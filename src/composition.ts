import {
  asFunction,
  asValue,
  createContainer,
  InjectionMode,
} from "awilix/browser";
import {
  McpServer,
  type McpRequestContext,
} from "@modelcontextprotocol/server";
import { getMcpAuthContext } from "agents/mcp/server";

import type { AppEnv } from "./env.js";
import type { CartOperationStore } from "./cart-operations.js";
import type {
  KrogerClients,
  KrogerTokenInfo,
} from "./services/kroger/client.js";
import type { Props } from "./tools/types.js";
import type { ShoppingStore } from "./utils/shopping-store.js";

import { ProductService } from "./services/kroger/product-service.js";
import { createKrogerClients } from "./services/kroger/client.js";
import { createWeeklyDealsCache } from "./services/weekly-deals/cache.js";
import { createWeeklyDealsLoader } from "./services/weekly-deals/runtime.js";
import { createCartTools } from "./tools/cart.js";
import { createInventoryTools } from "./tools/inventory.js";
import { createLocationTools } from "./tools/location.js";
import { createOrderTools } from "./tools/orders.js";
import { createProductTools } from "./tools/product.js";
import { createRecipeTools } from "./tools/recipes.js";
import { createResources } from "./tools/resources.js";
import { createShopTools } from "./tools/shop.js";
import { createShoppingListTools } from "./tools/shopping-list.js";
import { createWeeklyDealsTools } from "./tools/weekly-deals.js";
import { createD1ShoppingStore } from "./utils/d1-shopping-storage.js";
import { getUserDataKv } from "./utils/kv.js";
import { getProps } from "./utils/result.js";
import { createCartPersistence } from "./utils/user-storage.js";

export const SERVER_INFO = {
  name: "grocery-shopping-assistant",
  version: "1.1.0",
} as const;

export const SERVER_OPTIONS = {
  instructions:
    "Kroger grocery assistant with stores, pantry, equipment, orders, and lists. Use shop_for_items for one-shot shopping, or search_products then create_shopping_list and pass its listId to add_shopping_list_to_cart. Copy exact UPCs from search results into lists and orders; storeId selects the Kroger store. Edit lists with get_shopping_list, add_shopping_list_items, and edit_shopping_list_item. Use get_shopping_profile before personalized suggestions.",
} as const;

/**
 * Creates the request-scoped dependency graph for one MCP request.
 *
 * Every mutable or authenticated value is scoped to this container. The
 * graph is explicit: no filesystem discovery or automatic module loading is
 * used, so adding a module cannot silently broaden the request surface.
 */
export function createRequestContainer(
  env: AppEnv,
  requestContext: McpRequestContext,
) {
  return createContainer({
    injectionMode: InjectionMode.PROXY,
    strict: true,
  }).register({
    env: asValue(env),
    requestContext: asValue(requestContext),
    server: asFunction(
      () => new McpServer(SERVER_INFO, SERVER_OPTIONS),
    ).scoped(),

    // Auth is resolved only when a request-scoped user dependency needs it.
    authProps: asFunction(() => getProps()).scoped(),
    userId: asFunction(
      ({ authProps }: { authProps: Props }) => authProps.id,
    ).scoped(),
    clientId: asFunction(
      ({
        requestContext: ctx,
        userId,
      }: {
        requestContext: McpRequestContext;
        userId: string;
      }) => ctx.authInfo?.clientId ?? userId,
    ).scoped(),

    // The nullable shared binding is kept inside infrastructure adapters.
    userDataKv: asFunction(({ env: workerEnv }: { env: AppEnv }) =>
      getUserDataKv(workerEnv),
    ).scoped(),
    cartPersistenceKv: asFunction(
      ({ env: workerEnv }: { env: AppEnv }) => workerEnv.USER_DATA_KV,
    ).scoped(),
    getTokenInfo: asFunction((): (() => KrogerTokenInfo | null) => () => {
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
    }).scoped(),

    krogerClients: asFunction(
      ({
        getTokenInfo,
        requestContext: ctx,
        userDataKv,
      }: {
        getTokenInfo: () => KrogerTokenInfo | null;
        requestContext: McpRequestContext;
        userDataKv: ReturnType<typeof getUserDataKv>;
      }) =>
        createKrogerClients(getTokenInfo, userDataKv, ctx.requestInfo?.signal),
    ).scoped(),
    productClient: asFunction(
      ({ krogerClients }: { krogerClients: KrogerClients }) =>
        krogerClients.productClient,
    ).scoped(),
    locationClient: asFunction(
      ({ krogerClients }: { krogerClients: KrogerClients }) =>
        krogerClients.locationClient,
    ).scoped(),
    cartClient: asFunction(
      ({ krogerClients }: { krogerClients: KrogerClients }) =>
        krogerClients.cartClient,
    ).scoped(),

    shoppingStore: asFunction(
      ({ env: workerEnv, userId }: { env: AppEnv; userId: string }) =>
        createD1ShoppingStore(workerEnv.SHOPPING_DB, userId),
    ).scoped(),
    preferredLocation: asFunction(
      ({ shoppingStore }: { shoppingStore: ShoppingStore }) =>
        shoppingStore.preferredLocation,
    ).scoped(),
    pantry: asFunction(
      ({ shoppingStore }: { shoppingStore: ShoppingStore }) =>
        shoppingStore.pantry,
    ).scoped(),
    equipment: asFunction(
      ({ shoppingStore }: { shoppingStore: ShoppingStore }) =>
        shoppingStore.equipment,
    ).scoped(),
    shoppingList: asFunction(
      ({ shoppingStore }: { shoppingStore: ShoppingStore }) =>
        shoppingStore.shoppingList,
    ).scoped(),
    orderHistory: asFunction(
      ({ shoppingStore }: { shoppingStore: ShoppingStore }) =>
        shoppingStore.orderHistory,
    ).scoped(),

    cartJournal: asFunction(
      ({ env: workerEnv, userId }: { env: AppEnv; userId: string }) =>
        workerEnv.CART_OPERATIONS.getByName(userId),
    ).scoped(),
    carts: asFunction(
      ({
        cartJournal,
        cartPersistenceKv,
        clientId,
        userId,
      }: {
        cartJournal: CartOperationStore;
        cartPersistenceKv: AppEnv["USER_DATA_KV"];
        clientId: string;
        userId: string;
      }) =>
        createCartPersistence(cartPersistenceKv, () => ({ userId, clientId }), {
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
        }),
    ).scoped(),

    productService: asFunction(
      ({ productClient }: { productClient: KrogerClients["productClient"] }) =>
        new ProductService(productClient),
    ).scoped(),
    weeklyDealsCache: asFunction(
      ({ userDataKv }: { userDataKv: ReturnType<typeof getUserDataKv> }) =>
        createWeeklyDealsCache(userDataKv),
    ).scoped(),
    loadWeeklyDeals: asFunction(createWeeklyDealsLoader).scoped(),
    ai: asFunction(
      ({ env: workerEnv }: { env: AppEnv }) => workerEnv.AI,
    ).scoped(),

    cartTools: asFunction(createCartTools).scoped(),
    inventoryTools: asFunction(createInventoryTools).scoped(),
    locationTools: asFunction(createLocationTools).scoped(),
    orderTools: asFunction(createOrderTools).scoped(),
    productTools: asFunction(createProductTools).scoped(),
    recipeTools: asFunction(createRecipeTools).scoped(),
    resources: asFunction(createResources).scoped(),
    shopTools: asFunction(createShopTools).scoped(),
    shoppingListTools: asFunction(createShoppingListTools).scoped(),
    weeklyDealsTools: asFunction(createWeeklyDealsTools).scoped(),
  });
}

/** Register every feature factory against one request-scoped MCP server. */
export type RequestContainer = ReturnType<typeof createRequestContainer>;

export function registerRequestFeatures(
  container: RequestContainer,
): McpServer {
  const server = container.resolve("server");
  container.resolve("cartTools")(server);
  container.resolve("inventoryTools")(server);
  container.resolve("locationTools")(server);
  container.resolve("orderTools")(server);
  container.resolve("productTools")(server);
  container.resolve("recipeTools")(server);
  container.resolve("resources")(server);
  container.resolve("shopTools")(server);
  container.resolve("shoppingListTools")(server);
  container.resolve("weeklyDealsTools")(server);
  return server;
}
