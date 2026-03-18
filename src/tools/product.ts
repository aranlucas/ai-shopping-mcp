import { err, ok, ResultAsync } from "neverthrow";
import { z } from "zod";
import { notFoundError } from "../errors.js";
import {
  formatProductCompact,
  formatProductList,
} from "../utils/format-response.js";
import { fromApiResponse, toMcpResponse } from "../utils/result.js";
import { htmlResource } from "../utils/ui-resource.js";
import {
  productDetailHtml,
  productSearchResultsHtml,
} from "../utils/ui-templates.js";
import { type ToolContext, textResult } from "./types.js";

export function registerProductTools(ctx: ToolContext) {
  const { productClient } = ctx.clients;

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

        const apiResult = await fromApiResponse(
          productClient.GET("/v1/products", {
            params: { query: queryParams },
          }),
          `search products for "${term}"`,
        );

        completedSearches++;
        if (progressToken && extra?.sendNotification) {
          await ResultAsync.fromPromise(
            extra.sendNotification({
              method: "notifications/progress",
              params: {
                progressToken,
                progress: completedSearches,
                total: totalSearches,
              },
            }),
            (e) => e,
          ).orTee((e) =>
            console.error("Failed to send progress notification:", e),
          );
        }

        // Preserve Result type — map Ok to success shape, log and convert Err
        return apiResult
          .map((data) => {
            const products = data?.data || [];
            return {
              term,
              products,
              count: products.length,
              failed: false as const,
            };
          })
          .orTee((error) =>
            console.error(
              `Error searching products for "${term}":`,
              error.message,
            ),
          )
          .unwrapOr({
            term,
            products: [] as never[],
            count: 0,
            failed: true as const,
          });
      });

      const results = await Promise.all(searchPromises);
      const totalProducts = results.reduce((sum, r) => sum + r.count, 0);
      const failedTerms = results.filter((r) => r.failed);

      if (totalProducts === 0 && failedTerms.length === 0) {
        return textResult("No products found matching your search terms.");
      }

      if (totalProducts === 0 && failedTerms.length > 0) {
        return textResult(
          `Search failed for: ${failedTerms.map((r) => r.term).join(", ")}. Please try again.`,
        );
      }

      const formattedSections = results.map((result) => {
        if (result.failed) {
          return `**${result.term}** — search failed`;
        }
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

      const ui = htmlResource(
        "ui://search-products",
        productSearchResultsHtml(results, totalProducts),
      );

      return {
        content: [
          {
            type: "text" as const,
            text: `Bulk search completed (${terms.length} search terms, ${totalProducts} total products):\n\n${formattedSections.join("\n\n")}`,
          },
          ui,
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

      const result = await fromApiResponse(
        productClient.GET("/v1/products/{id}", {
          params: {
            path: { id: productId },
            query: queryParams,
          },
        }),
        "get product details",
      ).andThen((data) => {
        const product = data.data;
        if (!product) {
          return err(
            notFoundError(`No information found for product ID: ${productId}`),
          );
        }
        return ok(product);
      });

      if (result.isErr()) {
        return toMcpResponse(result.map(() => ""));
      }

      const product = result.value;
      const ui = htmlResource(
        "ui://product-details",
        productDetailHtml(product),
      );

      return {
        content: [
          {
            type: "text" as const,
            text: `Product Details:\n\n${formatProductList([product])}`,
          },
          ui,
        ],
      };
    },
  );
}
