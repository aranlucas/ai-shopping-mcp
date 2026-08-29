import {
  acceptedContent,
  CLIENT_CAPABILITIES_META_KEY,
  inputRequired,
  inputResponse,
  type InputRequiredResult,
  type ServerContext,
} from "@modelcontextprotocol/server";
import { ResultAsync, err, ok, type Result } from "neverthrow";
import * as z from "zod/v4";

import type { AppError } from "../errors.js";
import type { ShoppingList, ShoppingListItem } from "../utils/user-storage.js";

import { appResult } from "../app-results.js";
import { registerAppTool } from "../utils/app-tool.js";
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

const CHECKOUT_CONFIRMATION_KEY = "checkout_confirmation";
const checkoutConfirmationSchema = z.object({ confirm: z.boolean() });

class ElicitationUnsupportedError extends Error {}
class ElicitationFailedError extends Error {}

/**
 * The exact message the MCP SDK's `Server#elicitInput` throws when the
 * connected client didn't advertise the `elicitation.form` capability (see
 * `elicitInput` in `@modelcontextprotocol/sdk/server/index.js`). There is no
 * typed error or capability check exposed for this on the 2025 push path —
 * `requestCheckoutConfirmation` distinguishes "capability absent" (fall
 * through, treat as implicit confirmation) from "elicitation actually failed"
 * (surface an error) by string-matching this message. The MCP 2.0 envelope
 * path uses `clientSupportsFormElicitation` instead of this string. An SDK
 * upgrade that rewords it would silently turn every no-elicitation 2025-era
 * client into a failed checkout, so this constant is asserted against the
 * installed SDK directly in tests/tools/shopping-list-confirmation.test.ts.
 */
export const ELICITATION_UNSUPPORTED_MESSAGE = "Client does not support form elicitation.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * MCP 2.0 form-elicitation support, matching the SDK's inputRequired gate:
 * `elicitation.form` is required, and a bare `elicitation: {}` still counts
 * as form (the pre-mode declaration). URL-only clients do not qualify.
 * Hosts that attach an envelope but omit elicitation entirely must not
 * receive `inputRequired` — the SDK rejects that with -32021 and the
 * cart PUT never runs.
 */
export function clientSupportsFormElicitation(requestContext?: ServerContext): boolean {
  const envelope = requestContext?.mcpReq.envelope;
  if (!isRecord(envelope)) return false;
  const capabilities = envelope[CLIENT_CAPABILITIES_META_KEY];
  if (!isRecord(capabilities)) return false;
  const elicitation = capabilities.elicitation;
  if (!isRecord(elicitation)) return false;
  if (elicitation.form !== undefined) return true;
  return elicitation.url === undefined;
}

/** Recovery text so a list-save failure can still become an inline cart add. */
export function inlineCartAddRecovery(
  items: Array<{ upc?: string; quantity: number }>,
  storeId?: string,
): string {
  const inline = items
    .filter((item): item is { upc: string; quantity: number } => Boolean(item.upc))
    .map((item) => ({ upc: item.upc, quantity: item.quantity }));
  return `add_shopping_list_to_cart ${JSON.stringify({
    items: inline,
    storeId: storeId ?? "<storeId from search_stores>",
  })}`;
}

export function requestCheckoutConfirmation(
  server: CheckoutConfirmationServer,
  items: CheckoutConfirmationItem[],
): Promise<Result<void, AppError>>;
export function requestCheckoutConfirmation(
  server: CheckoutConfirmationServer,
  items: CheckoutConfirmationItem[],
  requestContext: ServerContext | undefined,
): Promise<Result<void, AppError> | InputRequiredResult>;
export async function requestCheckoutConfirmation(
  server: CheckoutConfirmationServer,
  items: CheckoutConfirmationItem[],
  requestContext?: ServerContext,
): Promise<Result<void, AppError> | InputRequiredResult> {
  const itemList = items.map((i) => `${i.productName} x${i.quantity}`).join(", ");
  const message = `Add ${items.length} item(s) to your Kroger cart? Items: ${itemList}`;

  if (requestContext?.mcpReq.envelope !== undefined) {
    const response = inputResponse(requestContext.mcpReq.inputResponses, CHECKOUT_CONFIRMATION_KEY);
    if (response.kind === "elicit" && response.action !== "accept") {
      return err(validationError("Checkout cancelled. Your shopping list remains unchanged."));
    }

    const accepted = acceptedContent(
      requestContext.mcpReq.inputResponses,
      CHECKOUT_CONFIRMATION_KEY,
      checkoutConfirmationSchema,
    );
    if (!accepted) {
      // Envelope present does not mean the client can fulfill elicitation.
      // Returning inputRequired without elicitation.form is rejected by the
      // SDK (-32021) and the cart PUT never runs.
      if (!clientSupportsFormElicitation(requestContext)) {
        return ok(undefined);
      }

      return inputRequired({
        inputRequests: {
          [CHECKOUT_CONFIRMATION_KEY]: inputRequired.elicit({
            message,
            requestedSchema: {
              type: "object",
              properties: {
                confirm: {
                  type: "boolean",
                  title: "Confirm checkout",
                  description: "Add these items to your Kroger cart?",
                  default: true,
                },
              },
              required: ["confirm"],
            },
          }),
        },
      });
    }

    return accepted.confirm
      ? ok(undefined)
      : err(validationError("Checkout cancelled. Your shopping list remains unchanged."));
  }

  const elicitResult = await ResultAsync.fromPromise(
    (requestContext?.mcpReq ?? server).elicitInput({
      message,
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

/** Short opaque id shown to the model: `list_` + 8 hex chars, e.g. `list_a1b2c3d8`. */
export function generateShortListId(): string {
  return `list_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

/**
 * Builds the namespaced KV storage key for a shopping list from the
 * authenticated user id and the short id shown to the model. The user
 * namespace is never sent to the model — only the short id
 * is. Because the storage key is namespaced by the authenticated user id, a
 * forged short id from another user is not readable here: the same
 * per-user isolation the old prefix-checked composite id provided.
 */
export type CreateShoppingListResult = { shortId: string; list: ShoppingList };

/**
 * Shared helper: persists a new shopping list snapshot and returns the short
 * id shown to the model alongside the stored record. Reused by
 * `create_shopping_list` and `shop_for_items`.
 */
export function createShoppingListRecord(
  storage: UserStorage,
  name: string,
  items: ShoppingListItem[],
): ResultAsync<CreateShoppingListResult, AppError> {
  const shortId = generateShortListId();
  return safeStorage(
    () => storage.shoppingList.create(shortId, name, items),
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
      if (result.isErr()) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                `Could not save shopping list "${listName}" (${result.error.message}). ` +
                `Add these items with ${inlineCartAddRecovery(enrichedItems, locationId)}.\n\n${lines}`,
            },
          ],
          isError: true as const,
        };
      }
      const { shortId, list } = result.value;
      return {
        content: [
          {
            type: "text" as const,
            text: `Created shopping list "${listName}" with ${enrichedItems.length} item(s). listId=${shortId}\n\n${lines}`,
          },
        ],
        ...appResult("create_shopping_list", {
          listId: shortId,
          name: list.name,
          items: list.items,
        }),
      };
    },
  );
}
