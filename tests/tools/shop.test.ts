import { beforeEach, describe, expect, it, vi } from "vitest";

import type { components as ProductComponents } from "../../src/services/kroger/product.js";
import type { ToolContext, UserStorage } from "../../src/tools/types.js";
import type { PreferredLocation, ShoppingList } from "../../src/utils/user-storage.js";

import { registerShopTools } from "../../src/tools/shop.js";

type Product = ProductComponents["schemas"]["products.productModel"];

type AuthContext = {
  props?: { id: string; accessToken: string; tokenExpiresAt: number };
};

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;
type CapturedTool = { name: string; config: unknown; handler: ToolHandler };

const testState = vi.hoisted(() => ({
  authContext: undefined as AuthContext | undefined,
  capturedTools: [] as CapturedTool[],
}));

vi.mock("agents/mcp", () => ({
  getMcpAuthContext: () => testState.authContext,
}));

vi.mock("@modelcontextprotocol/ext-apps/server", () => ({
  registerAppTool: (_server: unknown, name: string, config: unknown, handler: ToolHandler) => {
    testState.capturedTools.push({ name, config, handler });
  },
}));

function authenticate(userId = "user-123") {
  testState.authContext = {
    props: { id: userId, accessToken: "test-token", tokenExpiresAt: Date.now() + 60_000 },
  };
}

function textFromResult(result: unknown): string {
  const r = result as { content?: Array<{ type: string; text: string }> };
  return r.content?.[0]?.text ?? "";
}

function isErrorResult(result: unknown): boolean {
  return Boolean((result as { isError?: boolean }).isError);
}

function structuredContentOf(result: unknown): Record<string, unknown> {
  return (result as { structuredContent?: Record<string, unknown> }).structuredContent ?? {};
}

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    upc: "0001111041700",
    description: "Kroger 2% Reduced Fat Milk",
    brand: "Kroger",
    items: [
      {
        size: "1 gal",
        price: { regular: 3.49, promo: 2.99 },
        fulfillment: { curbside: true, instore: true },
      },
    ],
    ...overrides,
  };
}

type ProductGetFn = (
  path: string,
  opts: { params: { query?: Record<string, string | number> } },
) => Promise<{ data?: unknown; error?: unknown; response: Response }>;

function makeContext(
  productGet: ProductGetFn,
  preferredLocation: PreferredLocation | null,
): ToolContext {
  const createdLists: ShoppingList[] = [];

  const storage = {
    preferredLocation: {
      get: async () => preferredLocation,
      set: async () => {},
    },
    shoppingList: {
      create: async (id: string, name: string, items: ShoppingList["items"]) => {
        const list: ShoppingList = { id, name, items, createdAt: new Date().toISOString() };
        createdLists.push(list);
        return list;
      },
      get: async (id: string) => createdLists.find((l) => l.id === id) ?? null,
      clear: async () => {},
    },
    cartSnapshot: {
      get: async () => null,
      set: async () => {},
      clear: async () => {},
    },
    pantry: {} as UserStorage["pantry"],
    equipment: {} as UserStorage["equipment"],
    orderHistory: {} as UserStorage["orderHistory"],
  } as unknown as UserStorage;

  return {
    server: {
      server: { elicitInput: async () => ({ action: "accept", content: { confirm: true } }) },
    } as unknown as ToolContext["server"],
    clients: { productClient: { GET: productGet } } as unknown as ToolContext["clients"],
    storage,
    getEnv: () => ({}) as Env,
    getSessionId: () => "session-1",
  };
}

function getCapturedHandler(name: string): ToolHandler {
  const tool = testState.capturedTools.find((t) => t.name === name);
  expect(tool).toBeDefined();
  return (
    tool?.handler ??
    (async () => {
      throw new Error(`Tool ${name} was not captured`);
    })
  );
}

const PREFERRED_LOCATION: PreferredLocation = {
  locationId: "70500034",
  locationName: "QFC Broadway",
  address: "417 Broadway E",
  chain: "QFC",
  setAt: new Date().toISOString(),
};

describe("shop_for_items", () => {
  beforeEach(() => {
    testState.capturedTools.length = 0;
    authenticate();
  });

  it("resolves the preferred store, searches each name, and creates a shopping list", async () => {
    registerShopTools(
      makeContext(async (_path, opts) => {
        const term = String(opts.params.query?.["filter.term"] ?? "");
        if (term === "whole milk") {
          return {
            data: { data: [makeProduct()] },
            response: new Response(null, { status: 200 }),
          };
        }
        if (term === "eggs") {
          return {
            data: {
              data: [makeProduct({ upc: "0002000000029", description: "Grade A Large Eggs" })],
            },
            response: new Response(null, { status: 200 }),
          };
        }
        return { data: { data: [] }, response: new Response(null, { status: 200 }) };
      }, PREFERRED_LOCATION),
    );

    const result = await getCapturedHandler("shop_for_items")({
      items: [{ name: "whole milk" }, { name: "eggs", quantity: 2 }],
    });

    expect(isErrorResult(result)).toBe(false);
    const sc = structuredContentOf(result);
    expect(sc["_view"]).toBe("create_shopping_list");
    expect(sc["listId"]).toMatch(/^list_[0-9a-f]{8}$/);
    expect((sc["items"] as Array<{ productName: string; upc?: string }>).map((i) => i.upc)).toEqual(
      ["0001111041700", "0002000000029"],
    );

    const text = textFromResult(result);
    expect(text).toContain("whole milk → Kroger 2% Reduced Fat Milk");
    expect(text).toContain("eggs → Grade A Large Eggs");
    expect(text).toContain(`call add_shopping_list_to_cart with listId "${sc["listId"]}"`);
  });

  it("picks the pickup-available product over a non-pickup product for the same name", async () => {
    const noPickup = makeProduct({
      upc: "1111111111111",
      description: "No Pickup",
      items: [{ fulfillment: { curbside: false, instore: false } }],
    });
    const withPickup = makeProduct({
      upc: "2222222222222",
      description: "Has Pickup",
      items: [{ fulfillment: { curbside: true, instore: false } }],
    });

    registerShopTools(
      makeContext(async () => {
        return {
          data: { data: [noPickup, withPickup] },
          response: new Response(null, { status: 200 }),
        };
      }, PREFERRED_LOCATION),
    );

    const result = await getCapturedHandler("shop_for_items")({ items: [{ name: "milk" }] });

    const sc = structuredContentOf(result);
    expect((sc["items"] as Array<{ upc?: string }>)[0]?.upc).toBe("2222222222222");
  });

  it("tracks names with zero results and still creates a list for the rest", async () => {
    registerShopTools(
      makeContext(async (_path, opts) => {
        const term = String(opts.params.query?.["filter.term"] ?? "");
        if (term === "milk") {
          return { data: { data: [makeProduct()] }, response: new Response(null, { status: 200 }) };
        }
        return { data: { data: [] }, response: new Response(null, { status: 200 }) };
      }, PREFERRED_LOCATION),
    );

    const result = await getCapturedHandler("shop_for_items")({
      items: [{ name: "milk" }, { name: "unobtainium sauce" }],
    });

    expect(isErrorResult(result)).toBe(false);
    expect(textFromResult(result)).toContain("No results for: unobtainium sauce.");
    const sc = structuredContentOf(result);
    expect((sc["items"] as unknown[]).length).toBe(1);
  });

  it("returns an error when every name has zero results", async () => {
    registerShopTools(
      makeContext(async () => {
        return { data: { data: [] }, response: new Response(null, { status: 200 }) };
      }, PREFERRED_LOCATION),
    );

    const result = await getCapturedHandler("shop_for_items")({ items: [{ name: "unobtainium" }] });

    expect(isErrorResult(result)).toBe(true);
    expect(textFromResult(result)).toContain("No products found for: unobtainium");
    expect(textFromResult(result)).toContain("search_products");
  });

  it("returns a prescriptive error when no preferred store is set", async () => {
    registerShopTools(
      makeContext(async () => {
        return { data: { data: [] }, response: new Response(null, { status: 200 }) };
      }, null),
    );

    const result = await getCapturedHandler("shop_for_items")({ items: [{ name: "milk" }] });

    expect(isErrorResult(result)).toBe(true);
    expect(textFromResult(result)).toContain("No preferred store set");
    expect(textFromResult(result)).toContain("search_stores");
    expect(textFromResult(result)).toContain("set_preferred_store");
  });
});
