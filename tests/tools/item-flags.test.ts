import { describe, expect, it, vi } from "vitest";

import type { QfcDealsApiResponse } from "../../src/services/qfc-weekly-deals.js";
import type { ToolContext } from "../../src/tools/types.js";
import type { WeeklyDealsCacheEntry } from "../../src/tools/weekly-deals.js";
import type { PantryItem } from "../../src/utils/user-storage.js";

import {
  dealFlagLabel,
  getDealsForFlags,
  getPantryForFlags,
  itemFlagLabels,
  pantryFlagLabel,
} from "../../src/tools/item-flags.js";
import { buildWeeklyDealsCacheKey } from "../../src/tools/weekly-deals.js";

function makePantryItem(overrides: Partial<PantryItem> = {}): PantryItem {
  return {
    productName: "Whole Milk",
    quantity: 1,
    addedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeDealsResponse(overrides: Partial<QfcDealsApiResponse> = {}): QfcDealsApiResponse {
  return {
    sourceMode: "print_fallback",
    locationId: "70500847",
    divisionCode: "705",
    warnings: [],
    deals: [],
    ...overrides,
  };
}

function makeCacheEntry(overrides: Partial<WeeklyDealsCacheEntry> = {}): WeeklyDealsCacheEntry {
  const now = Date.now();
  return {
    version: 1,
    createdAt: now,
    freshUntil: now + 60_000,
    staleUntil: now + 120_000,
    data: makeDealsResponse(),
    ...overrides,
  };
}

function makeKvContext(store: Map<string, string> | null): ToolContext {
  return {
    server: {} as ToolContext["server"],
    clients: {} as ToolContext["clients"],
    productService: {
      getProduct: () => {
        throw new Error("productService not used in this test");
      },
      enrichProductName: async () => null,
    } as unknown as ToolContext["productService"],
    storage: {} as ToolContext["storage"],
    getEnv: () =>
      (store
        ? {
            USER_DATA_KV: {
              get: vi.fn(async (key: string) => store.get(key) ?? null),
              put: vi.fn(async (key: string, value: string) => {
                store.set(key, value);
              }),
            },
          }
        : {}) as unknown as Env,
    getSessionId: () => "session-1",
  };
}

// ---------------------------------------------------------------------------
// pantryFlagLabel
// ---------------------------------------------------------------------------

describe("pantryFlagLabel", () => {
  it("matches when the pantry item name contains the requested name", () => {
    const pantry = [makePantryItem({ productName: "Whole Milk" })];
    expect(pantryFlagLabel("milk", pantry)).toBe("in pantry");
  });

  it("matches when the requested name contains the pantry item name", () => {
    const pantry = [makePantryItem({ productName: "milk" })];
    expect(pantryFlagLabel("organic whole milk", pantry)).toBe("in pantry");
  });

  it("is case-insensitive", () => {
    const pantry = [makePantryItem({ productName: "EGGS" })];
    expect(pantryFlagLabel("eggs", pantry)).toBe("in pantry");
  });

  it("returns undefined when nothing matches", () => {
    const pantry = [makePantryItem({ productName: "Bread" })];
    expect(pantryFlagLabel("milk", pantry)).toBeUndefined();
  });

  it("returns undefined for an empty pantry", () => {
    expect(pantryFlagLabel("milk", [])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// dealFlagLabel
// ---------------------------------------------------------------------------

describe("dealFlagLabel", () => {
  it("includes the price when the matched deal has one", () => {
    const deals = [
      { id: "d1", title: "Kroger Whole Milk, Gallon", price: "$2.99", source: "print" as const },
    ];
    expect(dealFlagLabel("whole milk", deals)).toBe("on sale: $2.99");
  });

  it("falls back to a plain 'on sale' label when the deal has no price", () => {
    const deals = [{ id: "d1", title: "Kroger Whole Milk, Gallon", source: "print" as const }];
    expect(dealFlagLabel("whole milk", deals)).toBe("on sale");
  });

  it("returns undefined when no deal matches", () => {
    const deals = [{ id: "d1", title: "Frozen Pizza", source: "print" as const }];
    expect(dealFlagLabel("whole milk", deals)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// itemFlagLabels
// ---------------------------------------------------------------------------

describe("itemFlagLabels", () => {
  it("returns only the pantry and deal labels that apply", () => {
    const pantry = [makePantryItem({ productName: "Whole Milk" })];
    const deals = [
      { id: "d1", title: "Kroger Whole Milk, Gallon", price: "$2.99", source: "print" as const },
    ];

    expect(itemFlagLabels("whole milk", pantry, deals)).toEqual(["in pantry", "on sale: $2.99"]);
    expect(itemFlagLabels("bread", pantry, deals)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getPantryForFlags
// ---------------------------------------------------------------------------

describe("getPantryForFlags", () => {
  it("returns the pantry list on success", async () => {
    const pantry = [makePantryItem()];
    const ctx = {
      storage: { pantry: { getAll: async () => pantry } },
    } as unknown as ToolContext;

    expect(await getPantryForFlags(ctx)).toEqual(pantry);
  });

  it("returns an empty list when storage throws", async () => {
    const ctx = {
      storage: {
        pantry: {
          getAll: async () => {
            throw new Error("KV unavailable");
          },
        },
      },
    } as unknown as ToolContext;

    expect(await getPantryForFlags(ctx)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getDealsForFlags
// ---------------------------------------------------------------------------

describe("getDealsForFlags", () => {
  it("returns deals from a fresh cache entry", async () => {
    const deals = [{ id: "d1", title: "Bananas", price: "$0.59/lb", source: "print" as const }];
    const store = new Map<string, string>();
    const cacheKey = buildWeeklyDealsCacheKey({ locationId: "70500847", limit: 50, pageLimit: 2 });
    store.set(cacheKey, JSON.stringify(makeCacheEntry({ data: makeDealsResponse({ deals }) })));

    const ctx = makeKvContext(store);

    expect(await getDealsForFlags(ctx, "70500847")).toEqual(deals);
  });

  it("returns deals from a stale-but-within-grace cache entry", async () => {
    const deals = [{ id: "d1", title: "Bananas", price: "$0.59/lb", source: "print" as const }];
    const now = Date.now();
    const store = new Map<string, string>();
    const cacheKey = buildWeeklyDealsCacheKey({ locationId: "70500847", limit: 50, pageLimit: 2 });
    store.set(
      cacheKey,
      JSON.stringify(
        makeCacheEntry({
          freshUntil: now - 60_000,
          staleUntil: now + 60_000,
          data: makeDealsResponse({ deals }),
        }),
      ),
    );

    const ctx = makeKvContext(store);

    expect(await getDealsForFlags(ctx, "70500847")).toEqual(deals);
  });

  it("returns an empty list on a cold cache (no KV entry)", async () => {
    const ctx = makeKvContext(new Map());
    expect(await getDealsForFlags(ctx, "70500847")).toEqual([]);
  });

  it("returns an empty list when the cache entry is past its stale grace window", async () => {
    const now = Date.now();
    const store = new Map<string, string>();
    const cacheKey = buildWeeklyDealsCacheKey({ locationId: "70500847", limit: 50, pageLimit: 2 });
    store.set(
      cacheKey,
      JSON.stringify(makeCacheEntry({ freshUntil: now - 120_000, staleUntil: now - 60_000 })),
    );

    const ctx = makeKvContext(store);

    expect(await getDealsForFlags(ctx, "70500847")).toEqual([]);
  });

  it("returns an empty list, not a throw, for a corrupted cache entry", async () => {
    const store = new Map<string, string>();
    const cacheKey = buildWeeklyDealsCacheKey({ locationId: "70500847", limit: 50, pageLimit: 2 });
    store.set(cacheKey, "{not-valid-json");

    const ctx = makeKvContext(store);

    await expect(getDealsForFlags(ctx, "70500847")).resolves.toEqual([]);
  });

  it("returns an empty list when there is no USER_DATA_KV binding", async () => {
    const ctx = makeKvContext(null);
    expect(await getDealsForFlags(ctx, "70500847")).toEqual([]);
  });

  it("never fetches the circular directly (no fetch/product-search call site)", async () => {
    // getDealsForFlags only reads KV — this is a structural guarantee, not a
    // spy assertion: the function signature has no clients/fetch dependency.
    const ctx = makeKvContext(new Map());
    await expect(getDealsForFlags(ctx, undefined)).resolves.toEqual([]);
  });
});
