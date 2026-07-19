import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { ResultAsync, err, ok } from "neverthrow";
import * as z from "zod/v4";

import type { AppError } from "../errors.js";
import type { ShoppingList, ShoppingListItem } from "../utils/user-storage.js";

import { appResult } from "../app-results.js";
import { validationError } from "../errors.js";
import { formatShoppingListItemCompact } from "../utils/format-response.js";
import { getProps, safeResolveLocationId, safeStorage, toMcpError } from "../utils/result.js";
import { APP_VIEW_URI } from "../utils/view-resource.js";
import { getDealsForFlags, getPantryForFlags, itemFlagLabels } from "./item-flags.js";
import { upcSchema } from "./schemas.js";
import { type ToolContext, type UserStorage } from "./types.js";

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

  if (elicitResult.isErr()) {
    // A client without elicitation support implicitly confirms checkout.
    return elicitResult.error instanceof ElicitationUnsupportedError
      ? ok(undefined)
      : err(validationError("Elicitation request failed unexpectedly."));
  }

  const elicit = elicitResult.value;
  if (
    elicit.action === "decline" ||
    elicit.action === "cancel" ||
    (elicit.action === "accept" && elicit.content?.confirm === false)
  ) {
    return err(validationError("Checkout cancelled. Your shopping list remains unchanged."));
  }
  return ok(undefined);
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

/** Client-id hint for ShoppingStore implementations that accept caller-generated ids. */
function generateRequestedListId(): string {
  return `list_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

export type CreateShoppingListResult = { listId: string; list: ShoppingList };

/**
 * Persists a list and returns the storage-owned id shown to the model. The
 * gateway creates its own durable id, so the returned record is authoritative.
 */
export function createShoppingListRecord(
  storage: UserStorage,
  name: string,
  items: ShoppingListItem[],
): ResultAsync<CreateShoppingListResult, AppError> {
  const requestedId = generateRequestedListId();
  return safeStorage(
    () => storage.shoppingList.create(requestedId, name, items),
    "create shopping list",
  ).map((list) => ({ listId: list.id, list }));
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
      getProps();

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
        getPantryForFlags(ctx),
        safeResolveLocationId(ctx.storage, undefined),
      ]);
      const locationId = resolvedLocation.isOk() ? resolvedLocation.value.locationId : undefined;
      const deals = await getDealsForFlags(ctx, locationId);

      const lines = enrichedItems
        .map((item, index) => {
          const flags = itemFlagLabels(item.productName, pantry, deals);
          const base = formatShoppingListItemCompact(item);
          const suffixed = flags.length > 0 ? `${base} | ${flags.join(" | ")}` : base;
          return `${index + 1}. ${suffixed}`;
        })
        .join("\n");

      const result = await createShoppingListRecord(ctx.storage, listName, enrichedItems);
      if (result.isErr()) return toMcpError(result.error);
      const { listId, list } = result.value;
      return {
        content: [
          {
            type: "text" as const,
            text: `Created shopping list "${listName}" with ${enrichedItems.length} item(s). listId=${listId}\n\n${lines}`,
          },
        ],
        ...appResult("create_shopping_list", {
          listId,
          name: list.name,
          items: list.items,
        }),
      };
    },
  );
}
