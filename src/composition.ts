import {
  McpServer,
  type McpRequestContext,
} from "@modelcontextprotocol/server";
import { getMcpAuthContext } from "agents/mcp/server";

import type { AppEnv } from "./env.js";
import type { KrogerTokenInfo } from "./services/kroger/client.js";

import { registerPrompts } from "./prompts.js";
import { ProductService } from "./services/kroger/product-service.js";
import { createKrogerClients } from "./services/kroger/client.js";
import { createWeeklyDealsCache } from "./services/weekly-deals/cache.js";
import { createWeeklyDealsLoader } from "./services/weekly-deals/runtime.js";
import { registerCartTools } from "./tools/cart.js";
import { registerInventoryTools } from "./tools/inventory.js";
import { registerLocationTools } from "./tools/location.js";
import { registerOrderTools } from "./tools/orders.js";
import { registerProductTools } from "./tools/product.js";
import { registerRecipeTools } from "./tools/recipes.js";
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
    "Kroger grocery assistant with stores, pantry, equipment, orders, and lists. Use shop_for_items for one-shot shopping, or search_products then create_shopping_list and pass its listId to add_shopping_list_to_cart. Copy exact UPCs from search results into lists and orders; storeId selects the Kroger store. Edit lists with get_shopping_list, add_shopping_list_items, and edit_shopping_list_item. Use get_shopping_profile before personalized suggestions.",
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
): McpServer {
  const userId = getProps().id;
  const clientId = requestContext.authInfo?.clientId ?? userId;
  const server = new McpServer(SERVER_INFO, SERVER_OPTIONS);
  const userDataKv = getUserDataKv(env);

  const clients = createKrogerClients(
    (): KrogerTokenInfo | null => {
      const props = getMcpAuthContext()?.props;
      if (
        !props ||
        typeof props.accessToken !== "string" ||
        typeof props.tokenExpiresAt !== "number"
      ) {
        return null;
      }
      return {
        accessToken: props.accessToken,
        tokenExpiresAt: props.tokenExpiresAt,
      };
    },
    userDataKv,
    requestContext.requestInfo?.signal,
  );

  const shoppingStore = createD1ShoppingStore(env.SHOPPING_DB, userId);
  const { preferredLocation, pantry, equipment, orderHistory, shoppingList } =
    shoppingStore;

  const cartJournal = env.CART_OPERATIONS.getByName(userId);
  const carts = createCartPersistence(
    env.USER_DATA_KV,
    () => ({ userId, clientId }),
    {
      begin: (key, fingerprint) =>
        cartJournal.begin(JSON.stringify([clientId, key]), fingerprint),
      reconcileLegacy: (key, attempt, fingerprint, legacyFingerprint) =>
        cartJournal.reconcileLegacy(
          JSON.stringify([clientId, key]),
          attempt,
          fingerprint,
          legacyFingerprint,
        ),
      complete: (key, attempt) =>
        cartJournal.complete(JSON.stringify([clientId, key]), attempt),
      reject: (key, attempt) =>
        cartJournal.reject(JSON.stringify([clientId, key]), attempt),
    },
  );

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
    equipment,
    orderHistory,
    pantry,
    preferredLocation,
  });
  registerLocationTools(server, {
    locationClient: clients.locationClient,
    preferredLocation,
  });
  registerOrderTools(server, { orderHistory });
  registerProductTools(server, {
    productClient: clients.productClient,
    productService,
    preferredLocation,
  });
  registerRecipeTools(server, {
    pantry,
    equipment,
    orderHistory,
    loadWeeklyDeals,
  });
  registerResources(server, {
    productService,
    equipment,
    orderHistory,
    pantry,
    preferredLocation,
  });
  registerShopTools(server, {
    carts,
    productClient: clients.productClient,
    cartClient: clients.cartClient,
    weeklyDealsCache,
    pantry,
    preferredLocation,
    shoppingList,
    ai: env.AI,
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
