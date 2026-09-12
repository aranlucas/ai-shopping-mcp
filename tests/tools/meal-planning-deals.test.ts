import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as z from "zod/v4";

import type { QfcDealsApiResponse } from "../../src/services/qfc-weekly-deals.js";
import type { WeeklyDealsCacheEntry } from "../../src/tools/weekly-deals.js";

// Install the auth mock before loading tool modules.
import {
  getCapturedHandler,
  getCapturedTool,
  makeContext,
  makeStorage,
  resetToolTestHarness,
} from "./tool-test-harness.js";
import { getQfcWeeklyDeals } from "../../src/services/qfc-weekly-deals.js";
import { registerRecipeTools } from "../../src/tools/recipes.js";
import { buildWeeklyDealsCacheKey } from "../../src/tools/weekly-deals.js";

vi.mock("../../src/services/qfc-weekly-deals.js", () => ({
  getQfcWeeklyDeals: vi.fn<typeof getQfcWeeklyDeals>(),
}));

const STORE_ID = "70500847";
const PREFERRED_STORE = {
  provider: "kroger",
  locationId: STORE_ID,
  locationName: "QFC",
  address: "Seattle, WA",
  chain: "QFC",
  setAt: "2026-09-12T00:00:00Z",
};
const TRADER_JOES_STORE = { ...PREFERRED_STORE, provider: "trader_joes", locationId: "701" };
const CACHE_KEY = buildWeeklyDealsCacheKey({ locationId: STORE_ID, limit: 50, pageLimit: 2 });

function dealsResponse(overrides: Partial<QfcDealsApiResponse> = {}): QfcDealsApiResponse {
  return {
    locationId: STORE_ID,
    divisionCode: "705",
    sourceMode: "print_fallback",
    warnings: [],
    deals: [{ id: "deal-1", title: "Black beans", price: "$0.99", source: "print" }],
    ...overrides,
  };
}

function call(args: Record<string, unknown> = {}) {
  const { inputSchema } = getCapturedTool("get_meal_planning_context").config as {
    inputSchema: z.ZodType<Record<string, unknown>>;
  };
  return getCapturedHandler("get_meal_planning_context")(inputSchema.parse(args));
}

describe("meal planning with weekly deals", () => {
  let context: ReturnType<typeof makeContext>;
  let cache: Map<string, string>;
  let readCache: ReturnType<typeof vi.fn<(key: string) => Promise<string | null>>>;

  beforeEach(async () => {
    resetToolTestHarness();
    vi.mocked(getQfcWeeklyDeals).mockReset().mockResolvedValue(dealsResponse());
    context = makeContext(makeStorage());
    await context.storage.pantry.add({
      productName: "Rice",
      quantity: 2,
      addedAt: new Date().toISOString(),
    });
    await context.storage.preferredLocation.set(PREFERRED_STORE);
    cache = new Map();
    readCache = vi.fn<(key: string) => Promise<string | null>>(
      async (key) => cache.get(key) ?? null,
    );
    context.getEnv = () =>
      ({
        USER_DATA_KV: {
          get: readCache,
          put: async (key: string, value: string) => {
            cache.set(key, value);
          },
        },
      }) as unknown as Env;
    registerRecipeTools(context);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function seedCache(overrides: Partial<WeeklyDealsCacheEntry> = {}) {
    const now = Date.now();
    const entry: WeeklyDealsCacheEntry = {
      version: 1,
      createdAt: now,
      freshUntil: now + 60_000,
      staleUntil: now + 120_000,
      data: dealsResponse(),
      ...overrides,
    };
    cache.set(CACHE_KEY, JSON.stringify(entry));
  }

  it("leaves default pantry planning free of deal reads and network calls", async () => {
    const result = await call();
    expect(result.isError).toBe(false);
    expect(result.text).toContain("Rice x2");
    expect(result.text).not.toContain("Weekly Deals");
    expect(getQfcWeeklyDeals).not.toHaveBeenCalled();
    expect(readCache).not.toHaveBeenCalled();
  });

  it("combines preferred-store offers with pantry context and exact-product guidance", async () => {
    const result = await call({
      includeWeeklyDeals: true,
      numberOfMeals: 2,
      dietaryPreferences: "vegetarian",
    });
    expect(result.isError).toBe(false);
    expect(result.text).toContain("Rice x2");
    expect(result.text).toContain("Black beans | $0.99");
    expect(result.text).toContain(`storeId=${STORE_ID}`);
    expect(result.text).toContain("cache=miss");
    expect(result.text).toContain("Dietary preferences: vegetarian");
    expect(result.text).toContain("search_products");
    expect(result.text).toContain("create_shopping_list");
    expect(result.text).toContain("do not assume sale items are already in the pantry");
    expect(result.structuredContent).toBeUndefined();
    expect(result._meta).toBeUndefined();
    expect(getQfcWeeklyDeals).toHaveBeenCalledWith(
      expect.objectContaining({ locationId: STORE_ID, limit: 50, pageLimit: 2 }),
    );
    expect(cache.has(CACHE_KEY)).toBe(true);
  });

  it("reuses the default weekly-deals cache without fetching again", async () => {
    seedCache();
    const result = await call({ includeWeeklyDeals: true });
    expect(result.text).toContain("Black beans | $0.99");
    expect(result.text).toContain("cache=fresh");
    expect(getQfcWeeklyDeals).not.toHaveBeenCalled();
    expect(readCache).toHaveBeenCalledWith(CACHE_KEY);
  });

  it("honors an explicit Kroger store without changing a different provider's preference", async () => {
    await context.storage.preferredLocation.set(TRADER_JOES_STORE);
    await call({ includeWeeklyDeals: true, storeId: ` ${STORE_ID} ` });
    expect(getQfcWeeklyDeals).toHaveBeenCalledWith(
      expect.objectContaining({ locationId: STORE_ID }),
    );
    expect(await context.storage.preferredLocation.get()).toMatchObject({
      provider: "trader_joes",
      locationId: "701",
    });
  });

  it.each([null, TRADER_JOES_STORE])(
    "preserves pantry context and store recovery guidance for preference %j",
    async (preferred) => {
      context.storage.preferredLocation.get = async () => preferred;
      const result = await call({ includeWeeklyDeals: true });
      expect(result.isError).toBe(false);
      expect(result.text).toContain("Weekly Deals Unavailable");
      expect(result.text).toContain("Rice x2");
      expect(result.text).toContain("search_stores");
      expect(result.text).toContain("set_preferred_store");
      expect(getQfcWeeklyDeals).not.toHaveBeenCalled();
    },
  );

  it("supports planning from deals with an empty pantry", async () => {
    await context.storage.pantry.clear();
    const result = await call({ includeWeeklyDeals: true });
    expect(result.isError).toBe(false);
    expect(result.text).toContain("Treat all recipe ingredients as items to buy");
    expect(result.text).toContain("Black beans");
    expect(result.text).toContain("Action Required");
  });

  it("handles empty ads without suggesting that discounts exist", async () => {
    vi.mocked(getQfcWeeklyDeals).mockResolvedValue(dealsResponse({ deals: [] }));
    const result = await call({ includeWeeklyDeals: true });
    expect(result.isError).toBe(false);
    expect(result.text).toContain("No weekly offers found");
    expect(result.text).toContain("Rice x2");
  });

  it("labels stale fallback offers and preserves upstream warnings", async () => {
    seedCache({
      freshUntil: Date.now() - 60_000,
      data: dealsResponse({ warnings: ["Member prices require a loyalty card."] }),
    });
    vi.mocked(getQfcWeeklyDeals).mockRejectedValue(new Error("Service unavailable"));
    const result = await call({ includeWeeklyDeals: true });
    expect(result.isError).toBe(false);
    expect(result.text).toContain("cache=stale");
    expect(result.text).toContain("offers may have ended");
    expect(result.text).toContain("Member prices require a loyalty card");
    expect(result.text).toContain("Black beans");
  });

  it("keeps pantry planning available when a refresh fails beyond the stale grace period", async () => {
    seedCache({ freshUntil: Date.now() - 120_000, staleUntil: Date.now() - 60_000 });
    vi.mocked(getQfcWeeklyDeals).mockRejectedValue(new Error("Service unavailable"));
    const result = await call({ includeWeeklyDeals: true });
    expect(result.isError).toBe(false);
    expect(result.text).toContain("Weekly Deals Unavailable");
    expect(result.text).toContain("get_weekly_deals to retry");
    expect(result.text).toContain("Rice x2");
    expect(result.text).not.toContain("Black beans");
  });

  it("limits the summary to ten complete offers and preserves conditions and validity", async () => {
    seedCache({
      data: dealsResponse({
        deals: Array.from({ length: 12 }, (_, index) => ({
          id: `deal-${index + 1}`,
          title: `Offer ${index + 1}`,
          source: "print",
          price: "$2.00",
          details: "12 oz",
          savings: "Save $1",
          loyalty: "With card",
          disclaimer: "Must buy 5",
          validFrom: "2026-09-09",
          validTill: "2026-09-15",
        })),
      }),
    });
    const result = await call({ includeWeeklyDeals: true });
    expect(result.text).toContain("Showing 10 of 12 offers");
    expect(result.text).toContain(
      "Offer 10 | 12 oz | $2.00 | Save $1 | With card | Must buy 5 | from 2026-09-09 | until 2026-09-15",
    );
    expect(result.text).not.toContain("Offer 11");
    expect(result.text).toContain("get_weekly_deals for more offers");
    expect(JSON.parse(cache.get(CACHE_KEY) ?? "{}").data.deals).toHaveLength(12);
  });

  it("normalizes string booleans without treating false as an opt-in", async () => {
    const disabled = await call({ includeWeeklyDeals: " FALSE " });
    expect(disabled.text).not.toContain("Weekly Deals");
    expect(getQfcWeeklyDeals).not.toHaveBeenCalled();
    const enabled = await call({ includeWeeklyDeals: "true" });
    expect(enabled.text).toContain("Black beans");
  });

  it("keeps stale fallback when the refresh exceeds its deadline instead of caching partial data", async () => {
    seedCache({ freshUntil: Date.now() - 60_000 });
    const originalCache = cache.get(CACHE_KEY);
    const signal = AbortSignal.abort(new DOMException("Deal request timed out", "TimeoutError"));
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(signal);
    vi.mocked(getQfcWeeklyDeals).mockResolvedValue(dealsResponse({ deals: [] }));
    const result = await call({ includeWeeklyDeals: true });
    expect(result.isError).toBe(false);
    expect(result.text).toContain("cache=stale");
    expect(result.text).toContain("Black beans");
    expect(getQfcWeeklyDeals).toHaveBeenCalledWith(expect.objectContaining({ signal }));
    expect(cache.get(CACHE_KEY)).toBe(originalCache);
  });
});
