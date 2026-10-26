import { exports } from "cloudflare:workers";
import { z } from "zod/v4";
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
import { getProps } from "./utils/result.js";
import { createCartPersistence } from "./utils/user-storage.js";
import { APP_VIEW_URI, registerViewResource } from "./utils/view-resource.js";

export const SERVER_INFO = {
  name: "grocery-shopping-assistant",
  version: "1.1.0",
} as const;

export const SERVER_OPTIONS = {
  instructions:
    "Kroger grocery assistant. Use the preferred store; if missing, ask for ZIP, search_stores then set_preferred_store. Use shop_for_items for options, search_products to refine, then selected UPCs and packages in create_shopping_list. Existing lists: get_shopping_list then update_shopping_list. Before meal planning, get_shopping_profile. Save chosen meals with create_meal_plan; resume with get_meal_plan. Use update_meal_plan for servings and reviewed ingredient decisions: confirm pantry units and explicit package counts. After approval, prepare_meal_plan saves one list. Only add_shopping_list_to_cart after separate approval; meal-plan lists retain reviewed store/modality. Other adds default PICKUP. Report unresolved items. update_inventory changes pantry; view_cart shows assistant add history; record_order logs completed purchases.",
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

      const parsed = z
        .object({
          accessToken: z.string(),
          tokenExpiresAt: z.union([z.number(), z.nan(), z.literal(Infinity), z.literal(-Infinity)]),
        })
        .safeParse(props);

      return parsed.success ? parsed.data : null;
    },
    userDataKv,
    requestContext.requestInfo?.signal,
    waitUntil,
  );

  const shoppingStore = createD1ShoppingStore(env.SHOPPING_DB, userId);

  const { preferredLocation, pantry, equipment, orderHistory, shoppingList } = shoppingStore;

  const cartJournal = exports.CartOperations.getByName(userId);

  const carts = createCartPersistence(env.USER_DATA_KV, () => ({ userId, clientId }), {
    begin: (key, fingerprint) => cartJournal.begin(JSON.stringify([clientId, key]), fingerprint),
    reconcileLegacy: (key, attempt, fingerprint, legacyFingerprint) =>
      cartJournal.reconcileLegacy(
        JSON.stringify([clientId, key]),
        attempt,
        fingerprint,
        legacyFingerprint,
      ),
    complete: (key, attempt) => cartJournal.complete(JSON.stringify([clientId, key]), attempt),
    reject: (key, attempt) => cartJournal.reject(JSON.stringify([clientId, key]), attempt),
  });

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
