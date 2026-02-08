import { z } from "zod";
import { productClient } from "../services/kroger/client.js";
import {
  formatProductCompact,
  formatProductList,
} from "../utils/format-response.js";
import type { ToolContext } from "./types.js";

export function registerProductTools(ctx: ToolContext) {
  ctx.server.registerTool(
    "search_products",
    {
      title: "Search Products",
      description:
        "Searches for Kroger products using multiple search terms in parallel. Each term returns up to 10 items with pricing and availability. Results sorted by pickup availability.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
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
      const ITEMS_PER_TERM = 10;

      let completedSearches = 0;
      const totalSearches = terms.length;
      const progressToken = extra?._meta?.progressToken;

      const searchPromises = terms.map(async (term) => {
        const queryParams: Record<string, string | number> = {
          "filter.term": term,
          "filter.locationId": locationId,
          "filter.fulfillment": "ais",
          "filter.limit": ITEMS_PER_TERM,
        };

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

      const results = await Promise.all(searchPromises);

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

      const formattedSections = results.map((result) => {
        if (result.count === 0) {
          return `**${result.term}** (0 items)\nNo products found.`;
        }

        result.products.sort((a, b) => {
          const aItem = a.items?.[0];
          const bItem = b.items?.[0];
          const aPickup =
            aItem?.fulfillment?.curbside || aItem?.fulfillment?.instore;
          const bPickup =
            bItem?.fulfillment?.curbside || bItem?.fulfillment?.instore;

          if (aPickup && !bPickup) return -1;
          if (!aPickup && bPickup) return 1;
          return 0;
        });

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

  ctx.server.registerTool(
    "get_product_details",
    {
      title: "Get Product Details",
      description:
        "Retrieves detailed information about a specific Kroger product by its 13-digit UPC, including pricing, availability, and nutritional information.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
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
      const queryParams: Record<string, string> = {};

      if (locationId) {
        queryParams["filter.locationId"] = locationId;
      }

      const { data, error } = await productClient.GET("/v1/products/{id}", {
        params: {
          path: { id: productId },
          query: queryParams,
        },
      });

      if (error) {
        console.error("Error getting product details:", error);
        return {
          content: [
            {
              type: "text",
              text: `Failed to get product details: ${JSON.stringify(error)}`,
            },
          ],
          isError: true,
        };
      }

      const product = data.data;
      if (!product) {
        return {
          content: [
            {
              type: "text",
              text: `No information found for product ID: ${productId}`,
            },
          ],
          isError: true,
        };
      }

      console.log(`Retrieved details for product: ${product.description}`);

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
