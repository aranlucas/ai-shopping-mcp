import { z } from "zod";
import type { components } from "../services/kroger/cart.js";
import { cartClient } from "../services/kroger/client.js";
import { createUserStorage } from "../utils/user-storage.js";
import { requireAuth, resolveLocationId, type ToolContext } from "./types.js";

type CartItem = components["schemas"]["cart.cartItemModel"];
type CartItemRequest = components["schemas"]["cart.cartItemRequestModel"];

export function registerCartTools(ctx: ToolContext) {
  ctx.server.registerTool(
    "add_to_cart",
    {
      description:
        "Adds specified items to a user's shopping cart. Use this tool when the user wants to add products to their cart for purchase. Prefer to use add to cart with multiple items. Location ID will default to user's preferred location if not specified.",
      inputSchema: z.object({
        items: z.array(
          z.object({
            upc: z.string().length(13, {
              message: "UPC must be exactly 13 characters long",
            }),
            quantity: z
              .number()
              .min(1, { message: "Quantity must be at least 1" }),
            modality: z.enum(["DELIVERY", "PICKUP"]).default("PICKUP"),
          }),
        ),
        locationId: z
          .string()
          .length(8, { message: "Location ID must be exactly 8 characters" })
          .optional()
          .describe(
            "Store location ID for the cart. If not provided, uses your preferred location.",
          ),
      }),
    },
    async ({ items, locationId }) => {
      const props = requireAuth(ctx);
      const storage = createUserStorage(ctx.getEnv().USER_DATA_KV);

      const resolved = await resolveLocationId(storage, props.id, locationId);

      // Convert items to the format expected by the Kroger API
      const cartItems: CartItem[] = items.map((item) => ({
        upc: item.upc,
        quantity: item.quantity,
        modality: item.modality,
      }));

      const requestBody: CartItemRequest = {
        items: cartItems,
      };

      const { error } = await cartClient.PUT("/v1/cart/add", {
        body: requestBody,
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (error) {
        console.error("Error adding items to cart:", error);
        throw new Error(
          `Failed to add items to cart: ${JSON.stringify(error)}`,
        );
      }

      console.log(
        `Items successfully added to cart for location ${resolved.locationId}`,
      );

      const locationInfo = resolved.locationName
        ? ` at ${resolved.locationName}`
        : ` (Location: ${resolved.locationId})`;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              message: `Successfully added ${items.length} item(s) to cart${locationInfo}`,
              itemsAdded: items.length,
              locationId: resolved.locationId,
              success: true,
            }),
          },
        ],
      };
    },
  );
}
