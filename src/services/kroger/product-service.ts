import { type ResultAsync, err, ok } from "neverthrow";

import type { AppError } from "../../errors.js";
import type { KrogerClients } from "./client.js";
import type { components as ProductComponents } from "./product.js";

import { notFoundError } from "../../errors.js";
import { fromApiResponse } from "../../utils/result.js";

type Product = ProductComponents["schemas"]["products.productModel"];

/**
 * Thin wrapper around `productClient.GET("/v1/products/{id}")`. No caching
 * logic of its own — `productClient` is already KV-cached at the client
 * layer (see `createKrogerCacheMiddleware` in `client.ts`).
 */
export class ProductService {
  constructor(private productClient: KrogerClients["productClient"]) {}

  getProduct(upc: string, locationId?: string): ResultAsync<Product, AppError> {
    const queryParams: Record<string, string> = {};
    if (locationId) {
      queryParams["filter.locationId"] = locationId;
    }

    return fromApiResponse(
      this.productClient.GET("/v1/products/{id}", {
        params: { path: { id: upc }, query: queryParams },
      }),
      "get product details",
    ).andThen((data) => {
      const product = data.data;
      if (!product) {
        return err(notFoundError(`No information found for UPC: ${upc}`));
      }
      return ok(product);
    });
  }

  async enrichProductName(upc: string, locationId?: string): Promise<string | null> {
    return this.getProduct(upc, locationId).match(
      (product) => product.description ?? null,
      () => null,
    );
  }
}
