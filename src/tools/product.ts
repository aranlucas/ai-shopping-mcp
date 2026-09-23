import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import * as z from "zod/v4";

import { appResult } from "../app-results.js";
import { toProductData } from "../services/kroger/product-data.js";
import { searchProductsForTerms } from "../services/kroger/search.js";
import {
  formatProductDetails,
  formatProductSearchMarkdown,
} from "../utils/format-response.js";
import { safeStorage, toMcpError } from "../utils/result.js";
import { APP_VIEW_URI } from "../utils/view-resource.js";
import { storeIdSchema, upcSchema } from "./schemas.js";
import type { ToolContext } from "./types.js";

export {
  type ProductSearchResult,
  logProductSearchError,
  searchProductsForTerms,
} from "../services/kroger/search.js";

const getProductInputSchema = z.strictObject({
  upc: upcSchema.describe("UPC from search_products"),
  storeId: storeIdSchema
    .optional()
    .describe("Kroger store ID for pricing and availability"),
});

export function registerProductTools(ctx: ToolContext) {
  registerAppTool(
    ctx.server,
    "search_products",
    {
      title: "Search Products",
      description:
        "Search Kroger products in one batch. Put every needed item in the terms array; do not call once per item. Copy returned UPCs into shopping lists and orders. Uses the preferred Kroger store unless storeId is supplied.",
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
          .max(10, { message: "Maximum 10 search terms allowed" })
          .describe("Batch terms, e.g. ['milk', 'bread', 'eggs']"),
        storeId: storeIdSchema
          .optional()
          .describe("Kroger store ID; defaults to your preferred store"),
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
          .describe("Include aisle and shelf details for in-store shopping"),
      }),
    },
    async (
      { terms, storeId, limitPerTerm, includeLocation },
      requestContext,
    ) => {
      let locationId = storeId;
      if (!locationId) {
        const preferred = await safeStorage(
          () => ctx.storage.preferredLocation.get(),
          "fetch preferred location",
        );
        if (preferred.isErr()) return toMcpError(preferred.error);
        locationId = preferred.value?.locationId;
      }
      const requests = [...new Set(terms)].map((term, index) => ({
        requestId: `term_${index}`,
        term,
      }));
      const progressToken = requestContext.mcpReq._meta?.progressToken;
      const results = await searchProductsForTerms(
        ctx.clients.productClient,
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
            text: formatProductSearchMarkdown(results, { includeLocation }),
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

  registerAppTool(
    ctx.server,
    "get_product",
    {
      title: "Get Product Details",
      description:
        "Get one Kroger product by its UPC, with price, availability, and shelf location.",
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
      const product = toProductData(result.value, true);
      return {
        content: [
          { type: "text" as const, text: formatProductDetails(product) },
        ],
        ...appResult("get_product", { product }),
      };
    },
  );
}
