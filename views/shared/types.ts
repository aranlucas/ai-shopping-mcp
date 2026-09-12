import type { App } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/client";

export type {
  AddShoppingListToCartContent,
  AppData,
  AppViewName,
  DealData,
  KitchenEquipmentContent,
  KitchenEquipmentItemData,
  LocationData,
  OrderHistoryContent,
  PantryItemData,
  PantryListContent,
  PreferredStoreContent,
  ProductData,
  ProductDetailContent,
  ProductSearchResultsContent,
  ShoppingListContent,
  ShoppingListItemData,
  StoreDetailContent,
  StoreResultsContent,
  WeeklyDealsContent,
} from "../../src/app-results.js";
export { parseAppResult as parseToolResult } from "../../src/app-results.js";

import type {
  AddShoppingListToCartArgs,
  AddToInventoryArgs,
  CreateShoppingListArgs,
  RemoveFromInventoryArgs,
} from "../../src/tools/tool-types.js";

export type { AddShoppingListToCartArgs };

/** Discriminated union of callable tools used by the app UI. */
export type ToolCall =
  | { name: "add_shopping_list_to_cart"; arguments: AddShoppingListToCartArgs }
  | { name: "create_shopping_list"; arguments: CreateShoppingListArgs }
  | { name: "add_to_inventory"; arguments: AddToInventoryArgs }
  | { name: "remove_from_inventory"; arguments: RemoveFromInventoryArgs }
  | { name: "set_preferred_store"; arguments: { storeId: string } }
  | { name: "get_store"; arguments: { storeId: string } }
  | {
      name: "search_products";
      arguments: { terms: string[]; storeId?: string; includeLocation?: boolean };
    };

export function callTool(app: App | null | undefined, call: ToolCall): Promise<CallToolResult> {
  if (!app)
    return Promise.reject(new Error("The shopping app is disconnected. Reopen it and try again."));
  return app.callServerTool(call);
}

/** Open an external URL via the host. No-ops if the host doesn't support openLink. */
export async function openExternalLink(app: App | null | undefined, url: string): Promise<void> {
  if (!app?.getHostCapabilities()?.openLinks) return;
  await app.openLink({ url });
}

/** Send a user-requested message; callers own visible pending and failure states. */
export async function sendUserMessage(app: App | null | undefined, text: string): Promise<void> {
  if (!app) throw new Error("The shopping app is disconnected. Reopen it and try again.");
  const result = await app.sendMessage({
    role: "user",
    content: [{ type: "text", text }],
  });
  if (result.isError) throw new Error("The assistant could not receive your request. Try again.");
}
