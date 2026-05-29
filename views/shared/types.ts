import type { App } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type * as z from "zod/v4";

export type {
  AddToCartArgs,
  ManagePantryArgs,
  ManageShoppingListArgs,
} from "../../src/tools/tool-types.js";

import type {
  getLocationDetailsOutputSchema,
  getProductDetailsOutputSchema,
  getWeeklyDealsOutputSchema,
  managePantryOutputSchema,
  manageShoppingListOutputSchema,
  searchLocationsOutputSchema,
  searchProductsOutputSchema,
  searchRecipesOutputSchema,
} from "../../src/tools/output-schemas.js";
import type {
  AddToCartArgs,
  ManagePantryArgs,
  ManageShoppingListArgs,
} from "../../src/tools/tool-types.js";

/** Discriminated union of all callable tools — enables type-safe callTool(). */
export type ToolCall =
  | { name: "add_to_cart"; arguments: AddToCartArgs }
  | { name: "manage_shopping_list"; arguments: ManageShoppingListArgs }
  | { name: "manage_pantry"; arguments: ManagePantryArgs }
  | { name: "set_preferred_location"; arguments: { locationId: string } }
  | { name: "get_location_details"; arguments: { locationId: string } }
  | { name: "search_products"; arguments: { terms: string[] } };

/** Timeout for app-initiated callServerTool() calls (ms).
 *  Without this, calls hang indefinitely when the host doesn't respond. */
export const TOOL_CALL_TIMEOUT_MS = 15_000;

/**
 * Type-safe wrapper around app.callServerTool() with a timeout.
 * Returns the Promise so callers can await results and handle errors.
 */
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

/**
 * View content types.
 *
 * These are inferred directly from the server's Zod output schemas
 * (`src/tools/output-schemas.ts`) — the single source of truth for the
 * `structuredContent` contract. Inferring them here keeps the client in
 * lockstep with the server: any schema change flows through automatically,
 * so the two halves can't drift. The imports above are `import type` only,
 * so no Zod runtime is pulled into the views bundle.
 */
export type WeeklyDealsContent = z.infer<typeof getWeeklyDealsOutputSchema>;
export type LocationResultsContent = z.infer<typeof searchLocationsOutputSchema>;
export type LocationDetailContent = z.infer<typeof getLocationDetailsOutputSchema>;
export type ProductSearchResultsContent = z.infer<typeof searchProductsOutputSchema>;
export type ProductDetailContent = z.infer<typeof getProductDetailsOutputSchema>;
export type PantryListContent = z.infer<typeof managePantryOutputSchema>;
export type ShoppingListContent = z.infer<typeof manageShoppingListOutputSchema>;
export type RecipeResultsContent = z.infer<typeof searchRecipesOutputSchema>;

/** Element/sub-shapes, indexed out of the inferred content types above. */
export type DealData = WeeklyDealsContent["deals"][number];
export type LocationData = LocationDetailContent["location"];
export type ProductData = ProductDetailContent["product"];
export type PantryItemData = PantryListContent["items"][number];
export type ShoppingListItemData = ShoppingListContent["items"][number];
export type RecipeData = RecipeResultsContent["recipes"][number];

/**
 * Discriminated union of all possible tool `structuredContent` shapes.
 * Each member already carries its `_view` literal from the schema, so this
 * narrows cleanly on `data._view`.
 */
export type AppData =
  | ProductSearchResultsContent
  | ProductDetailContent
  | LocationResultsContent
  | LocationDetailContent
  | ShoppingListContent
  | PantryListContent
  | RecipeResultsContent
  | WeeklyDealsContent;

/**
 * Exhaustive map of the `_view` discriminators we know how to render. Typing it
 * as `Record<AppData["_view"], true>` makes it a compile error to add a view to
 * `AppData` (i.e. a new tool output schema) without registering it here — so the
 * runtime `KNOWN_VIEWS` set below can't silently drift from the type.
 */
const VIEW_NAMES: Record<AppData["_view"], true> = {
  search_products: true,
  get_product_details: true,
  search_locations: true,
  get_location_details: true,
  manage_shopping_list: true,
  manage_pantry: true,
  search_recipes_from_web: true,
  get_weekly_deals: true,
};

/** The set of `_view` discriminators we know how to render. */
const KNOWN_VIEWS = new Set(Object.keys(VIEW_NAMES) as AppData["_view"][]);

/**
 * Parse unknown structuredContent into a typed AppData value.
 * Returns null if the value is missing or carries an unrecognized `_view`,
 * so an unknown payload surfaces as "loading" rather than a blank render.
 */
export function parseStructuredContent(raw: unknown): AppData | null {
  if (!raw || typeof raw !== "object") return null;
  const view = (raw as { _view?: unknown })._view;
  if (typeof view !== "string" || !KNOWN_VIEWS.has(view as AppData["_view"])) return null;
  return raw as AppData;
}
