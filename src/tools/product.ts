import { ResultAsync } from "neverthrow";
import * as z from "zod/v4";

import type { CatalogProduct, CatalogSearchOptions } from "../services/catalog/types.js";
import type { ProductData } from "../app-results.js";

import { appResult } from "../app-results.js";
import {
  formatCatalogProductDetailMarkdown,
  formatCatalogSearchMarkdown,
} from "../utils/format-response.js";
import { safeStorage, toMcpError } from "../utils/result.js";
import { APP_VIEW_URI } from "../utils/view-resource.js";
import { storeIdSchema, upcSchema } from "./schemas.js";
import { type ToolContext, errorResult } from "./types.js";
import { parseProductReference } from "../services/catalog/types.js";

// Re-exported so `shop_for_items` and existing tests keep one import site for
// the Kroger-shaped search, which now lives in the catalog service layer.
export {
  type ProductSearchResult,
  logProductSearchError,
  searchProductsForTerms,
} from "../services/catalog/kroger-search.js";

/** Universal structured result shared by every provider and MCP App view. */
function compactCatalogProduct(product: CatalogProduct, includeLocation = false): ProductData {
  return {
    product: product.ref,
    name: product.name,
    available: product.available,
    ...(product.brand === undefined ? {} : { brand: product.brand }),
    ...(product.category === undefined ? {} : { category: product.category }),
    ...(product.size === undefined ? {} : { size: product.size }),
    ...(product.price === undefined ? {} : { price: product.price }),
    ...(product.regularPrice === undefined ? {} : { regularPrice: product.regularPrice }),
    ...(product.imageUrl === undefined ? {} : { imageUrl: product.imageUrl }),
    ...(product.url === undefined ? {} : { url: product.url }),
    ...(product.pickup === undefined ? {} : { pickup: product.pickup }),
    ...(includeLocation && product.aisle !== undefined ? { aisle: product.aisle } : {}),
  };
}

const getProductInputSchema = z
  .object({
    productRef: z
      .string()
      .trim()
      .refine((value) => parseProductReference(value) !== null, {
        message: "Use productRef=<provider>:<id> from search_products",
      })
      .optional()
      .describe("Exact productRef from search_products"),
    upc: upcSchema.optional().describe("Deprecated Kroger UPC compatibility input"),
    storeId: storeIdSchema
      .optional()
      .describe("Provider-scoped store id for availability and pricing"),
  })
  .refine((value) => Boolean(value.productRef) !== Boolean(value.upc), {
    message: "Provide exactly one productRef from search_products (or legacy Kroger upc)",
  });

export function registerProductTools(ctx: ToolContext) {
  ctx.server.registerTool(
    "search_products",
    {
      title: "Search Products",
      description:
        "Batch catalog search. Put every needed item in one terms array; do not call once per item. Omit providers to search all. Matches return `productRef=<provider>:<id>`.",
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
        stores: z
          .record(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u), z.string().trim().min(1).max(200))
          .optional()
          .describe("Provider-specific store ids, e.g. {kroger:'70500847',trader_joes:'701'}"),
        storeId: storeIdSchema
          .optional()
          .describe("Deprecated Kroger store id; prefer stores.kroger"),
        limitPerTerm: z.coerce
          .number()
          .int()
          .min(1)
          .max(10)
          .default(5)
          .describe("Max products to return per search term (1-10)"),
        providers: z
          .array(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u))
          .nonempty()
          .optional()
          .describe("Catalog provider ids. Omit to search every registered provider."),
        includeLocation: z
          .boolean()
          .default(false)
          .describe(
            "Include aisle, route sequence, bay, side, shelf, and shelf-position details for finding items on the shelf. Important when planning an in-store grocery route.",
          ),
      }),
    },
    async (
      { terms, stores, storeId, limitPerTerm, providers, includeLocation },
      requestContext,
    ) => {
      const availableProviderIds = Object.keys(ctx.catalogs);
      const selectedProviderIds = providers ?? availableProviderIds;
      const unknownProviders = selectedProviderIds.filter((id) => ctx.catalogs[id] === undefined);
      if (unknownProviders.length > 0) {
        return errorResult(
          `Unknown provider(s): ${unknownProviders.join(", ")}. Available: ${availableProviderIds.join(", ")}.`,
        );
      }
      const selected = selectedProviderIds.map((id) => {
        const provider = ctx.catalogs[id];
        if (!provider) throw new Error(`Unknown provider: ${id}`);
        return provider;
      });

      const preferred = await safeStorage(
        () => ctx.storage.preferredLocation.get(),
        "fetch preferred location",
      ).unwrapOr(null);

      const progressToken = requestContext.mcpReq._meta?.progressToken;

      // Providers are searched concurrently: they share nothing, so one being
      // slow or down must not serialize behind or sink the others.
      const perProvider = await Promise.all(
        selected.map(async (provider) => {
          const resolvedStoreId =
            stores?.[provider.id] ??
            (provider.id === "kroger" ? storeId : undefined) ??
            (preferred?.provider === provider.id ? preferred.locationId : undefined);
          const options: CatalogSearchOptions = {
            limitPerTerm,
            includeLocation,
            ...(resolvedStoreId === undefined ? {} : { storeId: resolvedStoreId }),
            ...(progressToken
              ? {
                  onTermComplete: async (completed: number, total: number) => {
                    await ResultAsync.fromPromise(
                      requestContext.mcpReq.notify({
                        method: "notifications/progress",
                        params: { progressToken, progress: completed, total },
                      }),
                      (e) => e,
                    ).orTee((e) => console.error("Failed to send progress notification:", e));
                  },
                }
              : {}),
          };
          const result = await provider.search(terms, options);
          return result
            .orTee((error) => console.warn(`${provider.label} search failed:`, error.message))
            .unwrapOr(
              terms.map((term) => ({
                provider: provider.id,
                term,
                products: [],
                failed: true,
              })),
            );
        }),
      );
      const results = perProvider.flat();

      const totalProducts = results.reduce((sum, result) => sum + result.products.length, 0);
      const failed = results.filter((result) => result.failed);

      // Only a search that found nothing anywhere and failed somewhere is an
      // error; a Kroger hit with Trader Joe's down is still a useful answer.
      if (totalProducts === 0 && failed.length > 0) {
        const failedTerms = [...new Set(failed.map((result) => result.term))];
        return errorResult(`Search failed for: ${failedTerms.join(", ")}. Please try again.`);
      }

      return {
        content: [
          {
            type: "text" as const,
            text: formatCatalogSearchMarkdown(results, selected, { includeLocation }),
          },
        ],
        ...appResult("search_products", {
          results: results.map((result) => ({
            provider: result.provider,
            term: result.term,
            products: result.products.map((product) =>
              compactCatalogProduct(product, includeLocation),
            ),
            count: result.products.length,
            failed: result.failed,
          })),
          totalProducts,
        }),
      };
    },
  );

  ctx.server.registerTool(
    "get_product",
    {
      title: "Get Product Details",
      description:
        "Gets one exact catalog product by universal productRef. Legacy Kroger upc is accepted.",
      _meta: { ui: { resourceUri: APP_VIEW_URI } },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: getProductInputSchema,
    },
    async ({ productRef, upc, storeId }) => {
      const reference = productRef
        ? parseProductReference(productRef)
        : upc
          ? { provider: "kroger", id: upc }
          : null;
      if (!reference) return errorResult("Provide a productRef from search_products.");

      const provider = ctx.catalogs[reference.provider];
      if (!provider) {
        return errorResult(
          `Unknown provider=${reference.provider}. Available: ${Object.keys(ctx.catalogs).join(", ")}.`,
        );
      }
      const result = await provider.get(reference, storeId === undefined ? {} : { storeId });

      if (result.isErr()) return toMcpError(result.error);
      const product = result.value;
      return {
        content: [
          {
            type: "text" as const,
            text: formatCatalogProductDetailMarkdown(product, provider),
          },
        ],
        ...appResult("get_product", {
          product: compactCatalogProduct(product, true),
        }),
      };
    },
  );
}
