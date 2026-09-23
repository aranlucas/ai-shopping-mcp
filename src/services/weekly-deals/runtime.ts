import type { ProductSearchFn } from "../qfc-weekly-deals.js";
import type { KrogerClients } from "../kroger/client.js";
import type { ShoppingStore } from "../../utils/shopping-store.js";
import type { WeeklyDealsServiceDependencies } from "./service.js";

import { AppErrorException } from "../../errors.js";
import { getQfcWeeklyDeals } from "../qfc-weekly-deals.js";
import { getUserDataKv } from "../../utils/kv.js";
import { fromApiResponse, safeResolveLocationId } from "../../utils/result.js";

type WeeklyDealsToolDependencies = {
  storage: ShoppingStore;
  clients: Pick<KrogerClients, "productClient">;
  getEnv: () => Env;
};

/** Bridge MCP infrastructure to the tool-independent weekly-deals service. */
export function createWeeklyDealsDependencies(
  ctx: WeeklyDealsToolDependencies,
): WeeklyDealsServiceDependencies {
  return {
    resolveLocationId: (storeId) =>
      safeResolveLocationId(ctx.storage, storeId).map(
        ({ locationId }) => locationId,
      ),
    getCache: () => getUserDataKv(ctx.getEnv()),
    fetchLive: async ({ locationId, limit, pageLimit, signal }) => {
      return getQfcWeeklyDeals({
        locationId,
        limit,
        pageLimit,
        ...(signal ? { signal } : {}),
        searchProducts: createProductSearch(ctx, signal),
      });
    },
  };
}

function createProductSearch(
  ctx: WeeklyDealsToolDependencies,
  signal?: AbortSignal,
): ProductSearchFn {
  return async (term, locationId, limit) => {
    const apiResult = await fromApiResponse(
      () =>
        ctx.clients.productClient.GET("/v1/products", {
          ...(signal ? { signal } : {}),
          params: {
            query: {
              "filter.term": term,
              "filter.locationId": locationId,
              "filter.limit": limit,
            },
          },
        }),
      `search weekly deals for "${term}"`,
    );
    return apiResult.match(
      (value) => value.data ?? [],
      (error) => {
        throw new AppErrorException(error);
      },
    );
  };
}
