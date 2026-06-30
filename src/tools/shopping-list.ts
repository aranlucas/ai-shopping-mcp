import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { type Result, ResultAsync, err, ok } from "neverthrow";
import * as z from "zod/v4";

import type { AppError } from "../errors.js";
import type { ShoppingListItem } from "../utils/user-storage.js";

import { validationError } from "../errors.js";
import { formatShoppingListCompact } from "../utils/format-response.js";
import { getProps, safeStorage, toMcpError } from "../utils/result.js";
import { APP_VIEW_URI } from "../utils/view-resource.js";
import { type ToolContext, getSessionScopedUserId } from "./types.js";

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
  name: z
    .string()
    .min(1)
    .max(200)
    .describe(
      "Short label for the list (e.g., 'Tuesday dinner', 'Weekend BBQ'). Distinguishes this list from any prior ones in the conversation.",
    ),
  items: z
    .array(
      z.object({
        productName: z
          .string()
          .min(1)
          .max(200)
          .describe("Product name (e.g., 'Whole Milk', 'Sourdough Bread')"),
        upc: z
          .string()
          .length(13, { message: "UPC must be exactly 13 characters" })
          .optional()
          .describe("13-digit UPC from product search, needed for cart checkout"),
        quantity: z.number().min(1).max(999).default(1),
        notes: z
          .string()
          .max(500)
          .optional()
          .describe("Optional notes (e.g., 'get organic if available')"),
      }),
    )
    .describe("Items to add to this shopping list"),
});

const shoppingListItemSchema = z.looseObject({
  productName: z.string(),
  upc: z.string().optional(),
  quantity: z.number(),
  notes: z.string().optional(),
});

export const createShoppingListOutputSchema = z.object({
  _view: z.literal("create_shopping_list"),
  shopping_list_id: z
    .string()
    .describe(
      "Stable id of this shopping list. Pass it to add_to_cart to add the list to the Kroger cart.",
    ),
  name: z.string().describe("The label the agent supplied when creating the list."),
  items: z.array(shoppingListItemSchema),
  actionDetail: z.string().optional(),
});

export function registerShoppingListTools(ctx: ToolContext) {
  registerAppTool(
    ctx.server,
    "create_shopping_list",
    {
      title: "Create Shopping List",
      description:
        "Build a named shopping list of products the user plans to buy. Returns a `shopping_list_id` to pass to `add_to_cart`. Each call creates a fresh list; to refine, call this again with the updated items. Pass `name` to label the list in the UI.",
      _meta: { ui: { resourceUri: APP_VIEW_URI } },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: createShoppingListInputSchema,
      outputSchema: createShoppingListOutputSchema,
    },
    async ({ name, items }) => {
      const props = getProps();

      // The list id is a short random token namespaced under the authenticated
      // user and session; `add_to_cart` reads the list back by this id.
      // Including the user id in the key prevents a forged id from reaching
      // another user's list.
      const shortId = crypto.randomUUID().slice(0, 8);
      const shoppingListId = `${getSessionScopedUserId(props.id, ctx.getSessionId())}:list:${shortId}`;

      const result = await safeStorage(
        () => ctx.storage.shoppingList.create(shoppingListId, name, items),
        "create shopping list",
      );

      return result.match(
        (list) => ({
          content: [
            {
              type: "text" as const,
              text: `Created shopping list "${name}" with ${items.length} item(s).\n\n${formatShoppingListCompact(items)}`,
            },
          ],
          structuredContent: {
            _view: "create_shopping_list",
            shopping_list_id: list.id,
            name: list.name,
            items: list.items,
          },
        }),
        toMcpError,
      );
    },
  );
}
