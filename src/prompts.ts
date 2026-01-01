/**
 * MCP Prompts for Kroger AI Assistant
 * These prompts provide guided workflows for common shopping scenarios
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerPrompts(server: McpServer) {
  /**
   * Prompt 1: Grocery List Store Path
   * Helps users find the optimal path through a store based on their grocery list
   */
  server.prompt(
    "grocery_list_store_path",
    "Generate a prompt to find the optimal path through a store based on a grocery list",
    {
      grocery_list: z
        .string()
        .describe("The grocery list items to organize into a store path"),
    },
    ({ grocery_list }: { grocery_list: string }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `I have the following grocery list and need help finding the most efficient path through the store:

${grocery_list}

Please help me by:
1. Searching for each item to find their aisle/department locations
2. Organizing the items by department/aisle in a logical order
3. Suggesting an efficient route through the store

IMPORTANT: DO NOT add items to my cart. Only help me organize the shopping path.`,
          },
        },
      ],
    }),
  );

  /**
   * Prompt 2: Pharmacy Open Check
   * Verifies whether a pharmacy at the preferred Kroger location is open
   */
  server.prompt(
    "pharmacy_open_check",
    "Generate a prompt to check if the pharmacy at the preferred Kroger location is open",
    {},
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Please check if the pharmacy at my preferred Kroger store is currently open.

Use the get_location_details tool to:
1. Check the pharmacy department information
2. Verify the current hours of operation
3. Let me know if it's open right now and what services are available

If I don't have a preferred location set, please help me set one first.`,
          },
        },
      ],
    }),
  );

  /**
   * Prompt 3: Set Preferred Store
   * Guides users through selecting and saving their preferred Kroger store
   */
  server.prompt(
    "set_preferred_store",
    "Generate a prompt to help the user set their preferred Kroger store",
    {
      zip_code: z
        .string()
        .length(5)
        .optional()
        .describe("Optional zip code to search for nearby stores"),
    },
    ({ zip_code }: { zip_code?: string }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Please help me set my preferred Kroger store location.

${zip_code ? `Search for stores near zip code: ${zip_code}` : "Search for stores near my area"}

Please:
1. Search for nearby Kroger/QFC locations
2. Show me the options with their addresses and distances
3. Help me select my preferred location

This will make future shopping and product searches more convenient.`,
          },
        },
      ],
    }),
  );

  /**
   * Prompt 4: Add Recipe to Cart
   * Finds a recipe and automatically adds ingredients to the shopping cart
   */
  server.prompt(
    "add_recipe_to_cart",
    "Generate a prompt to find a specific recipe and add its ingredients to cart",
    {
      recipe_type: z
        .string()
        .default("classic apple pie")
        .describe("The type of recipe to search for"),
    },
    ({ recipe_type }: { recipe_type: string }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `I want to make ${recipe_type}. Please help me by:

1. Finding a good recipe for ${recipe_type}
2. Showing me the ingredients and instructions
3. Searching for each ingredient at my local store
4. Adding all available ingredients to my cart using bulk_add_to_cart
5. Suggesting alternatives for any ingredients that aren't available
6. Asking me if I want delivery or pickup before completing the additions

Please make sure to check product availability at my preferred location before adding to cart.`,
          },
        },
      ],
    }),
  );
}
