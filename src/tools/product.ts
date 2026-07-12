import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { ResultAsync } from "neverthrow";
import * as z from "zod/v4";

import type { AppError } from "../errors.js";
import type { KrogerClients } from "../services/kroger/client.js";
import type { components as ProductComponents } from "../services/kroger/product.js";

import {
  formatProductDetailMarkdown,
  formatSearchProductsMarkdown,
} from "../utils/format-response.js";
import { fromApiResponse, getProps, safeResolveLocationId, toMcpError } from "../utils/result.js";
import { APP_VIEW_META_KEY } from "../utils/view-meta.js";
import { APP_VIEW_URI } from "../utils/view-resource.js";
import { storeIdSchema, upcSchema } from "./schemas.js";
import { type ToolContext, errorResult } from "./types.js";

type Product = ProductComponents["schemas"]["products.productModel"];

type SearchProduct = Pick<
  Product,
  "upc" | "description" | "brand" | "categories" | "aisleLocations"
> & {
  images?: Product["images"];
  items?: Product["items"];
};

export type ProductSearchResult = {
  term: string;
  products: Product[];
  count: number;
  failed: boolean;
};

/**
 * Keep the MCP Apps payload useful without sending the complete Kroger catalog
 * record to hosts that include structuredContent in model context.
 */
export function compactSearchProduct(product: Product): SearchProduct {
  const image =
    product.images?.find((candidate) => candidate.default || candidate.perspective === "front") ??
    product.images?.[0];
  const imageSize =
    image?.sizes?.find((size) => size.size === "thumbnail" || size.size === "small") ??
    image?.sizes?.[0];
  const item = product.items?.[0];

  return {
    upc: product.upc,
    description: product.description,
    brand: product.brand,
    categories: product.categories,
    aisleLocations: product.aisleLocations?.slice(0, 1),
    images: image
      ? [
          {
            perspective: image.perspective,
            default: image.default,
            sizes: imageSize ? [imageSize] : [],
          },
        ]
      : undefined,
    items: item
      ? [
          {
            size: item.size,
            price: item.price
              ? { regular: item.price.regular, promo: item.price.promo }
              : undefined,
            fulfillment: item.fulfillment
              ? {
                  curbside: item.fulfillment.curbside,
                  delivery: item.fulfillment.delivery,
                  instore: item.fulfillment.instore,
                  shiptohome: item.fulfillment.shiptohome,
                }
              : undefined,
            inventory: item.inventory ? { stockLevel: item.inventory.stockLevel } : undefined,
          },
        ]
      : undefined,
  };
}

export const getProductInputSchema = z.object({
  upc: upcSchema.describe("UPC from search_products"),
  storeId: storeIdSchema
    .optional()
    .describe("8-character storeId from search_stores to check availability and pricing"),
});

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
        'Batch product search. Put every needed item (up to 10) in one terms array; do not call once per item. Searches Kroger/QFC in parallel and returns UPCs, prices, and availability. Example: {"terms":["milk","eggs","bread"]}',
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
          .describe("All needed products in one batch, e.g. ['milk', 'bread', 'eggs']"),
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
        _meta: { [APP_VIEW_META_KEY]: "search_products" },
        structuredContent: {
          results: results.map((result) => ({
            ...result,
            products: result.products.map(compactSearchProduct),
          })),
          totalProducts,
        },
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
      inputSchema: getProductInputSchema,
    },
    async ({ upc, storeId }) => {
      const result = await ctx.productService.getProduct(upc, storeId);

      return result.match((product) => {
        return {
          content: [{ type: "text" as const, text: formatProductDetailMarkdown(product) }],
          _meta: { [APP_VIEW_META_KEY]: "get_product" },
          structuredContent: { product },
        };
      }, toMcpError);
    },
  );
}
