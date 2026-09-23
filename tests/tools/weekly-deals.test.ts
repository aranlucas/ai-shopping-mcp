import { beforeEach, describe, expect, it, vi } from "vitest";

import type { McpServer } from "@modelcontextprotocol/server";

import type { QfcDealsApiResponse } from "../../src/services/qfc-weekly-deals.js";
import type { KrogerClients } from "../../src/services/kroger/client.js";
import type { WeeklyDealsLoader } from "../../src/services/weekly-deals/service.js";
import type { WeeklyDealsCache } from "../../src/services/weekly-deals/cache.js";
import { type WeeklyDealWarning } from "../../src/services/weekly-deals/schema.js";
import type { WeeklyDealsCacheEntry } from "../../src/tools/weekly-deals.js";
import type { PreferredLocation } from "../../src/domain/shopping.js";
import type { KvLike } from "../../src/utils/kv.js";
import type { PreferredLocationStore } from "../../src/utils/shopping-store.js";

import { AppErrorException, authError } from "../../src/errors.js";
import {
  addCacheWarning,
  buildWeeklyDealsCacheKey,
  formatWeeklyDealsToolResponse,
  getLatestCircularEndTime,
  parseCacheEntry,
  registerWeeklyDealsTools,
} from "../../src/tools/weekly-deals.js";
import { createWeeklyDealsCache } from "../../src/services/weekly-deals/cache.js";
import { createWeeklyDealsLoader } from "../../src/services/weekly-deals/runtime.js";
import {
  type TestToolConfig,
  type TestToolHandler as ToolHandler,
  wrapV2ToolHandler,
} from "../v2-tool-handler.js";

const weeklyDealsAuthState = vi.hoisted(() => ({
  authContext: {
    props: {
      id: "user-weekly-deals",
      accessToken: "token",
      tokenExpiresAt: Date.now() + 60_000,
    },
  } as
    | { props?: { id: string; accessToken: string; tokenExpiresAt: number } }
    | undefined,
}));

vi.mock("agents/mcp", () => ({
  getMcpAuthContext: () => weeklyDealsAuthState.authContext,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the text content from the first text item in a tool response */
function getTextContent(
  response: ReturnType<typeof formatWeeklyDealsToolResponse>,
): string {
  const textItem = response.content.find(
    (c): c is { type: "text"; text: string } =>
      "type" in c && c.type === "text",
  );
  return textItem?.text ?? "";
}

function makeMinimalResult(
  overrides: Partial<QfcDealsApiResponse> = {},
): QfcDealsApiResponse {
  return {
    sourceMode: "print_fallback",
    locationId: "70500847",
    divisionCode: "705",
    warnings: [],
    deals: [],
    ...overrides,
  };
}

function legacyWarning(message: string): WeeklyDealWarning {
  return { code: "legacy", details: { message } };
}

function makeCircular(eventEndDate: string, eventStartDate = "2025-01-01") {
  return {
    id: "circ-1",
    eventId: "evt-1",
    eventName: "Weekly Ad",
    eventStartDate,
    eventEndDate,
    divisionCode: "705",
    divisionName: "QFC",
    week: "2025-01-01",
    previewCircular: false,
    timezone: "America/Los_Angeles",
    circularType: "print",
    tags: [],
    description: "Weekly ad",
    locationId: "70500847",
  };
}

function makeCacheEntry(
  overrides: Partial<WeeklyDealsCacheEntry> = {},
): WeeklyDealsCacheEntry {
  const now = Date.now();
  return {
    version: 1,
    createdAt: now,
    freshUntil: now + 60_000,
    staleUntil: now + 120_000,
    data: makeMinimalResult(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildWeeklyDealsCacheKey
// ---------------------------------------------------------------------------

describe("buildWeeklyDealsCacheKey", () => {
  it("builds key with all params", () => {
    const key = buildWeeklyDealsCacheKey({
      locationId: "70500847",
      limit: 50,
      pageLimit: 2,
    });
    expect(key).toBe("qfc|weekly-deals|v1|loc:70500847|limit:50|pages:2");
  });

  it("uses 'default' when locationId is undefined", () => {
    const key = buildWeeklyDealsCacheKey({ limit: 50, pageLimit: 2 });
    expect(key).toBe("qfc|weekly-deals|v1|loc:default|limit:50|pages:2");
  });

  it("includes version prefix v1", () => {
    const key = buildWeeklyDealsCacheKey({ limit: 1, pageLimit: 1 });
    expect(key).toContain("|v1|");
  });
});

// ---------------------------------------------------------------------------
// parseCacheEntry
// ---------------------------------------------------------------------------

describe("parseCacheEntry", () => {
  it("returns null for null input", () => {
    expect(parseCacheEntry(null)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseCacheEntry("")).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseCacheEntry("{not-valid-json")).toBeNull();
  });

  it("returns null when version is wrong", () => {
    const entry = { ...makeCacheEntry(), version: 2 };
    expect(parseCacheEntry(JSON.stringify(entry))).toBeNull();
  });

  it("returns null when freshUntil is missing", () => {
    const { freshUntil: _, ...entry } = makeCacheEntry();
    expect(parseCacheEntry(JSON.stringify(entry))).toBeNull();
  });

  it("returns null when staleUntil is missing", () => {
    const { staleUntil: _, ...entry } = makeCacheEntry();
    expect(parseCacheEntry(JSON.stringify(entry))).toBeNull();
  });

  it("returns null when data is missing", () => {
    const { data: _, ...entry } = makeCacheEntry();
    expect(parseCacheEntry(JSON.stringify(entry))).toBeNull();
  });

  it("returns null when data has the wrong shape", () => {
    const entry = { ...makeCacheEntry(), data: { warnings: "not-an-array" } };
    expect(parseCacheEntry(JSON.stringify(entry))).toBeNull();
  });

  it("returns valid entry for a correct structure", () => {
    const entry = makeCacheEntry();
    const result = parseCacheEntry(JSON.stringify(entry));
    expect(result).not.toBeNull();
    expect(result?.version).toBe(1);
    expect(result?.freshUntil).toBe(entry.freshUntil);
    expect(result?.staleUntil).toBe(entry.staleUntil);
  });

  it("rejects a deal whose optional fields have the wrong runtime type", () => {
    const entry = JSON.parse(JSON.stringify(makeCacheEntry())) as {
      data: { deals: unknown[] };
    };
    entry.data.deals = [
      {
        id: "deal-1",
        title: "Milk",
        source: "print",
        price: { malformed: true },
      },
    ];

    expect(parseCacheEntry(JSON.stringify(entry))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getLatestCircularEndTime
// ---------------------------------------------------------------------------

describe("getLatestCircularEndTime", () => {
  it("returns null when no circulars present", () => {
    const result = makeMinimalResult();
    expect(getLatestCircularEndTime(result)).toBeNull();
  });

  it("returns end time from printCircular when only print exists", () => {
    const endDate = "2025-01-07T00:00:00Z";
    const result = makeMinimalResult({
      printCircular: makeCircular(endDate),
    });
    expect(getLatestCircularEndTime(result)).toBe(Date.parse(endDate));
  });

  it("returns end time from shoppableCircular when only shoppable exists", () => {
    const endDate = "2025-01-08T00:00:00Z";
    const result = makeMinimalResult({
      shoppableCircular: makeCircular(endDate),
    });
    expect(getLatestCircularEndTime(result)).toBe(Date.parse(endDate));
  });

  it("returns the later end time when both circulars exist", () => {
    const printEnd = "2025-01-07T00:00:00Z";
    const shoppableEnd = "2025-01-09T00:00:00Z";
    const result = makeMinimalResult({
      printCircular: makeCircular(printEnd),
      shoppableCircular: makeCircular(shoppableEnd),
    });
    expect(getLatestCircularEndTime(result)).toBe(Date.parse(shoppableEnd));
  });
});

// ---------------------------------------------------------------------------
// addCacheWarning
// ---------------------------------------------------------------------------

describe("addCacheWarning", () => {
  it("appends a warning to an empty warnings array", () => {
    const result = makeMinimalResult({ warnings: [] });
    const warning = legacyWarning("Test warning");
    const updated = addCacheWarning(result, warning);
    expect(updated.warnings).toEqual([warning]);
  });

  it("appends to existing warnings", () => {
    const first = legacyWarning("First warning");
    const second = legacyWarning("Second warning");
    const result = makeMinimalResult({ warnings: [first] });
    const updated = addCacheWarning(result, second);
    expect(updated.warnings).toEqual([first, second]);
  });

  it("does not mutate the original result", () => {
    const result = makeMinimalResult({ warnings: [] });
    addCacheWarning(result, legacyWarning("A warning"));
    expect(result.warnings).toHaveLength(0);
  });

  it("preserves all other fields from the original result", () => {
    const result = makeMinimalResult({
      sourceMode: "search_api",
      locationId: "12345678",
    });
    const updated = addCacheWarning(result, legacyWarning("msg"));
    expect(updated.sourceMode).toBe("search_api");
    expect(updated.locationId).toBe("12345678");
  });
});

// ---------------------------------------------------------------------------
// formatWeeklyDealsToolResponse
// ---------------------------------------------------------------------------

describe("formatWeeklyDealsToolResponse", () => {
  it("returns markdown deals when no dates and no warnings", async () => {
    const result = makeMinimalResult({
      deals: [
        { id: "1", title: "Bananas", price: "$0.59/lb", source: "print" },
      ],
    });
    const text = getTextContent(formatWeeklyDealsToolResponse(result, "miss"));
    expect(text).toContain("Bananas");
    expect(text).toContain("dealCount: 1");
    expect(text).not.toContain("Deals valid");
    expect(text).not.toContain("warnings:");
  });

  it("includes validFrom and validTill from printCircular", async () => {
    const result = makeMinimalResult({
      printCircular: makeCircular(
        "2025-01-07T00:00:00Z",
        "2025-01-01T00:00:00Z",
      ),
      deals: [{ id: "1", title: "Apples", price: "$1.99/lb", source: "print" }],
    });
    const text = getTextContent(formatWeeklyDealsToolResponse(result, "miss"));
    expect(text).toContain("Deals valid");
    expect(text).toContain("2025-01-01T00:00:00Z");
    expect(text).toContain("2025-01-07T00:00:00Z");
    expect(text).toContain("Apples");
  });

  it("includes validFrom and validTill from shoppableCircular when no printCircular", async () => {
    const result = makeMinimalResult({
      shoppableCircular: makeCircular(
        "2025-01-08T00:00:00Z",
        "2025-01-02T00:00:00Z",
      ),
      deals: [{ id: "1", title: "Milk", price: "$3.49", source: "search_api" }],
    });
    const text = getTextContent(formatWeeklyDealsToolResponse(result, "miss"));
    expect(text).toContain("Deals valid");
    expect(text).toContain("2025-01-02T00:00:00Z");
    expect(text).toContain("2025-01-08T00:00:00Z");
  });

  it("falls back to deal-level dates when no circular dates present", async () => {
    const result = makeMinimalResult({
      deals: [
        {
          id: "1",
          title: "Eggs",
          price: "$2.99",
          source: "print",
          validFrom: "2025-01-01",
          validTill: "2025-01-07",
        },
      ],
    });
    const text = getTextContent(formatWeeklyDealsToolResponse(result, "miss"));
    expect(text).toContain("2025-01-01");
    expect(text).toContain("2025-01-07");
  });

  it("omits the validity header when only one date is available", async () => {
    const result = makeMinimalResult({
      deals: [
        {
          id: "1",
          title: "Bread",
          price: "$2.49",
          source: "print",
          validFrom: "2025-01-01",
        },
      ],
    });
    const text = getTextContent(formatWeeklyDealsToolResponse(result, "miss"));
    expect(text).not.toContain("Deals valid");
  });

  it("includes warnings when present", async () => {
    const result = makeMinimalResult({
      warnings: [
        legacyWarning("Print-ad parsing failed"),
        legacyWarning("Using fallback"),
      ],
      deals: [
        { id: "1", title: "Chicken", price: "$4.99", source: "search_api" },
      ],
    });
    const text = getTextContent(formatWeeklyDealsToolResponse(result, "miss"));
    expect(text).toContain("Print-ad parsing failed");
    expect(text).toContain("Using fallback");
    expect(text).toContain("warnings:");
  });

  it("includes both date fields and warnings", async () => {
    const result = makeMinimalResult({
      printCircular: makeCircular(
        "2025-01-07T00:00:00Z",
        "2025-01-01T00:00:00Z",
      ),
      warnings: [legacyWarning("Some warning")],
      deals: [{ id: "1", title: "Beef", price: "$5.99", source: "print" }],
    });
    const text = getTextContent(formatWeeklyDealsToolResponse(result, "miss"));
    expect(text).toContain("Deals valid");
    expect(text).toContain("Some warning");
  });

  it("does not include source label in output", async () => {
    const result = makeMinimalResult({
      sourceMode: "print_fallback",
      deals: [{ id: "1", title: "Apples", price: "$1.99", source: "print" }],
    });
    const text = getTextContent(formatWeeklyDealsToolResponse(result, "miss"));
    expect(text).not.toContain("Weekly deals source:");
    expect(text).not.toContain("print_fallback");
  });

  it("does not include location or division info in output", async () => {
    const result = makeMinimalResult({
      locationId: "70500847",
      divisionCode: "705",
      deals: [{ id: "1", title: "Apples", price: "$1.99", source: "print" }],
    });
    const text = getTextContent(formatWeeklyDealsToolResponse(result, "miss"));
    expect(text).not.toContain("Location:");
    expect(text).not.toContain("division");
  });

  it("does not include cache state label in text output", async () => {
    const result = makeMinimalResult({
      deals: [{ id: "1", title: "Apples", price: "$1.99", source: "print" }],
    });
    const freshText = getTextContent(
      formatWeeklyDealsToolResponse(result, "fresh"),
    );
    expect(freshText).not.toContain("Cache:");
    const staleText = getTextContent(
      formatWeeklyDealsToolResponse(result, "stale"),
    );
    expect(staleText).not.toContain("Cache:");
  });

  it("includes structuredContent with cache state", async () => {
    const result = makeMinimalResult({ deals: [] });
    const response = formatWeeklyDealsToolResponse(result, "fresh");
    expect(response.structuredContent).toBeDefined();
    expect(
      (response.structuredContent as { cache: { state: string } }).cache.state,
    ).toBe("fresh");
  });

  it("includes the source store and degradation warnings in structuredContent", () => {
    const result = makeMinimalResult({
      locationId: "12345678",
      warnings: [
        {
          code: "live_refresh_partial",
          details: { action: "not_cached" },
        },
      ],
      meta: { degraded: true, failedTermCount: 1 },
    });

    const response = formatWeeklyDealsToolResponse(result, "miss");
    expect(response.structuredContent).toMatchObject({
      storeId: "12345678",
      warnings: ["Live refresh was partial; results were not cached."],
      cache: { state: "miss" },
    });
  });

  it("keeps fresh-cache information in markdown without exposing it as a UI warning", () => {
    const response = formatWeeklyDealsToolResponse(
      makeMinimalResult({ warnings: [{ code: "cache_served" }] }),
      "fresh",
    );

    expect(getTextContent(response)).toContain("Served from KV cache.");
    expect(response.structuredContent).toMatchObject({
      warnings: [],
      cache: { state: "fresh" },
    });
  });

  it("includes deal title, details, price, and savings in a markdown line", async () => {
    const result = makeMinimalResult({
      deals: [
        {
          id: "1",
          title: "Ground Beef",
          details: "80% Lean",
          price: "$3.99/lb",
          savings: "Save $2.00",
          source: "print",
        },
      ],
    });
    const text = getTextContent(formatWeeklyDealsToolResponse(result, "miss"));
    expect(text).toContain("- Ground Beef | 80% Lean | $3.99/lb | Save $2.00");
  });

  it("includes deal title when deal has no price", async () => {
    const result = makeMinimalResult({
      deals: [{ id: "1", title: "Special Item", source: "print" }],
    });
    const text = getTextContent(formatWeeklyDealsToolResponse(result, "miss"));
    expect(text).toContain("Special Item");
    expect(text).not.toContain("See weekly ad");
  });

  it("shows dealCount: 0 when no deals", async () => {
    const result = makeMinimalResult({ deals: [] });
    const text = getTextContent(formatWeeklyDealsToolResponse(result, "miss"));
    expect(text).toContain("dealCount: 0");
  });

  it("classifies and sorts deals into category order (meat before produce before pantry)", async () => {
    const result = makeMinimalResult({
      deals: [
        { id: "1", title: "Zucchini", price: "$1.99", source: "print" },
        { id: "2", title: "Flank Steaks", price: "$6.99/lb", source: "print" },
        { id: "3", title: "Doritos", price: "$3.99", source: "print" },
      ],
    });
    const response = formatWeeklyDealsToolResponse(result, "miss");
    const text = getTextContent(response);

    const meatIndex = text.indexOf("Flank Steaks");
    const produceIndex = text.indexOf("Zucchini");
    const pantryIndex = text.indexOf("Doritos");
    expect(meatIndex).toBeGreaterThan(-1);
    expect(meatIndex).toBeLessThan(produceIndex);
    expect(produceIndex).toBeLessThan(pantryIndex);
    expect(text).toContain("Meat & Seafood:");
    expect(text).toContain("Produce:");
    expect(text).toContain("Pantry, Snacks & Beverages:");

    const structured = response.structuredContent as {
      deals: Array<{ title: string; category: string }>;
    };
    expect(structured.deals.map((d) => d.title)).toEqual([
      "Flank Steaks",
      "Zucchini",
      "Doritos",
    ]);
    expect(structured.deals.map((d) => d.category)).toEqual([
      "Meat & Seafood",
      "Produce",
      "Pantry, Snacks & Beverages",
    ]);
  });

  it("keeps deals within the same category in their original (source) order", async () => {
    const result = makeMinimalResult({
      deals: [
        {
          id: "1",
          title: "Chicken Breast",
          price: "$3.99/lb",
          source: "print",
        },
        { id: "2", title: "Ground Beef", price: "$4.99/lb", source: "print" },
      ],
    });
    const response = formatWeeklyDealsToolResponse(result, "miss");
    const structured = response.structuredContent as {
      deals: Array<{ title: string }>;
    };
    expect(structured.deals.map((d) => d.title)).toEqual([
      "Chicken Breast",
      "Ground Beef",
    ]);
  });
});

// ---------------------------------------------------------------------------
// get_weekly_deals handler
// ---------------------------------------------------------------------------

type CapturedTool = {
  name: string;
  config: TestToolConfig;
  handler: ToolHandler;
};

const mockGetQfcWeeklyDeals = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => unknown>(),
);

vi.mock("../../src/services/qfc-weekly-deals.js", () => ({
  getQfcWeeklyDeals: mockGetQfcWeeklyDeals,
}));

const capturedWeeklyDealsTools = vi.hoisted(() => [] as CapturedTool[]);

function makeMinimalDealsResponse(
  overrides: Partial<QfcDealsApiResponse> = {},
): QfcDealsApiResponse {
  return {
    sourceMode: "print_fallback",
    locationId: "70500847",
    divisionCode: "705",
    warnings: [],
    deals: [{ id: "d1", title: "Bananas", price: "$0.59/lb", source: "print" }],
    ...overrides,
  };
}

function makeFreshCacheEntry(data: QfcDealsApiResponse): WeeklyDealsCacheEntry {
  const now = Date.now();
  return {
    version: 1,
    createdAt: now,
    freshUntil: now + 60_000,
    staleUntil: now + 120_000,
    data,
  };
}

function makeStaleCacheEntry(data: QfcDealsApiResponse): WeeklyDealsCacheEntry {
  const now = Date.now();
  return {
    version: 1,
    createdAt: now - 200_000,
    freshUntil: now - 100_000,
    staleUntil: now + 60_000,
    data,
  };
}

function makeKV(initialData: Map<string, string> = new Map()): {
  kv: KVNamespace;
  store: Map<string, string>;
} {
  const store = new Map(initialData);
  return {
    kv: {
      get: vi.fn<(key: string) => unknown>(
        async (key: string) => store.get(key) ?? null,
      ),
      put: vi.fn<(key: string, value: string, _opts?: unknown) => unknown>(
        async (key: string, value: string, _opts?: unknown) => {
          store.set(key, value);
        },
      ),
      delete: vi.fn<(...args: unknown[]) => unknown>(),
      list: vi.fn<(...args: unknown[]) => unknown>(),
      getWithMetadata: vi.fn<(...args: unknown[]) => unknown>(),
    } as unknown as KVNamespace,
    store,
  };
}

const DEFAULT_PREFERRED_LOCATION: PreferredLocation = {
  locationId: "70500034",
  locationName: "QFC Test Store",
  address: "1 Test St",
  chain: "QFC",
  setAt: new Date().toISOString(),
};

function makeWeeklyDealsContext(
  kv: KvLike | null = null,
  preferredLocation: PreferredLocation | null = DEFAULT_PREFERRED_LOCATION,
): {
  server: McpServer;
  preferredLocation: PreferredLocationStore;
  productClient: KrogerClients["productClient"];
  weeklyDealsCache: WeeklyDealsCache;
  loadWeeklyDeals: WeeklyDealsLoader;
} {
  const server = {
    registerTool: (
      name: string,
      config: TestToolConfig,
      handler: Parameters<typeof wrapV2ToolHandler>[0],
    ) => {
      capturedWeeklyDealsTools.push({
        name,
        config,
        handler: wrapV2ToolHandler(handler, config),
      });
    },
  } as unknown as McpServer;
  const productClient = {
    GET: vi.fn<() => unknown>(async () => ({
      data: { data: [] },
      response: new Response(null, { status: 200 }),
    })),
  } as unknown as KrogerClients["productClient"];
  const preferredLocationStore: PreferredLocationStore = {
    get: async () => preferredLocation,
    set: async () => {},
    delete: async () => {},
  };
  const weeklyDealsCache = createWeeklyDealsCache(kv);
  return {
    server,
    preferredLocation: preferredLocationStore,
    productClient,
    weeklyDealsCache,
    loadWeeklyDeals: createWeeklyDealsLoader({
      preferredLocation: preferredLocationStore,
      productClient,
      weeklyDealsCache,
    }),
  };
}

function getWeeklyDealsHandler(): ToolHandler {
  const tool = capturedWeeklyDealsTools.find(
    (t) => t.name === "get_weekly_deals",
  );
  if (!tool) throw new Error("get_weekly_deals not captured");
  return tool.handler;
}

function registerWeeklyDealsForTest(
  context: ReturnType<typeof makeWeeklyDealsContext>,
) {
  registerWeeklyDealsTools(context.server, {
    loadWeeklyDeals: context.loadWeeklyDeals,
  });
}

function textFromResult(result: unknown): string {
  const r = result as { content?: Array<{ type: string; text: string }> };
  return r.content?.[0]?.text ?? "";
}

function isErrorResult(result: unknown): boolean {
  return Boolean((result as { isError?: boolean }).isError);
}

describe("get_weekly_deals handler", () => {
  beforeEach(() => {
    capturedWeeklyDealsTools.length = 0;
    vi.resetAllMocks();
    weeklyDealsAuthState.authContext = {
      props: {
        id: "user-weekly-deals",
        accessToken: "token",
        tokenExpiresAt: Date.now() + 60_000,
      },
    };
  });

  const TEST_STORE_ID = DEFAULT_PREFERRED_LOCATION.locationId;
  // Explicit storeId bypasses preferred-store resolution for tests that don't care about it.
  const DEFAULT_ARGS = { storeId: TEST_STORE_ID, limit: 50, pageLimit: 2 };
  const CACHE_KEY_PARAMS = {
    locationId: TEST_STORE_ID,
    limit: 50,
    pageLimit: 2,
  };

  it("returns cached deals without calling the API when a fresh KV cache entry exists", async () => {
    const cachedData = makeMinimalDealsResponse({
      deals: [
        { id: "cached", title: "Cached Deal", price: "$1.00", source: "print" },
      ],
    });
    const { kv, store } = makeKV();
    const cacheKey = buildWeeklyDealsCacheKey(CACHE_KEY_PARAMS);
    store.set(cacheKey, JSON.stringify(makeFreshCacheEntry(cachedData)));

    registerWeeklyDealsForTest(makeWeeklyDealsContext(kv));

    const result = await getWeeklyDealsHandler()(DEFAULT_ARGS);

    expect(mockGetQfcWeeklyDeals).not.toHaveBeenCalled();
    expect(textFromResult(result)).toContain("Cached Deal");
    expect(textFromResult(result)).toContain("Served from KV cache.");
  });

  it("fetches live data and writes it to KV cache on a cache miss", async () => {
    const liveData = makeMinimalDealsResponse();
    mockGetQfcWeeklyDeals.mockResolvedValue(liveData);
    const { kv, store } = makeKV();

    registerWeeklyDealsForTest(makeWeeklyDealsContext(kv));

    const result = await getWeeklyDealsHandler()(DEFAULT_ARGS);

    expect(mockGetQfcWeeklyDeals).toHaveBeenCalledOnce();
    expect(textFromResult(result)).toContain("Bananas");
    expect(store.size).toBe(1);
  });

  it("keeps cached deals fresh through the circular and retains a 48-hour stale fallback", async () => {
    const eventEnd = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const liveData = makeMinimalDealsResponse({
      printCircular: makeCircular(eventEnd),
    });
    mockGetQfcWeeklyDeals.mockResolvedValue(liveData);
    const { kv, store } = makeKV();

    registerWeeklyDealsForTest(makeWeeklyDealsContext(kv));

    await getWeeklyDealsHandler()(DEFAULT_ARGS);

    const rawEntry = [...store.values()][0];
    const entry = parseCacheEntry(rawEntry);
    const expectedFreshUntil = Date.parse(eventEnd);
    const expectedStaleUntil = expectedFreshUntil + 48 * 60 * 60 * 1000;

    expect(entry?.freshUntil).toBe(expectedFreshUntil);
    expect(entry?.staleUntil).toBe(expectedStaleUntil);
    expect(kv.put).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      {
        expiration: Math.ceil(expectedStaleUntil / 1000),
      },
    );
  });

  it("serves stale cache with a warning when live fetch fails and a stale entry exists", async () => {
    const staleData = makeMinimalDealsResponse({
      deals: [
        { id: "s1", title: "Stale Deal", price: "$2.00", source: "print" },
      ],
    });
    const { kv, store } = makeKV();
    const cacheKey = buildWeeklyDealsCacheKey(CACHE_KEY_PARAMS);
    store.set(cacheKey, JSON.stringify(makeStaleCacheEntry(staleData)));

    mockGetQfcWeeklyDeals.mockRejectedValue(new Error("network timeout"));

    registerWeeklyDealsForTest(makeWeeklyDealsContext(kv));

    const result = await getWeeklyDealsHandler()(DEFAULT_ARGS);

    expect(isErrorResult(result)).toBe(false);
    expect(textFromResult(result)).toContain("Stale Deal");
    expect(textFromResult(result)).toContain("stale");
  });

  it("serves stale cache when a live refresh is partial and does not replace it", async () => {
    const staleData = makeMinimalDealsResponse({
      deals: [
        { id: "s1", title: "Stale Deal", price: "$2.00", source: "print" },
      ],
    });
    const { kv, store } = makeKV();
    const cacheKey = buildWeeklyDealsCacheKey(CACHE_KEY_PARAMS);
    store.set(cacheKey, JSON.stringify(makeStaleCacheEntry(staleData)));
    const originalCache = store.get(cacheKey);

    mockGetQfcWeeklyDeals.mockResolvedValue(
      makeMinimalDealsResponse({
        deals: [
          {
            id: "partial",
            title: "Partial Deal",
            price: "$1.00",
            source: "search_api",
          },
        ],
        warnings: [legacyWarning("Weekly deal search was partial.")],
        meta: { degraded: true, failedTermCount: 1 },
      }),
    );

    registerWeeklyDealsForTest(makeWeeklyDealsContext(kv));

    const result = await getWeeklyDealsHandler()(DEFAULT_ARGS);

    expect(isErrorResult(result)).toBe(false);
    expect(textFromResult(result)).toContain("Stale Deal");
    expect(textFromResult(result)).toContain("partial");
    expect(textFromResult(result)).not.toContain("Partial Deal");
    expect(store.get(cacheKey)).toBe(originalCache);
  });

  it("returns an MCP error when the live fetch fails and there is no stale cache", async () => {
    mockGetQfcWeeklyDeals.mockRejectedValue(new Error("connection refused"));
    const { kv } = makeKV();

    registerWeeklyDealsForTest(makeWeeklyDealsContext(kv));

    const result = await getWeeklyDealsHandler()(DEFAULT_ARGS);

    expect(isErrorResult(result)).toBe(true);
  });

  it("preserves an upstream auth failure when no stale cache exists", async () => {
    mockGetQfcWeeklyDeals.mockRejectedValue(
      new AppErrorException(authError("Kroger authentication expired.")),
    );
    const { kv } = makeKV();

    registerWeeklyDealsForTest(makeWeeklyDealsContext(kv));

    const result = await getWeeklyDealsHandler()(DEFAULT_ARGS);
    const structured = result as {
      isError?: boolean;
      structuredContent?: { error?: { code?: string; recovery?: string } };
    };

    expect(structured.isError).toBe(true);
    expect(structured.structuredContent?.error).toMatchObject({
      code: "AUTH_ERROR",
      recovery: "reconnect",
    });
  });

  it("survives a synchronous cache read throw and reports the cache failure", async () => {
    const liveData = makeMinimalDealsResponse();
    mockGetQfcWeeklyDeals.mockResolvedValue(liveData);
    const { kv } = makeKV();
    vi.mocked(kv.get).mockImplementation(() => {
      throw new Error("KV read unavailable");
    });

    registerWeeklyDealsForTest(makeWeeklyDealsContext(kv));

    const result = await getWeeklyDealsHandler()(DEFAULT_ARGS);

    expect(isErrorResult(result)).toBe(false);
    expect(textFromResult(result)).toContain("KV cache read failed");
    expect(textFromResult(result)).toContain("Bananas");
  });

  it("survives a synchronous cache write throw without failing live deals", async () => {
    const liveData = makeMinimalDealsResponse();
    mockGetQfcWeeklyDeals.mockResolvedValue(liveData);
    const { kv } = makeKV();
    vi.mocked(kv.put).mockImplementation(() => {
      throw new Error("KV write unavailable");
    });

    registerWeeklyDealsForTest(makeWeeklyDealsContext(kv));

    const result = await getWeeklyDealsHandler()(DEFAULT_ARGS);

    expect(isErrorResult(result)).toBe(false);
    expect(textFromResult(result)).toContain("Cache write failed");
    expect(textFromResult(result)).toContain("Bananas");
  });

  it("fetches live data without caching when no USER_DATA_KV binding is present in env", async () => {
    const liveData = makeMinimalDealsResponse();
    mockGetQfcWeeklyDeals.mockResolvedValue(liveData);

    registerWeeklyDealsForTest(makeWeeklyDealsContext(null));

    const result = await getWeeklyDealsHandler()(DEFAULT_ARGS);

    expect(mockGetQfcWeeklyDeals).toHaveBeenCalledOnce();
    expect(textFromResult(result)).toContain("Bananas");
    expect(isErrorResult(result)).toBe(false);
  });

  it("passes storeId to the cache key and to getQfcWeeklyDeals", async () => {
    const liveData = makeMinimalDealsResponse({ locationId: "12345678" });
    mockGetQfcWeeklyDeals.mockResolvedValue(liveData);
    const { kv, store } = makeKV();

    registerWeeklyDealsForTest(makeWeeklyDealsContext(kv));

    await getWeeklyDealsHandler()({
      storeId: "12345678",
      limit: 50,
      pageLimit: 2,
    });

    expect(mockGetQfcWeeklyDeals).toHaveBeenCalledWith(
      expect.objectContaining({ locationId: "12345678" }),
    );
    expect([...store.keys()][0]).toContain("loc:12345678");
  });

  it("returns routed structuredContent with cache state 'miss' on fresh fetch", async () => {
    const liveData = makeMinimalDealsResponse();
    mockGetQfcWeeklyDeals.mockResolvedValue(liveData);
    const { kv } = makeKV();

    registerWeeklyDealsForTest(makeWeeklyDealsContext(kv));

    const result = await getWeeklyDealsHandler()(DEFAULT_ARGS);

    const sc = (result as { structuredContent?: { cache: { state: string } } })
      .structuredContent;
    expect(result).toMatchObject({
      _meta: { "dev.aranlucas/view": "get_weekly_deals" },
    });
    expect(sc?.cache.state).toBe("miss");
  });

  it("resolves the preferred store when storeId is omitted", async () => {
    const liveData = makeMinimalDealsResponse();
    mockGetQfcWeeklyDeals.mockResolvedValue(liveData);
    const { kv, store } = makeKV();

    registerWeeklyDealsForTest(
      makeWeeklyDealsContext(kv, DEFAULT_PREFERRED_LOCATION),
    );

    await getWeeklyDealsHandler()({ limit: 50, pageLimit: 2 });

    expect(mockGetQfcWeeklyDeals).toHaveBeenCalledWith(
      expect.objectContaining({
        locationId: DEFAULT_PREFERRED_LOCATION.locationId,
      }),
    );
    expect([...store.keys()][0]).toContain(
      `loc:${DEFAULT_PREFERRED_LOCATION.locationId}`,
    );
  });

  it("returns a prescriptive error when storeId is omitted and no preferred store is set", async () => {
    const { kv } = makeKV();

    registerWeeklyDealsForTest(makeWeeklyDealsContext(kv, null));

    const result = await getWeeklyDealsHandler()({ limit: 50, pageLimit: 2 });

    expect(isErrorResult(result)).toBe(true);
    expect(textFromResult(result)).toContain("No store set");
    expect(textFromResult(result)).toContain("search_stores");
    expect(textFromResult(result)).toContain("set_preferred_store");
    expect(mockGetQfcWeeklyDeals).not.toHaveBeenCalled();
  });
});
