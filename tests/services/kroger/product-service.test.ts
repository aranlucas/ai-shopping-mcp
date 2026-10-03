import {
  productClientWith,
  type ProductRequest,
} from "../../kroger-clients.js";
import { describe, expect, it, vi } from "vitest";

import type { KrogerClients } from "../../../src/services/kroger/client.js";
import type { components as ProductComponents } from "../../../src/services/kroger/product.js";

import { ProductService } from "../../../src/services/kroger/product-service.js";

type Product = ProductComponents["schemas"]["products.productModel"];

function stubProductClient(
  get: ProductRequest,
): KrogerClients["productClient"] {
  return productClientWith(get);
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

    const get = vi.fn<ProductRequest>(async () => ({
      data: { data: product },
      response: new Response(null, { status: 200 }),
    }));

    const service = new ProductService(stubProductClient(get));

    const result = await service.getProduct("0001111041700");

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual(product);
  });

  it("passes locationId as filter.locationId when provided", async () => {
    let capturedQuery: Record<string, string | number> | undefined;

    const get = vi.fn<ProductRequest>(async (_path, opts) => {
      capturedQuery = opts.params.query;

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
    const get = vi.fn<ProductRequest>(async () => ({
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
    const get = vi.fn<ProductRequest>(async () => ({
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
    const get = vi.fn<ProductRequest>(async () => ({
      data: { data: makeProduct({ description: "Whole Milk" }) },
      response: new Response(null, { status: 200 }),
    }));

    const service = new ProductService(stubProductClient(get));

    expect(await service.enrichProductName("0001111041700")).toBe("Whole Milk");
  });

  it("returns null when the product has no description", async () => {
    const get = vi.fn<ProductRequest>(async () => ({
      data: { data: makeProduct({ description: undefined }) },
      response: new Response(null, { status: 200 }),
    }));

    const service = new ProductService(stubProductClient(get));

    expect(await service.enrichProductName("0001111041700")).toBeNull();
  });

  it("returns null (never throws) when the lookup fails", async () => {
    const get = vi.fn<ProductRequest>(async () => ({
      error: { reason: "boom" },
      response: new Response(null, { status: 500 }),
    }));

    const service = new ProductService(stubProductClient(get));

    await expect(
      service.enrichProductName("0001111041700"),
    ).resolves.toBeNull();
  });

  it("returns null when the product is not found", async () => {
    const get = vi.fn<ProductRequest>(async () => ({
      data: { data: undefined },
      response: new Response(null, { status: 200 }),
    }));

    const service = new ProductService(stubProductClient(get));

    expect(await service.enrichProductName("0009999999999")).toBeNull();
  });
});

describe("ProductService catalog budget", () => {
  it("rejects oversized exact and text work before any provider request", async () => {
    const get = vi.fn<Parameters<typeof stubProductClient>[0]>(async () => ({
      data: { data: makeProduct() },
      response: new Response(null, { status: 200 }),
    }));

    const service = new ProductService(stubProductClient(get));

    const upcs = Array.from({ length: 41 }, (_, index) =>
      String(index).padStart(13, "0"),
    );

    const exact = await service.resolveProducts(upcs, { limitPerTerm: 5 });

    const text = await service.resolveProducts(
      Array.from({ length: 11 }, (_, index) => `item ${index}`),
      { limitPerTerm: 5 },
    );

    const names = await service.enrichProductNames(upcs);

    for (const result of [exact, text, names]) {
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().type).toBe("VALIDATION_ERROR");
    }

    expect(get).not.toHaveBeenCalled();
  });

  it("normalizes and deduplicates UPCs while preserving mixed order and partial failures", async () => {
    const get = vi.fn<Parameters<typeof stubProductClient>[0]>(
      async (path, options) => {
        const term = options.params.query?.["filter.term"];

        if (term === "failure") {
          return { error: {}, response: new Response(null, { status: 401 }) };
        }

        return {
          data: { data: path === "/v1/products/{id}" ? makeProduct() : [] },
          response: new Response(null, { status: 200 }),
        };
      },
    );

    const service = new ProductService(stubProductClient(get));
    const progress: Array<[number, number]> = [];

    const resolved = await service.resolveProducts(
      [" bread ", "1111041700", "failure", "0001111041700", "bread"],
      { locationId: "70500847", limitPerTerm: 3 },
      (completed, total) => {
        progress.push([completed, total]);
      },
    );

    expect(resolved._unsafeUnwrap()).toMatchObject({
      results: [
        { term: "bread", status: "success", products: [] },
        { term: "0001111041700", status: "success", products: [makeProduct()] },
        { term: "failure", status: "failed", error: { type: "AUTH_ERROR" } },
      ],
      exactUpcs: new Set(["0001111041700"]),
    });
    expect(get).toHaveBeenCalledTimes(3);
    expect(get).toHaveBeenCalledWith("/v1/products/{id}", {
      params: {
        path: { id: "0001111041700" },
        query: { "filter.locationId": "70500847" },
      },
    });
    expect(progress).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it("bounds combined text and UPC requests to five in flight", async () => {
    let inFlight = 0;
    let peak = 0;

    const get = vi.fn<Parameters<typeof stubProductClient>[0]>(
      async (...args: unknown[]) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => {
          setTimeout(resolve, 1);
        });
        inFlight--;

        return {
          data: {
            data:
              args[0] === "/v1/products/{id}" ? makeProduct() : [makeProduct()],
          },
          response: new Response(null, { status: 200 }),
        };
      },
    );

    const service = new ProductService(stubProductClient(get));

    const terms = [
      ...Array.from({ length: 30 }, (_, index) =>
        String(index).padStart(13, "0"),
      ),
      ...Array.from({ length: 10 }, (_, index) => `item ${index}`),
    ];

    const result = await service.resolveProducts(terms, { limitPerTerm: 5 });

    expect(result._unsafeUnwrap().results).toHaveLength(40);
    expect(get).toHaveBeenCalledTimes(40);
    expect(peak).toBe(5);
  });

  it("enriches a full list within the same concurrency budget and preserves duplicate positions", async () => {
    let inFlight = 0;
    let peak = 0;

    const get = vi.fn<Parameters<typeof stubProductClient>[0]>(
      async (_path, options) => {
        const upc = options.params.path?.id;

        if (!upc) throw new Error("Missing fixture UPC path");
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => {
          setTimeout(resolve, 1);
        });
        inFlight--;

        return {
          data: {
            data:
              upc === "0000000000001"
                ? undefined
                : makeProduct({ description: upc }),
          },
          response: new Response(null, { status: 200 }),
        };
      },
    );

    const service = new ProductService(stubProductClient(get));

    const upcs = [
      "1",
      " 0000000000001 ",
      ...Array.from({ length: 38 }, (_, index) => String(index + 2)),
    ];

    const result = await service.enrichProductNames(upcs);

    expect(result._unsafeUnwrap()).toEqual([
      null,
      null,
      ...upcs.slice(2).map((upc) => upc.padStart(13, "0")),
    ]);
    expect(get).toHaveBeenCalledTimes(39);
    expect(peak).toBe(5);
  });

  it("preserves a successful exact product when another adapter call throws synchronously", async () => {
    const service = new ProductService(
      stubProductClient((_path, options) => {
        if (options.params.path?.id === "0000000000001")
          throw new Error("adapter failed");

        return Promise.resolve({
          data: { data: makeProduct() },
          response: new Response(null, { status: 200 }),
        });
      }),
    );

    const result = await service.resolveProducts(
      ["0000000000001", "0001111041700"],
      { limitPerTerm: 5 },
    );

    expect(result._unsafeUnwrap().results).toMatchObject([
      { status: "failed", error: { type: "NETWORK_ERROR" } },
      { status: "success", products: [makeProduct()] },
    ]);
  });
});
