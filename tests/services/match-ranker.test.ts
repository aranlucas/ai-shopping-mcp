import { afterEach, describe, expect, it, vi } from "vitest";

import type { components as ProductComponents } from "../../src/services/kroger/product.js";

import { rankProductMatches } from "../../src/services/match-ranker.js";

type Product = ProductComponents["schemas"]["products.productModel"];
type RerankerRunInput = {
  query: string;
  contexts: Array<{ text: string }>;
  top_k: number;
};
type RerankerRunOutput = {
  response: Array<{ id: number; score: number }>;
};
type RerankerRunMock = ReturnType<
  typeof vi.fn<(model: string, options: RerankerRunInput) => Promise<RerankerRunOutput>>
>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    upc: "0000000000001",
    description: "Product",
    items: [{}],
    ...overrides,
  };
}

/** A stub Ai binding whose `run` returns a caller-supplied score per context text. */
function makeStubAi(scoreFor: (text: string, index: number) => number): {
  ai: Ai;
  run: RerankerRunMock;
} {
  const run = vi.fn(async (_model: string, options: RerankerRunInput) => ({
    response: options.contexts.map((context, index) => ({
      id: index,
      score: scoreFor(context.text, index),
    })),
  }));

  return { ai: { run } as unknown as Ai, run };
}

// ---------------------------------------------------------------------------
// rankProductMatches
// ---------------------------------------------------------------------------

describe("rankProductMatches", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ranks a real match ahead of a superficially-similar wrong-category product", async () => {
    const milkChocolate = makeProduct({
      upc: "1111111111111",
      description: "Chocolate Milk Bar",
      brand: "Hershey's",
      items: [{ size: "1.5 oz" }],
    });
    const milk = makeProduct({
      upc: "2222222222222",
      description: "Whole Milk",
      brand: "Kroger",
      items: [{ size: "1 gal" }],
    });

    // Chocolate bar is first in the raw search order — ranking should move
    // the real milk match ahead of it.
    const products = [milkChocolate, milk];

    const { ai } = makeStubAi((text) => {
      if (text.startsWith("Whole Milk")) return 0.95;
      return 0.05;
    });

    const ranked = await rankProductMatches({ ai, query: "whole milk", products });

    expect(ranked.map((p) => p.upc)).toEqual(["2222222222222", "1111111111111"]);
  });

  it("calls the Cloudflare reranker with compact product contexts", async () => {
    const milk = makeProduct({
      upc: "1111111111111",
      description: "Whole Milk",
      brand: "Kroger",
      categories: ["Dairy"],
      items: [
        {
          size: "1 gal",
          inventory: { stockLevel: "HIGH" },
          fulfillment: { curbside: true, instore: true, delivery: false },
        },
      ],
    });

    const { ai, run } = makeStubAi(() => 0.5);

    await rankProductMatches({ ai, query: "whole milk", products: [milk] });

    expect(run).toHaveBeenCalledWith(
      "@cf/baai/bge-reranker-base",
      expect.objectContaining({
        query: "whole milk",
        top_k: 1,
        contexts: [
          {
            text: expect.stringContaining("Whole Milk | Kroger | 1 gal"),
          },
        ],
      }),
    );
    const call = run.mock.calls[0] as [string, RerankerRunInput] | undefined;
    expect(call?.[1].contexts[0]?.text).toContain("stock=HIGH");
    expect(call?.[1].contexts[0]?.text).toContain("curbside=true");
    expect(call?.[1].contexts[0]?.text).toContain("instore=true");
  });

  it("boosts in-stock pickup products ahead of a slightly better unavailable semantic match", async () => {
    const unavailable = makeProduct({
      upc: "1111111111111",
      description: "Whole Milk",
      items: [
        {
          inventory: { stockLevel: "TEMPORARILY_OUT_OF_STOCK" },
          fulfillment: { curbside: false, instore: false },
        },
      ],
    });
    const available = makeProduct({
      upc: "2222222222222",
      description: "Kroger 2% Milk",
      items: [
        {
          inventory: { stockLevel: "HIGH" },
          fulfillment: { curbside: true, instore: true },
        },
      ],
    });

    const { ai } = makeStubAi((text) => (text.startsWith("Whole Milk") ? 0.9 : 0.75));

    const ranked = await rankProductMatches({
      ai,
      query: "milk",
      products: [unavailable, available],
    });

    expect(ranked.map((p) => p.upc)).toEqual(["2222222222222", "1111111111111"]);
  });

  it("keeps reranker order when availability scores are tied", async () => {
    const first = makeProduct({
      upc: "1111111111111",
      description: "First Milk",
      items: [{ fulfillment: { curbside: true, instore: true } }],
    });
    const second = makeProduct({
      upc: "2222222222222",
      description: "Second Milk",
      items: [{ fulfillment: { curbside: true, instore: true } }],
    });
    const { ai } = makeStubAi((text) => (text.startsWith("Second") ? 0.8 : 0.7));

    const ranked = await rankProductMatches({ ai, query: "milk", products: [first, second] });

    expect(ranked.map((p) => p.upc)).toEqual(["2222222222222", "1111111111111"]);
  });

  it("falls back to original order when ai.run rejects", async () => {
    const products = [makeProduct({ upc: "1" }), makeProduct({ upc: "2" })];
    const ai = {
      run: vi.fn(async () => {
        throw new Error("boom");
      }),
    } as unknown as Ai;

    const ranked = await rankProductMatches({ ai, query: "milk", products });

    expect(ranked).toEqual(products);
  });

  it("falls back to original order on timeout", async () => {
    vi.useFakeTimers();
    const products = [makeProduct({ upc: "1" }), makeProduct({ upc: "2" })];
    const ai = {
      run: vi.fn(() => new Promise<never>(() => {})),
    } as unknown as Ai;

    const resultPromise = rankProductMatches({ ai, query: "milk", products });
    await vi.advanceTimersByTimeAsync(2000);
    const ranked = await resultPromise;

    expect(ranked).toEqual(products);
  });

  it("falls back to original order on a malformed reranker response", async () => {
    const products = [makeProduct({ upc: "1" }), makeProduct({ upc: "2" })];
    const ai = { run: vi.fn(async () => ({ request_id: "async-response" })) } as unknown as Ai;

    const ranked = await rankProductMatches({ ai, query: "milk", products });

    expect(ranked).toEqual(products);
  });

  it("falls back to original order when the reranker response references an invalid product index", async () => {
    const products = [makeProduct({ upc: "1" }), makeProduct({ upc: "2" })];
    const ai = {
      run: vi.fn(async () => ({ response: [{ id: 5, score: 0.9 }] })),
    } as unknown as Ai;

    const ranked = await rankProductMatches({ ai, query: "milk", products });

    expect(ranked).toEqual(products);
  });

  it("returns an empty array unchanged", async () => {
    const { ai } = makeStubAi(() => 0.5);

    const ranked = await rankProductMatches({ ai, query: "milk", products: [] });

    expect(ranked).toEqual([]);
  });
});
