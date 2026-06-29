import { beforeEach, describe, expect, it, vi } from "vitest";

import type { components as ProductComponents } from "../../src/services/kroger/product.js";
import type { ToolContext, UserStorage } from "../../src/tools/types.js";
import type { PreferredLocation } from "../../src/utils/user-storage.js";

import { apiError, authError } from "../../src/errors.js";
import { logProductSearchError, registerProductTools } from "../../src/tools/product.js";

type Product = ProductComponents["schemas"]["products.productModel"];

// ---------------------------------------------------------------------------
// Shared test state and mocks
// ---------------------------------------------------------------------------

type AuthContext = {
  props?: {
    id: string;
    accessToken: string;
    tokenExpiresAt: number;
  };
};

type ToolExtra = {
  sendNotification?: (notification: { method: string; params: unknown }) => Promise<void>;
  _meta?: { progressToken?: string | number };
};

type ToolHandler = (args: Record<string, unknown>, extra?: ToolExtra) => Promise<unknown>;

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function authenticate(userId = "user-123") {
  testState.authContext = {
    props: { id: userId, accessToken: "test-token", tokenExpiresAt: Date.now() + 60_000 },
  };
}

type GetOpts = {
  params: {
    query?: Record<string, string | number>;
    path?: Record<string, string>;
  };
};

type ProductGetFn = (
  path: string,
  opts: GetOpts,
) => Promise<{ data?: unknown; error?: unknown; response: Response }>;

function makeStorage(preferredLocation?: PreferredLocation): UserStorage {
  const stored = preferredLocation ?? null;
  return {
    preferredLocation: {
      set: async () => {},
      get: async () => stored,
    },
    pantry: {
      add: async () => {},
      remove: async () => {},
      clear: async () => {},
      getAll: async () => [],
    },
    equipment: {
      add: async () => {},
      remove: async () => {},
      clear: async () => {},
      getAll: async () => [],
    },
    orderHistory: {
      add: async () => {},
      getAll: async () => [],
    },
    shoppingList: {
      add: async () => {},
      remove: async () => {},
      updateItem: async () => {},
      clear: async () => {},
      getAll: async () => [],
      getUnchecked: async () => [],
    },
  } as unknown as UserStorage;
}

function makeContext(productGet: ProductGetFn, storage?: UserStorage): ToolContext {
  return {
    server: {} as ToolContext["server"],
    clients: {
      productClient: { GET: productGet },
    } as unknown as ToolContext["clients"],
    storage: storage ?? makeStorage(),
    getEnv: () => ({}) as Env,
    getSessionId: () => "session-1",
  };
}

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    upc: "0001111041700",
    description: "Test Milk",
    brand: "Kroger",
    aisleLocations: [{ description: "Dairy", number: "10" }],
    categories: ["Dairy"],
    images: [
      {
        perspective: "front",
        default: true,
        sizes: [{ id: "medium", size: "medium", url: "https://example.com/milk.jpg" }],
      },
    ],
    items: [
      {
        itemId: "item-001",
        size: "1 gal",
        price: { regular: 3.99, promo: 2.99 },
        fulfillment: { curbside: true, instore: true, delivery: false, shiptohome: false },
      },
    ],
    ...overrides,
  };
}

function makeSearchResponse(products: Product[]) {
  return {
    data: { data: products },
    response: new Response(null, { status: 200 }),
  };
}

function makeDetailResponse(product: Product | undefined) {
  return {
    data: { data: product },
    response: new Response(null, { status: 200 }),
  };
}

function makeErrorResponse(status = 500) {
  return {
    error: { reason: "Internal Server Error" },
    response: new Response(null, { status }),
  };
}

function textFromResult(result: unknown): string {
  const r = result as { content?: Array<{ type: string; text: string }> };
  return r.content?.[0]?.text ?? "";
}

function isErrorResult(result: unknown): boolean {
  return Boolean((result as { isError?: boolean }).isError);
}

function structuredContentOf(result: unknown): unknown {
  return (result as { structuredContent?: unknown }).structuredContent;
}

function getCapturedHandler(name: string): ToolHandler {
  const tool = testState.capturedTools.find((t) => t.name === name);
  expect(tool).toBeDefined();
  return (
    tool?.handler ??
    (async () => {
      throw new Error(`Tool "${name}" was not captured`);
    })
  );
}

// ---------------------------------------------------------------------------
// logProductSearchError
// ---------------------------------------------------------------------------

describe("logProductSearchError", () => {
  it("logs expected auth failures as warnings instead of errors", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    logProductSearchError("eggs", authError("Kroger access token has expired."));

    expect(warnSpy).toHaveBeenCalledWith(
      'Search unavailable for "eggs":',
      "Kroger access token has expired.",
    );
    expect(errorSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("logs unexpected product failures as errors", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    logProductSearchError("eggs", apiError("Failed to search products"));

    expect(errorSpy).toHaveBeenCalledWith(
      'Error searching products for "eggs":',
      "Failed to search products",
    );
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// search_products
// ---------------------------------------------------------------------------

describe("search_products", () => {
  beforeEach(() => {
    testState.capturedTools.length = 0;
    authenticate();
  });

  it("returns structuredContent with _view: search_products and correct totalProducts for a single term", async () => {
    const product = makeProduct();
    registerProductTools(makeContext(async () => makeSearchResponse([product])));

    const result = await getCapturedHandler("search_products")({ terms: ["milk"] });

    const sc = structuredContentOf(result) as {
      _view: string;
      results: Array<{ term: string; products: Product[]; count: number; failed: boolean }>;
      totalProducts: number;
    };
    expect(sc._view).toBe("search_products");
    expect(sc.totalProducts).toBe(1);
    expect(sc.results).toHaveLength(1);
    expect(sc.results[0].term).toBe("milk");
    expect(sc.results[0].products[0].upc).toBe("0001111041700");
    expect(sc.results[0].failed).toBe(false);
  });

  it("returns textResult 'No products found...' when all terms return empty results and no failures", async () => {
    registerProductTools(makeContext(async () => makeSearchResponse([])));

    const result = await getCapturedHandler("search_products")({ terms: ["unknownitem"] });

    expect(textFromResult(result)).toContain("No products found");
    expect(structuredContentOf(result)).toBeUndefined();
  });

  it("returns textResult 'Search failed for...' when all searches fail with API errors", async () => {
    registerProductTools(makeContext(async () => makeErrorResponse(500)));

    const result = await getCapturedHandler("search_products")({ terms: ["milk"] });

    const text = textFromResult(result);
    expect(text).toContain("Search failed for");
    expect(text).toContain("milk");
    expect(structuredContentOf(result)).toBeUndefined();
  });

  it("includes successful results in structuredContent while failed terms appear with failed: true", async () => {
    const product = makeProduct();
    registerProductTools(
      makeContext(async (_path, opts) => {
        const term = opts.params.query?.["filter.term"];
        if (term === "milk") return makeSearchResponse([product]);
        return makeErrorResponse(500);
      }),
    );

    const result = await getCapturedHandler("search_products")({ terms: ["milk", "bread"] });

    const sc = structuredContentOf(result) as {
      _view: string;
      results: Array<{ term: string; failed: boolean; products: Product[]; count: number }>;
      totalProducts: number;
    };
    expect(sc._view).toBe("search_products");
    expect(sc.totalProducts).toBe(1);
    expect(sc.results).toHaveLength(2);

    const milkResult = sc.results.find((r) => r.term === "milk");
    expect(milkResult?.failed).toBe(false);
    expect(milkResult?.products).toHaveLength(1);

    const breadResult = sc.results.find((r) => r.term === "bread");
    expect(breadResult?.failed).toBe(true);
    expect(breadResult?.count).toBe(0);
  });

  it("passes provided locationId as 'filter.locationId' in the API query params", async () => {
    const capturedQueries: Array<Record<string, string | number>> = [];
    registerProductTools(
      makeContext(async (_path, opts) => {
        if (opts.params.query) capturedQueries.push(opts.params.query);
        return makeSearchResponse([]);
      }),
    );

    await getCapturedHandler("search_products")({ terms: ["milk"], locationId: "12345678" });

    expect(capturedQueries[0]["filter.locationId"]).toBe("12345678");
  });

  it("resolves preferred location from storage and uses it as 'filter.locationId' when no locationId arg is given", async () => {
    const capturedQueries: Array<Record<string, string | number>> = [];
    const storage = makeStorage({
      locationId: "99887766",
      locationName: "QFC Store",
      address: "123 Main St",
      chain: "QFC",
      setAt: new Date().toISOString(),
    });
    registerProductTools(
      makeContext(async (_path, opts) => {
        if (opts.params.query) capturedQueries.push(opts.params.query);
        return makeSearchResponse([]);
      }, storage),
    );

    await getCapturedHandler("search_products")({ terms: ["eggs"] });

    expect(capturedQueries[0]["filter.locationId"]).toBe("99887766");
  });

  it("sends progress notifications (notifications/progress) for each completed search when progressToken is present", async () => {
    const product = makeProduct();
    const notifications: Array<{ method: string; params: unknown }> = [];
    registerProductTools(makeContext(async () => makeSearchResponse([product])));

    const sendNotification = vi.fn(async (notification: { method: string; params: unknown }) => {
      notifications.push(notification);
    });

    await getCapturedHandler("search_products")(
      { terms: ["milk", "eggs"] },
      { _meta: { progressToken: "tok-1" }, sendNotification },
    );

    expect(notifications).toHaveLength(2);
    expect(notifications[0].method).toBe("notifications/progress");

    const firstParams = notifications[0].params as {
      progressToken: string | number;
      progress: number;
      total: number;
    };
    expect(firstParams.progressToken).toBe("tok-1");
    expect(firstParams.total).toBe(2);
  });

  it("sorts products within each result so pickup-available products come first", async () => {
    const noPickup = makeProduct({
      upc: "1111111111111",
      description: "No Pickup Product",
      items: [{ itemId: "i1", fulfillment: { curbside: false, instore: false } }],
    });
    const withPickup = makeProduct({
      upc: "2222222222222",
      description: "Pickup Product",
      items: [{ itemId: "i2", fulfillment: { curbside: true, instore: true } }],
    });
    registerProductTools(makeContext(async () => makeSearchResponse([noPickup, withPickup])));

    const result = await getCapturedHandler("search_products")({ terms: ["item"] });

    const sc = structuredContentOf(result) as { results: Array<{ products: Product[] }> };
    const products = sc.results[0].products;
    expect(products[0].upc).toBe("2222222222222"); // pickup product sorted first
    expect(products[1].upc).toBe("1111111111111"); // no-pickup product sorted after
  });

  it("toon content strips itemId, images, and categories; structuredContent retains them", async () => {
    const product = makeProduct();
    registerProductTools(makeContext(async () => makeSearchResponse([product])));

    const result = await getCapturedHandler("search_products")({ terms: ["milk"] });

    // structuredContent keeps the full product including images and categories
    const sc = structuredContentOf(result) as { results: Array<{ products: Product[] }> };
    expect(sc.results[0].products[0].images).toBeDefined();
    expect(sc.results[0].products[0].categories).toBeDefined();

    // toon (model context) is compact: no itemId, but has pickup field
    const text = textFromResult(result);
    expect(text).not.toContain("itemId");
    expect(text).toContain("pickup");
  });
});

// ---------------------------------------------------------------------------
// get_product_details
// ---------------------------------------------------------------------------

describe("get_product_details", () => {
  beforeEach(() => {
    testState.capturedTools.length = 0;
    authenticate();
  });

  it("returns structuredContent with _view: get_product_details and full product including images", async () => {
    const product = makeProduct();
    registerProductTools(makeContext(async () => makeDetailResponse(product)));

    const result = await getCapturedHandler("get_product_details")({
      productId: "0001111041700",
    });

    const sc = structuredContentOf(result) as { _view: string; product: Product };
    expect(sc._view).toBe("get_product_details");
    expect(sc.product.upc).toBe("0001111041700");
    expect(sc.product.description).toBe("Test Milk");
    expect(sc.product.images).toBeDefined();
    expect(sc.product.images).toHaveLength(1);
  });

  it("returns MCP error when API response has no product data (data.data is undefined)", async () => {
    registerProductTools(makeContext(async () => makeDetailResponse(undefined)));

    const result = await getCapturedHandler("get_product_details")({
      productId: "0001111041700",
    });

    expect(isErrorResult(result)).toBe(true);
    expect(textFromResult(result)).toContain("0001111041700");
  });

  it("returns MCP error when the Kroger API call itself fails (e.g. 401)", async () => {
    registerProductTools(makeContext(async () => makeErrorResponse(401)));

    const result = await getCapturedHandler("get_product_details")({
      productId: "0001111041700",
    });

    expect(isErrorResult(result)).toBe(true);
  });

  it("passes locationId as 'filter.locationId' query param when provided", async () => {
    const capturedQueries: Array<Record<string, string>> = [];
    const product = makeProduct();
    registerProductTools(
      makeContext(async (_path, opts) => {
        if (opts.params.query) {
          capturedQueries.push(opts.params.query as Record<string, string>);
        }
        return makeDetailResponse(product);
      }),
    );

    await getCapturedHandler("get_product_details")({
      productId: "0001111041700",
      locationId: "12345678",
    });

    expect(capturedQueries[0]["filter.locationId"]).toBe("12345678");
  });

  it("strips images from toon content but structuredContent retains them", async () => {
    const product = makeProduct();
    registerProductTools(makeContext(async () => makeDetailResponse(product)));

    const result = await getCapturedHandler("get_product_details")({
      productId: "0001111041700",
    });

    // structuredContent preserves the full product with images
    const sc = structuredContentOf(result) as { product: Product };
    expect(sc.product.images).toBeDefined();
    expect(sc.product.images).toHaveLength(1);

    // toon (model context) strips the images field
    const text = textFromResult(result);
    expect(text).not.toContain("images");
  });
});
