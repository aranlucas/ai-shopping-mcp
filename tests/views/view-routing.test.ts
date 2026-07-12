import { describe, expect, it } from "vitest";

import { APP_VIEW_NAMES, appResult, parseAppResult } from "../../src/app-results.js";

describe("MCP App view routing", () => {
  it("routes from namespaced result metadata without exposing _view on the wire", () => {
    const result = parseAppResult({
      content: [],
      _meta: { "dev.aranlucas/view": "search_products" },
      structuredContent: { results: [], totalProducts: 0 },
    });

    expect(result).toEqual({ view: "search_products", results: [], totalProducts: 0 });
  });

  it("does not accept the removed structuredContent _view convention", () => {
    expect(
      parseAppResult({
        content: [],
        structuredContent: { _view: "search_products", results: [], totalProducts: 0 },
      }),
    ).toBeNull();
  });

  it("routes the preferred-store mutation result", () => {
    const result = parseAppResult({
      content: [],
      ...appResult("set_preferred_store", {
        store: {
          locationId: "70500847",
          locationName: "QFC Broadway",
          address: "500 Broadway E, Seattle, WA 98102",
          chain: "QFC",
          setAt: "2026-07-12T12:00:00.000Z",
        },
        actionDetail: "Preferred store set to QFC Broadway",
      }),
    });

    expect(result).toMatchObject({
      view: "set_preferred_store",
      store: { locationId: "70500847", locationName: "QFC Broadway" },
    });
  });

  it("keeps every contract view name unique", () => {
    const names = Object.keys(APP_VIEW_NAMES);
    expect(new Set(names).size).toBe(names.length);
  });
});
