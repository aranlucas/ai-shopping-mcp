import { describe, expect, it } from "vitest";
import {
  normalizeProductIdentity,
  productReferenceSchema,
  productReferenceInputSchema,
} from "../src/domain/product-identity.js";
import { parseAppResult } from "../src/app-results.js";

describe("Kroger product identity compatibility", () => {
  it("does not fall back to a legacy UPC when an explicit foreign product is present", () => {
    const product = { provider: "another_store", id: "milk" };
    const normalized = normalizeProductIdentity({
      product,
      upc: "0001111042578",
    });
    expect(normalized).toBeUndefined();
  });

  it("converts legacy-only records at the boundary", () => {
    expect(normalizeProductIdentity({ upc: "1" })).toBe("0000000000001");
    expect(normalizeProductIdentity({})).toBeUndefined();
  });

  it("keeps generic wire references local while accepting only legacy Kroger UPC refs", () => {
    expect(
      productReferenceSchema.parse({
        provider: "store",
        id: "item:variant",
      }),
    ).toEqual({
      provider: "store",
      id: "item:variant",
    });
    expect(productReferenceInputSchema.parse(" kroger:1 ")).toBe(
      "0000000000001",
    );
    expect(
      productReferenceInputSchema.safeParse("store:item:variant").success,
    ).toBe(false);
  });

  it("normalizes legacy app payloads without leaking UPC fallback to views", () => {
    const parsed = parseAppResult({
      content: [],
      _meta: { "dev.aranlucas/view": "create_shopping_list" },
      structuredContent: {
        listId: "list",
        name: "Dinner",
        items: [
          {
            productName: "Milk",
            quantity: 1,
            product: { provider: "another_store", id: "milk" },
            upc: "0001111042578",
          },
        ],
      },
    });
    if (parsed?.view !== "create_shopping_list")
      throw new Error("Expected list view");
    expect(parsed.items[0]).not.toHaveProperty("product");
    expect(parsed.items[0]).not.toHaveProperty("upc");
  });
});
