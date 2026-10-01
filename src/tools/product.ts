import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { appResult } from "../app-results.js";
import type { KrogerClients } from "../services/kroger/client.js";
import { toProductData } from "../services/kroger/product-data.js";
import type { ProductService } from "../services/kroger/product-service.js";
import {
  type ProductSearchResult,
  searchProductsForTerms,
} from "../services/kroger/search.js";
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

/** An all-digit term is a UPC (copied from earlier results), not a search. */
const UPC_TERM = /^\d{8,13}$/;
const MAX_TEXT_TERMS = 10;
/** UPC detail calls in flight at once; there is no cap on how many are asked. */
const UPC_LOOKUP_BATCH = 5;

/** Runs `fn` over `items` a batch at a time, preserving order. */
async function mapInBatches<T, R>(
  items: T[],
  size: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += size) {
    const batch = items
      .slice(start, start + size)
      .map((item, offset) => fn(item, start + offset));
    // oxlint-disable-next-line eslint/no-await-in-loop -- batches are sequential to bound concurrent Kroger calls
    const settled = await Promise.all(batch);
    results.push(...settled);
  }
  return results;
}

const NO_STORE_NOTICE =
  "No preferred store is set, so prices and availability are not for a specific store, and cart adds will fail. Use search_stores and set_preferred_store first when the user wants to buy.";

export type ProductToolDependencies = {
  productClient: KrogerClients["productClient"];
  productService: Pick<ProductService, "getProduct">;
  preferredLocation: PreferredLocationStore;
};

export function registerProductTools(
  server: McpServer,
  { productClient, productService, preferredLocation }: ProductToolDependencies,
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
          .refine(
            (terms) =>
              terms.filter((term) => !UPC_TERM.test(term)).length <=
              MAX_TEXT_TERMS,
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

      const uniqueTerms = [
        ...new Set(
          terms.map((term) =>
            UPC_TERM.test(term) ? term.padStart(13, "0") : term,
          ),
        ),
      ];
      const upcs = uniqueTerms.filter((term) => UPC_TERM.test(term));
      const textTerms = uniqueTerms.filter((term) => !UPC_TERM.test(term));

      const progressToken = requestContext.mcpReq._meta?.progressToken;
      const [lookups, searches] = await Promise.all([
        mapInBatches(
          upcs,
          UPC_LOOKUP_BATCH,
          async (upc, index): Promise<ProductSearchResult> =>
            (await productService.getProduct(upc, locationId)).match(
              (product) => ({
                requestId: `upc_${index}`,
                term: upc,
                status: "success" as const,
                products: [product],
              }),
              (error) => ({
                requestId: `upc_${index}`,
                term: upc,
                status: "failed" as const,
                error,
              }),
            ),
        ),
        textTerms.length === 0
          ? Promise.resolve([])
          : searchProductsForTerms(
              productClient,
              textTerms.map((term, index) => ({
                requestId: `term_${index}`,
                term,
              })),
              { locationId, limitPerTerm },
              async (completed, total) => {
                if (progressToken === undefined) return;
                await requestContext.mcpReq.notify({
                  method: "notifications/progress",
                  params: { progressToken, progress: completed, total },
                });
              },
            ),
      ]);
      // Report in the order the terms were asked.
      const byTerm = new Map(
        [...lookups, ...searches].map((result) => [result.term, result]),
      );
      const results = uniqueTerms.flatMap((term) => {
        const result = byTerm.get(term);
        return result ? [result] : [];
      });

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

      const exactUpcs = new Set(upcs);
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
