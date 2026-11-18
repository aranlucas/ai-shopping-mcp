import { exports } from "cloudflare:workers";
import { McpServer, type McpRequestContext } from "@modelcontextprotocol/server";
import { getMcpAuthContext } from "agents/mcp/server";

import type { AppEnv } from "./env.js";
import type { KrogerTokenInfo, WaitUntil } from "./services/kroger/client.js";

import { registerPrompts } from "./prompts.js";
import { ProductService } from "./services/kroger/product-service.js";
import { createKrogerClients } from "./services/kroger/client.js";
import { createWeeklyDealsCache } from "./services/weekly-deals/cache.js";
import { createWeeklyDealsLoader } from "./services/weekly-deals/runtime.js";
import { registerCartTools } from "./tools/cart.js";
import { registerInventoryTools } from "./tools/inventory.js";
import { registerLocationTools } from "./tools/location.js";
import { registerMealPlanTools } from "./tools/meal-plan.js";
import { createD1MealPlanStore } from "./utils/d1-meal-plan-storage.js";
import { registerOrderTools } from "./tools/orders.js";
import { registerProductTools } from "./tools/product.js";
import { registerResources } from "./tools/resources.js";
import { registerShopTools } from "./tools/shop.js";
import { registerShoppingListTools } from "./tools/shopping-list.js";
import { registerWeeklyDealsTools } from "./tools/weekly-deals.js";
import { createD1ShoppingStore } from "./utils/d1-shopping-storage.js";
import { getUserDataKv } from "./utils/kv.js";
import { getProps, requestTokenSchema } from "./utils/request-identity.js";
import { createCartStore } from "./utils/cart-store.js";
import { APP_VIEW_URI, registerViewResource } from "./utils/view-resource.js";

export const SERVER_INFO = {
  name: "grocery-shopping-assistant",
  version: "1.1.0",
} as const;

export const SERVER_OPTIONS = {
  instructions:
    "Use the preferred store. If unset, ask for a ZIP code, then use search_stores and set_preferred_store. Find options with shop_for_items and refine with search_products. Save selected UPCs and package counts. Report unmatched items. Delete lists only on request. Before meal planning, read get_shopping_profile. Confirm pantry units and purchase quantities. Get approval to prepare_meal_plan and separate approval for add_shopping_list_to_cart. Keep the reviewed store and modality.",
} as const;

/**
 * Builds a fresh request-scoped MCP server with all features registered.
 *
 * Authenticated and mutable dependencies are created for this request only.
 * Token lookup stays lazy so the Kroger middleware observes the auth context
 * that is active when a request is made, while the user and client identities
 * used for persistence remain fixed for the request's server.
 */
export function buildServer(
  env: AppEnv,
  requestContext: McpRequestContext,
  waitUntil?: WaitUntil,
): McpServer {
  const userId = getProps().id;
  const clientId = requestContext.authInfo?.clientId ?? userId;
  const server = new McpServer(SERVER_INFO, SERVER_OPTIONS);
  const userDataKv = getUserDataKv(env);

  const clients = createKrogerClients(
    (): KrogerTokenInfo | null => {
      const props = getMcpAuthContext()?.props;

      const parsed = requestTokenSchema.safeParse(props);

      return parsed.success ? parsed.data : null;
    },
    userDataKv,
    requestContext.requestInfo?.signal,
    waitUntil,
  );

  const shoppingStore = createD1ShoppingStore(env.SHOPPING_DB, userId);

  const { preferredLocation, pantry, equipment, orderHistory, shoppingList } = shoppingStore;

  const carts = createCartStore(exports.CartOperations.getByName(userId), clientId);

  const productService = new ProductService(clients.productClient);
  const weeklyDealsCache = createWeeklyDealsCache(userDataKv);

  const loadWeeklyDeals = createWeeklyDealsLoader({
    preferredLocation,
    productClient: clients.productClient,
    weeklyDealsCache,
  });

  registerCartTools(server, {
    carts,
    cartClient: clients.cartClient,
    preferredLocation,
    shoppingList,
  });
  registerInventoryTools(server, {
    updateInventory: shoppingStore.updateInventory,
    loadWeeklyDeals,
    equipment,
    orderHistory,
    pantry,
    preferredLocation,
  });
  registerLocationTools(server, {
    locationClient: clients.locationClient,
    preferredLocation,
  });
  registerMealPlanTools(server, createD1MealPlanStore(env.SHOPPING_DB, userId));
  registerOrderTools(server, { orderHistory, preferredLocation });
  registerProductTools(server, {
    productService,
    preferredLocation,
  });
  registerResources(server, {
    productService,
    equipment,
    orderHistory,
    pantry,
    preferredLocation,
  });
  registerShopTools(server, {
    productClient: clients.productClient,
    weeklyDealsCache,
    pantry,
    preferredLocation,
  });
  registerShoppingListTools(server, {
    weeklyDealsCache,
    pantry,
    preferredLocation,
    productService,
    shoppingList,
  });
  registerWeeklyDealsTools(server, { loadWeeklyDeals });

  registerPrompts(server);
  registerViewResource(server, () => env, APP_VIEW_URI, "mcp-app.html");

  return server;
}
