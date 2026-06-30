import { beforeEach, describe, expect, it, vi } from "vitest";

import type { QfcDealsApiResponse } from "../../src/services/qfc-weekly-deals.js";
import type { ToolContext } from "../../src/tools/types.js";
import type { WeeklyDealsCacheEntry } from "../../src/tools/weekly-deals.js";

import {
  addCacheWarning,
  buildWeeklyDealsCacheKey,
  formatWeeklyDealsToolResponse,
  getLatestCircularEndTime,
  parseCacheEntry,
  registerWeeklyDealsTools,
} from "../../src/tools/weekly-deals.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the text content from the first text item in a tool response */
function getTextContent(response: ReturnType<typeof formatWeeklyDealsToolResponse>): string {
  const textItem = response.content.find(
    (c): c is { type: "text"; text: string } => "type" in c && c.type === "text",
  );
  return textItem?.text ?? "";
}

function makeMinimalResult(overrides: Partial<QfcDealsApiResponse> = {}): QfcDealsApiResponse {
  return {
    sourceMode: "print_fallback",
    locationId: "70500847",
    divisionCode: "705",
    warnings: [],
    deals: [],
    ...overrides,
  };
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

function makeCacheEntry(overrides: Partial<WeeklyDealsCacheEntry> = {}): WeeklyDealsCacheEntry {
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
    const updated = addCacheWarning(result, "Test warning");
    expect(updated.warnings).toEqual(["Test warning"]);
  });

  it("appends to existing warnings", () => {
    const result = makeMinimalResult({ warnings: ["First warning"] });
    const updated = addCacheWarning(result, "Second warning");
    expect(updated.warnings).toEqual(["First warning", "Second warning"]);
  });

  it("does not mutate the original result", () => {
    const result = makeMinimalResult({ warnings: [] });
    addCacheWarning(result, "A warning");
    expect(result.warnings).toHaveLength(0);
  });

  it("preserves all other fields from the original result", () => {
    const result = makeMinimalResult({
      sourceMode: "search_api",
      locationId: "12345678",
    });
    const updated = addCacheWarning(result, "msg");
    expect(updated.sourceMode).toBe("search_api");
    expect(updated.locationId).toBe("12345678");
  });
});

// ---------------------------------------------------------------------------
// formatWeeklyDealsToolResponse
// ---------------------------------------------------------------------------

describe("formatWeeklyDealsToolResponse", () => {
  it("returns TOON-encoded deals when no dates and no warnings", async () => {
    const result = makeMinimalResult({
      deals: [{ id: "1", title: "Bananas", price: "$0.59/lb", source: "print" }],
    });
    const text = getTextContent(formatWeeklyDealsToolResponse(result, "miss"));
    expect(text).toContain("Bananas");
    expect(text).toContain("dealCount: 1");
    // top-level validFrom: field absent (column headers contain "validFrom" without ": ")
    expect(text).not.toContain("validFrom: ");
    expect(text).not.toContain("warnings");
  });

  it("includes validFrom and validTill from printCircular", async () => {
    const result = makeMinimalResult({
      printCircular: makeCircular("2025-01-07T00:00:00Z", "2025-01-01T00:00:00Z"),
      deals: [{ id: "1", title: "Apples", price: "$1.99/lb", source: "print" }],
    });
    const text = getTextContent(formatWeeklyDealsToolResponse(result, "miss"));
    expect(text).toContain("validFrom:");
    expect(text).toContain("validTill:");
    expect(text).toContain("Apples");
  });

  it("includes validFrom and validTill from shoppableCircular when no printCircular", async () => {
    const result = makeMinimalResult({
      shoppableCircular: makeCircular("2025-01-08T00:00:00Z", "2025-01-02T00:00:00Z"),
      deals: [{ id: "1", title: "Milk", price: "$3.49", source: "search_api" }],
    });
    const text = getTextContent(formatWeeklyDealsToolResponse(result, "miss"));
    expect(text).toContain("validFrom:");
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

  it("omits date fields when only one date is available", async () => {
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
    // top-level date keys absent (column headers have "validFrom" without the ": " suffix)
    expect(text).not.toContain("validFrom: ");
    expect(text).not.toContain("validTill: ");
  });

  it("includes warnings array when present", async () => {
    const result = makeMinimalResult({
      warnings: ["Print-ad parsing failed", "Using fallback"],
      deals: [{ id: "1", title: "Chicken", price: "$4.99", source: "search_api" }],
    });
    const text = getTextContent(formatWeeklyDealsToolResponse(result, "miss"));
    expect(text).toContain("Print-ad parsing failed");
    expect(text).toContain("Using fallback");
    expect(text).toContain("warnings");
  });

  it("includes both date fields and warnings", async () => {
    const result = makeMinimalResult({
      printCircular: makeCircular("2025-01-07T00:00:00Z", "2025-01-01T00:00:00Z"),
      warnings: ["Some warning"],
      deals: [{ id: "1", title: "Beef", price: "$5.99", source: "print" }],
    });
    const text = getTextContent(formatWeeklyDealsToolResponse(result, "miss"));
    expect(text).toContain("validFrom:");
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

  it("does not include deals count in output", async () => {
    const result = makeMinimalResult({
      deals: [
        { id: "1", title: "A", price: "$1.00", source: "print" },
        { id: "2", title: "B", price: "$2.00", source: "print" },
      ],
    });
    const text = getTextContent(formatWeeklyDealsToolResponse(result, "miss"));
    expect(text).not.toContain("Deals returned:");
  });

  it("does not include cache state label in text output", async () => {
    const result = makeMinimalResult({
      deals: [{ id: "1", title: "Apples", price: "$1.99", source: "print" }],
    });
    const freshText = getTextContent(formatWeeklyDealsToolResponse(result, "fresh"));
    expect(freshText).not.toContain("Cache:");
    const staleText = getTextContent(formatWeeklyDealsToolResponse(result, "stale"));
    expect(staleText).not.toContain("Cache:");
  });

  it("includes structuredContent with cache state", async () => {
    const result = makeMinimalResult({ deals: [] });
    const response = formatWeeklyDealsToolResponse(result, "fresh");
    expect(response.structuredContent).toBeDefined();
    expect((response.structuredContent as { cache: { state: string } }).cache.state).toBe("fresh");
  });

  it("includes deal title, details, price, and savings in TOON row", async () => {
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
    expect(text).toContain("Ground Beef");
    expect(text).toContain("80% Lean");
    expect(text).toContain("$3.99/lb");
    expect(text).toContain("Save $2.00");
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
});

// ---------------------------------------------------------------------------
// TOON compaction vs JSON
// ---------------------------------------------------------------------------

function makeDeals(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `deal-${i}`,
    title: `Organic Valley Whole Milk 64oz`,
    details: "2% Reduced Fat, Grade A",
    price: `$${(3 + i * 0.25).toFixed(2)}`,
    savings: `Save $1.${i % 10}0`,
    source: "print" as const,
    validFrom: "2025-01-01",
    validTill: "2025-01-07",
  }));
}

describe("TOON compaction vs JSON", () => {
  it("TOON is shorter than JSON for a realistic deals list (10 items)", () => {
    const result = makeMinimalResult({ deals: makeDeals(10) });
    const toonText = getTextContent(formatWeeklyDealsToolResponse(result, "miss"));
    const jsonText = JSON.stringify(result.deals);
    const savings = ((1 - toonText.length / jsonText.length) * 100).toFixed(1);
    console.log(
      `10 deals — TOON: ${toonText.length} chars, JSON: ${jsonText.length} chars (${savings}% smaller)`,
    );
    expect(toonText.length).toBeLessThan(jsonText.length);
  });

  it("TOON is shorter than JSON for a larger deals list (50 items)", () => {
    const result = makeMinimalResult({ deals: makeDeals(50) });
    const toonText = getTextContent(formatWeeklyDealsToolResponse(result, "miss"));
    const jsonText = JSON.stringify(result.deals);
    const savings = ((1 - toonText.length / jsonText.length) * 100).toFixed(1);
    console.log(
      `50 deals — TOON: ${toonText.length} chars, JSON: ${jsonText.length} chars (${savings}% smaller)`,
    );
    expect(toonText.length).toBeLessThan(jsonText.length);
  });

  it("savings grow with array size — 50-item list saves more than 10-item list", () => {
    const result10 = makeMinimalResult({ deals: makeDeals(10) });
    const result50 = makeMinimalResult({ deals: makeDeals(50) });
    const toon10 = getTextContent(formatWeeklyDealsToolResponse(result10, "miss")).length;
    const json10 = JSON.stringify(result10.deals).length;
    const toon50 = getTextContent(formatWeeklyDealsToolResponse(result50, "miss")).length;
    const json50 = JSON.stringify(result50.deals).length;
    const savings10 = 1 - toon10 / json10;
    const savings50 = 1 - toon50 / json50;
    console.log(
      `Savings ratio — 10 items: ${(savings10 * 100).toFixed(1)}%, 50 items: ${(savings50 * 100).toFixed(1)}%`,
    );
    expect(savings50).toBeGreaterThan(savings10);
  });

  it("TOON output is valid text with TOON field-header syntax for uniform arrays", () => {
    const result = makeMinimalResult({ deals: makeDeals(5) });
    const toonText = getTextContent(formatWeeklyDealsToolResponse(result, "miss"));
    // TOON tabular arrays declare length and fields in a header like: deals[N]{field1,field2,...}:
    expect(toonText).toMatch(/deals\[\d+\]\{[^}]+\}:/);
  });
});

// ---------------------------------------------------------------------------
// get_weekly_deals handler
// ---------------------------------------------------------------------------

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;
type CapturedTool = { name: string; handler: ToolHandler };

const mockGetQfcWeeklyDeals = vi.hoisted(() => vi.fn());

vi.mock("../../src/services/qfc-weekly-deals.js", () => ({
  getQfcWeeklyDeals: mockGetQfcWeeklyDeals,
}));

const capturedWeeklyDealsTools = vi.hoisted(() => [] as CapturedTool[]);

vi.mock("@modelcontextprotocol/ext-apps/server", () => ({
  registerAppTool: (_server: unknown, name: string, _config: unknown, handler: ToolHandler) => {
    capturedWeeklyDealsTools.push({ name, handler });
  },
}));

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
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      put: vi.fn(async (key: string, value: string, _opts?: unknown) => {
        store.set(key, value);
      }),
      delete: vi.fn(),
      list: vi.fn(),
      getWithMetadata: vi.fn(),
    } as unknown as KVNamespace,
    store,
  };
}

function makeWeeklyDealsContext(kv: KVNamespace | null = null): ToolContext {
  return {
    server: {} as ToolContext["server"],
    clients: {
      productClient: {
        GET: vi.fn(async () => ({
          data: { data: [] },
          response: new Response(null, { status: 200 }),
        })),
      },
    } as unknown as ToolContext["clients"],
    storage: {} as ToolContext["storage"],
    getEnv: () => (kv ? { USER_DATA_KV: kv } : {}) as Env,
    getSessionId: () => "session-1",
  };
}

function getWeeklyDealsHandler(): ToolHandler {
  const tool = capturedWeeklyDealsTools.find((t) => t.name === "get_weekly_deals");
  if (!tool) throw new Error("get_weekly_deals not captured");
  return tool.handler;
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
  });

  // Defaults that match the tool's inputSchema defaults (Zod defaults bypass raw handler calls)
  const DEFAULT_ARGS = { limit: 50, pageLimit: 2 };

  it("returns cached deals without calling the API when a fresh KV cache entry exists", async () => {
    const cachedData = makeMinimalDealsResponse({
      deals: [{ id: "cached", title: "Cached Deal", price: "$1.00", source: "print" }],
    });
    const { kv, store } = makeKV();
    const cacheKey = buildWeeklyDealsCacheKey({ ...DEFAULT_ARGS });
    store.set(cacheKey, JSON.stringify(makeFreshCacheEntry(cachedData)));

    registerWeeklyDealsTools(makeWeeklyDealsContext(kv));

    const result = await getWeeklyDealsHandler()(DEFAULT_ARGS);

    expect(mockGetQfcWeeklyDeals).not.toHaveBeenCalled();
    expect(textFromResult(result)).toContain("Cached Deal");
    expect(textFromResult(result)).toContain("Served from KV cache.");
  });

  it("fetches live data and writes it to KV cache on a cache miss", async () => {
    const liveData = makeMinimalDealsResponse();
    mockGetQfcWeeklyDeals.mockResolvedValue(liveData);
    const { kv, store } = makeKV();

    registerWeeklyDealsTools(makeWeeklyDealsContext(kv));

    const result = await getWeeklyDealsHandler()(DEFAULT_ARGS);

    expect(mockGetQfcWeeklyDeals).toHaveBeenCalledOnce();
    expect(textFromResult(result)).toContain("Bananas");
    expect(store.size).toBe(1);
  });

  it("serves stale cache with a warning when live fetch fails and a stale entry exists", async () => {
    const staleData = makeMinimalDealsResponse({
      deals: [{ id: "s1", title: "Stale Deal", price: "$2.00", source: "print" }],
    });
    const { kv, store } = makeKV();
    const cacheKey = buildWeeklyDealsCacheKey({ ...DEFAULT_ARGS });
    store.set(cacheKey, JSON.stringify(makeStaleCacheEntry(staleData)));

    mockGetQfcWeeklyDeals.mockRejectedValue(new Error("network timeout"));

    registerWeeklyDealsTools(makeWeeklyDealsContext(kv));

    const result = await getWeeklyDealsHandler()(DEFAULT_ARGS);

    expect(isErrorResult(result)).toBe(false);
    expect(textFromResult(result)).toContain("Stale Deal");
    expect(textFromResult(result)).toContain("stale");
  });

  it("returns an MCP error when the live fetch fails and there is no stale cache", async () => {
    mockGetQfcWeeklyDeals.mockRejectedValue(new Error("connection refused"));
    const { kv } = makeKV();

    registerWeeklyDealsTools(makeWeeklyDealsContext(kv));

    const result = await getWeeklyDealsHandler()(DEFAULT_ARGS);

    expect(isErrorResult(result)).toBe(true);
  });

  it("fetches live data without caching when no USER_DATA_KV binding is present in env", async () => {
    const liveData = makeMinimalDealsResponse();
    mockGetQfcWeeklyDeals.mockResolvedValue(liveData);

    registerWeeklyDealsTools(makeWeeklyDealsContext(null));

    const result = await getWeeklyDealsHandler()(DEFAULT_ARGS);

    expect(mockGetQfcWeeklyDeals).toHaveBeenCalledOnce();
    expect(textFromResult(result)).toContain("Bananas");
    expect(isErrorResult(result)).toBe(false);
  });

  it("passes locationId to the cache key and to getQfcWeeklyDeals", async () => {
    const liveData = makeMinimalDealsResponse({ locationId: "12345678" });
    mockGetQfcWeeklyDeals.mockResolvedValue(liveData);
    const { kv, store } = makeKV();

    registerWeeklyDealsTools(makeWeeklyDealsContext(kv));

    await getWeeklyDealsHandler()({ locationId: "12345678", ...DEFAULT_ARGS });

    expect(mockGetQfcWeeklyDeals).toHaveBeenCalledWith(
      expect.objectContaining({ locationId: "12345678" }),
    );
    expect([...store.keys()][0]).toContain("loc:12345678");
  });

  it("returns structuredContent with _view: get_weekly_deals and cache state 'miss' on fresh fetch", async () => {
    const liveData = makeMinimalDealsResponse();
    mockGetQfcWeeklyDeals.mockResolvedValue(liveData);
    const { kv } = makeKV();

    registerWeeklyDealsTools(makeWeeklyDealsContext(kv));

    const result = await getWeeklyDealsHandler()(DEFAULT_ARGS);

    const sc = (result as { structuredContent?: { _view: string; cache: { state: string } } })
      .structuredContent;
    expect(sc?._view).toBe("get_weekly_deals");
    expect(sc?.cache.state).toBe("miss");
  });
});
