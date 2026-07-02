import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { type Result, ResultAsync, err, ok } from "neverthrow";
import * as z from "zod/v4";

import type { AppError } from "../errors.js";
import type { ShoppingList, ShoppingListItem } from "../utils/user-storage.js";

import { validationError } from "../errors.js";
import { formatShoppingListCompact } from "../utils/format-response.js";
import { getProps, safeStorage, toMcpError } from "../utils/result.js";
import { APP_VIEW_URI } from "../utils/view-resource.js";
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

export async function requestCheckoutConfirmation(
  server: CheckoutConfirmationServer,
  items: CheckoutConfirmationItem[],
): Promise<Result<void, AppError>> {
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
      e instanceof Error && e.message === "Client does not support form elicitation."
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
  name: z.string().min(1).max(200).describe("Short label for the list, e.g. 'Tuesday dinner'."),
  items: z
    .array(
      z.object({
        productName: z.string().min(1).max(200).describe("Product name, e.g. 'Whole Milk'"),
        upc: upcSchema.optional().describe("UPC from search_products, needed for cart checkout"),
        quantity: z.coerce.number().min(1).max(999).default(1),
        notes: z.string().max(500).optional().describe("Optional note, e.g. 'get organic'"),
      }),
    )
    .min(1, { message: "Shopping list must include at least one item" })
    .describe("Items to add to this shopping list"),
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
        'Build a named immutable shopping list snapshot with at least one product. Returns a short `listId` to pass to add_shopping_list_to_cart. Example: {"name":"Tuesday dinner","items":[{"productName":"Whole Milk","upc":"0001111041700","quantity":1}]}',
      _meta: { ui: { resourceUri: APP_VIEW_URI } },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: createShoppingListInputSchema,
    },
    async ({ name, items }) => {
      const props = getProps();

      if (items.length === 0) {
        return toMcpError(validationError("Shopping list must include at least one item."));
      }

      const result = await createShoppingListRecord(
        ctx.storage,
        props.id,
        ctx.getSessionId(),
        name,
        items,
      );

      return result.match(
        ({ shortId, list }) => ({
          content: [
            {
              type: "text" as const,
              text: `Created shopping list "${name}" with ${items.length} item(s). listId=${shortId}\n\n${formatShoppingListCompact(items)}`,
            },
          ],
          structuredContent: {
            _view: "create_shopping_list",
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
