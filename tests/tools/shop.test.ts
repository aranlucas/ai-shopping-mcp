import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KrogerClients } from "../../src/services/kroger/client.js";
import type { components } from "../../src/services/kroger/product.js";
import { appPayloadSchemas } from "../../src/app-results.js";
import {
  getCapturedHandler,
  getCapturedTool,
  makeContext,
  resetToolTestHarness,
} from "./tool-test-harness.js";
import {
  registerShopTools,
  shopForItemsInputSchema,
} from "../../src/tools/shop.js";

type Product = components["schemas"]["products.productModel"];
const product = (index: number, overrides: Partial<Product> = {}): Product => ({
  upc: String(index).padStart(13, "0"),
  description: `Milk ${index}`,
  brand: "Kroger",
  items: [
    {
      size: "1 gal",
      price: { regular: 3.49, promo: 2.99 },
      fulfillment: { curbside: true, delivery: true },
    },
  ],
  ...overrides,
});

async function setup(products: Product[] = [product(1)]) {
  const context = makeContext();
  await context.preferredLocation.set({
    locationId: "70500034",
    locationName: "QFC",
    address: "Broadway",
    chain: "QFC",
    setAt: new Date().toISOString(),
  });
  const get = vi.fn<
    (
      path: string,
      options: { params: { query?: Record<string, string | number> } },
    ) => Promise<{ data: { data: Product[] }; response: Response }>
  >(
    async (
      _path: string,
      _options: { params: { query?: Record<string, string | number> } },
    ) => ({
      data: { data: products },
      response: new Response(null, { status: 200 }),
    }),
  );
  context.productClient = {
    GET: get,
  } as unknown as KrogerClients["productClient"];
  registerShopTools(context.server, context);
  return { context, get, call: getCapturedHandler("shop_for_items") };
}

function options(
  result: Awaited<ReturnType<ReturnType<typeof getCapturedHandler>>>,
) {
  expect(result._meta).toMatchObject({
    "dev.aranlucas/view": "search_products",
  });
  return appPayloadSchemas.search_products.parse(result.structuredContent);
}

describe("shop_for_items product options", () => {
  beforeEach(resetToolTestHarness);

  it("returns five choices in catalog order without creating a list or writing a cart", async () => {
    const { context, get, call } = await setup(
      Array.from({ length: 8 }, (_, i) => product(i + 1)),
    );
    const create = vi.spyOn(context.shoppingList, "create");
    const put = vi.spyOn(context.cartClient, "PUT");
    const result = await call({ items: [{ name: "milk", quantity: 2 }] });
    const data = options(result);
    expect(data.results[0]).toMatchObject({
      requestId: "item_0",
      term: "milk",
      quantity: 2,
      failed: false,
    });
    expect(data.results[0].products.map((item) => item.upc)).toEqual(
      [1, 2, 3, 4, 5].map((i) => String(i).padStart(13, "0")),
    );
    expect(data.totalProducts).toBe(5);
    expect(result.text).toContain("requested qty=2");
    expect(result.text).toContain("create_shopping_list");
    expect(result.text).toContain("add_shopping_list_to_cart");
    expect(create).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(get.mock.calls[0][1].params.query).toMatchObject({
      "filter.locationId": "70500034",
      "filter.limit": 20,
    });
    expect(getCapturedTool("shop_for_items").config).toMatchObject({
      annotations: { readOnlyHint: true, idempotentHint: true },
    });
  });

  it("filters ineligible products and duplicate UPCs before taking five options", async () => {
    const { call } = await setup([
      product(1, {
        items: [
          {
            inventory: { stockLevel: "TEMPORARILY_OUT_OF_STOCK" },
            fulfillment: { curbside: true },
          },
        ],
      }),
      product(2, { items: [{ fulfillment: { curbside: false } }] }),
      product(3, { upc: undefined }),
      product(4),
      product(4),
      ...Array.from({ length: 6 }, (_, i) => product(i + 5)),
    ]);
    expect(
      options(
        await call({ items: [{ name: "milk" }] }),
      ).results[0].products.map((item) => item.upc),
    ).toEqual([4, 5, 6, 7, 8].map((i) => String(i).padStart(13, "0")));
  });

  it("checks delivery fulfillment independently of pickup", async () => {
    const { call } = await setup([
      product(1, {
        items: [{ fulfillment: { curbside: true, delivery: false } }],
      }),
      product(2, {
        items: [{ fulfillment: { curbside: false, delivery: true } }],
      }),
    ]);
    const result = await call({
      items: [{ name: "milk" }],
      modality: "delivery",
    });
    expect(options(result).results[0].products.map((item) => item.upc)).toEqual(
      [product(2).upc],
    );
    expect(result.text).toContain("DELIVERY");
  });

  it("retains duplicate requests with distinct IDs and quantities", async () => {
    const { call } = await setup();
    expect(
      options(
        await call({
          items: [
            { name: "milk", quantity: 2 },
            { name: "milk", quantity: 3 },
          ],
        }),
      ).results,
    ).toEqual([
      expect.objectContaining({ requestId: "item_0", quantity: 2 }),
      expect.objectContaining({ requestId: "item_1", quantity: 3 }),
    ]);
  });

  it("exposes price, size, and supplied dietary evidence to the calling agent", async () => {
    const { call } = await setup([
      product(1, {
        manufacturerDeclarations: ["Certified Gluten Free"],
        allergensDescription: "Contains milk",
        nutritionInformation: { ingredientStatement: "Milk, lactase" },
      }),
    ]);
    const result = await call({ items: [{ name: "milk" }] });
    expect(options(result).results[0].products[0]).toMatchObject({
      price: 2.99,
      regularPrice: 3.49,
      size: "1 gal",
      declarations: ["Certified Gluten Free"],
      allergens: "Contains milk",
      ingredients: "Milk, lactase",
    });
    expect(result.text).toContain("claims: Certified Gluten Free");
    expect(result.text).toContain("allergens: Contains milk");
    expect(result.text).toContain("ingredients: Milk, lactase");
    expect(result.text).toContain("$2.99 (was $3.49)");
  });

  it("returns fewer than five when the catalog has fewer eligible choices", async () => {
    const { call } = await setup([product(1), product(2)]);
    expect(
      options(await call({ items: [{ name: "milk" }] })).totalProducts,
    ).toBe(2);
  });

  it("preserves empty and failed searches alongside usable options", async () => {
    const { get, call } = await setup();
    get.mockResolvedValueOnce({
      data: { data: [product(1)] },
      response: new Response(null, { status: 200 }),
    });
    get.mockResolvedValueOnce({
      data: { data: [] },
      response: new Response(null, { status: 200 }),
    });
    get.mockResolvedValueOnce({
      data: { data: [] },
      response: new Response(null, { status: 429 }),
    });
    const result = await call({
      items: [{ name: "milk" }, { name: "eggs" }, { name: "bread" }],
    });
    expect(result.isError).toBe(false);
    expect(options(result).results).toEqual([
      expect.objectContaining({ term: "milk", failed: false }),
      expect.objectContaining({ term: "eggs", failed: false, products: [] }),
      expect.objectContaining({
        term: "bread",
        failed: true,
        products: [],
        error: expect.any(String),
      }),
    ]);
    expect(result.text).toContain("No Kroger results");
    expect(result.text).toContain("recovery=retry_later");
  });

  it("preserves an upstream failure when every search fails", async () => {
    const { get, call } = await setup();
    get.mockRejectedValueOnce(new Error("Search timed out"));
    const result = await call({ items: [{ name: "milk" }] });
    expect(result.isError).toBe(true);
    expect(result.text).toContain(
      'search products for "milk": Search timed out',
    );
    expect(result.text).not.toContain("No available");
  });

  it("suggests refining search when no eligible choices remain", async () => {
    const { call } = await setup([]);
    const result = await call({ items: [{ name: "milk" }] });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("search_products");
    expect(result.text).toContain("No available pickup products");
  });

  it("names the store setup steps without searching when no preferred store is set", async () => {
    const { context, get, call } = await setup();
    await context.preferredLocation.delete();
    const result = await call({ items: [{ name: "milk" }] });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("search_stores");
    expect(result.text).toContain("set_preferred_store");
    expect(get).not.toHaveBeenCalled();
  });

  it("includes pantry flags without writing household data", async () => {
    const { context, call } = await setup();
    await context.pantry.add({
      productName: "Whole Milk",
      quantity: 1,
      addedAt: new Date().toISOString(),
    });
    const result = await call({ items: [{ name: "whole milk" }] });
    expect(options(result).results[0].flags).toContain("in pantry");
    expect(result.text).toContain("in pantry");
  });

  it("rejects the retired addToCart input instead of silently ignoring it", () => {
    expect(
      shopForItemsInputSchema.safeParse({
        items: [{ name: "milk" }],
        addToCart: true,
      }).success,
    ).toBe(false);
    expect(
      shopForItemsInputSchema.parse({
        items: [{ name: " milk ", quantity: "2" }],
      }),
    ).toEqual({ items: [{ name: "milk", quantity: 2 }], modality: "PICKUP" });
  });
});
