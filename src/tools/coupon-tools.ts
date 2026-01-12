import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createUserStorage } from "../utils/user-storage.js";

// Context from the auth process, encrypted & stored in the auth token
type Props = {
  id: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt: number;
  krogerClientId: string;
  krogerClientSecret: string;
};

/**
 * Registers AI-powered coupon, deals, and recipe tools with the MCP server.
 *
 * Tools:
 * - suggest_recipes_from_pantry: AI-powered recipe suggestions
 * - categorize_shopping_list: AI-powered shopping list organization
 * - get_weekly_deals_from_web: AI web scraping for weekly deals
 * - search_recipes_from_web: AI web scraping for recipes
 */
export function registerCouponTools(
  server: McpServer,
  env: Env,
  getProps: () => Props | undefined,
) {
  // MCP Sampling tool: Suggest recipes from pantry items
  server.registerTool(
    "suggest_recipes_from_pantry",
    {
      description:
        "Uses AI to suggest recipes based on items currently in your pantry. This tool analyzes your pantry inventory and generates creative recipe ideas using the items you have available.",
      inputSchema: z.object({
        cuisineType: z
          .string()
          .optional()
          .describe(
            "Optional cuisine preference (e.g., 'Italian', 'Mexican', 'Asian')",
          ),
        maxRecipes: z
          .number()
          .min(1)
          .max(5)
          .optional()
          .default(3)
          .describe("Number of recipe suggestions to generate (1-5)"),
      }),
    },
    async ({ cuisineType, maxRecipes }) => {
      const props = getProps();
      if (!props?.id) {
        throw new Error("User not authenticated");
      }

      const storage = createUserStorage(env.USER_DATA_KV);
      const pantry = await storage.pantry.getAll(props.id);

      if (pantry.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "Your pantry is empty. Add items to your pantry first using the add_to_pantry tool, then try this again!",
            },
          ],
        };
      }

      // Build the prompt for the LLM
      const pantryItems = pantry
        .map((item) => `- ${item.productName} (${item.quantity})`)
        .join("\n");

      const cuisineConstraint = cuisineType
        ? `Focus on ${cuisineType} cuisine. `
        : "";

      const prompt = `Given these pantry items:

${pantryItems}

${cuisineConstraint}Suggest ${maxRecipes} creative recipes I can make using ONLY these ingredients (or common household staples like salt, pepper, oil).

For each recipe, provide:
1. Recipe name
2. Required ingredients from the pantry
3. Brief cooking instructions (3-5 steps)
4. Estimated cooking time

Format each recipe clearly and concisely.`;

      // Use MCP sampling to request AI completion via the underlying server
      const samplingResult = await server.server.createMessage({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: prompt,
            },
          },
        ],
        maxTokens: 1000,
      });

      // Extract the text response from sampling result
      // The content field can be a single item or array
      const content = Array.isArray(samplingResult.content)
        ? samplingResult.content[0]
        : samplingResult.content;
      const recipeText =
        content?.type === "text" ? content.text : "Unable to generate recipes";

      return {
        content: [
          {
            type: "text",
            text: `**Recipe Suggestions Based on Your Pantry**\n\n${recipeText}\n\n---\n*Based on ${pantry.length} items in your pantry*`,
          },
        ],
      };
    },
  );

  // MCP Sampling tool: Smart shopping list categorization
  server.registerTool(
    "categorize_shopping_list",
    {
      description:
        "Uses AI to intelligently categorize and organize a shopping list by store department/aisle. Helps plan an efficient path through the store.",
      inputSchema: z.object({
        items: z
          .array(z.string())
          .describe(
            "List of items to categorize (e.g., ['milk', 'bread', 'chicken'])",
          ),
      }),
    },
    async ({ items }) => {
      if (items.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "Please provide at least one item to categorize.",
            },
          ],
        };
      }

      const itemList = items
        .map((item, idx) => `${idx + 1}. ${item}`)
        .join("\n");

      const prompt = `Organize this shopping list by grocery store department/aisle:

${itemList}

Group items by these common grocery store departments:
- Produce (fruits, vegetables)
- Meat & Seafood
- Dairy & Eggs
- Bakery
- Pantry & Canned Goods
- Frozen Foods
- Beverages
- Snacks & Candy
- Health & Beauty
- Household Items

For each department that has items, list the items under that department.
Provide a suggested shopping route (which departments to visit in order for efficiency).`;

      // Use MCP sampling to request AI completion via the underlying server
      const samplingResult = await server.server.createMessage({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: prompt,
            },
          },
        ],
        maxTokens: 800,
      });

      // Extract the text response from sampling result
      const content = Array.isArray(samplingResult.content)
        ? samplingResult.content[0]
        : samplingResult.content;
      const categorizedText =
        content?.type === "text"
          ? content.text
          : "Unable to categorize shopping list";

      return {
        content: [
          {
            type: "text",
            text: `**Shopping List Organized by Department**\n\n${categorizedText}`,
          },
        ],
      };
    },
  );

  // MCP Sampling tool: Extract weekly deals from QFC webpage
  server.registerTool(
    "get_weekly_deals_from_web",
    {
      description:
        "Uses AI to scrape and extract current weekly deals from the QFC website. Returns structured deals data including product names, prices, and savings.",
      inputSchema: z.object({
        zipCode: z
          .string()
          .length(5)
          .optional()
          .default("98122")
          .describe("Zip code for location-specific deals"),
      }),
    },
    async ({ zipCode }) => {
      try {
        // Fetch the QFC weekly deals page
        const dealsUrl = `https://www.qfc.com/savings/weekly-ad?zipcode=${zipCode}`;
        console.log(`Fetching weekly deals from: ${dealsUrl}`);

        const response = await fetch(dealsUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Accept: "text/html,application/xhtml+xml,application/xml",
          },
        });

        if (!response.ok) {
          throw new Error(
            `Failed to fetch deals page: ${response.status} ${response.statusText}`,
          );
        }

        const html = await response.text();

        // Extract just the body content (remove scripts, styles for cleaner parsing)
        const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        const bodyContent = bodyMatch ? bodyMatch[1] : html;

        // Remove script and style tags
        const cleanedHtml = bodyContent
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
          .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
          .substring(0, 50000); // Limit to 50k chars to stay within token limits

        // Use sampling to have the LLM extract deals
        const prompt = `Parse this QFC weekly deals webpage HTML and extract all product deals.

For each deal, extract:
- Product name/description
- Original price (if available)
- Sale price
- Savings amount or percentage
- Any special conditions (e.g., "with card", "limit 5")
- Department/category

Return the results as a structured JSON array. Example format:
[
  {
    "product": "Product name",
    "originalPrice": "$9.99",
    "salePrice": "$6.99",
    "savings": "Save $3.00",
    "conditions": "With digital coupon",
    "category": "Produce"
  }
]

Only return the JSON array, no other text.

HTML to parse:
${cleanedHtml}`;

        // Use MCP sampling to request AI completion
        const samplingResult = await server.server.createMessage({
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: prompt,
              },
            },
          ],
          maxTokens: 2000,
        });

        // Extract the text response
        const content = Array.isArray(samplingResult.content)
          ? samplingResult.content[0]
          : samplingResult.content;
        const dealsText =
          content?.type === "text" ? content.text : "Unable to extract deals";

        // Try to parse as JSON
        let dealsData: unknown;
        try {
          // Extract JSON from markdown code blocks if present
          const jsonMatch = dealsText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
          const jsonText = jsonMatch ? jsonMatch[1] : dealsText;
          dealsData = JSON.parse(jsonText);
        } catch {
          // If parsing fails, return as formatted text
          dealsData = dealsText;
        }

        return {
          content: [
            {
              type: "text",
              text:
                typeof dealsData === "string"
                  ? `**Weekly Deals (Zip: ${zipCode})**\n\n${dealsData}`
                  : `**Weekly Deals (Zip: ${zipCode})**\n\nFound ${Array.isArray(dealsData) ? dealsData.length : 0} deals:\n\n${JSON.stringify(dealsData, null, 2)}`,
            },
          ],
        };
      } catch (error) {
        console.error("Error fetching weekly deals:", error);
        return {
          content: [
            {
              type: "text",
              text: `Failed to fetch weekly deals: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          ],
        };
      }
    },
  );

  // MCP Sampling tool: Search recipes from Janella's Cookbook
  server.registerTool(
    "search_recipes_from_web",
    {
      description:
        "Uses AI to scrape and extract recipes from Janella's Cookbook website. Searches for recipes by keyword and returns detailed recipe information including ingredients and instructions.",
      inputSchema: z.object({
        searchQuery: z
          .string()
          .min(1)
          .describe("Recipe search query (e.g., 'Cookie', 'Pasta', 'Chicken')"),
      }),
    },
    async ({ searchQuery }) => {
      try {
        // Fetch the recipe search results page
        const recipeUrl = `https://janella-cookbook.vercel.app/search?q=${encodeURIComponent(searchQuery)}`;
        console.log(`Fetching recipes from: ${recipeUrl}`);

        const response = await fetch(recipeUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Accept: "text/html,application/xhtml+xml,application/xml",
          },
        });

        if (!response.ok) {
          throw new Error(
            `Failed to fetch recipe page: ${response.status} ${response.statusText}`,
          );
        }

        const html = await response.text();

        // Extract just the body content (remove scripts, styles for cleaner parsing)
        const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        const bodyContent = bodyMatch ? bodyMatch[1] : html;

        // Remove script and style tags
        const cleanedHtml = bodyContent
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
          .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
          .substring(0, 50000); // Limit to 50k chars to stay within token limits

        // Use sampling to have the LLM extract recipes
        const prompt = `Parse this recipe search results webpage HTML and extract recipe information.

For each recipe found, extract:
- Recipe name/title
- Description (if available)
- Ingredients list (as array)
- Cooking instructions (step-by-step)
- Prep time (if available)
- Cook time (if available)
- Servings (if available)
- Recipe URL or ID (if available)

Return the results as a structured JSON array. Example format:
[
  {
    "name": "Recipe name",
    "description": "Brief description",
    "ingredients": ["ingredient 1", "ingredient 2"],
    "instructions": ["Step 1", "Step 2"],
    "prepTime": "15 minutes",
    "cookTime": "30 minutes",
    "servings": "4",
    "url": "recipe-url-if-available"
  }
]

Only return the JSON array, no other text. Limit to 5 recipes maximum.

HTML to parse:
${cleanedHtml}`;

        // Use MCP sampling to request AI completion
        const samplingResult = await server.server.createMessage({
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: prompt,
              },
            },
          ],
          maxTokens: 2000,
        });

        // Extract the text response
        const content = Array.isArray(samplingResult.content)
          ? samplingResult.content[0]
          : samplingResult.content;
        const recipesText =
          content?.type === "text" ? content.text : "Unable to extract recipes";

        // Try to parse as JSON
        let recipesData: unknown;
        try {
          // Extract JSON from markdown code blocks if present
          const jsonMatch = recipesText.match(
            /```(?:json)?\s*([\s\S]*?)\s*```/,
          );
          const jsonText = jsonMatch ? jsonMatch[1] : recipesText;
          recipesData = JSON.parse(jsonText);
        } catch {
          // If parsing fails, return as formatted text
          recipesData = recipesText;
        }

        // Format the response
        if (typeof recipesData === "string") {
          return {
            content: [
              {
                type: "text",
                text: `**Recipe Search Results for "${searchQuery}"**\n\n${recipesData}`,
              },
            ],
          };
        }

        // Format as structured recipes
        const formattedRecipes = Array.isArray(recipesData)
          ? recipesData
              .map((recipe, idx) => {
                const parts = [`**${idx + 1}. ${recipe.name}**`];

                if (recipe.description) {
                  parts.push(`${recipe.description}`);
                }

                if (recipe.prepTime || recipe.cookTime || recipe.servings) {
                  const metadata = [];
                  if (recipe.prepTime)
                    metadata.push(`Prep: ${recipe.prepTime}`);
                  if (recipe.cookTime)
                    metadata.push(`Cook: ${recipe.cookTime}`);
                  if (recipe.servings)
                    metadata.push(`Serves: ${recipe.servings}`);
                  parts.push(metadata.join(" | "));
                }

                if (recipe.ingredients && recipe.ingredients.length > 0) {
                  parts.push("\n**Ingredients:**");
                  recipe.ingredients.forEach((ing: string) => {
                    parts.push(`- ${ing}`);
                  });
                }

                if (recipe.instructions && recipe.instructions.length > 0) {
                  parts.push("\n**Instructions:**");
                  recipe.instructions.forEach((step: string, i: number) => {
                    parts.push(`${i + 1}. ${step}`);
                  });
                }

                return parts.join("\n");
              })
              .join("\n\n---\n\n")
          : JSON.stringify(recipesData, null, 2);

        return {
          content: [
            {
              type: "text",
              text: `**Recipe Search Results for "${searchQuery}"**\n\nFound ${Array.isArray(recipesData) ? recipesData.length : 0} recipes:\n\n${formattedRecipes}`,
            },
          ],
        };
      } catch (error) {
        console.error("Error fetching recipes:", error);
        return {
          content: [
            {
              type: "text",
              text: `Failed to fetch recipes: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          ],
        };
      }
    },
  );
}
