import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { fromApiResponse, safeStorage } from "../utils/result.js";
import { getSessionScopedUserId, type ToolContext } from "./types.js";

function jsonResource(uri: string, data: unknown) {
  return {
    contents: [{ type: "text" as const, uri, text: JSON.stringify(data, null, 2) }],
  };
}

function unauthenticatedResource(uri: string) {
  return jsonResource(uri, { error: "User not authenticated" });
}

export function registerResources(ctx: ToolContext) {
  const { productClient } = ctx.clients;

  ctx.server.registerResource(
    "Pantry Inventory",
    "shopping://user/pantry",
    {
      description:
        "Items currently in the user's pantry. Use this to avoid suggesting duplicate purchases and to help with meal planning based on available ingredients.",
      mimeType: "application/json",
    },
    async () => {
      const props = ctx.getUser();
      if (!props?.id) return unauthenticatedResource("shopping://user/pantry");

      const result = await safeStorage(() => ctx.storage.pantry.getAll(props.id), "fetch pantry");

      return result.match(
        (pantry) =>
          jsonResource("shopping://user/pantry", {
            itemCount: pantry.length,
            items: pantry,
            lastUpdated: new Date().toISOString(),
          }),
        () =>
          jsonResource("shopping://user/pantry", {
            error: "Failed to fetch pantry data",
          }),
      );
    },
  );

  ctx.server.registerResource(
    "Equipment Inventory",
    "shopping://user/equipment",
    {
      description:
        "Kitchen equipment and tools the user owns. Use this to suggest recipes that match available equipment and to help with meal planning based on what tools are available.",
      mimeType: "application/json",
    },
    async () => {
      const props = ctx.getUser();
      if (!props?.id) return unauthenticatedResource("shopping://user/equipment");

      const result = await safeStorage(
        () => ctx.storage.equipment.getAll(props.id),
        "fetch equipment",
      );

      return result.match(
        (equipment) =>
          jsonResource("shopping://user/equipment", {
            itemCount: equipment.length,
            items: equipment,
            lastUpdated: new Date().toISOString(),
          }),
        () =>
          jsonResource("shopping://user/equipment", {
            error: "Failed to fetch equipment data",
          }),
      );
    },
  );

  ctx.server.registerResource(
    "Preferred Store Location",
    "shopping://user/location",
    {
      description:
        "The user's preferred shopping location. Use this for product searches and availability checks when no location is explicitly specified. IMPORTANT: If no location is set, proactively ask the user for their zip code and help them find and set their preferred store using search_locations and set_preferred_location tools.",
      mimeType: "application/json",
    },
    async () => {
      const props = ctx.getUser();
      if (!props?.id) return unauthenticatedResource("shopping://user/location");

      const result = await safeStorage(
        () => ctx.storage.preferredLocation.get(props.id),
        "fetch preferred location",
      );

      return result.match(
        (location) => {
          if (!location) {
            return jsonResource("shopping://user/location", {
              message: "No preferred location set",
              instruction:
                "Ask the user for their zip code, then use search_locations to find nearby stores and set_preferred_location to save their choice.",
            });
          }
          return jsonResource("shopping://user/location", location);
        },
        () =>
          jsonResource("shopping://user/location", {
            error: "Failed to fetch location data",
          }),
      );
    },
  );

  ctx.server.registerResource(
    "Order History",
    "shopping://user/orders",
    {
      description:
        "The user's past orders and purchase history. Use this to identify frequently purchased items, shopping patterns, and to make personalized recommendations.",
      mimeType: "application/json",
    },
    async () => {
      const props = ctx.getUser();
      if (!props?.id) return unauthenticatedResource("shopping://user/orders");

      const result = await safeStorage(
        () => ctx.storage.orderHistory.getRecent(props.id, 20),
        "fetch order history",
      );

      return result.match(
        (orders) =>
          jsonResource("shopping://user/orders", {
            orderCount: orders.length,
            orders,
            lastUpdated: new Date().toISOString(),
          }),
        () =>
          jsonResource("shopping://user/orders", {
            error: "Failed to fetch order data",
          }),
      );
    },
  );

  ctx.server.registerResource(
    "Shopping List",
    "shopping://user/shopping-list",
    {
      description:
        "The user's current shopping list of items they plan to buy. Items may have UPCs (ready for cart checkout) or just names (need product search). Use this to help users plan purchases, find products for items without UPCs, and coordinate checkout.",
      mimeType: "application/json",
    },
    async () => {
      const props = ctx.getUser();
      if (!props?.id) return unauthenticatedResource("shopping://user/shopping-list");

      const scopedId = getSessionScopedUserId(props.id, ctx.getSessionId());
      const result = await safeStorage(
        () => ctx.storage.shoppingList.getAll(scopedId),
        "fetch shopping list",
      );

      return result.match(
        (list) => {
          const unchecked = list.filter((i) => !i.checked);
          const withUpc = unchecked.filter((i) => i.upc);
          const withoutUpc = unchecked.filter((i) => !i.upc);

          return jsonResource("shopping://user/shopping-list", {
            totalItems: list.length,
            uncheckedCount: unchecked.length,
            readyForCheckout: withUpc.length,
            needsUpc: withoutUpc.length,
            items: list,
            lastUpdated: new Date().toISOString(),
          });
        },
        () =>
          jsonResource("shopping://user/shopping-list", {
            error: "Failed to fetch shopping list data",
          }),
      );
    },
  );

  ctx.server.registerResource(
    "Product Details",
    new ResourceTemplate("shopping://product/{productId}", {
      list: undefined,
    }),
    {
      description:
        "Detailed information about a specific product by its ID (13-digit UPC). Includes pricing, availability, and location information.",
      mimeType: "application/json",
    },
    async (uri: URL) => {
      const match = uri.href.match(/shopping:\/\/product\/([0-9]{13})/);
      if (!match) {
        return jsonResource(uri.href, {
          error: "Invalid product URI format. Expected: shopping://product/{13-digit-upc}",
        });
      }

      const productId = match[1];

      const props = ctx.getUser();
      const locationId = props?.id
        ? (
            await safeStorage(
              () => ctx.storage.preferredLocation.get(props.id),
              "fetch preferred location",
            )
          )
            .map((loc) => loc?.locationId)
            .unwrapOr(undefined)
        : undefined;

      const queryParams: Record<string, string> = {};
      if (locationId) {
        queryParams["filter.locationId"] = locationId;
      }

      const result = await fromApiResponse(
        productClient.GET("/v1/products/{id}", {
          params: {
            path: { id: productId },
            query: queryParams,
          },
        }),
        "fetch product details",
      );

      return result.match(
        (data) => {
          const product = data.data;
          if (!product) {
            return jsonResource(uri.href, {
              error: `No product found with ID: ${productId}`,
            });
          }
          return jsonResource(uri.href, product);
        },
        (error) =>
          jsonResource(uri.href, {
            error: `Failed to fetch product: ${error.message}`,
          }),
      );
    },
  );
}
