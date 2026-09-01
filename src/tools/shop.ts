import * as z from "zod/v4";

import type { components as ProductComponents } from "../services/kroger/product.js";
import type { ShoppingListItem } from "../utils/user-storage.js";

import { appResult } from "../app-results.js";
import { registerAppTool } from "../utils/app-tool.js";
import { notFoundError, storageError, validationError } from "../errors.js";
import { rankProductMatches } from "../services/match-ranker.js";
import {
  getProps,
  safeResolveLocationId,
  safeStorage,
  STORE_ID_RECOVERY_HINT,
  toMcpError,
} from "../utils/result.js";
import { APP_VIEW_URI } from "../utils/view-resource.js";
import { type LineItem, addLineItemsToCart, toCartSnapshotItems } from "./cart.js";
import { getDealsForFlags, getPantryForFlags, itemFlagLabels } from "./item-flags.js";
import { searchProductsForTerms } from "./product.js";
import { coercedBooleanSchema, storeIdSchema } from "./schemas.js";
import { createShoppingListRecord, inlineCartAddRecovery } from "./shopping-list.js";
import { type ToolContext } from "./types.js";

type Product = ProductComponents["schemas"]["products.productModel"];

/**
 * Resolves the Workers AI binding for semantic match ranking. Ranking itself
 * is best-effort; remote-binding failures are handled inside `rankProductMatches`.
 */
export function getMatchRankerAi(ctx: ToolContext): Ai {
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
  storeId: storeIdSchema
    .optional()
    .describe("8-character storeId from search_stores. Uses your preferred store if omitted."),
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

export function registerShopTools(ctx: ToolContext) {
  const { productClient, cartClient } = ctx.clients;

  registerAppTool(
    ctx.server,
    "shop_for_items",
    {
      title: "Shop For Items",
      description:
        'One-shot shopping: searches for each item name, picks the best match, and creates a shopping list. Pass storeId from search_stores when no preferred store is saved. Set addToCart:true to also add the matches to your Kroger cart (PICKUP). Example: {"items":[{"name":"whole milk"},{"name":"eggs","quantity":2}],"storeId":"70500847","addToCart":true}',
      _meta: { ui: { resourceUri: APP_VIEW_URI } },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: shopForItemsInputSchema,
    },
    async ({ items, addToCart, storeId }, requestContext) => {
      getProps();

      const resolvedLocation = await safeResolveLocationId(ctx.storage, storeId);
      if (resolvedLocation.isErr()) {
        if (resolvedLocation.error.type === "NOT_FOUND") {
          return toMcpError(
            notFoundError(
              `No preferred store set. ${STORE_ID_RECOVERY_HINT} Or use search_stores then set_preferred_store and try again.`,
            ),
          );
        }
        return toMcpError(
          storageError(
            `${resolvedLocation.error.message}. ${STORE_ID_RECOVERY_HINT}`,
            resolvedLocation.error,
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
      const shortId = createResult.isOk() ? createResult.value.shortId : undefined;
      const list = createResult.isOk() ? createResult.value.list : undefined;

      const parts: string[] = [
        shortId
          ? `Created shopping list "${listName}" (listId=${shortId}) with ${matched.length} item(s).`
          : `Found ${matched.length} item(s). Shopping list could not be saved (${createResult.isErr() ? createResult.error.message : "unknown error"}).`,
        "",
        ...matched.map((match) =>
          formatMatchLineMarkdown(match.name, match.quantity, match.product, match.flags),
        ),
      ];

      if (notFound.length > 0) {
        parts.push("", `No results for: ${notFound.join(", ")}.`);
      }

      const respond = () => ({
        content: [{ type: "text" as const, text: parts.join("\n") }],
        ...(shortId && list
          ? appResult("create_shopping_list", {
              listId: shortId,
              name: list.name,
              items: list.items,
            })
          : {}),
      });

      if (!addToCart) {
        parts.push(
          "",
          shortId
            ? `Review these matches, then call add_shopping_list_to_cart with listId "${shortId}" to add them to the Kroger cart.`
            : `Add the matches with ${inlineCartAddRecovery(listItems, locationId)}.`,
        );
        return respond();
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
          shortId
            ? `None of the matches had a upc to add to cart. Retry with add_shopping_list_to_cart {"listId":"${shortId}"} once available.`
            : `None of the matches had a upc to add to cart. Retry with ${inlineCartAddRecovery(listItems, locationId)}.`,
        );
        return respond();
      }

      const addResult = await addLineItemsToCart(
        ctx,
        cartClient,
        lineItems,
        "PICKUP",
        requestContext,
      );
      if (addResult.isErr()) {
        parts.push(
          "",
          shortId
            ? `Cart add was cancelled or failed; the shopping list still exists. Retry with add_shopping_list_to_cart {"listId":"${shortId}"}.`
            : `Cart add was cancelled or failed. Retry with ${inlineCartAddRecovery(listItems, locationId)}.`,
        );
        return respond();
      }

      // Persist the cart snapshot under the same storage key
      // add_shopping_list_to_cart checks, so a follow-up call with this
      // listId short-circuits instead of double-adding. Skip when the list
      // itself could not be saved — there is no listId to key the receipt.
      if (shortId) {
        const snapshot = toCartSnapshotItems(lineItems, "PICKUP");
        const snapshotResult = await safeStorage(
          () => ctx.storage.cartSnapshot.set(shortId, snapshot),
          "persist cart snapshot",
        );
        if (snapshotResult.isErr()) {
          return toMcpError(
            storageError(
              "Kroger accepted the cart add, but its local retry receipt could not be saved. The outcome is ambiguous; do not retry because that may add duplicates. Check the Kroger cart first.",
              snapshotResult.error,
            ),
          );
        }
      }

      parts.push(
        "",
        `Added ${lineItems.length} item(s) to your Kroger cart (no need to call add_shopping_list_to_cart).`,
      );
      return respond();
    },
  );
}
