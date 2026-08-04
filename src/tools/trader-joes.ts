import * as z from "zod/v4";

import type { TraderJoesProduct } from "../services/traderjoes/client.js";
import type { ToolContext } from "./types.js";

import { toMcpError } from "../utils/result.js";
import { textResult } from "./types.js";

export const searchTraderJoesInputSchema = z.object({
  query: z.string().trim().min(1).max(120).describe("What to look for, e.g. 'chili onion crunch'."),
  limit: z.coerce.number().int().min(1).max(50).default(10).describe("Matches to return."),
  storeCode: z.string().trim().max(16).optional().describe("Store code to price against."),
});

/**
 * One catalog line for the model. The `name=` field is what the list-editing
 * tools take, so it is quoted and stated explicitly rather than left for the
 * model to extract from prose.
 */
function formatProductLine(product: TraderJoesProduct, index: number): string {
  const facts = [
    product.price === undefined ? null : `$${product.price.toFixed(2)}`,
    product.size,
    product.category,
    product.available ? null : "out of stock",
  ].filter(Boolean);
  const suffix = facts.length > 0 ? ` — ${facts.join(" · ")}` : "";
  return `${index + 1}. name="${product.name}" sku=${product.sku}${suffix}`;
}

export function registerTraderJoesTools(ctx: ToolContext) {
  ctx.server.registerTool(
    "search_trader_joes_products",
    {
      title: "Search Trader Joe's Products",
      description:
        "Searches the Trader Joe's catalog for names, prices, and sizes. Trader Joe's has no cart API, so a match can only become a list item: pass its `name` to add_shopping_list_items. Never pass a Trader Joe's sku to a Kroger tool.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: searchTraderJoesInputSchema,
    },
    async ({ query, limit, storeCode }) => {
      const result = await ctx.traderJoes.searchProducts(query, {
        limit,
        ...(storeCode === undefined ? {} : { storeCode }),
      });
      if (result.isErr()) return toMcpError(result.error);

      const { products, storeCode: pricedAt } = result.value;
      if (products.length === 0) {
        return textResult(
          `No Trader Joe's products matched "${query}". Try fewer or more general words.`,
        );
      }

      const lines = products.map(formatProductLine).join("\n");
      return textResult(
        `Found ${products.length} Trader Joe's product(s) for "${query}" (store ${pricedAt}).\n\n${lines}\n\nAdd any of these to a list with add_shopping_list_items using the quoted name.`,
      );
    },
  );
}
