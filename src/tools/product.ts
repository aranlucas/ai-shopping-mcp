import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { ResultAsync, err, ok } from "neverthrow";
import * as z from "zod/v4";

import type { AppError } from "../errors.js";
import type { KrogerClients } from "../services/kroger/client.js";
import type { components as ProductComponents } from "../services/kroger/product.js";

import { notFoundError } from "../errors.js";
import {
  formatProductDetailMarkdown,
  formatSearchProductsMarkdown,
} from "../utils/format-response.js";
import { fromApiResponse, getProps, safeResolveLocationId, toMcpError } from "../utils/result.js";
import { APP_VIEW_URI } from "../utils/view-resource.js";
import { storeIdSchema, upcSchema } from "./schemas.js";
import { type ToolContext, errorResult } from "./types.js";

type Product = ProductComponents["schemas"]["products.productModel"];

export type ProductSearchResult = {
  term: string;
  products: Product[];
  count: number;
  failed: boolean;
};

export function logProductSearchError(term: string, error: AppError) {
  if (error.type === "AUTH_ERROR") {
    console.warn(`Search unavailable for "${term}":`, error.message);
    return;
  }

  console.error(`Error searching products for "${term}":`, error.message);
}

/**
 * Searches Kroger products for each term in parallel. Shared by `search_products`
 * and `shop_for_items` so both tools use the same query shape, sorting, and
 * error handling.
 */
export async function searchProductsForTerms(
  productClient: KrogerClients["productClient"],
  terms: string[],
  params: { locationId?: string; limitPerTerm: number },
  onSearchComplete?: (completed: number, total: number) => Promise<void> | void,
): Promise<ProductSearchResult[]> {
  let completedSearches = 0;
  const totalSearches = terms.length;

  const searchPromises = terms.map(async (term) => {
    const queryParams: Record<string, string | number> = {
      "filter.term": term,
      ...(params.locationId ? { "filter.locationId": params.locationId } : {}),
      "filter.fulfillment": "ais",
      "filter.limit": params.limitPerTerm,
    };

    const apiResult = await fromApiResponse(
      productClient.GET("/v1/products", {
        params: { query: queryParams },
      }),
      `search products for "${term}"`,
    );

    completedSearches++;
    if (onSearchComplete) await onSearchComplete(completedSearches, totalSearches);

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
          products: [] as Product[],
          count: 0,
          failed: true as const,
        }),
      );
  });

  const results = await Promise.all(searchPromises);

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

  return results;
}

export function registerProductTools(ctx: ToolContext) {
  const { productClient } = ctx.clients;

  registerAppTool(
    ctx.server,
    "search_products",
    {
      title: "Search Products",
      description:
        'Searches Kroger/QFC products using 1-10 search terms in parallel, up to limitPerTerm products each, with UPCs, pricing, and pickup availability at the given or preferred store. Example: {"terms":["milk","eggs"]}',
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
          .describe("Search terms, e.g. ['milk', 'bread', 'eggs']"),
        storeId: storeIdSchema
          .optional()
          .describe(
            "8-character storeId from search_stores. Uses your preferred store if omitted.",
          ),
        limitPerTerm: z.coerce
          .number()
          .int()
          .min(1)
          .max(10)
          .default(5)
          .describe("Max products to return per search term (1-10)"),
      }),
    },
    async ({ terms, storeId, limitPerTerm }, extra) => {
      // Resolve storeId: explicit arg → preferred store → omit filter
      let resolvedLocationId: string | undefined = storeId;
      if (!resolvedLocationId) {
        const resolved = await safeResolveLocationId(ctx.storage, getProps().id, undefined);
        resolved.match(
          (location) => {
            resolvedLocationId = location.locationId;
          },
          () => undefined,
        );
      }

      const progressToken = extra?._meta?.progressToken;
      const sendNotification = extra?.sendNotification;

      const results = await searchProductsForTerms(
        productClient,
        terms,
        { locationId: resolvedLocationId, limitPerTerm },
        progressToken && sendNotification
          ? async (completed, total) => {
              await ResultAsync.fromPromise(
                sendNotification({
                  method: "notifications/progress",
                  params: { progressToken, progress: completed, total },
                }),
                (e) => e,
              ).orTee((e) => console.error("Failed to send progress notification:", e));
            }
          : undefined,
      );

      const totalProducts = results.reduce((sum, r) => sum + r.count, 0);
      const failedTerms = results.filter((r) => r.failed);

      if (totalProducts === 0 && failedTerms.length > 0) {
        return errorResult(
          `Search failed for: ${failedTerms.map((r) => r.term).join(", ")}. Please try again.`,
        );
      }

      return {
        content: [{ type: "text" as const, text: formatSearchProductsMarkdown(results) }],
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
        "Retrieves detailed Kroger/QFC product information by UPC, including size variants, pricing, and availability at a store.",
      _meta: { ui: { resourceUri: APP_VIEW_URI } },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: z.object({
        productId: upcSchema.describe("UPC from search_products"),
        storeId: storeIdSchema
          .optional()
          .describe("8-character storeId from search_stores to check availability and pricing"),
      }),
    },
    async ({ productId, storeId }) => {
      const queryParams: Record<string, string> = {};
      if (storeId) {
        queryParams["filter.locationId"] = storeId;
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
        return {
          content: [{ type: "text" as const, text: formatProductDetailMarkdown(product) }],
          structuredContent: { _view: "get_product", product },
        };
      }, toMcpError);
    },
  );
}
