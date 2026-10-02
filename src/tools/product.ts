import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { appResult } from "../app-results.js";
import { toProductData } from "../services/kroger/product-data.js";
import type { ProductService } from "../services/kroger/product-service.js";
import {
  MAX_CATALOG_REQUESTS,
  MAX_TEXT_TERMS,
  isUpcTerm,
} from "../services/kroger/catalog-workload.js";
import { formatProductSearchMarkdown } from "../utils/format-response.js";
import { safeStorage, toMcpError } from "../utils/result.js";
import type { PreferredLocationStore } from "../utils/shopping-store.js";
import { APP_VIEW_URI } from "../utils/view-resource.js";
import { storeIdSchema } from "./schemas.js";

export {
  type ProductSearchResult,
  logProductSearchError,
  searchProductsForTerms,
} from "../services/kroger/search.js";

const NO_STORE_NOTICE =
  "No preferred store is set, so prices and availability are not for a specific store, and cart adds will fail. Use search_stores and set_preferred_store first when the user wants to buy.";

export type ProductToolDependencies = {
  productService: Pick<ProductService, "resolveProducts">;
  preferredLocation: PreferredLocationStore;
};

export function registerProductTools(
  server: McpServer,
  { productService, preferredLocation }: ProductToolDependencies,
): void {
  registerAppTool(
    server,
    "search_products",
    {
      title: "Search Products",
      description:
        "Compare Kroger products and prices at the preferred store. Batch all items in terms; do not call once per item. Returns upc, size, price, sale price, pickup availability, and stock status; check availability before cart adds. Copy exact UPCs into lists or carts. All-digit terms look up exact UPCs with aisles and variants. Results are candidates, not guaranteed exact matches or the cheapest in the catalog.",
      _meta: { ui: { resourceUri: APP_VIEW_URI } },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: z.strictObject({
        terms: z
          .array(z.string().trim().min(1).max(100))
          .min(1, { message: "At least one search term is required" })
          .max(MAX_CATALOG_REQUESTS, {
            message: `Maximum ${MAX_CATALOG_REQUESTS} product requests per call.`,
          })
          .refine(
            (terms) =>
              terms.filter((term) => !isUpcTerm(term)).length <= MAX_TEXT_TERMS,
            {
              message: `Maximum ${MAX_TEXT_TERMS} text search terms per call (UPC terms don't count).`,
            },
          )
          .describe(
            "Product names to search, e.g. ['milk', 'bread'], and/or UPCs to look up exactly, e.g. ['0001111041700']",
          ),
        storeId: storeIdSchema
          .optional()
          .describe(
            "8-character storeId from search_stores; defaults to the preferred store",
          ),
        limitPerTerm: z.coerce
          .number()
          .int()
          .min(1)
          .max(10)
          .default(5)
          .describe("Max products per text term (1-10)"),
        includeLocation: z
          .boolean()
          .default(false)
          .describe(
            "Include aisle and shelf for each product, for shopping in the store",
          ),
      }),
    },
    async (
      { terms, storeId, limitPerTerm, includeLocation },
      requestContext,
    ) => {
      let locationId = storeId;
      if (!locationId) {
        const preferred = await safeStorage(
          () => preferredLocation.get(),
          "fetch preferred location",
        );
        if (preferred.isErr()) return toMcpError(preferred.error);
        locationId = preferred.value?.locationId;
      }

      const progressToken = requestContext.mcpReq._meta?.progressToken;
      const resolved = await productService.resolveProducts(
        terms,
        { locationId, limitPerTerm },
        async (completed, total) => {
          if (progressToken === undefined) return;
          await requestContext.mcpReq.notify({
            method: "notifications/progress",
            params: { progressToken, progress: completed, total },
          });
        },
      );
      if (resolved.isErr()) return toMcpError(resolved.error);
      const { results, exactUpcs } = resolved.value;

      const totalProducts = results.reduce(
        (sum, result) =>
          sum + (result.status === "success" ? result.products.length : 0),
        0,
      );
      const failures = results.filter((result) => result.status === "failed");
      const failure =
        failures.find((result) => result.error.type === "AUTH_ERROR") ??
        failures[0];
      if (totalProducts === 0 && failure) return toMcpError(failure.error);

      const text = `${locationId ? "" : `${NO_STORE_NOTICE}\n\n`}${formatProductSearchMarkdown(results, { includeLocation, exactUpcs })}`;

      // A single exact lookup opens the product detail view in the app.
      const [only] = results;
      if (
        results.length === 1 &&
        exactUpcs.has(only.term) &&
        only.status === "success"
      ) {
        return {
          content: [{ type: "text" as const, text }],
          ...appResult("get_product", {
            product: toProductData(only.products[0], true, only.term),
          }),
        };
      }

      return {
        content: [{ type: "text" as const, text }],
        ...appResult("search_products", {
          results: results.map((result) =>
            result.status === "failed"
              ? {
                  term: result.term,
                  products: [],
                  failed: true,
                  error: result.error.message,
                }
              : {
                  term: result.term,
                  products: result.products.map((product) =>
                    toProductData(
                      product,
                      includeLocation || exactUpcs.has(result.term),
                      exactUpcs.has(result.term) ? result.term : undefined,
                    ),
                  ),
                  failed: false,
                },
          ),
          totalProducts,
        }),
      };
    },
  );
}
