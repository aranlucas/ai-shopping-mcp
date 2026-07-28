import { isInputRequiredResult, type ServerContext } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import type { CartConfirmationState, ShopForItemsContinuation } from "../cart-confirmation.js";
import type { components as ProductComponents } from "../services/kroger/product.js";
import type { ShoppingList, ShoppingListItem } from "../utils/user-storage.js";

import { appResult } from "../app-results.js";
import { notFoundError, validationError } from "../errors.js";
import { rankProductMatches } from "../services/match-ranker.js";
import { getProps, safeResolveLocationId, safeStorage, toMcpError } from "../utils/result.js";
import { APP_VIEW_URI } from "../utils/view-resource.js";
import { type LineItem, addLineItemsToCart } from "./cart.js";
import { getDealsForFlags, getPantryForFlags, itemFlagLabels } from "./item-flags.js";
import { searchProductsForTerms } from "./product.js";
import { coercedBooleanSchema } from "./schemas.js";
import { createShoppingListRecord } from "./shopping-list.js";
import { type ToolContext } from "./types.js";

type Product = ProductComponents["schemas"]["products.productModel"];

/**
 * Resolves the Workers AI binding for semantic match ranking. Ranking itself
 * is best-effort; remote-binding failures are handled inside `rankProductMatches`.
 */
function getMatchRankerAi(ctx: ToolContext): Ai {
  return ctx.getEnv().AI;
}

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
  addToCart: coercedBooleanSchema
    .optional()
    .default(false)
    .describe("Also add matched items to the Kroger cart (PICKUP) after creating the list"),
});

/** Picks the best product match for a name: first pickup-available result, else the first result. */
function pickBestMatch(products: Product[]): Product | undefined {
  const withPickup = products.find((product) => {
    const item = product.items?.[0];
    return Boolean(item?.fulfillment?.curbside || item?.fulfillment?.instore);
  });
  return withPickup ?? products[0];
}

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
  parts.push(...flags);

  return `- ${parts.join(" | ")} (qty ${quantity})`;
}

function shopInputFingerprint(
  items: Array<{ name: string; quantity: number }>,
  addToCart: boolean,
): string {
  return JSON.stringify({ items, addToCart });
}

function shoppingListResponse(listId: string, list: ShoppingList, parts: string[]) {
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
  requestContext: ServerContext,
  continuation: ShopForItemsContinuation,
  list: ShoppingList,
  lineItems: LineItem[],
) {
  const parts = [continuation.responseText];
  const addResult = await addLineItemsToCart(
    ctx,
    requestContext,
    ctx.clients.cartClient,
    lineItems,
    "PICKUP",
    {
      continuation,
      receiptListId: continuation.listId,
    },
  );
  if (isInputRequiredResult(addResult)) return addResult;
  if (addResult.isErr()) {
    if (addResult.error.type === "STORAGE_ERROR") {
      return toMcpError(addResult.error);
    }
    parts.push(
      "",
      `Cart add was cancelled or failed; the shopping list still exists. Retry with add_shopping_list_to_cart {"listId":"${continuation.listId}"}.`,
    );
    return shoppingListResponse(continuation.listId, list, parts);
  }

  parts.push(
    "",
    `Added ${lineItems.length} item(s) to your Kroger cart (no need to call add_shopping_list_to_cart).`,
  );
  return shoppingListResponse(continuation.listId, list, parts);
}

export function registerShopTools(ctx: ToolContext) {
  const { productClient } = ctx.clients;

  ctx.server.registerTool(
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
    async ({ items, addToCart }, requestContext) => {
      getProps();
      const fingerprint = shopInputFingerprint(items, addToCart);
      const pendingState = requestContext.mcpReq.requestState<CartConfirmationState>();
      const pendingContinuation = pendingState?.continuation;

      if (
        addToCart &&
        pendingState?.kind === "cart-confirmation" &&
        pendingContinuation?.kind === "shop-for-items" &&
        pendingContinuation.inputFingerprint === fingerprint
      ) {
        const listResult = await safeStorage(
          () => ctx.storage.shoppingList.get(pendingContinuation.listId),
          "resume shopping list cart confirmation",
        );
        if (listResult.isErr()) return toMcpError(listResult.error);
        if (!listResult.value) {
          return toMcpError(
            validationError(
              `Shopping list "${pendingContinuation.listId}" no longer exists. Run shop_for_items again.`,
            ),
          );
        }
        return finishShopForItemsCart(
          ctx,
          requestContext,
          pendingContinuation,
          listResult.value,
          pendingState.items,
        );
      }

      const resolvedLocation = await safeResolveLocationId(ctx.storage, undefined);
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

      // Semantic re-ranking: each term's candidates are reordered
      // best-match-first before the existing pickup-first heuristic runs.
      // AI errors degrade to the original search order.
      // See docs/small-model-efficiency-plan.md "Server-side AI" #8.
      const ai = getMatchRankerAi(ctx);
      const rankedResults = await Promise.all(
        searchResults.map(async (result, index) => {
          if (result.failed || result.products.length === 0) return result;
          const ranked = await rankProductMatches({
            ai,
            query: terms[index],
            products: result.products,
          });
          return { ...result, products: ranked };
        }),
      );

      const [pantry, deals] = await Promise.all([
        getPantryForFlags(ctx),
        getDealsForFlags(ctx, locationId),
      ]);

      const matched: Array<{ name: string; quantity: number; product: Product; flags: string[] }> =
        [];
      const notFound: string[] = [];

      items.forEach((item, index) => {
        const result = rankedResults[index];
        const best = result && !result.failed ? pickBestMatch(result.products) : undefined;
        if (best) {
          matched.push({
            name: item.name,
            quantity: item.quantity,
            product: best,
            flags: itemFlagLabels(item.name, pantry, deals),
          });
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

      const createResult = await createShoppingListRecord(ctx.storage, listName, listItems);
      if (createResult.isErr()) return toMcpError(createResult.error);
      const { listId, list } = createResult.value;

      const parts: string[] = [
        `Created shopping list "${listName}" (listId=${listId}) with ${matched.length} item(s).`,
        "",
        ...matched.map((match) =>
          formatMatchLineMarkdown(match.name, match.quantity, match.product, match.flags),
        ),
      ];

      if (notFound.length > 0) {
        parts.push("", `No results for: ${notFound.join(", ")}.`);
      }

      if (!addToCart) {
        parts.push(
          "",
          `Review these matches, then call add_shopping_list_to_cart with listId "${listId}" to add them to the Kroger cart.`,
        );
        return shoppingListResponse(listId, list, parts);
      }

      // addToCart: reuse the same confirm-then-PUT path as
      // add_shopping_list_to_cart so the elicitation confirmation still
      // gates the write.
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

      const continuation: ShopForItemsContinuation = {
        kind: "shop-for-items",
        inputFingerprint: fingerprint,
        listId,
        responseText: parts.join("\n"),
      };
      return finishShopForItemsCart(ctx, requestContext, continuation, list, lineItems);
    },
  );
}
