import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { ResultAsync, err, ok } from "neverthrow";
import * as z from "zod/v4";

import type { AppError } from "../errors.js";
import type { components as ProductComponents } from "../services/kroger/product.js";

import { notFoundError } from "../errors.js";
import { fromApiResponse, getProps, safeResolveLocationId, toMcpError } from "../utils/result.js";
import { toonResult } from "../utils/toon.js";
import { APP_VIEW_URI } from "../utils/view-resource.js";
import { type ToolContext, errorResult } from "./types.js";

type Product = ProductComponents["schemas"]["products.productModel"];

// Compact representation for toon encoding of bulk search results.
// Strips images, categories, extra aisle locations, itemId, shiptohome,
// and inventory detail — the full data lives in structuredContent for the
// React UI. Retains all size/price variants so the agent can present options.
function compactProductForContent(product: Product) {
  return {
    upc: product.upc,
    description: product.description,
    brand: product.brand,
    aisle: product.aisleLocations?.[0]?.description,
    items: product.items?.map(({ itemId: _itemId, ...item }) => ({
      size: item.size,
      price: item.price?.promo ?? item.price?.regular,
      ...(item.price?.promo != null && item.price.promo !== item.price?.regular
        ? { was: item.price?.regular }
        : {}),
      pickup: !!(item.fulfillment?.curbside || item.fulfillment?.instore),
    })),
  };
}

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
        "Searches Kroger/QFC products using 1-10 search terms in parallel. Each term returns up to 10 products with UPCs, pricing, and pickup availability at the provided or preferred store.",
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
          .max(10, { message: "Maximum 10 search terms allowed" })
          .describe("Array of search terms for products (e.g., ['milk', 'bread', 'eggs'])"),
        locationId: z
          .string()
          .length(8, { message: "Location ID must be exactly 8 characters" })
          .optional()
          .describe(
            "Location ID to check product availability at a specific store. If omitted, the user's saved preferred location is used.",
          ),
      }),
    },
    async ({ terms, locationId }, extra) => {
      const ITEMS_PER_TERM = 10;

      // Resolve locationId: explicit arg → preferred location → omit filter
      let resolvedLocationId: string | undefined = locationId;
      if (!resolvedLocationId) {
        const resolved = await safeResolveLocationId(ctx.storage, getProps().id, undefined);
        resolved.match(
          (location) => {
            resolvedLocationId = location.locationId;
          },
          () => undefined,
        );
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
          .match(
            (result) => result,
            () => ({
              term,
              products: [] as never[],
              count: 0,
              failed: true as const,
            }),
          );
      });

      const results = await Promise.all(searchPromises);
      const totalProducts = results.reduce((sum, r) => sum + r.count, 0);
      const failedTerms = results.filter((r) => r.failed);

      if (totalProducts === 0 && failedTerms.length > 0) {
        return errorResult(
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

      // Strip images, categories, extra aisle locations, and item IDs from the
      // model context. Full product data is preserved in structuredContent for
      // the React UI.
      const resultsForContent = results.map((r) => ({
        ...r,
        products: r.products.map((product) => compactProductForContent(product)),
      }));

      return {
        ...toonResult({ termCount: terms.length, totalProducts, results: resultsForContent }),
        structuredContent: { _view: "search_products", results, totalProducts },
      };
    },
  );

  registerAppTool(
    ctx.server,
    "get_product",
    {
      title: "Get Product Details",
      description:
        "Retrieves detailed Kroger/QFC product information by 13-digit UPC, including size variants, pricing, availability, images for the app view, and nutrition or fulfillment fields returned by Kroger.",
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

      return result.match((product) => {
        // Strip images from model context; keep in structuredContent for UI.
        const { images: _images, ...productForContent } = product;

        return {
          ...toonResult(productForContent),
          structuredContent: { _view: "get_product", product },
        };
      }, toMcpError);
    },
  );
}
