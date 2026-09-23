import type { ProductSearchFn } from "../qfc-weekly-deals.js";
import type { KrogerClients } from "../kroger/client.js";
import type { PreferredLocationStore } from "../../utils/shopping-store.js";
import type {
  WeeklyDealsLoader,
  WeeklyDealsServiceDependencies,
} from "./service.js";
import type { WeeklyDealsCache } from "./cache.js";

import { AppErrorException } from "../../errors.js";
import { getQfcWeeklyDeals } from "../qfc-weekly-deals.js";
import { loadWeeklyDeals } from "./service.js";
import { fromApiResponse, safeResolveLocationId } from "../../utils/result.js";

export type WeeklyDealsLoaderDependencies = {
  preferredLocation: PreferredLocationStore;
  productClient: KrogerClients["productClient"];
  weeklyDealsCache: WeeklyDealsCache;
};

/** Binds request-scoped MCP infrastructure to the weekly-deals service. */
export function createWeeklyDealsLoader(
  dependencies: WeeklyDealsLoaderDependencies,
): WeeklyDealsLoader {
  const serviceDependencies: WeeklyDealsServiceDependencies = {
    resolveLocationId: (storeId) =>
      safeResolveLocationId(dependencies.preferredLocation, storeId).map(
        ({ locationId }) => locationId,
      ),
    weeklyDealsCache: dependencies.weeklyDealsCache,
    fetchLive: async ({ locationId, limit, pageLimit, signal }) => {
      return getQfcWeeklyDeals({
        locationId,
        limit,
        pageLimit,
        ...(signal ? { signal } : {}),
        searchProducts: createProductSearch(dependencies.productClient, signal),
      });
    },
  };

  return (params) => loadWeeklyDeals(serviceDependencies, params);
}

function createProductSearch(
  productClient: KrogerClients["productClient"],
  signal?: AbortSignal,
): ProductSearchFn {
  return async (term, locationId, limit) => {
    const apiResult = await fromApiResponse(
      () =>
        productClient.GET("/v1/products", {
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
