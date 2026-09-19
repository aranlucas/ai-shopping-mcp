import { describe, expect, it } from "vitest";
import { networkError } from "../../src/errors.js";
import {
  classifyShoppingItem,
  summarizeShoppingOutcomes,
} from "../../src/services/shopping-outcomes.js";
import type { ProductSearchResult } from "../../src/services/kroger/search.js";
import type { ProductSelection } from "../../src/services/product-selector.js";

const request = { requestId: "item_0", name: "Milk", quantity: 2 };
const product = { upc: "0001111041700", description: "Whole Milk" };
const search: ProductSearchResult = {
  requestId: "item_0",
  term: "Milk",
  status: "success",
  products: [product],
};
const selected: ProductSelection = {
  requestId: "item_0",
  status: "selected",
  product,
};

describe("shopping item outcomes", () => {
  it("carries the requested quantity and selected product into matches", () => {
    expect(classifyShoppingItem(request, search, selected)).toEqual({
      kind: "matched",
      request,
      product,
    });
  });

  it("preserves a failed search even if selection data is inconsistent", () => {
    const error = networkError("Timed out");
    expect(
      classifyShoppingItem(
        request,
        {
          requestId: request.requestId,
          term: request.name,
          status: "failed",
          error,
        },
        selected,
      ),
    ).toEqual({ kind: "failed", request, error });
  });

  it("rejects a search result for a different request", () => {
    expect(() =>
      classifyShoppingItem(
        request,
        { ...search, requestId: "item_9" },
        selected,
      ),
    ).toThrow("does not match request item_0");
  });

  it("preserves the mandatory upstream failure error", () => {
    expect(
      classifyShoppingItem(
        request,
        {
          requestId: request.requestId,
          term: request.name,
          status: "failed",
          error: networkError("Search failed"),
        },
        undefined,
      ),
    ).toMatchObject({ kind: "failed", error: { type: "NETWORK_ERROR" } });
  });

  it.each([
    { products: [], kind: "not_found" },
    { products: [product], kind: "needs_review" },
  ])("classifies unselected items as $kind", ({ products, kind }) => {
    expect(
      classifyShoppingItem(
        request,
        { ...search, products, status: "success" },
        { requestId: request.requestId, status: "unresolved" },
      ),
    ).toMatchObject({ kind, request });
  });

  it("summarizes partial results without losing provenance or mixing them into the list", () => {
    const summary = summarizeShoppingOutcomes([
      { kind: "matched", request, product },
      {
        kind: "failed",
        request: { requestId: "item_1", name: "Eggs", quantity: 1 },
        error: networkError("Timed out"),
      },
      {
        kind: "not_found",
        request: { requestId: "item_2", name: "Bread", quantity: 1 },
      },
      {
        kind: "needs_review",
        request: { requestId: "item_3", name: "Butter", quantity: 1 },
      },
    ])._unsafeUnwrap();
    expect(summary.matched).toEqual([{ kind: "matched", request, product }]);
    expect(summary.warnings.join("\n")).toContain("No results for: Bread.");
    expect(summary.warnings.join("\n")).toContain(
      "Eggs: NETWORK_ERROR: Timed out (recovery: retry_later)",
    );
    expect(summary.warnings.join("\n")).toContain(
      "No suitable match for: Butter.",
    );
  });

  it("returns the original failure when nothing matched", () => {
    const error = networkError("Timed out");
    expect(
      summarizeShoppingOutcomes([
        { kind: "not_found", request },
        { kind: "failed", request, error },
      ])._unsafeUnwrapErr(),
    ).toBe(error);
  });

  it("returns no warnings for a completely matched list", () => {
    expect(
      summarizeShoppingOutcomes([
        { kind: "matched", request, product },
      ])._unsafeUnwrap().warnings,
    ).toEqual([]);
  });
});
