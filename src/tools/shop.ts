import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/server";
import { ResultAsync } from "neverthrow";
import * as z from "zod/v4";

import type { ShoppingList, ShoppingListItem } from "../domain/shopping.js";
import type { components as ProductComponents } from "../services/kroger/product.js";

import { appResult } from "../app-results.js";
import { apiError, notFoundError } from "../errors.js";
import { formatKrogerPrice } from "../services/kroger/price.js";
import type { KrogerClients } from "../services/kroger/client.js";
import {
  classifyShoppingItem,
  summarizeShoppingOutcomes,
} from "../services/shopping-outcomes.js";
import { selectProductMatches } from "../services/product-selector.js";
import type { WeeklyDealsCache } from "../services/weekly-deals/cache.js";
import {
  getProps,
  safeResolveLocationId,
  toMcpError,
} from "../utils/result.js";
import { APP_VIEW_URI } from "../utils/view-resource.js";
import type {
  PantryStore,
  PreferredLocationStore,
  ShoppingListStore,
} from "../utils/shopping-store.js";
import type { CartStore } from "../utils/user-storage.js";
import { type LineItem, addLineItemsToCart } from "./cart.js";
import {
  getDealsForFlags,
  getPantryForFlags,
  itemFlagLabels,
} from "./item-flags.js";
import { searchProductsForTerms } from "./product.js";
import { coercedBooleanSchema } from "./schemas.js";
import { createShoppingListRecord } from "./shopping-list.js";

type Product = ProductComponents["schemas"]["products.productModel"];

export type ShopToolDependencies = {
  carts: CartStore;
  productClient: KrogerClients["productClient"];
  cartClient: KrogerClients["cartClient"];
  weeklyDealsCache: WeeklyDealsCache;
  pantry: PantryStore;
  preferredLocation: PreferredLocationStore;
  shoppingList: ShoppingListStore;
  ai: Env["AI"];
};

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

  const price = formatKrogerPrice(item?.price);
  if (price) parts.push(price);

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
  carts: CartStore,
  cartClient: KrogerClients["cartClient"],
  listId: string,
  responseText: string,
  list: ShoppingList,
  lineItems: LineItem[],
) {
  const parts = [responseText];
  const addResult = await addLineItemsToCart(
    carts,
    cartClient,
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

export function createShopTools({
  carts,
  productClient,
  cartClient,
  weeklyDealsCache,
  pantry,
  preferredLocation,
  shoppingList,
  ai,
}: ShopToolDependencies) {
  return (server: McpServer) => {
    registerAppTool(
      server,
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
          preferredLocation,
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

        const requests = items.map((item, index) => ({
          requestId: `item_${index}`,
          name: item.name,
          quantity: item.quantity,
        }));
        const searchResults = await searchProductsForTerms(
          productClient,
          requests.map(({ requestId, name }) => ({ requestId, term: name })),
          { locationId, limitPerTerm: 20 },
        );

        const selectionResult = await ResultAsync.fromPromise(
          selectProductMatches({
            ai,
            items: searchResults
              .filter((result) => result.status === "success")
              .map((result) => ({
                requestId: result.requestId,
                query: result.term,
                products: result.products,
              })),
            forPickup: addToCart,
          }),
          () =>
            apiError(
              "Jev product selection failed. No shopping list or cart changes were made. Check Cloudflare AI Gateway access and retry.",
            ),
        );
        if (selectionResult.isErr()) return toMcpError(selectionResult.error);
        const selectionsByRequestId = new Map(
          selectionResult.value.map((selection) => [
            selection.requestId,
            selection,
          ]),
        );
        const searchesByRequestId = new Map(
          searchResults.map((search) => [search.requestId, search]),
        );

        const [pantryItems, deals] = await Promise.all([
          getPantryForFlags(pantry),
          getDealsForFlags(weeklyDealsCache, locationId),
        ]);

        const outcomes = requests.map((request) => {
          const search = searchesByRequestId.get(request.requestId);
          if (!search)
            throw new Error(
              `Missing search result for request ${request.requestId}`,
            );
          return classifyShoppingItem(
            request,
            search,
            selectionsByRequestId.get(request.requestId),
          );
        });
        const summaryResult = summarizeShoppingOutcomes(outcomes);
        if (summaryResult.isErr()) return toMcpError(summaryResult.error);
        const summary = summaryResult.value;
        const matched = summary.matched.map(({ request, product }) => ({
          ...request,
          product,
          flags: itemFlagLabels(request.name, pantryItems, deals),
        }));

        const listItems: ShoppingListItem[] = matched.map((match) => ({
          productName: match.product.description || match.name,
          upc: match.product.upc,
          quantity: match.quantity,
        }));

        const listName = `Shopping list ${new Date().toISOString().slice(0, 10)}`;

        const createResult = await createShoppingListRecord(
          shoppingList,
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

        parts.push(...summary.warnings);

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
          carts,
          cartClient,
          listId,
          parts.join("\n"),
          list,
          lineItems,
        );
      },
    );
  };
}
