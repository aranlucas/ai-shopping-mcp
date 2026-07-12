import { describe, expect, it } from "vitest";

import { parseToolResult } from "../../views/shared/types.js";

describe("MCP App view routing", () => {
  it("routes from namespaced result metadata without exposing _view on the wire", () => {
    const result = parseToolResult({
      content: [],
      _meta: { "dev.aranlucas/view": "search_products" },
      structuredContent: { results: [], totalProducts: 0 },
    });

    expect(result).toEqual({ _view: "search_products", results: [], totalProducts: 0 });
  });

  it("does not accept the removed structuredContent _view convention", () => {
    expect(
      parseToolResult({
        content: [],
        structuredContent: { _view: "search_products", results: [], totalProducts: 0 },
      }),
    ).toBeNull();
  });
});
