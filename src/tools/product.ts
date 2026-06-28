import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { ResultAsync, err, ok } from "neverthrow";
import * as z from "zod/v4";

import type { AppError } from "../errors.js";

import { notFoundError } from "../errors.js";
import { fromApiResponse, getProps, safeResolveLocationId, toMcpError } from "../utils/result.js";
import { toonResult } from "../utils/toon.js";
import { APP_VIEW_URI } from "../utils/view-resource.js";
import { getProductDetailsOutputSchema, searchProductsOutputSchema } from "./output-schemas.js";
import { type ToolContext, textResult } from "./types.js";

export function logProductSearchError(term: string, error: AppError) {
  if (error.type === "AUTH_ERROR") {
    console.warn(`Search unavailable for "${term}":`, error.message);
    return;
  }

  console.error(`Error searching products for "${term}":`, error.message);
}

export function registerProductTools(ctx: ToolContext) {
  const { productClient } = ctx.clients;

  registerAppTool(
    ctx.server,
    "search_products",
    {
      title: "Search Products",
      description:
        "Searches for Kroger products using multiple search terms in parallel. Accepts 1–25 terms. Each term returns up to 10 items with pricing and availability. Results sorted by pickup availability.",
      _meta: { ui: { resourceUri: APP_VIEW_URI } },
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
          .max(25, { message: "Maximum 25 search terms allowed" })
          .describe("Array of search terms for products (e.g., ['milk', 'bread', 'eggs'])"),
        locationId: z
          .string()
          .length(8, { message: "Location ID must be exactly 8 characters" })
          .optional()
          .describe(
            "Location ID to check product availability at a specific store. If omitted, the user's saved preferred location is used.",
          ),
      }),
      outputSchema: searchProductsOutputSchema,
    },
    async ({ terms, locationId }, extra) => {
      const ITEMS_PER_TERM = 10;

      // Resolve locationId: explicit arg → preferred location → omit filter
      let resolvedLocationId: string | undefined = locationId;
      if (!resolvedLocationId) {
        const resolved = await safeResolveLocationId(ctx.storage, getProps().id, undefined);
        if (resolved.isOk()) {
          resolvedLocationId = resolved.value.locationId;
        }
      }

      let completedSearches = 0;
      const totalSearches = terms.length;
      const progressToken = extra?._meta?.progressToken;

      const searchPromises = terms.map(async (term) => {
        const queryParams: Record<string, string | number> = {
          "filter.term": term,
          ...(resolvedLocationId ? { "filter.locationId": resolvedLocationId } : {}),
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
          ).orTee((e) => console.error("Failed to send progress notification:", e));
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
          .orTee((error) => logProductSearchError(term, error))
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

      for (const result of results) {
        if (!result.failed && result.count > 0) {
          result.products.sort((a, b) => {
            const aItem = a.items?.[0];
            const bItem = b.items?.[0];
            const aPickup = aItem?.fulfillment?.curbside || aItem?.fulfillment?.instore;
            const bPickup = bItem?.fulfillment?.curbside || bItem?.fulfillment?.instore;

            if (aPickup && !bPickup) return -1;
            if (!aPickup && bPickup) return 1;
            return 0;
          });
        }
      }

      // Strip images from the model context — long CDN URLs the model doesn't
      // use. Images are preserved in structuredContent for the React UI.
      const resultsForContent = results.map((r) => ({
        ...r,
        products: r.products.map(({ images: _images, ...rest }) => rest),
      }));

      return {
        ...toonResult({ termCount: terms.length, totalProducts, results: resultsForContent }),
        structuredContent: { _view: "search_products", results, totalProducts },
      };
    },
  );

  registerAppTool(
    ctx.server,
    "get_product_details",
    {
      title: "Get Product Details",
      description:
        "Retrieves detailed information about a specific Kroger product by its 13-digit UPC, including pricing, availability, and nutritional information.",
      _meta: { ui: { resourceUri: APP_VIEW_URI } },
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
          .describe("Location ID to check product availability and pricing at a specific store"),
      }),
      outputSchema: getProductDetailsOutputSchema,
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
          return err(notFoundError(`No information found for product ID: ${productId}`));
        }
        return ok(product);
      });

      if (result.isErr()) {
        return toMcpError(result.error);
      }

      const product = result.value;

      // Strip images from model context; keep in structuredContent for UI.
      const { images: _images, ...productForContent } = product;

      return {
        ...toonResult(productForContent),
        structuredContent: { _view: "get_product_details", product },
      };
    },
  );
}
