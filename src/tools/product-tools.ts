import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { productClient } from "../services/kroger/client.js";
import {
  formatProductCompact,
  formatProductList,
} from "../utils/format-response.js";

/**
 * Registers product search and details tools with the MCP server.
 *
 * Tools:
 * - search_products: Bulk search for products using multiple terms
 * - get_product_details: Get detailed info about a specific product
 */
export function registerProductTools(server: McpServer) {
  // Search products tool - bulk search with limit of 10 items per term
  server.registerTool(
    "search_products",
    {
      description:
        "Searches for Kroger products in bulk using multiple search terms. Use this tool when the user wants to find multiple products at once. Each search term returns up to 10 items. Provides essential product details including pricing and availability.",
      inputSchema: z.object({
        terms: z
          .array(z.string().max(100))
          .min(1, { message: "At least one search term is required" })
          .max(10, { message: "Maximum 10 search terms allowed" })
          .describe(
            "Array of search terms for products (e.g., ['milk', 'bread', 'eggs'])",
          ),
        locationId: z
          .string()
          .length(8, { message: "Location ID must be exactly 8 characters" })
          .describe(
            "Location ID to check product availability at a specific store",
          ),
      }),
    },
    async ({ terms, locationId }, extra) => {
      // Limit of 10 items per search term
      const ITEMS_PER_TERM = 10;

      // Progress tracking
      let completedSearches = 0;
      const totalSearches = terms.length;
      const progressToken = extra?._meta?.progressToken;

      // Execute all searches in parallel with progress tracking
      const searchPromises = terms.map(async (term) => {
        // Build query parameters
        const queryParams: Record<string, string | number> = {
          "filter.term": term,
          "filter.locationId": locationId,
          "filter.fulfillment": "ais",
          "filter.limit": ITEMS_PER_TERM,
        };

        // Make the API call to search for products
        const { data, error } = await productClient.GET("/v1/products", {
          params: {
            query: queryParams,
          },
        });

        if (error) {
          console.error(`Error searching products for term "${term}":`, error);
          return { term, products: [], count: 0 };
        }

        const products = data?.data || [];
        console.log(`Found ${products.length} products for term "${term}"`);

        // Send progress notification after each search completes
        completedSearches++;
        if (progressToken && extra?.sendNotification) {
          try {
            await extra.sendNotification({
              method: "notifications/progress",
              params: {
                progressToken,
                progress: completedSearches,
                total: totalSearches,
              },
            });
          } catch (error) {
            console.error("Failed to send progress notification:", error);
          }
        }

        return { term, products, count: products.length };
      });

      // Wait for all searches to complete
      const results = await Promise.all(searchPromises);

      // Count total products
      const totalProducts = results.reduce((sum, r) => sum + r.count, 0);

      if (totalProducts === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No products found matching your search terms.",
            },
          ],
        };
      }

      // Format results grouped by search term
      const formattedSections = results.map((result) => {
        if (result.count === 0) {
          return `**${result.term}** (0 items)\nNo products found.`;
        }

        // Sort products within each term: pickup in-stock first, then delivery-only, then out-of-stock last
        result.products.sort((a, b) => {
          const aItem = a.items?.[0];
          const bItem = b.items?.[0];
          const aPickup =
            aItem?.fulfillment?.curbside || aItem?.fulfillment?.instore;
          const bPickup =
            bItem?.fulfillment?.curbside || bItem?.fulfillment?.instore;

          // Pickup available items come first
          if (aPickup && !bPickup) return -1;
          if (!aPickup && bPickup) return 1;
          return 0;
        });

        // Format products for this term
        const productsFormatted = result.products
          .map(
            (product, index) =>
              `  ${index + 1}. ${formatProductCompact(product)}`,
          )
          .join("\n");

        return `**${result.term}** (${result.count} items)\n${productsFormatted}`;
      });

      return {
        content: [
          {
            type: "text",
            text: `Bulk search completed (${terms.length} search terms, ${totalProducts} total products):\n\n${formattedSections.join("\n\n")}`,
          },
        ],
      };
    },
  );

  // Get product details tool
  server.registerTool(
    "get_product_details",
    {
      description:
        "Retrieves detailed information about a specific Kroger product using its product ID. Use this tool when the user needs comprehensive details about a particular product, including pricing, availability, nutritional information, and images.",
      inputSchema: z.object({
        productId: z.string().length(13, {
          message: "Product ID must be a 13-digit UPC number",
        }),
        locationId: z
          .string()
          .length(8, { message: "Location ID must be exactly 8 characters" })
          .optional()
          .describe(
            "Location ID to check product availability and pricing at a specific store",
          ),
      }),
    },
    async ({ productId, locationId }) => {
      // Build query parameters
      const queryParams: Record<string, string> = {};

      if (locationId) {
        queryParams["filter.locationId"] = locationId;
      }

      // Make the API call to get product details
      const { data, error } = await productClient.GET("/v1/products/{id}", {
        params: {
          path: { id: productId },
          query: queryParams,
        },
      });

      if (error) {
        console.error("Error getting product details:", error);
        throw new Error(
          `Failed to get product details: ${JSON.stringify(error)}`,
        );
      }

      const product = data.data;
      if (!product) {
        throw new Error(`No information found for product ID: ${productId}`);
      }

      console.log(`Retrieved details for product: ${product.description}`);

      // Return successful response with formatted product
      const formattedProduct = formatProductList([product]);

      return {
        content: [
          {
            type: "text",
            text: `Product Details:\n\n${formattedProduct}`,
          },
        ],
      };
    },
  );
}
