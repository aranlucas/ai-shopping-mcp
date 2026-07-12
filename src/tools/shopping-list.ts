import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { ResultAsync, err, ok } from "neverthrow";
import * as z from "zod/v4";

import type { AppError } from "../errors.js";
import type { ShoppingList, ShoppingListItem } from "../utils/user-storage.js";

import { validationError } from "../errors.js";
import { formatShoppingListItemCompact } from "../utils/format-response.js";
import { getProps, safeResolveLocationId, safeStorage, toMcpError } from "../utils/result.js";
import { APP_VIEW_URI } from "../utils/view-resource.js";
import { APP_VIEW_META_KEY } from "../utils/view-meta.js";
import { getDealsForFlags, getPantryForFlags, itemFlagLabels } from "./item-flags.js";
import { upcSchema } from "./schemas.js";
import { type ToolContext, type UserStorage, getSessionScopedUserId } from "./types.js";

type CheckoutConfirmationServer = {
  elicitInput(input: {
    message: string;
    requestedSchema: {
      type: "object";
      properties: {
        confirm: {
          type: "boolean";
          title: string;
          description: string;
          default: boolean;
        };
      };
    };
  }): Promise<{ action: "accept" | "decline" | "cancel"; content?: { confirm?: boolean } }>;
};

type CheckoutConfirmationItem = Pick<ShoppingListItem, "productName" | "quantity">;

class ElicitationUnsupportedError extends Error {}
class ElicitationFailedError extends Error {}

/**
 * The exact message the MCP SDK's `Server#elicitInput` throws when the
 * connected client didn't advertise the `elicitation.form` capability (see
 * `elicitInput` in `@modelcontextprotocol/sdk/server/index.js`). There is no
 * typed error or capability check exposed for this — `requestCheckoutConfirmation`
 * below distinguishes "capability absent" (fall through, treat as implicit
 * confirmation) from "elicitation actually failed" (surface an error) by
 * string-matching this message. An SDK upgrade that rewords it would silently
 * turn every no-elicitation client into a failed checkout, so this constant
 * is asserted against the installed SDK directly in
 * tests/tools/shopping-list-confirmation.test.ts — that test fails loudly if
 * the SDK's wording ever changes.
 */
export const ELICITATION_UNSUPPORTED_MESSAGE = "Client does not support form elicitation.";

export async function requestCheckoutConfirmation(
  server: CheckoutConfirmationServer,
  items: CheckoutConfirmationItem[],
) {
  const itemList = items.map((i) => `${i.productName} x${i.quantity}`).join(", ");

  const elicitResult = await ResultAsync.fromPromise(
    server.elicitInput({
      message: `Add ${items.length} item(s) to your Kroger cart? Items: ${itemList}`,
      requestedSchema: {
        type: "object" as const,
        properties: {
          confirm: {
            type: "boolean" as const,
            title: "Confirm checkout",
            description: "Add these items to your Kroger cart?",
            default: true,
          },
        },
      },
    }),
    (e) =>
      e instanceof Error && e.message === ELICITATION_UNSUPPORTED_MESSAGE
        ? new ElicitationUnsupportedError()
        : new ElicitationFailedError(),
  );

  return elicitResult.match(
    (elicit) => {
      if (
        elicit.action === "decline" ||
        elicit.action === "cancel" ||
        (elicit.action === "accept" && elicit.content?.confirm === false)
      ) {
        return err(validationError("Checkout cancelled. Your shopping list remains unchanged."));
      }
      return ok(undefined);
    },
    (e) =>
      e instanceof ElicitationUnsupportedError
        ? ok(undefined) // client doesn't support elicitation — treat as implicit confirmation
        : err(validationError("Elicitation request failed unexpectedly.")),
  );
}

export const createShoppingListInputSchema = z.object({
  name: z.string().min(1).max(200).describe("List label, e.g. 'Tuesday dinner'."),
  items: z
    .array(
      z.object({
        upc: upcSchema.describe("UPC from search_products"),
        quantity: z.coerce.number().min(1).max(999).default(1),
        notes: z.string().max(500).optional().describe("e.g. 'get organic'"),
      }),
    )
    .min(1, { message: "Shopping list must include at least one item" }),
});

/** Short opaque id shown to the model: `list_` + 8 hex chars, e.g. `list_a1b2c3d8`. */
export function generateShortListId(): string {
  return `list_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

/**
 * Builds the namespaced KV storage key for a shopping list from the
 * authenticated user id, session id, and the short id shown to the model.
 * The user/session namespace is never sent to the model — only the short id
 * is. Because the storage key is namespaced by the authenticated user id, a
 * forged short id from another user is not readable here: the same
 * per-user isolation the old prefix-checked composite id provided.
 */
export function buildShoppingListStorageKey(
  userId: string,
  sessionId: string,
  shortId: string,
): string {
  return `${getSessionScopedUserId(userId, sessionId)}:list:${shortId}`;
}

export type CreateShoppingListResult = { shortId: string; list: ShoppingList };

/**
 * Shared helper: persists a new shopping list snapshot and returns the short
 * id shown to the model alongside the stored record. Reused by
 * `create_shopping_list` and `shop_for_items`.
 */
export function createShoppingListRecord(
  storage: UserStorage,
  userId: string,
  sessionId: string,
  name: string,
  items: ShoppingListItem[],
): ResultAsync<CreateShoppingListResult, AppError> {
  const shortId = generateShortListId();
  const storageKey = buildShoppingListStorageKey(userId, sessionId, shortId);

  return safeStorage(
    () => storage.shoppingList.create(storageKey, name, items),
    "create shopping list",
  ).map((list) => ({ shortId, list }));
}

export function registerShoppingListTools(ctx: ToolContext) {
  registerAppTool(
    ctx.server,
    "create_shopping_list",
    {
      title: "Create Shopping List",
      description:
        'Creates a named shopping list snapshot; returns `listId` for add_shopping_list_to_cart. The product name is looked up automatically from the UPC. Example: {"name":"Tuesday dinner","items":[{"upc":"0001111041700","quantity":1}]}',
      _meta: { ui: { resourceUri: APP_VIEW_URI } },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: createShoppingListInputSchema,
    },
    async ({ name: listName, items }) => {
      const props = getProps();

      if (items.length === 0) {
        return toMcpError(validationError("Shopping list must include at least one item."));
      }

      // Product names are always looked up from the UPC (ProductService is
      // KV-cached at the Kroger client layer) — a lookup failure falls back
      // to the UPC as the display name, never a failed tool call. Lookups
      // run in parallel.
      const enrichedItems: ShoppingListItem[] = await Promise.all(
        items.map(async (item) => {
          const productName = await ctx.productService.enrichProductName(item.upc);
          return {
            productName: productName ?? item.upc,
            upc: item.upc,
            quantity: item.quantity,
            notes: item.notes,
          };
        }),
      );

      // Best-effort pantry/deal flags (see item-flags.ts): a storage/cache
      // miss or error yields no flag, never a failed tool call. Location is
      // resolved best-effort too — no preferred store just means no deal
      // flags, not an error for this tool.
      const [pantry, resolvedLocation] = await Promise.all([
        getPantryForFlags(ctx, props.id),
        safeResolveLocationId(ctx.storage, props.id, undefined),
      ]);
      const locationId = resolvedLocation.match(
        (resolved) => resolved.locationId,
        () => undefined,
      );
      const deals = await getDealsForFlags(ctx, locationId);

      const lines = enrichedItems
        .map((item, index) => {
          const flags = itemFlagLabels(item.productName, pantry, deals);
          const base = formatShoppingListItemCompact(item);
          const suffixed = flags.length > 0 ? `${base} | ${flags.join(" | ")}` : base;
          return `${index + 1}. ${suffixed}`;
        })
        .join("\n");

      const result = await createShoppingListRecord(
        ctx.storage,
        props.id,
        ctx.getSessionId(),
        listName,
        enrichedItems,
      );

      return result.match(
        ({ shortId, list }) => ({
          content: [
            {
              type: "text" as const,
              text: `Created shopping list "${listName}" with ${enrichedItems.length} item(s). listId=${shortId}\n\n${lines}`,
            },
          ],
          _meta: { [APP_VIEW_META_KEY]: "create_shopping_list" },
          structuredContent: {
            listId: shortId,
            name: list.name,
            items: list.items,
          },
        }),
        toMcpError,
      );
    },
  );
}
