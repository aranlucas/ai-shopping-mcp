/**
 * Response size regression tests.
 *
 * These tests measure the character count of the `content` field (what the
 * model actually reads) for the heaviest tool responses. They catch
 * accidental regressions that would cause early context compaction.
 *
 * Run with:
 *   pnpm exec vitest run tests/tools/response-size.test.ts
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ToolContext } from "../../src/tools/types.js";

import { createKrogerClients } from "../../src/services/kroger/client.js";
import { ProductService } from "../../src/services/kroger/product-service.js";
import { registerProductTools } from "../../src/tools/product.js";
import { testCartConfirmationCodec } from "../cart-confirmation.js";
import { createCartPersistence } from "../../src/utils/user-storage.js";
import { type TestToolHandler as ToolHandler, wrapV2ToolHandler } from "../v2-tool-handler.js";
import { createKrogerCatalogProvider } from "../../src/services/catalog/kroger-provider.js";
import { stubCatalogRegistry } from "../catalog-stub.js";

type CapturedTool = { name: string; handler: ToolHandler };

const testState = vi.hoisted(() => ({
  authContext: undefined as
    | { props?: { id: string; accessToken: string; tokenExpiresAt: number } }
    | undefined,
  capturedTools: [] as CapturedTool[],
}));

vi.mock("agents/mcp", () => ({
  getMcpAuthContext: () => testState.authContext,
}));

function authenticate() {
  testState.authContext = {
    props: { id: "user-size-test", accessToken: "token", tokenExpiresAt: Date.now() + 60_000 },
  };
}

/** Total character count of the text content a model would receive */
function measureContentChars(result: unknown): number {
  const r = result as { content?: Array<{ type?: string; text?: string }> };
  return r.content?.reduce((sum, c) => sum + (c.text?.length ?? 0), 0) ?? 0;
}

function getTool(name: string): ToolHandler {
  const tool = testState.capturedTools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool ${name} not registered`);
  return tool.handler;
}

/**
 * Minimal in-memory KV stub — same pattern as tests/utils/user-storage.test.ts.
 * KVNamespace has ~10 method signatures; the stub implements only what these
 * tests exercise, and `as unknown as KVNamespace` is the established project
 * idiom for partial KV mocks.
 */
function createMockKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    put: vi.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    delete: vi.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
  } as unknown as KVNamespace;
}

// ---------------------------------------------------------------------------
// Realistic mock product — mimics a full Kroger API response including images
// ---------------------------------------------------------------------------

function makeProduct(upc: string, term: string) {
  return {
    productId: upc,
    upc,
    description: `${term} Product (Large Size)`,
    brand: "TestBrand",
    categories: ["Grocery", "Dairy", "Milk"],
    aisleLocations: [{ description: "Dairy Aisle", number: "D4" }],
    // Images are the main bulk — multiple perspectives × multiple sizes with long CDN URLs
    images: [
      {
        perspective: "front",
        default: true,
        sizes: [
          {
            id: "thumbnail",
            size: "50",
            url: `https://images.kroger.com/is/image/kroger/${upc}-0001?wid=50&hei=50&fmt=auto&qlt=80&resMode=bicub&op_usm=0.9`,
          },
          {
            id: "small",
            size: "150",
            url: `https://images.kroger.com/is/image/kroger/${upc}-0001?wid=150&hei=150&fmt=auto&qlt=80&resMode=bicub&op_usm=0.9`,
          },
          {
            id: "medium",
            size: "350",
            url: `https://images.kroger.com/is/image/kroger/${upc}-0001?wid=350&hei=350&fmt=auto&qlt=80&resMode=bicub&op_usm=0.9`,
          },
          {
            id: "large",
            size: "600",
            url: `https://images.kroger.com/is/image/kroger/${upc}-0001?wid=600&hei=600&fmt=auto&qlt=80&resMode=bicub&op_usm=0.9`,
          },
          {
            id: "xlarge",
            size: "1200",
            url: `https://images.kroger.com/is/image/kroger/${upc}-0001?wid=1200&hei=1200&fmt=auto&qlt=80&resMode=bicub&op_usm=0.9`,
          },
        ],
      },
      {
        perspective: "back",
        default: false,
        sizes: [
          {
            id: "thumbnail",
            size: "50",
            url: `https://images.kroger.com/is/image/kroger/${upc}-0002?wid=50&hei=50&fmt=auto&qlt=80`,
          },
          {
            id: "medium",
            size: "350",
            url: `https://images.kroger.com/is/image/kroger/${upc}-0002?wid=350&hei=350&fmt=auto&qlt=80`,
          },
        ],
      },
    ],
    items: [
      {
        itemId: `${upc}-001`,
        size: "1 gallon",
        price: { regular: 4.99, promo: 3.49 },
        fulfillment: { curbside: true, delivery: true, instore: true, shiptohome: false },
        inventory: { stockLevel: "HIGH" },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// search_products: worst-case bulk search
// ---------------------------------------------------------------------------

describe("search_products content size", () => {
  beforeEach(() => {
    testState.capturedTools.length = 0;
    authenticate();
  });

  async function runSearch(terms: string[], productsPerTerm: number) {
    testState.capturedTools.length = 0;

    const clients = createKrogerClients(() => null);
    vi.spyOn(clients.productClient, "GET").mockImplementation(async (_path, options) => {
      const query = (options as { params?: { query?: Record<string, unknown> } })?.params?.query;
      const term = String(query?.["filter.term"] ?? "");
      const data = Array.from({ length: productsPerTerm }, (_, i) =>
        makeProduct(String(10000000000000 + i).slice(0, 13), term),
      );
      return {
        data: { data },
        error: undefined,
        response: new Response("", { status: 200 }),
      } as Awaited<ReturnType<typeof clients.productClient.GET>>;
    });

    const carts = createCartPersistence(createMockKV(), {
      userId: "response-size-user",
      clientId: "client-size",
    });
    const server = {
      registerTool: (name: string, _config: unknown, handler: ToolHandler) => {
        testState.capturedTools.push({
          name,
          handler: wrapV2ToolHandler(handler, server),
        });
      },
    };
    registerProductTools({
      server: server as unknown as ToolContext["server"],
      clients,
      productService: new ProductService(clients.productClient),
      // Real Kroger provider over the stubbed client, so the structured
      // payload this test measures is the one production emits.
      catalogs: stubCatalogRegistry({
        kroger: createKrogerCatalogProvider(clients.productClient),
      }),
      storage: {
        preferredLocation: { get: async () => null },
      } as unknown as ToolContext["storage"],
      carts,
      getEnv: () =>
        ({
          USER_DATA_KV: { get: async () => null, put: async () => {} },
        }) as unknown as Env,
      requestStateCodec: testCartConfirmationCodec,
    });

    return getTool("search_products")({ terms });
  }

  it("stays under 15 KB for 5 terms × 10 products", async () => {
    const terms = ["milk", "eggs", "bread", "butter", "cheese"];
    const result = await runSearch(terms, 10);
    const chars = measureContentChars(result);

    // Compact items array (images/categories/itemId stripped) stays under 15 KB.
    // The previous image-only stripping produced up to 80 KB.
    expect(chars).toBeLessThan(15_000);

    // Structured content carries only the compact view projection.
    const sc = (
      result as {
        structuredContent?: { results?: Array<{ products: Array<{ imageUrl?: unknown }> }> };
      }
    ).structuredContent;
    expect(sc?.results?.[0]?.products?.[0]?.imageUrl).toBeDefined();
    expect(sc?.results?.[0]?.products?.[0]).not.toHaveProperty("nutritionInformation");
  });

  it("stays under 60 KB for 25 terms × 10 products (worst-case bulk search)", async () => {
    const terms = Array.from({ length: 25 }, (_, i) => `item${i + 1}`);
    const result = await runSearch(terms, 10);
    const chars = measureContentChars(result);

    // 25 terms × 10 products with compact items array should stay well under 60 KB.
    // Without flat compaction this would exceed the 262 K-token context limit.
    expect(chars).toBeLessThan(60_000);
  });
});
