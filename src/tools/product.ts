import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { appResult } from "../app-results.js";
import type { KrogerClients } from "../services/kroger/client.js";
import { toProductData } from "../services/kroger/product-data.js";
import type { ProductService } from "../services/kroger/product-service.js";
import { searchProductsForTerms } from "../services/kroger/search.js";
import {
  formatProductDetails,
  formatProductSearchMarkdown,
} from "../utils/format-response.js";
import { safeStorage, toMcpError } from "../utils/result.js";
import type { PreferredLocationStore } from "../utils/shopping-store.js";
import { APP_VIEW_URI } from "../utils/view-resource.js";
import { storeIdSchema, upcSchema } from "./schemas.js";

export {
  type ProductSearchResult,
  logProductSearchError,
  searchProductsForTerms,
} from "../services/kroger/search.js";

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
        "Search Kroger products in one batch: put every item in terms (do not call once per item), or pass upcs to look up exact products. Returns upc, price, sale price, and pickup availability at the preferred store; copy the UPCs into lists, carts, and orders.",
      _meta: { ui: { resourceUri: APP_VIEW_URI } },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: z
        .strictObject({
          terms: z
            .array(z.string().trim().min(1).max(100))
            .min(1)
            .max(10, { message: "Maximum 10 search terms allowed" })
            .optional()
            .describe("Batch search terms, e.g. ['milk', 'bread', 'eggs']"),
          upcs: z
            .array(upcSchema)
            .min(1)
            .optional()
            .describe("Exact 13-digit UPCs to look up instead of searching"),
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
            .describe("Max products per term (1-10)"),
          includeLocation: z
            .boolean()
            .default(false)
            .describe(
              "Include aisle and shelf for each product, for shopping in the store",
            ),
        })
        .refine((input) => Boolean(input.terms ?? input.upcs), {
          message: "Pass terms to search, or upcs to look up exact products.",
        }),
    },
    async (
      { terms, upcs, storeId, limitPerTerm, includeLocation },
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
      const notice = locationId ? "" : `${NO_STORE_NOTICE}\n\n`;

      if (upcs && !terms) return lookupUpcs(upcs, locationId, notice);

      const requests = [...new Set(terms)].map((term, index) => ({
        requestId: `term_${index}`,
        term,
      }));
      const progressToken = requestContext.mcpReq._meta?.progressToken;
      const results = await searchProductsForTerms(
        productClient,
        requests,
        { locationId, limitPerTerm },
        async (completed, total) => {
          if (progressToken === undefined) return;
          await requestContext.mcpReq.notify({
            method: "notifications/progress",
            params: { progressToken, progress: completed, total },
          });
        },
      );
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

      return {
        content: [
          {
            type: "text" as const,
            text: `${notice}${formatProductSearchMarkdown(results, { includeLocation })}`,
          },
        ],
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
                    toProductData(product, includeLocation),
                  ),
                  failed: false,
                },
          ),
          totalProducts,
        }),
      };
    },
  );

  /** Exact UPC lookups; one UPC renders the product detail view. */
  async function lookupUpcs(
    upcs: string[],
    locationId: string | undefined,
    notice: string,
  ) {
    const lookups = await Promise.all(
      [...new Set(upcs)].map(async (upc) => ({
        upc,
        result: await productService.getProduct(upc, locationId),
      })),
    );
    const found = lookups.flatMap(({ upc, result }) =>
      result.isOk() ? [toProductData(result.value, true, upc)] : [],
    );
    const missing = lookups.filter(({ result }) => result.isErr());
    if (found.length === 0) {
      const [first] = missing;
      if (first?.result.isErr()) return toMcpError(first.result.error);
    }

    const text = [
      notice.trim(),
      ...found.map((product) => formatProductDetails(product)),
      missing.length > 0
        ? `Not found: ${missing.map(({ upc }) => `upc=${upc}`).join(", ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    if (found.length === 1) {
      return {
        content: [{ type: "text" as const, text }],
        ...appResult("get_product", { product: found[0] }),
      };
    }
    return {
      content: [{ type: "text" as const, text }],
      ...appResult("search_products", {
        results: found.map((product) => ({
          term: product.upc,
          products: [product],
          failed: false,
        })),
        totalProducts: found.length,
      }),
    };
  }
}
