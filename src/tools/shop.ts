import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import * as z from "zod/v4";

import type { components as ProductComponents } from "../services/kroger/product.js";
import type { ShoppingListItem } from "../utils/user-storage.js";

import { notFoundError, validationError } from "../errors.js";
import {
  type EmbeddingAi,
  isEmbeddingAiLike,
  rankProductMatches,
} from "../services/match-ranker.js";
import { getProps, safeResolveLocationId, safeStorage, toMcpError } from "../utils/result.js";
import { APP_VIEW_URI } from "../utils/view-resource.js";
import { type LineItem, addLineItemsToCart, toCartSnapshotItems } from "./cart.js";
import { getDealsForFlags, getPantryForFlags, itemFlagLabels } from "./item-flags.js";
import { getProductSearchCacheKv, searchProductsForTerms } from "./product.js";
import { coercedBooleanSchema } from "./schemas.js";
import { buildShoppingListStorageKey, createShoppingListRecord } from "./shopping-list.js";
import { type ToolContext } from "./types.js";

type Product = ProductComponents["schemas"]["products.productModel"];

/**
 * Resolves the Workers AI binding for semantic match ranking, or null when AI
 * features are disabled. Gated by two independent conditions so tests never
 * reach the real (remote-proxied) `env.AI` binding: the binding must exist,
 * and `AI_FEATURES` must not be `"off"` (see vitest.config.ts, which sets
 * `AI_FEATURES: "off"` for the whole suite).
 */
export function getMatchRankerAi(ctx: ToolContext): EmbeddingAi | null {
  const env = ctx.getEnv();
  if ("AI_FEATURES" in env && env.AI_FEATURES === "off") return null;

  return isEmbeddingAiLike(env.AI) ? env.AI : null;
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

export function registerShopTools(ctx: ToolContext) {
  const { productClient, cartClient } = ctx.clients;

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
      const kv = getProductSearchCacheKv(ctx);
      const searchResults = await searchProductsForTerms(productClient, terms, {
        locationId,
        limitPerTerm: 5,
        kv,
      });

      // Semantic re-ranking: when AI features are enabled, each term's
      // candidates are reordered best-match-first before the existing
      // pickup-first heuristic runs. Disabled (the default in tests and when
      // AI_FEATURES=off), this is a no-op and behavior is byte-identical to
      // before. See docs/small-model-efficiency-plan.md "Server-side AI" #8.
      const ai = getMatchRankerAi(ctx);
      const rankedResults = await Promise.all(
        searchResults.map(async (result, index) => {
          if (!ai || result.failed || result.products.length === 0) return result;
          const ranked = await rankProductMatches({
            ai,
            kv,
            query: terms[index],
            products: result.products,
          });
          return { ...result, products: ranked };
        }),
      );

      const [pantry, deals] = await Promise.all([
        getPantryForFlags(ctx, props.id),
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

      const createResult = await createShoppingListRecord(
        ctx.storage,
        props.id,
        ctx.getSessionId(),
        listName,
        listItems,
      );

      return createResult.match(async ({ shortId, list }) => {
        const parts: string[] = [
          `Created shopping list "${listName}" (listId=${shortId}) with ${matched.length} item(s).`,
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
          structuredContent: {
            _view: "create_shopping_list" as const,
            listId: shortId,
            name: list.name,
            items: list.items,
          },
        });

        if (!addToCart) {
          parts.push(
            "",
            `Review these matches, then call add_shopping_list_to_cart with listId "${shortId}" to add them to the Kroger cart.`,
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
            `None of the matches had a upc to add to cart. Retry with add_shopping_list_to_cart {"listId":"${shortId}"} once available.`,
          );
          return respond();
        }

        const addResult = await addLineItemsToCart(ctx, cartClient, lineItems, "PICKUP", props.id);

        return addResult.match(
          async () => {
            // Persist the cart snapshot under the same storage key
            // add_shopping_list_to_cart checks, so a follow-up call with this
            // listId short-circuits instead of double-adding.
            const snapshot = toCartSnapshotItems(lineItems, "PICKUP");
            const storageKey = buildShoppingListStorageKey(props.id, ctx.getSessionId(), shortId);

            return safeStorage(
              () => ctx.storage.cartSnapshot.set(storageKey, snapshot),
              "persist cart snapshot",
            ).match(() => {
              parts.push(
                "",
                `Added ${lineItems.length} item(s) to your Kroger cart (no need to call add_shopping_list_to_cart).`,
              );
              return respond();
            }, toMcpError);
          },
          () => {
            parts.push(
              "",
              `Cart add was cancelled or failed; the shopping list still exists. Retry with add_shopping_list_to_cart {"listId":"${shortId}"}.`,
            );
            return respond();
          },
        );
      }, toMcpError);
    },
  );
}
