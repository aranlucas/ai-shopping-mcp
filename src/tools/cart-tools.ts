import type { components } from "../services/kroger/cart.js";
import { cartClient } from "../services/kroger/client.js";

export interface AddToCartInput {
  items: Array<{
    upc: string;
    quantity: number;
    modality: "DELIVERY" | "PICKUP";
  }>;
}

export interface ToolResponse {
  content: Array<{
    type: "text";
    text: string;
  }>;
}

export async function addToCart(input: AddToCartInput): Promise<ToolResponse> {
  const { items } = input;

  // Convert items to the format expected by the Kroger API
  const cartItems: components["schemas"]["cart.cartItemModel"][] = items.map(
    (item: {
      upc: string;
      quantity: number;
      modality: "DELIVERY" | "PICKUP";
    }) => ({
      upc: item.upc,
      quantity: item.quantity,
      modality: item.modality,
    }),
  );

  const requestBody: components["schemas"]["cart.cartItemRequestModel"] = {
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
    throw new Error(`Failed to add items to cart: ${JSON.stringify(error)}`);
  }

  console.log("Items successfully added to cart");

  // Return a success response
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          message: `Successfully added ${items.length} item(s) to cart`,
          itemsAdded: items.length,
          success: true,
        }),
      },
    ],
  };
}
