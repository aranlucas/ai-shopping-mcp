import { describe, expect, it } from "vitest";
import type { QfcDealsApiResponse } from "../../src/services/qfc-weekly-deals.js";
import type { WeeklyDealsCacheEntry } from "../../src/tools/weekly-deals.js";
import {
  addCacheWarning,
  buildWeeklyDealsCacheKey,
  formatWeeklyDealsToolResponse,
  getLatestCircularEndTime,
  parseCacheEntry,
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
  it("returns plain deals list when no dates and no warnings", async () => {
    const result = makeMinimalResult({
      deals: [{ id: "1", title: "Bananas", price: "$0.59/lb", source: "print" }],
    });
    const text = getTextContent(formatWeeklyDealsToolResponse(result, "miss"));
    expect(text).toBe("1. Bananas | $0.59/lb");
  });

  it("prepends valid date range when both printCircular dates are present", async () => {
    const result = makeMinimalResult({
      printCircular: makeCircular("2025-01-07T00:00:00Z", "2025-01-01T00:00:00Z"),
      deals: [{ id: "1", title: "Apples", price: "$1.99/lb", source: "print" }],
    });
    const text = getTextContent(formatWeeklyDealsToolResponse(result, "miss"));
    expect(text).toContain("Valid: 2025-01-01T00:00:00Z – 2025-01-07T00:00:00Z");
    expect(text).toContain("1. Apples | $1.99/lb");
  });

  it("prepends valid date range from shoppableCircular when no printCircular", async () => {
    const result = makeMinimalResult({
      shoppableCircular: makeCircular("2025-01-08T00:00:00Z", "2025-01-02T00:00:00Z"),
      deals: [{ id: "1", title: "Milk", price: "$3.49", source: "search_api" }],
    });
    const text = getTextContent(formatWeeklyDealsToolResponse(result, "miss"));
    expect(text).toContain("Valid: 2025-01-02T00:00:00Z – 2025-01-08T00:00:00Z");
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
    expect(text).toContain("Valid: 2025-01-01 – 2025-01-07");
  });

  it("omits date line when only one date is available", async () => {
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
    expect(text).not.toContain("Valid:");
  });

  it("includes warnings in header when present", async () => {
    const result = makeMinimalResult({
      warnings: ["Print-ad parsing failed", "Using fallback"],
      deals: [{ id: "1", title: "Chicken", price: "$4.99", source: "search_api" }],
    });
    const text = getTextContent(formatWeeklyDealsToolResponse(result, "miss"));
    expect(text).toContain("Warnings: Print-ad parsing failed | Using fallback");
  });

  it("includes both dates and warnings separated by newline", async () => {
    const result = makeMinimalResult({
      printCircular: makeCircular("2025-01-07T00:00:00Z", "2025-01-01T00:00:00Z"),
      warnings: ["Some warning"],
      deals: [{ id: "1", title: "Beef", price: "$5.99", source: "print" }],
    });
    const text = getTextContent(formatWeeklyDealsToolResponse(result, "miss"));
    const lines = text.split("\n");
    expect(lines[0]).toContain("Valid:");
    expect(lines[1]).toContain("Warnings:");
    expect(text).toContain("\n\n"); // blank line separates header from deals
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

  it("includes deal details and savings in compact format", async () => {
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
    expect(text).toBe("1. Ground Beef | 80% Lean | $3.99/lb (Save $2.00)");
  });

  it("shows 'See weekly ad' when deal has no price", async () => {
    const result = makeMinimalResult({
      deals: [{ id: "1", title: "Special Item", source: "print" }],
    });
    const text = getTextContent(formatWeeklyDealsToolResponse(result, "miss"));
    expect(text).toContain("See weekly ad");
  });

  it("returns empty deals message when no deals", async () => {
    const result = makeMinimalResult({ deals: [] });
    const text = getTextContent(formatWeeklyDealsToolResponse(result, "miss"));
    expect(text).toBe("No weekly deals found.");
  });
});
