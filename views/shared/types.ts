import type { App } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export type {
  AddShoppingListToCartContent,
  AppData,
  AppViewName,
  DealData,
  KitchenEquipmentContent,
  KitchenEquipmentItemData,
  LocationData,
  OrderHistoryContent,
  OrderItemData,
  PantryItemData,
  PantryListContent,
  PreferredStoreContent,
  PreferredStoreData,
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

export type {
  AddShoppingListToCartArgs,
  AddToInventoryArgs,
  CreateShoppingListArgs,
  RemoveFromInventoryArgs,
};

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
      arguments: { terms: string[]; storeId?: string; include_location?: boolean };
    };

/** Timeout for app-initiated callServerTool() calls (ms). */
export const TOOL_CALL_TIMEOUT_MS = 15_000;

export function callTool(
  app: App | null | undefined,
  call: ToolCall,
): Promise<CallToolResult> | undefined {
  return app?.callServerTool(call as Parameters<App["callServerTool"]>[0], {
    timeout: TOOL_CALL_TIMEOUT_MS,
  });
}

/** Open an external URL via the host. No-ops if the host doesn't support openLink. */
export async function openExternalLink(app: App | null | undefined, url: string): Promise<void> {
  if (!app?.getHostCapabilities()?.openLinks) return;
  await app.openLink({ url });
}

/** Send a short message to the host on behalf of the user. Best-effort. */
export function sendUserMessage(app: App | null | undefined, text: string): void {
  app?.sendMessage({
    role: "user",
    content: [{ type: "text", text }],
  });
}
