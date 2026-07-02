import { describe, expect, it, vi } from "vitest";

import type { KrogerClients } from "../../../src/services/kroger/client.js";
import type { components as ProductComponents } from "../../../src/services/kroger/product.js";

import { ProductService } from "../../../src/services/kroger/product-service.js";

type Product = ProductComponents["schemas"]["products.productModel"];

function stubProductClient(
  get: (...args: unknown[]) => Promise<{ data?: unknown; error?: unknown; response: Response }>,
): KrogerClients["productClient"] {
  return { GET: get } as unknown as KrogerClients["productClient"];
}

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    upc: "0001111041700",
    description: "Kroger 2% Reduced Fat Milk",
    brand: "Kroger",
    ...overrides,
  };
}

describe("ProductService.getProduct", () => {
  it("returns Ok with the product on a successful lookup", async () => {
    const product = makeProduct();
    const get = vi.fn(async () => ({
      data: { data: product },
      response: new Response(null, { status: 200 }),
    }));
    const service = new ProductService(stubProductClient(get));

    const result = await service.getProduct("0001111041700");

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual(product);
  });

  it("passes locationId as filter.locationId when provided", async () => {
    let capturedQuery: Record<string, string> | undefined;
    const get = vi.fn(async (_path: unknown, opts: unknown) => {
      capturedQuery = (opts as { params: { query: Record<string, string> } }).params.query;
      return {
        data: { data: makeProduct() },
        response: new Response(null, { status: 200 }),
      };
    });
    const service = new ProductService(stubProductClient(get));

    await service.getProduct("0001111041700", "70500847");

    expect(capturedQuery?.["filter.locationId"]).toBe("70500847");
  });

  it("returns Err NOT_FOUND when the API returns no product data", async () => {
    const get = vi.fn(async () => ({
      data: { data: undefined },
      response: new Response(null, { status: 200 }),
    }));
    const service = new ProductService(stubProductClient(get));

    const result = await service.getProduct("0009999999999");

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("NOT_FOUND");
    expect(result._unsafeUnwrapErr().message).toContain("0009999999999");
  });

  it("returns Err API_ERROR when the API call fails", async () => {
    const get = vi.fn(async () => ({
      error: { reason: "Internal Server Error" },
      response: new Response(null, { status: 500 }),
    }));
    const service = new ProductService(stubProductClient(get));

    const result = await service.getProduct("0001111041700");

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("API_ERROR");
  });
});

describe("ProductService.enrichProductName", () => {
  it("returns the product description on success", async () => {
    const get = vi.fn(async () => ({
      data: { data: makeProduct({ description: "Whole Milk" }) },
      response: new Response(null, { status: 200 }),
    }));
    const service = new ProductService(stubProductClient(get));

    expect(await service.enrichProductName("0001111041700")).toBe("Whole Milk");
  });

  it("returns null when the product has no description", async () => {
    const get = vi.fn(async () => ({
      data: { data: makeProduct({ description: undefined }) },
      response: new Response(null, { status: 200 }),
    }));
    const service = new ProductService(stubProductClient(get));

    expect(await service.enrichProductName("0001111041700")).toBeNull();
  });

  it("returns null (never throws) when the lookup fails", async () => {
    const get = vi.fn(async () => ({
      error: { reason: "boom" },
      response: new Response(null, { status: 500 }),
    }));
    const service = new ProductService(stubProductClient(get));

    await expect(service.enrichProductName("0001111041700")).resolves.toBeNull();
  });

  it("returns null when the product is not found", async () => {
    const get = vi.fn(async () => ({
      data: { data: undefined },
      response: new Response(null, { status: 200 }),
    }));
    const service = new ProductService(stubProductClient(get));

    expect(await service.enrichProductName("0009999999999")).toBeNull();
  });
});
