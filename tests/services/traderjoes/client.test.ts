import { describe, expect, it, vi } from "vitest";

import type { KvLike } from "../../../src/utils/kv.js";

import { createTraderJoesClient } from "../../../src/services/traderjoes/client.js";

type CatalogItemOverrides = Record<string, unknown>;

function catalogItem(overrides: CatalogItemOverrides = {}) {
  return {
    sku: "076892",
    item_title: "Chili Onion Crunch",
    sales_size: 6,
    sales_uom_description: "Ounce",
    primary_image: "/content/dam/tjs/chili-onion-crunch.jpg",
    url_key: "chili-onion-crunch-076892",
    availability: "1",
    retail_price: "3.99",
    category_hierarchy: [{ name: "Products" }, { name: "Food" }, { name: "Condiments" }],
    price_range: { minimum_price: { final_price: { value: 3.99 } } },
    ...overrides,
  };
}

function catalogResponse(items: CatalogItemOverrides[], status = 200) {
  return Response.json({ data: { products: { items } } }, { status });
}

/** In-memory KV double so cache hits and misses are observable. */
function memoryKv(): KvLike & { writes: number } {
  const store = new Map<string, string>();
  return {
    writes: 0,
    get: async (key: string) => store.get(key) ?? null,
    put: async function (this: { writes: number }, key: string, value: string) {
      this.writes += 1;
      store.set(key, value);
    },
  } as KvLike & { writes: number };
}

describe("Trader Joe's catalog client", () => {
  it("normalizes catalog items into shopping-list-ready products", async () => {
    const fetcher = vi.fn(async () => catalogResponse([catalogItem()]));
    const client = createTraderJoesClient({ fetcher: fetcher as unknown as typeof fetch });

    const result = await client.searchProducts("chili crunch");

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({
      storeCode: "701",
      products: [
        {
          sku: "076892",
          name: "Chili Onion Crunch",
          price: 3.99,
          size: "6 Ounce",
          // The generic "Products" root is skipped for the specific category.
          category: "Condiments",
          imageUrl: "https://www.traderjoes.com/content/dam/tjs/chili-onion-crunch.jpg",
          url: "https://www.traderjoes.com/home/products/pdp/chili-onion-crunch-076892",
          available: true,
        },
      ],
    });
  });

  it("sends the search terms, store code, and page size the storefront expects", async () => {
    const fetcher = vi.fn(async () => catalogResponse([]));
    const client = createTraderJoesClient({ fetcher: fetcher as unknown as typeof fetch });

    await client.searchProducts("gyoza", { storeCode: "546", limit: 3 });

    const call = fetcher.mock.calls.at(0) as unknown as [URL | string, RequestInit] | undefined;
    const init = call?.[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as {
      operationName: string;
      variables: Record<string, unknown>;
    };
    expect(body.operationName).toBe("SearchProducts");
    // availability and published are GraphQL variable defaults in the document,
    // so they are not sent on the wire.
    expect(body.variables).toEqual({
      search: "gyoza",
      storeCode: "546",
      pageSize: 3,
      currentPage: 1,
    });
  });

  it("falls back to retail_price when price_range is absent", async () => {
    const fetcher = vi.fn(async () =>
      catalogResponse([catalogItem({ price_range: null, retail_price: "$2.49" })]),
    );
    const client = createTraderJoesClient({ fetcher: fetcher as unknown as typeof fetch });

    const products = (await client.searchProducts("crackers"))._unsafeUnwrap().products;
    expect(products[0]?.price).toBe(2.49);
  });

  it("skips items with no sku or title rather than failing the search", async () => {
    const fetcher = vi.fn(async () =>
      catalogResponse([
        catalogItem({ sku: null }),
        catalogItem({ item_title: "  " }),
        catalogItem(),
      ]),
    );
    const client = createTraderJoesClient({ fetcher: fetcher as unknown as typeof fetch });

    const products = (await client.searchProducts("anything"))._unsafeUnwrap().products;
    expect(products).toHaveLength(1);
  });

  it("caps results at the requested limit", async () => {
    const fetcher = vi.fn(async () =>
      catalogResponse([
        catalogItem({ sku: "1" }),
        catalogItem({ sku: "2" }),
        catalogItem({ sku: "3" }),
      ]),
    );
    const client = createTraderJoesClient({ fetcher: fetcher as unknown as typeof fetch });

    const products = (await client.searchProducts("x", { limit: 2 }))._unsafeUnwrap().products;
    expect(products.map((product) => product.sku)).toEqual(["1", "2"]);
  });

  it("reports bot protection distinctly from a bad query", async () => {
    const fetcher = vi.fn(async () => new Response("Access Denied", { status: 403 }));
    const client = createTraderJoesClient({ fetcher: fetcher as unknown as typeof fetch });

    const result = await client.searchProducts("chili crunch");

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain("bot protection");
  });

  it("surfaces GraphQL errors instead of returning an empty catalog", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ errors: [{ message: "Unknown field 'search'" }] }, { status: 200 }),
    );
    const client = createTraderJoesClient({ fetcher: fetcher as unknown as typeof fetch });

    const result = await client.searchProducts("chili crunch");

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain("Unknown field 'search'");
  });

  it("serves a repeat search from KV without calling the storefront again", async () => {
    const fetcher = vi.fn(async () => catalogResponse([catalogItem()]));
    const kv = memoryKv();
    const client = createTraderJoesClient({ fetcher: fetcher as unknown as typeof fetch, kv });

    const first = await client.searchProducts("chili crunch");
    const second = await client.searchProducts("Chili Crunch");

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(second._unsafeUnwrap()).toEqual(first._unsafeUnwrap());
  });

  it("uses the configured endpoint override", async () => {
    const fetcher = vi.fn(async () => catalogResponse([]));
    const client = createTraderJoesClient({
      endpoint: "https://proxy.example/graphql",
      fetcher: fetcher as unknown as typeof fetch,
    });

    await client.searchProducts("anything");

    const [url] = fetcher.mock.calls.at(0) as unknown as [URL | string];
    expect(String(url)).toBe("https://proxy.example/graphql");
  });

  it("rejects an empty query without a network call", async () => {
    const fetcher = vi.fn(async () => catalogResponse([]));
    const client = createTraderJoesClient({ fetcher: fetcher as unknown as typeof fetch });

    const result = await client.searchProducts("   ");

    expect(result.isErr()).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
