import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import * as z from "zod/v4";

import type { components as ProductComponents } from "../services/kroger/product.js";
import type { ShoppingListItem } from "../utils/user-storage.js";

import { notFoundError, validationError } from "../errors.js";
import { getProps, safeResolveLocationId, toMcpError } from "../utils/result.js";
import { APP_VIEW_URI } from "../utils/view-resource.js";
import { searchProductsForTerms } from "./product.js";
import { createShoppingListRecord } from "./shopping-list.js";
import { type ToolContext } from "./types.js";

type Product = ProductComponents["schemas"]["products.productModel"];

const shopItemSchema = z.object({
  name: z.string().min(1).max(100).describe("Item to shop for, e.g. 'whole milk'"),
  quantity: z.coerce.number().min(1).max(999).default(1),
});

export const shopForItemsInputSchema = z.object({
  items: z
    .array(shopItemSchema)
    .min(1, { message: "At least one item is required" })
    .max(10, { message: "Maximum 10 items allowed" })
    .describe("Items to search for and add to a new shopping list"),
});

/** Picks the best product match for a name: first pickup-available result, else the first result. */
function pickBestMatch(products: Product[]): Product | undefined {
  const withPickup = products.find((product) => {
    const item = product.items?.[0];
    return Boolean(item?.fulfillment?.curbside || item?.fulfillment?.instore);
  });
  return withPickup ?? products[0];
}

/** One markdown line: searched name → matched product, brand, size, price, upc. */
function formatMatchLineMarkdown(searchedName: string, quantity: number, product: Product): string {
  const item = product.items?.[0];
  const parts: string[] = [`${searchedName} → ${product.description ?? "Unknown product"}`];

  if (product.brand) parts.push(product.brand);
  if (item?.size) parts.push(item.size);

  if (item?.price) {
    const { regular, promo } = item.price;
    if (promo != null && promo !== regular) {
      parts.push(`$${promo} (was $${regular})`);
    } else if (regular != null) {
      parts.push(`$${regular}`);
    }
  }

  parts.push(`upc=${product.upc ?? "unknown"}`);

  return `- ${parts.join(" | ")} (qty ${quantity})`;
}

export function registerShopTools(ctx: ToolContext) {
  const { productClient } = ctx.clients;

  registerAppTool(
    ctx.server,
    "shop_for_items",
    {
      title: "Shop For Items",
      description:
        'One-shot shopping: resolves your preferred store, searches for each item name, picks the best match, and creates a shopping list — without adding to cart. Example: {"items":[{"name":"whole milk"},{"name":"eggs","quantity":2}]}',
      _meta: { ui: { resourceUri: APP_VIEW_URI } },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: shopForItemsInputSchema,
    },
    async ({ items }) => {
      const props = getProps();

      const resolvedLocation = await safeResolveLocationId(ctx.storage, props.id, undefined);
      if (resolvedLocation.isErr()) {
        return toMcpError(
          notFoundError(
            "No preferred store set. Use search_stores to find a store, then set_preferred_store to save it, and try again.",
          ),
        );
      }
      const { locationId } = resolvedLocation.value;

      const terms = items.map((item) => item.name);
      const searchResults = await searchProductsForTerms(productClient, terms, {
        locationId,
        limitPerTerm: 5,
      });

      const matched: Array<{ name: string; quantity: number; product: Product }> = [];
      const notFound: string[] = [];

      items.forEach((item, index) => {
        const result = searchResults[index];
        const best = result && !result.failed ? pickBestMatch(result.products) : undefined;
        if (best) {
          matched.push({ name: item.name, quantity: item.quantity, product: best });
        } else {
          notFound.push(item.name);
        }
      });

      if (matched.length === 0) {
        return toMcpError(
          validationError(
            `No products found for: ${notFound.join(", ")}. Try different search terms with search_products.`,
          ),
        );
      }

      const listItems: ShoppingListItem[] = matched.map((match) => ({
        productName: match.product.description || match.name,
        upc: match.product.upc,
        quantity: match.quantity,
      }));

      const listName = `Shopping list ${new Date().toISOString().slice(0, 10)}`;

      const createResult = await createShoppingListRecord(
        ctx.storage,
        props.id,
        ctx.getSessionId(),
        listName,
        listItems,
      );

      return createResult.match(({ shortId, list }) => {
        const parts: string[] = [
          `Created shopping list "${listName}" (listId=${shortId}) with ${matched.length} item(s).`,
          "",
          ...matched.map((match) =>
            formatMatchLineMarkdown(match.name, match.quantity, match.product),
          ),
        ];

        if (notFound.length > 0) {
          parts.push("", `No results for: ${notFound.join(", ")}.`);
        }

        parts.push(
          "",
          `Review these matches, then call add_shopping_list_to_cart with listId "${shortId}" to add them to the Kroger cart.`,
        );

        return {
          content: [{ type: "text" as const, text: parts.join("\n") }],
          structuredContent: {
            _view: "create_shopping_list" as const,
            listId: shortId,
            name: list.name,
            items: list.items,
          },
        };
      }, toMcpError);
    },
  );
}
