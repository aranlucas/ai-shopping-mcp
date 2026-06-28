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

import type { ToolContext, UserStorage } from "../../src/tools/types.js";

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;
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

vi.mock("@modelcontextprotocol/ext-apps/server", () => ({
  registerAppTool: (_server: unknown, name: string, _config: unknown, handler: ToolHandler) => {
    testState.capturedTools.push({ name, handler });
  },
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

  it("stays under 80 KB for 5 terms × 10 products with images", async () => {
    const terms = ["milk", "eggs", "bread", "butter", "cheese"];
    const productsPerTerm = 10;

    // Build a fake openapi-fetch client that returns products with images.
    // fromApiResponse expects { data, error, response } where response.ok=true.
    const mockProductClient = {
      GET: vi.fn(async (_path: string, options: { params: { query: Record<string, unknown> } }) => {
        const term = String(options.params.query["filter.term"]);
        const data = Array.from({ length: productsPerTerm }, (_, i) =>
          makeProduct(String(10000000000000 + i).slice(0, 13), term),
        );
        return { data: { data }, error: undefined, response: { ok: true, status: 200 } };
      }),
    };

    const mockStorage = {
      preferredLocation: { get: async () => null },
    };

    const { registerProductTools } = await import("../../src/tools/product.js");
    registerProductTools({
      server: {} as unknown as ToolContext["server"],
      clients: { productClient: mockProductClient } as unknown as ToolContext["clients"],
      storage: mockStorage as unknown as UserStorage,
      getEnv: () => ({}) as Env,
      getSessionId: () => "session-size",
    });

    const result = await getTool("search_products")({ terms });
    const chars = measureContentChars(result);

    // With images stripped the content should be well under 80 KB.
    // Without stripping this would be 200–400 KB.
    expect(chars).toBeLessThan(80_000);

    // Structured content still carries images (for UI)
    const sc = (
      result as {
        structuredContent?: { results?: Array<{ products: Array<{ images?: unknown }> }> };
      }
    ).structuredContent;
    expect(sc?.results?.[0]?.products?.[0]?.images).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// search_recipes_from_web: worst-case multi-recipe with long instructions
// ---------------------------------------------------------------------------

describe("search_recipes_from_web content size", () => {
  beforeEach(() => {
    testState.capturedTools.length = 0;
    authenticate();
  });

  it("stays under 15 KB for 5 recipes with 15 ingredients and 12 steps each", async () => {
    const makeRecipe = (n: number) => ({
      recipe: {
        title: `Recipe ${n}: Delicious Dish with a Long Title`,
        description:
          "A wonderfully complex dish that takes skill and patience to prepare perfectly.",
        cuisine: "Mediterranean",
        difficulty: "INTERMEDIATE",
        totalTime: 75,
        servings: "4 servings",
        slug: `recipe-${n}`,
        ingredients: Array.from({ length: 15 }, (_, i) => ({
          quantity: String(i + 1),
          unit: "cups",
          name: `Ingredient ${i + 1} with a descriptive name`,
          notes: i % 3 === 0 ? "finely chopped" : undefined,
        })),
        instructions: Array.from({ length: 12 }, (_, i) => ({
          stepNumber: i + 1,
          instruction: `Step ${i + 1}: Perform this detailed cooking action carefully to ensure the best possible result for this dish.`,
        })),
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          success: true,
          data: { results: Array.from({ length: 5 }, (_, i) => makeRecipe(i + 1)) },
        }),
      ),
    );

    const { registerRecipeTools } = await import("../../src/tools/recipes.js");
    registerRecipeTools({
      server: {} as unknown as ToolContext["server"],
      clients: {} as unknown as ToolContext["clients"],
      storage: {} as unknown as UserStorage,
      getEnv: () => ({}) as Env,
      getSessionId: () => "session-size",
    });

    const result = await getTool("search_recipes_from_web")({ searchQuery: "dinner" });
    const chars = measureContentChars(result);

    // Without instruction compaction this would be 25–40 KB; with it <15 KB.
    expect(chars).toBeLessThan(15_000);

    // Full instructions should still be in structuredContent for the UI
    const sc = (result as { structuredContent?: { recipes?: Array<{ instructions?: unknown[] }> } })
      .structuredContent;
    expect(sc?.recipes?.[0]?.instructions).toHaveLength(12);
  });
});
