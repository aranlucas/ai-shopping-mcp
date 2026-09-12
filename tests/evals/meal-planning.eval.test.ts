/**
 * Eval: meal planning context with weekly deals.
 *
 * These tests exercise the real MCP wire contract. The weekly-deals cache is
 * seeded through the worker's USER_DATA_KV binding so a normal run never
 * reaches Kroger's circular endpoints; the product search and list hand-off
 * still run through the deterministic fixture gateway.
 */
import type { Client } from "@modelcontextprotocol/client";
import { env, reset } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { QfcDealsApiResponse } from "../../src/services/qfc-weekly-deals.js";
import type { WeeklyDealsCacheEntry } from "../../src/tools/weekly-deals.js";

import {
  type KrogerFetchStub,
  type ToolCallResult,
  DEFAULT_STORE_ID,
  contentText,
  createEvalMcpClient,
  estimateTokens,
  extractListIds,
  extractProductRefs,
  extractStoreIds,
  installKrogerFetchStub,
} from "./harness.js";
import { buildWeeklyDealsCacheKey } from "../../src/tools/weekly-deals.js";

const CACHE_KEY = buildWeeklyDealsCacheKey({
  locationId: DEFAULT_STORE_ID,
  limit: 50,
  pageLimit: 2,
});

const DEAL_START = "2026-09-09";
const DEAL_END = "2026-09-15";

function dealsData(deals = conciseDeals(10), warnings: string[] = []): QfcDealsApiResponse {
  return {
    sourceMode: "print_fallback",
    locationId: DEFAULT_STORE_ID,
    divisionCode: DEFAULT_STORE_ID.slice(0, 3),
    warnings,
    deals,
  };
}

function conciseDeals(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `deal-${index + 1}`,
    title: index === 0 ? "Kroger 2% Reduced Fat Milk" : `Weeknight Offer ${index + 1}`,
    details: index === 0 ? "1 gal" : "12 oz",
    price: index === 0 ? "$3.49" : "$2.00",
    savings: index === 0 ? "Save $0.50 (was $3.99)" : "Save $1.00",
    loyalty: "With QFC card",
    disclaimer: "Limit 5",
    validFrom: DEAL_START,
    validTill: DEAL_END,
    source: "print" as const,
  }));
}

async function seedDeals(
  overrides: Partial<WeeklyDealsCacheEntry> = {},
  data: QfcDealsApiResponse = dealsData(),
) {
  const now = Date.now();
  const entry: WeeklyDealsCacheEntry = {
    version: 1,
    createdAt: now,
    freshUntil: now + 60 * 60 * 1000,
    staleUntil: now + 2 * 60 * 60 * 1000,
    data,
    ...overrides,
  };
  await env.USER_DATA_KV.put(CACHE_KEY, JSON.stringify(entry));
}

function failKrogerFetches() {
  const originalFetch = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.hostname === "api.kroger.com") throw new Error("fixture Kroger outage");
      return originalFetch(input, init);
    }),
  );
}

describe("meal planning weekly deals (wire eval)", () => {
  let stub: KrogerFetchStub;
  let client: Client;
  let toolCalls: number;

  beforeEach(async () => {
    stub = installKrogerFetchStub();
    client = await createEvalMcpClient();
    toolCalls = 0;
  });

  afterEach(async () => {
    stub.restore();
    await reset();
  });

  async function call(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    toolCalls++;
    const result = (await client.callTool({ name, arguments: args })) as ToolCallResult;
    expect(result.isError, `${name} failed: ${contentText(result)}`).toBeFalsy();
    return result;
  }

  it("returns pantry and deals together, then supports search-to-list in three calls", async () => {
    await call("set_preferred_store", { storeId: DEFAULT_STORE_ID });
    await call("add_to_inventory", {
      inventory: "pantry",
      items: [{ name: "Rice", quantity: 2 }],
    });
    await seedDeals();
    toolCalls = 0;

    // Timed workflow: one context call, one batched exact-product search, and
    // one shopping-list write. The setup calls above model an existing user.
    const context = await call("get_meal_planning_context", {
      includeWeeklyDeals: true,
      numberOfMeals: 2,
      storeId: DEFAULT_STORE_ID,
    });
    const contextText = contentText(context);
    const [storeId] = extractStoreIds(contextText);
    expect(storeId).toBe(DEFAULT_STORE_ID);
    expect(contextText).toContain("Rice x2");
    expect(contextText).toContain("Kroger 2% Reduced Fat Milk");
    expect(contextText).toContain("$3.49");
    expect(contextText).toContain("With QFC card");
    expect(contextText).toContain(`from ${DEAL_START}`);
    expect(contextText).toContain(`until ${DEAL_END}`);
    expect(contextText).toContain("cache=fresh");
    expect(context.structuredContent).toBeUndefined();

    const search = await call("search_products", { terms: ["milk"], storeId });
    const [productRef] = extractProductRefs(contentText(search));
    expect(productRef).toBeDefined();

    const list = await call("create_shopping_list", {
      name: "Milk dinner plan",
      items: [{ productRef, quantity: 1 }],
    });
    expect(extractListIds(contentText(list))).toHaveLength(1);
    expect(toolCalls).toBeLessThanOrEqual(3);

    // Meal planning and list creation must not silently mutate Kroger's cart.
    expect(stub.cartPuts).toHaveLength(0);
  });

  it("accepts string booleans and keeps the default false path deal-free", async () => {
    await call("set_preferred_store", { storeId: DEFAULT_STORE_ID });
    await call("add_to_inventory", {
      inventory: "pantry",
      items: [{ name: "Rice", quantity: 1 }],
    });
    await seedDeals();

    const disabled = await call("get_meal_planning_context", { includeWeeklyDeals: " FALSE " });
    expect(contentText(disabled)).toContain("Rice x1");
    expect(contentText(disabled)).not.toContain("Weekly Deals");
    expect(contentText(disabled)).not.toContain("Kroger 2% Reduced Fat Milk");

    const enabled = await call("get_meal_planning_context", {
      includeWeeklyDeals: " true ",
      storeId: DEFAULT_STORE_ID,
    });
    expect(contentText(enabled)).toContain("Weekly Deals");
    expect(contentText(enabled)).toContain("cache=fresh");
  });

  it("can plan from deals when the pantry is empty", async () => {
    await seedDeals();

    const result = await call("get_meal_planning_context", {
      includeWeeklyDeals: true,
      storeId: DEFAULT_STORE_ID,
    });
    const text = contentText(result);
    expect(text).toContain("Your pantry is empty. Treat all recipe ingredients as items to buy.");
    expect(text).toContain("Kroger 2% Reduced Fat Milk");
    expect(text).toContain("Action Required");
    expect(text).toContain("search_products");
    expect(stub.cartPuts).toHaveLength(0);
  });

  it("surfaces a refresh warning when stale cached deals cannot refresh", async () => {
    await seedDeals(
      { freshUntil: Date.now() - 60_000, staleUntil: Date.now() + 60 * 60 * 1000 },
      dealsData(conciseDeals(2), ["Member prices require a loyalty card."]),
    );
    failKrogerFetches();

    const result = await call("get_meal_planning_context", {
      includeWeeklyDeals: true,
      storeId: DEFAULT_STORE_ID,
    });
    const text = contentText(result);
    // Failed product searches must not become a cacheable empty success. The
    // shared loader preserves the usable stale entry and exposes the refresh
    // failure as a warning.
    expect(text).toContain("cache=stale");
    expect(text).toContain("Unable to fetch weekly circulars");
    expect(text).toContain("Kroger 2% Reduced Fat Milk");
    expect(text).toContain("Member prices require a loyalty card.");
  });

  it("keeps pantry context and gives recovery guidance when deals are unavailable", async () => {
    await call("add_to_inventory", {
      inventory: "pantry",
      items: [{ name: "Rice", quantity: 1 }],
    });

    const result = await call("get_meal_planning_context", {
      includeWeeklyDeals: true,
    });
    const text = contentText(result);
    expect(text).toContain("Weekly Deals Unavailable");
    expect(text).toContain("get_weekly_deals to retry");
    expect(text).toContain("Rice x1");
    expect(text).not.toContain("Kroger 2% Reduced Fat Milk");
    expect(stub.cartPuts).toHaveLength(0);
  });

  it("keeps ten concise offers within the meal-planning response budget", async () => {
    await seedDeals();
    const result = await call("get_meal_planning_context", {
      includeWeeklyDeals: true,
      storeId: DEFAULT_STORE_ID,
    });
    const text = contentText(result);
    expect(text).toContain("Showing 10 of 10 offers");
    expect(text).toContain("Weeknight Offer 10");
    expect(estimateTokens(text)).toBeLessThanOrEqual(1000);
    expect(result.structuredContent).toBeUndefined();
  });
});
