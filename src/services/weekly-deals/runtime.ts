import type { paths as ProductPaths } from "../kroger/product.js";
import type { FetchOptions } from "openapi-fetch";

type ProductSearchOptions = FetchOptions<ProductPaths["/v1/products"]["get"]>;

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
  fetchDeals?: typeof getQfcWeeklyDeals;
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
      const options: Parameters<typeof getQfcWeeklyDeals>[0] = {
        locationId,
        limit,
        pageLimit,
        searchProducts: createProductSearch(dependencies.productClient, signal),
      };

      if (signal) options.signal = signal;

      return (dependencies.fetchDeals ?? getQfcWeeklyDeals)(options);
    },
  };

  return (params) => loadWeeklyDeals(serviceDependencies, params);
}

function createProductSearch(
  productClient: KrogerClients["productClient"],
  signal?: AbortSignal,
): ProductSearchFn {
  return async (term, locationId, limit) => {
    const options: ProductSearchOptions = {
      params: {
        query: {
          "filter.term": term,
          "filter.locationId": locationId,
          "filter.limit": limit,
        },
      },
    };

    if (signal) options.signal = signal;

    const apiResult = await fromApiResponse(
      () => productClient.GET("/v1/products", options),
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
