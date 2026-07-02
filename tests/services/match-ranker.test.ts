import { afterEach, describe, expect, it, vi } from "vitest";

import type { components as ProductComponents } from "../../src/services/kroger/product.js";
import type { EmbeddingAi, EmbeddingKv } from "../../src/services/match-ranker.js";

import { isEmbeddingAiLike, rankProductMatches } from "../../src/services/match-ranker.js";

type Product = ProductComponents["schemas"]["products.productModel"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Mirrors match-ranker.ts's internal cache-key derivation (SHA-256 hex of the
 * embedded text, prefixed `embed|v1|bge-small|`) so tests can pre-seed the KV
 * cache under the exact key the module will look up.
 */
async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function embeddingCacheKey(text: string): Promise<string> {
  return `embed|v1|bge-small|${await sha256Hex(text)}`;
}

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    upc: "0000000000001",
    description: "Product",
    items: [{}],
    ...overrides,
  };
}

/** A stub KV whose store, get, and put mocks are all inspectable from the test. */
function makeFakeKv(): {
  kv: EmbeddingKv;
  store: Map<string, string>;
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
} {
  const store = new Map<string, string>();
  const get = vi.fn(async (key: string) => store.get(key) ?? null);
  const put = vi.fn(async (key: string, value: string) => {
    store.set(key, value);
  });
  return { kv: { get, put }, store, get, put };
}

/** A stub Ai binding whose `run` returns a caller-supplied vector per input text. */
function makeStubAi(vectorFor: (text: string) => number[]): EmbeddingAi {
  return {
    run: vi.fn(async (_model: string, options: { text: string[] }) => ({
      data: options.text.map(vectorFor),
    })),
  };
}

// ---------------------------------------------------------------------------
// isEmbeddingAiLike
// ---------------------------------------------------------------------------

describe("isEmbeddingAiLike", () => {
  it("accepts an object with a run function", () => {
    expect(isEmbeddingAiLike({ run: () => {} })).toBe(true);
  });

  it("rejects null, non-objects, and objects without run", () => {
    expect(isEmbeddingAiLike(null)).toBe(false);
    expect(isEmbeddingAiLike(undefined)).toBe(false);
    expect(isEmbeddingAiLike("ai")).toBe(false);
    expect(isEmbeddingAiLike({})).toBe(false);
    expect(isEmbeddingAiLike({ run: "not a function" })).toBe(false);
  });
});

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

    const ai = makeStubAi((text) => {
      if (text === "whole milk") return [1, 0];
      if (text.startsWith("Whole Milk")) return [0.95, 0.05]; // close to query
      return [0, 1]; // chocolate bar: orthogonal to the query
    });
    const { kv } = makeFakeKv();

    const ranked = await rankProductMatches({ ai, kv, query: "whole milk", products });

    expect(ranked.map((p) => p.upc)).toEqual(["2222222222222", "1111111111111"]);
  });

  it("boosts pickup-available products when similarity is otherwise tied", async () => {
    const noPickup = makeProduct({
      upc: "1111111111111",
      description: "Milk",
      items: [{ fulfillment: { curbside: false, instore: false } }],
    });
    const withPickup = makeProduct({
      upc: "2222222222222",
      description: "Milk",
      items: [{ fulfillment: { curbside: true, instore: false } }],
    });

    // Both products embed to the same text ("Milk"), so without the pickup
    // boost a stable sort would keep noPickup (index 0) first.
    const products = [noPickup, withPickup];

    const ai = makeStubAi(() => [1, 0]);
    const { kv } = makeFakeKv();

    const ranked = await rankProductMatches({ ai, kv, query: "milk", products });

    expect(ranked.map((p) => p.upc)).toEqual(["2222222222222", "1111111111111"]);
  });

  it("skips re-embedding cached product texts, batching only the query and uncached texts", async () => {
    const productA = makeProduct({ upc: "1111111111111", description: "A", items: [{}] });
    const productB = makeProduct({ upc: "2222222222222", description: "B", items: [{}] });

    const { kv, store, put } = makeFakeKv();
    store.set(await embeddingCacheKey("A"), JSON.stringify([1, 0]));

    const ai = makeStubAi(() => [0, 1]);

    await rankProductMatches({ ai, kv, query: "a", products: [productA, productB] });

    expect(ai.run).toHaveBeenCalledTimes(1);
    expect(ai.run).toHaveBeenCalledWith(
      "@cf/baai/bge-small-en-v1.5",
      expect.objectContaining({ text: ["a", "B"] }),
    );
    // Only the uncached text ("B") gets written back to the cache.
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("falls back to original order when ai.run rejects", async () => {
    const products = [makeProduct({ upc: "1" }), makeProduct({ upc: "2" })];
    const ai: EmbeddingAi = {
      run: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
    const { kv } = makeFakeKv();

    const ranked = await rankProductMatches({ ai, kv, query: "milk", products });

    expect(ranked).toEqual(products);
  });

  it("falls back to original order on timeout", async () => {
    vi.useFakeTimers();
    const products = [makeProduct({ upc: "1" }), makeProduct({ upc: "2" })];
    const ai: EmbeddingAi = {
      run: vi.fn(() => new Promise<never>(() => {})),
    };
    const { kv } = makeFakeKv();

    const resultPromise = rankProductMatches({ ai, kv, query: "milk", products });
    await vi.advanceTimersByTimeAsync(2000);
    const ranked = await resultPromise;

    expect(ranked).toEqual(products);
  });

  it("falls back to original order on a malformed embedding response", async () => {
    const products = [makeProduct({ upc: "1" }), makeProduct({ upc: "2" })];
    const ai: EmbeddingAi = { run: vi.fn(async () => ({ request_id: "async-response" })) };
    const { kv } = makeFakeKv();

    const ranked = await rankProductMatches({ ai, kv, query: "milk", products });

    expect(ranked).toEqual(products);
  });

  it("falls back to original order when the embedding response has the wrong length", async () => {
    const products = [makeProduct({ upc: "1" }), makeProduct({ upc: "2" })];
    const ai: EmbeddingAi = { run: vi.fn(async () => ({ data: [[1, 0]] })) };
    const { kv } = makeFakeKv();

    const ranked = await rankProductMatches({ ai, kv, query: "milk", products });

    expect(ranked).toEqual(products);
  });

  it("returns an empty array unchanged", async () => {
    const ai = makeStubAi(() => [1, 0]);
    const { kv } = makeFakeKv();

    const ranked = await rankProductMatches({ ai, kv, query: "milk", products: [] });

    expect(ranked).toEqual([]);
  });
});
