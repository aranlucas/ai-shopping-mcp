import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Props } from "../server.js";
import type { components } from "../services/kroger/cart.js";
import { cartClient } from "../services/kroger/client.js";
import { createUserStorage } from "../utils/user-storage.js";

// Type aliases for API schemas
type CartItem = components["schemas"]["cart.cartItemModel"];
type CartItemRequest = components["schemas"]["cart.cartItemRequestModel"];

/**
 * Registers shopping cart tools with the MCP server.
 *
 * Tools:
 * - add_to_cart: Add items to the user's shopping cart
 */
export function registerCartTools(
  server: McpServer,
  env: Env,
  getProps: () => Props | undefined,
) {
  // Add to cart tool
  server.registerTool(
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
      const props = getProps();
      if (!props?.id) {
        throw new Error("User not authenticated");
      }

      // Get location ID from preferred location if not provided
      let effectiveLocationId = locationId;
      let locationName: string | undefined;

      if (!effectiveLocationId) {
        const storage = createUserStorage(env.USER_DATA_KV);
        const preferredLocation = await storage.preferredLocation.get(props.id);

        if (!preferredLocation) {
          throw new Error(
            "No location specified and no preferred location set. Please provide a locationId or set your preferred location using set_preferred_location.",
          );
        }

        effectiveLocationId = preferredLocation.locationId;
        locationName = preferredLocation.locationName;
      }

      // Convert items to the format expected by the Kroger API
      const cartItems: CartItem[] = items.map((item) => ({
        upc: item.upc,
        quantity: item.quantity,
        modality: item.modality,
      }));

      const requestBody: CartItemRequest = {
        items: cartItems,
      };

      // Make the API call to add items to the cart
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
        `Items successfully added to cart for location ${effectiveLocationId}`,
      );

      // Return a success response with location context
      const locationInfo = locationName
        ? ` at ${locationName}`
        : ` (Location: ${effectiveLocationId})`;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              message: `Successfully added ${items.length} item(s) to cart${locationInfo}`,
              itemsAdded: items.length,
              locationId: effectiveLocationId,
              success: true,
            }),
          },
        ],
      };
    },
  );
}
