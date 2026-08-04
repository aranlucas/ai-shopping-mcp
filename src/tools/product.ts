import { ResultAsync } from "neverthrow";
import * as z from "zod/v4";

import type { components as ProductComponents } from "../services/kroger/product.js";
import type { CatalogSearchOptions } from "../services/catalog/types.js";
import type { ProductData } from "../app-results.js";

import { appResult } from "../app-results.js";
import { CATALOG_PROVIDER_IDS } from "../services/catalog/types.js";
import {
  formatCatalogSearchMarkdown,
  formatProductDetailMarkdown,
} from "../utils/format-response.js";
import { safeResolveLocationId, toMcpError } from "../utils/result.js";
import { APP_VIEW_URI } from "../utils/view-resource.js";
import { storeIdSchema, upcSchema } from "./schemas.js";
import { type ToolContext, errorResult } from "./types.js";

type Product = ProductComponents["schemas"]["products.productModel"];
type ProductImage = ProductComponents["schemas"]["products.productImageModel"];

// Re-exported so `shop_for_items` and existing tests keep one import site for
// the Kroger-shaped search, which now lives in the catalog service layer.
export {
  type ProductSearchResult,
  logProductSearchError,
  searchProductsForTerms,
} from "../services/catalog/kroger-search.js";

/**
 * Keep the MCP Apps payload useful without sending the complete Kroger catalog
 * record to hosts that include structuredContent in model context.
 */
function compactProductImages(images: ProductImage[] | undefined): ProductData["images"] {
  const image =
    images?.find((candidate) => candidate.default || candidate.perspective === "front") ??
    images?.[0];
  const imageSize =
    image?.sizes?.find((size) => size.size === "thumbnail" || size.size === "small") ??
    image?.sizes?.[0];

  return image
    ? [
        {
          perspective: image.perspective,
          default: image.default,
          sizes: imageSize ? [imageSize] : [],
        },
      ]
    : undefined;
}

function compactSearchProduct(product: Product, includeLocation = false): ProductData {
  const item = product.items?.[0];

  return {
    upc: product.upc,
    description: product.description,
    brand: product.brand,
    categories: product.categories,
    ...(includeLocation && product.aisleLocations
      ? { aisleLocations: product.aisleLocations.slice(0, 1) }
      : {}),
    images: compactProductImages(product.images),
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

/** Product fields rendered by the detail app; excludes catalog-only metadata. */
function compactProductDetail(product: Product): ProductData {
  return {
    upc: product.upc,
    description: product.description,
    brand: product.brand,
    categories: product.categories,
    aisleLocations: product.aisleLocations,
    images: compactProductImages(product.images),
    items: product.items?.map((item) => ({
      itemId: item.itemId,
      size: item.size,
      price: item.price ? { regular: item.price.regular, promo: item.price.promo } : undefined,
      fulfillment: item.fulfillment
        ? {
            curbside: item.fulfillment.curbside,
            delivery: item.fulfillment.delivery,
            instore: item.fulfillment.instore,
            shiptohome: item.fulfillment.shiptohome,
          }
        : undefined,
      inventory: item.inventory ? { stockLevel: item.inventory.stockLevel } : undefined,
    })),
  };
}

const getProductInputSchema = z.object({
  upc: upcSchema.describe("UPC from search_products"),
  storeId: storeIdSchema
    .optional()
    .describe("8-character storeId from search_stores to check availability and pricing"),
});

export function registerProductTools(ctx: ToolContext) {
  ctx.server.registerTool(
    "search_products",
    {
      title: "Search Products",
      description:
        'Batch product search. Put every needed item (up to 10) in one terms array; do not call once per item. Searches Kroger/QFC and returns UPCs, prices, and availability. Add providers to search other catalogs; a provider without a cart (Trader Joe\'s) yields list-only matches. Example: {"terms":["milk","eggs"],"providers":["kroger","trader_joes"]}',
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
        providers: z
          .array(z.enum(CATALOG_PROVIDER_IDS))
          .nonempty()
          .default(["kroger"])
          .describe("Catalogs to search. Default is Kroger only."),
        includeLocation: z
          .boolean()
          .default(false)
          .describe(
            "Include aisle, route sequence, bay, side, shelf, and shelf-position details for finding items on the shelf. Important when planning an in-store grocery route.",
          ),
      }),
    },
    async ({ terms, storeId, limitPerTerm, providers, includeLocation }, requestContext) => {
      const selected = (providers ?? ["kroger"]).map((id) => ctx.catalogs[id]).filter(Boolean);
      if (selected.length === 0) {
        return errorResult(`No such provider. Available: ${CATALOG_PROVIDER_IDS.join(", ")}.`);
      }

      // Resolve storeId: explicit arg → preferred store → omit filter. This is
      // the Kroger store; providers that do not recognize it ignore it.
      let resolvedLocationId: string | undefined = storeId;
      if (!resolvedLocationId) {
        const resolved = await safeResolveLocationId(ctx.storage, undefined);
        if (resolved.isOk()) resolvedLocationId = resolved.value.locationId;
      }

      const progressToken = requestContext.mcpReq._meta?.progressToken;
      const options: CatalogSearchOptions = {
        limitPerTerm,
        includeLocation,
        ...(resolvedLocationId === undefined ? {} : { storeId: resolvedLocationId }),
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

      // Providers are searched concurrently: they share nothing, so one being
      // slow or down must not serialize behind or sink the others.
      const perProvider = await Promise.all(
        selected.map(async (provider) => {
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
        const terms_ = [...new Set(failed.map((result) => result.term))];
        return errorResult(`Search failed for: ${terms_.join(", ")}. Please try again.`);
      }

      return {
        content: [
          {
            type: "text" as const,
            text: formatCatalogSearchMarkdown(results, selected, { includeLocation }),
          },
        ],
        // The MCP App view is Kroger-shaped, so it carries only the Kroger
        // records, taken from the provider's opaque native payload. Providers
        // without a view contribute text output alone.
        ...appResult("search_products", {
          results: results
            .filter((result) => result.provider === "kroger")
            .map((result) => {
              const native = result.products
                .map((product) => product.native)
                .filter((record): record is Product => record != null);
              return {
                term: result.term,
                products: native.map((product) => compactSearchProduct(product, includeLocation)),
                count: native.length,
                failed: result.failed,
              };
            }),
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

      if (result.isErr()) return toMcpError(result.error);
      const product = result.value;
      return {
        content: [{ type: "text" as const, text: formatProductDetailMarkdown(product) }],
        ...appResult("get_product", { product: compactProductDetail(product) }),
      };
    },
  );
}
