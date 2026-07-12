/**
 * MCP prompts for guided Kroger/QFC shopping workflows.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import * as z from "zod/v4";

export function registerPrompts(server: McpServer) {
  server.registerPrompt(
    "plan_shopping_route",
    {
      title: "Plan Shopping Route",
      description:
        "Plan an efficient in-store shopping route by matching grocery items to product departments and aisle information.",
      argsSchema: {
        grocery_list: z.string().optional().describe("Optional grocery list items to organize"),
      },
    },
    async ({ grocery_list }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: grocery_list
              ? `I have the following grocery list and need help finding the most efficient path through the store:

${grocery_list}

Please help me by:
1. Calling search_products once with all items in its terms array to find aisle/department locations
2. Organizing the items by department/aisle in a logical order
3. Suggesting an efficient route through the store

IMPORTANT: DO NOT add items to my cart. Only help me organize the shopping path.`
              : `I need help planning a shopping trip. Please help me by:

1. Understanding what items I might need (you can check my pantry, order history, or ask me what I'm looking for)
2. Once we have a list, call search_products once with all items in its terms array to find aisle/department locations
3. Organize the items by department/aisle in a logical order
4. Suggest an efficient route through the store

IMPORTANT: DO NOT add items to my cart. Only help me organize the shopping path.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "set_preferred_store",
    {
      title: "Set Preferred Store",
      description:
        "Guide the user through finding nearby Kroger/QFC stores and saving one as their preferred store.",
      argsSchema: {
        zip_code: z
          .string()
          .length(5)
          .optional()
          .describe("Optional zip code to search for nearby stores"),
      },
    },
    ({ zip_code }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Please help me set my preferred Kroger store location.

${zip_code ? `Search for stores near zip code: ${zip_code}` : "Search for stores near my area"}

Please:
1. Use search_stores to find nearby Kroger/QFC locations
2. Show me the options with their addresses and store IDs
3. Use set_preferred_store after I choose a store

This will make future shopping and product searches more convenient.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "shop_recipe_ingredients",
    {
      title: "Shop Recipe Ingredients",
      description:
        "Help the user turn a recipe or dish idea into shoppable Kroger/QFC ingredients, a shopping list, and optional cart handoff.",
      argsSchema: {
        recipe_type: z
          .string()
          .default("classic apple pie")
          .describe("The recipe or dish the user wants to shop for"),
      },
    },
    ({ recipe_type }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `I want to make ${recipe_type}. Please help me by:

1. Asking whether I already have a specific recipe; if not, propose a practical ingredient list for ${recipe_type}
2. Checking my pantry context when useful so we do not buy items I already have
3. Calling search_products once with all missing ingredients in its terms array at my preferred store
4. Creating a shopping list with create_shopping_list using UPCs for the selected products
5. Offering to add that list to my cart with add_shopping_list_to_cart after I confirm pickup or delivery
6. Suggesting alternatives for any ingredients that are not available

Please make sure to check product availability at my preferred location before adding to cart.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "plan_meals_from_pantry",
    {
      title: "Plan Meals From Pantry",
      description:
        "Use pantry, expiry, equipment, and recent-order context to draft meal ideas and optionally prepare a shopping list for missing ingredients.",
      argsSchema: {
        meal_count: z
          .string()
          .optional()
          .default("3")
          .describe("Number of meals to plan; passed to get_meal_planning_context"),
      },
    },
    ({ meal_count }) => {
      const parsedCount = Number.parseInt(meal_count ?? "3", 10);
      const numberOfMeals = Number.isFinite(parsedCount)
        ? Math.min(Math.max(parsedCount, 1), 7)
        : 3;

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Please plan meals from my pantry.

1. Call get_meal_planning_context with numberOfMeals: ${numberOfMeals}
2. Use the returned pantry, expiry, equipment, and recent-order context to suggest meals
3. Prioritize expiring ingredients and exclude expired items
4. For missing ingredients I want to buy, create a shopping list with create_shopping_list

Do not invent pantry contents; use the context returned by get_meal_planning_context.`,
            },
          },
        ],
      };
    },
  );
}
