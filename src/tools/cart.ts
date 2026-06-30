import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import * as z from "zod/v4";

import type { components } from "../services/kroger/cart.js";

import { validationError } from "../errors.js";
import {
  fromApiResponse,
  getProps,
  safeResolveLocationId,
  safeStorage,
  toMcpError,
} from "../utils/result.js";
import { APP_VIEW_URI } from "../utils/view-resource.js";
import { requestCheckoutConfirmation } from "./shopping-list.js";
import { type ToolContext } from "./types.js";

type CartItem = components["schemas"]["cart.cartItemModel"];
type CartItemRequest = components["schemas"]["cart.cartItemRequestModel"];

export const addToCartInputSchema = z.object({
  shopping_list_id: z
    .string()
    .min(1, { message: "shopping_list_id is required" })
    .describe(
      "The id returned by `create_shopping_list` as `shopping_list_id`. Identifies the list whose items are added to the Kroger cart.",
    ),
  locationId: z
    .string()
    .length(8, { message: "Location ID must be exactly 8 characters" })
    .optional()
    .describe("Store location ID for the cart. If not provided, uses your preferred location."),
  modality: z.enum(["DELIVERY", "PICKUP"]).default("PICKUP"),
});

export function registerCartTools(ctx: ToolContext) {
  const { cartClient } = ctx.clients;

  registerAppTool(
    ctx.server,
    "add_to_cart",
    {
      title: "Add Shopping List to Cart",
      description:
        "Adds every item on a shopping list (identified by `shopping_list_id`) that has a UPC to the user's Kroger shopping cart. Items without a UPC are listed separately so they can be searched first. After a successful add, the resulting cart contents are persisted under the same `shopping_list_id`. Location defaults to the user's preferred location if not specified.",
      _meta: { ui: { resourceUri: APP_VIEW_URI } },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: addToCartInputSchema,
    },
    async ({ shopping_list_id, locationId, modality }) => {
      const props = getProps();

      // The shopping list id is namespaced with the authenticated user id,
      // so a forged id from another user can't be read here.
      if (!shopping_list_id.startsWith(`${props.id}:`)) {
        return toMcpError(
          validationError("The provided shopping_list_id does not belong to the current user."),
        );
      }

      return safeStorage(
        () => ctx.storage.shoppingList.get(shopping_list_id),
        "fetch shopping list",
      ).match(async (list) => {
        if (!list) {
          return toMcpError(
            validationError(
              `No shopping list found for shopping_list_id "${shopping_list_id}". Create one with create_shopping_list first.`,
            ),
          );
        }

        const withUpc = list.items.filter((item): item is typeof item & { upc: string } =>
          Boolean(item.upc),
        );
        const withoutUpc = list.items.filter((item) => !item.upc);

        if (withUpc.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  `Shopping list "${list.name}" has no items with a UPC ready to add to the cart.\n` +
                  (withoutUpc.length > 0
                    ? `Use search_products to find UPCs for: ${withoutUpc.map((i) => i.productName).join(", ")}.`
                    : ""),
              },
            ],
            structuredContent: {
              _view: "add_to_cart",
              shopping_list_id,
              name: list.name,
              items: [],
              needsUpc: withoutUpc.map((i) => ({
                productName: i.productName,
                quantity: i.quantity,
              })),
              actionDetail: "No items with UPCs to add",
            },
          };
        }

        return safeResolveLocationId(ctx.storage, props.id, locationId).match(async (resolved) => {
          const confirmationResult = await requestCheckoutConfirmation(ctx.server.server, withUpc);

          return confirmationResult.match(async () => {
            const cartItems: CartItem[] = withUpc.map((item) => ({
              upc: item.upc,
              quantity: item.quantity,
              modality,
            }));

            const requestBody: CartItemRequest = { items: cartItems };

            const addResult = await fromApiResponse(
              cartClient.PUT("/v1/cart/add", {
                body: requestBody,
                headers: { "Content-Type": "application/json" },
              }),
              "add shopping list items to cart",
            );

            return addResult.match(async () => {
              // Persist the cart snapshot keyed by shopping_list_id (the
              // shopping_list_id -> CartItem[] mapping the agent uses to
              // recall which shopping list produced which cart).
              const snapshot = cartItems.map((item) => ({
                upc: item.upc,
                quantity: item.quantity,
                modality: item.modality,
                productName: withUpc.find((i) => i.upc === item.upc)?.productName,
              }));

              return safeStorage(
                () => ctx.storage.cartSnapshot.set(shopping_list_id, snapshot),
                "persist cart snapshot",
              ).match(() => {
                const locationInfo = resolved.locationName
                  ? ` at ${resolved.locationName}`
                  : ` (Location: ${resolved.locationId})`;

                const resultParts: string[] = [
                  `Added ${withUpc.length} item(s) from list "${list.name}" to cart${locationInfo}:\n${withUpc.map((i) => `  - ${i.productName} x${i.quantity}`).join("\n")}`,
                ];

                if (withoutUpc.length > 0) {
                  resultParts.push(
                    `${withoutUpc.length} item(s) need a UPC before checkout (use search_products to find them, then create a new shopping list with create_shopping_list):\n${withoutUpc.map((i) => `  - ${i.productName} x${i.quantity}`).join("\n")}`,
                  );
                }

                return {
                  content: [{ type: "text" as const, text: resultParts.join("\n\n") }],
                  structuredContent: {
                    _view: "add_to_cart",
                    shopping_list_id,
                    name: list.name,
                    items: snapshot,
                    needsUpc: withoutUpc.map((i) => ({
                      productName: i.productName,
                      quantity: i.quantity,
                    })),
                    actionDetail: `Added ${withUpc.length} item(s) from list "${list.name}" to cart`,
                  },
                };
              }, toMcpError);
            }, toMcpError);
          }, toMcpError);
        }, toMcpError);
      }, toMcpError);
    },
  );
}
