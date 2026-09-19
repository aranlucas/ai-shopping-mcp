import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { ResultAsync } from "neverthrow";
import * as z from "zod/v4";

import type { components as ProductComponents } from "../services/kroger/product.js";
import type { ShoppingList, ShoppingListItem } from "../utils/user-storage.js";

import { appResult } from "../app-results.js";
import { apiError, notFoundError, validationError } from "../errors.js";
import { selectProductMatches } from "../services/product-selector.js";
import {
  getProps,
  safeResolveLocationId,
  toMcpError,
} from "../utils/result.js";
import { APP_VIEW_URI } from "../utils/view-resource.js";
import { type LineItem, addLineItemsToCart } from "./cart.js";
import {
  getDealsForFlags,
  getPantryForFlags,
  itemFlagLabels,
} from "./item-flags.js";
import { searchProductsForTerms } from "./product.js";
import { coercedBooleanSchema } from "./schemas.js";
import { createShoppingListRecord } from "./shopping-list.js";
import { type ToolContext } from "./types.js";

type Product = ProductComponents["schemas"]["products.productModel"];

const shopItemSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .describe("Item to shop for, e.g. 'whole milk'"),
  quantity: z.coerce.number().int().min(1).max(999).default(1),
});

export const shopForItemsInputSchema = z.object({
  items: z
    .array(shopItemSchema)
    .min(1, { message: "At least one item is required" })
    .max(10, { message: "Maximum 10 items allowed" })
    .describe("Items to search for and add to a new shopping list"),
  addToCart: coercedBooleanSchema
    .optional()
    .default(false)
    .describe(
      "Also add matched items to the Kroger cart (PICKUP) after creating the list",
    ),
});

/**
 * One markdown line: searched name → matched product, brand, size, price,
 * upc, plus optional trailing flags (e.g. "in pantry", "on sale: $2.99").
 */
function formatMatchLineMarkdown(
  searchedName: string,
  quantity: number,
  product: Product,
  flags: string[] = [],
): string {
  const item = product.items?.[0];
  const parts: string[] = [
    `${searchedName} → ${product.description ?? "Unknown product"}`,
  ];

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
  parts.push(...flags);

  return `- ${parts.join(" | ")} (qty ${quantity})`;
}

function shoppingListResponse(
  listId: string,
  list: ShoppingList,
  parts: string[],
) {
  return {
    content: [{ type: "text" as const, text: parts.join("\n") }],
    ...appResult("create_shopping_list", {
      listId,
      name: list.name,
      items: list.items,
    }),
  };
}

async function finishShopForItemsCart(
  ctx: ToolContext,
  listId: string,
  responseText: string,
  list: ShoppingList,
  lineItems: LineItem[],
) {
  const parts = [responseText];
  const addResult = await addLineItemsToCart(
    ctx,
    ctx.clients.cartClient,
    lineItems,
    "PICKUP",
    {
      receiptListId: listId,
    },
  );
  if (addResult.isErr()) {
    if (
      addResult.error.type === "STORAGE_ERROR" ||
      addResult.error.type === "MUTATION_OUTCOME_UNKNOWN"
    ) {
      return toMcpError({
        ...addResult.error,
        message: `listId=${listId}. ${addResult.error.message}`,
      });
    }
    parts.push(
      "",
      `Cart add failed: ${addResult.error.message}. The shopping list still exists. After resolving this error, retry with add_shopping_list_to_cart {"listId":"${listId}"}.`,
    );
    return shoppingListResponse(listId, list, parts);
  }

  if (addResult.value === "already_added")
    return shoppingListResponse(listId, list, [
      ...parts,
      "These items were already added to the Kroger cart.",
    ]);

  parts.push(
    "",
    `Added ${lineItems.length} item(s) to your Kroger cart (no need to call add_shopping_list_to_cart).`,
  );
  return shoppingListResponse(listId, list, parts);
}

export function registerShopTools(ctx: ToolContext) {
  const { productClient } = ctx.clients;

  registerAppTool(
    ctx.server,
    "shop_for_items",
    {
      title: "Shop For Items",
      description:
        'One-shot shopping: resolves your preferred store, searches for each item name, picks the best match, and creates a shopping list. Set addToCart:true to also add the matches to your Kroger cart (PICKUP). Example: {"items":[{"name":"whole milk"},{"name":"eggs","quantity":2}],"addToCart":true}',
      _meta: { ui: { resourceUri: APP_VIEW_URI } },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: shopForItemsInputSchema,
    },
    async ({ items, addToCart }) => {
      getProps();
      const resolvedLocation = await safeResolveLocationId(
        ctx.storage,
        undefined,
      );
      if (resolvedLocation.isErr()) {
        if (resolvedLocation.error.type !== "NOT_FOUND")
          return toMcpError(resolvedLocation.error);
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
        limitPerTerm: 20,
      });

      const ai = ctx.getEnv().AI;
      const selectionResult = await ResultAsync.fromPromise(
        selectProductMatches({
          ai,
          items: searchResults.map((result) => ({
            query: result.term,
            products: result.failed ? [] : result.products,
          })),
          forPickup: addToCart,
        }),
        () =>
          apiError(
            "Jev product selection failed. No shopping list or cart changes were made. Check Cloudflare AI Gateway access and retry.",
          ),
      );
      if (selectionResult.isErr()) return toMcpError(selectionResult.error);
      const selections = selectionResult.value;

      const [pantry, deals] = await Promise.all([
        getPantryForFlags(ctx),
        getDealsForFlags(ctx, locationId),
      ]);

      const matched: Array<{
        name: string;
        quantity: number;
        product: Product;
        flags: string[];
      }> = [];
      const notFound: string[] = [];
      const unresolved: string[] = [];

      items.forEach((item, index) => {
        const selection = selections[index];
        const best =
          selection?.status === "selected" ? selection.product : undefined;
        if (best) {
          matched.push({
            name: item.name,
            quantity: item.quantity,
            product: best,
            flags: itemFlagLabels(item.name, pantry, deals),
          });
        } else if (
          !searchResults[index].failed &&
          searchResults[index].products.length > 0
        ) {
          unresolved.push(item.name);
        } else {
          notFound.push(item.name);
        }
      });

      if (matched.length === 0) {
        const failure = searchResults.find((result) => result.error)?.error;
        if (failure) return toMcpError(failure);
        return toMcpError(
          validationError(
            unresolved.length > 0
              ? `No suitable match for: ${[...notFound, ...unresolved].join(", ")}. Review alternatives with search_products.`
              : `No products found for: ${notFound.join(", ")}. Try different search terms with search_products.`,
          ),
        );
      }

      const listItems: ShoppingListItem[] = matched.map((match) => ({
        productName: match.product.description || match.name,
        ...(match.product.upc
          ? { product: { provider: "kroger", id: match.product.upc } }
          : {}),
        upc: match.product.upc,
        quantity: match.quantity,
      }));

      const listName = `Shopping list ${new Date().toISOString().slice(0, 10)}`;

      const createResult = await createShoppingListRecord(
        ctx.storage,
        listName,
        listItems,
      );
      if (createResult.isErr()) return toMcpError(createResult.error);
      const { listId, list } = createResult.value;

      const parts: string[] = [
        `Created shopping list "${listName}" (listId=${listId}) with ${matched.length} item(s).`,
        "",
        ...matched.map((match) =>
          formatMatchLineMarkdown(
            match.name,
            match.quantity,
            match.product,
            match.flags,
          ),
        ),
      ];

      if (notFound.length > 0) {
        parts.push("", `No results for: ${notFound.join(", ")}.`);
      }
      if (unresolved.length > 0) {
        parts.push(
          "",
          `No suitable match for: ${unresolved.join(", ")}. Review alternatives with search_products.`,
        );
      }

      if (!addToCart) {
        parts.push(
          "",
          `Review these matches, then call add_shopping_list_to_cart with listId "${listId}" to add them to the Kroger cart.`,
        );
        return shoppingListResponse(listId, list, parts);
      }

      // addToCart: reuse the same direct PUT path as
      // add_shopping_list_to_cart.
      const lineItems: LineItem[] = matched.flatMap((match) =>
        match.product.upc
          ? [
              {
                upc: match.product.upc,
                quantity: match.quantity,
                productName: match.product.description || match.name,
              },
            ]
          : [],
      );

      if (lineItems.length === 0) {
        parts.push(
          "",
          `None of the matches had a upc to add to cart. Retry with add_shopping_list_to_cart {"listId":"${listId}"} once available.`,
        );
        return shoppingListResponse(listId, list, parts);
      }

      return finishShopForItemsCart(
        ctx,
        listId,
        parts.join("\n"),
        list,
        lineItems,
      );
    },
  );
}
