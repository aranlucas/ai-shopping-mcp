import { describe, expect, it } from "vitest";
import {
  normalizeProductIdentity,
  productReferenceInputSchema,
  krogerProductId,
} from "../src/domain/product-identity.js";
import { parseAppResult } from "../src/app-results.js";

describe("canonical product identity", () => {
  it("uses an explicit reference even when a conflicting legacy UPC is present", () => {
    const product = { provider: "another_store", id: "milk" };
    const normalized = normalizeProductIdentity({
      product,
      upc: "0001111042578",
    });
    expect(normalized).toEqual(product);
    expect(krogerProductId(normalized)).toBeUndefined();
  });

  it("converts legacy-only records at the boundary", () => {
    expect(normalizeProductIdentity({ upc: "0001111042578" })).toEqual({
      provider: "kroger",
      id: "0001111042578",
    });
    expect(normalizeProductIdentity({})).toBeUndefined();
  });

  it("decodes serialized references while retaining provider-scoped colons", () => {
    expect(productReferenceInputSchema.parse(" store:item:variant ")).toEqual({
      provider: "store",
      id: "item:variant",
    });
    expect(
      productReferenceInputSchema.safeParse("missing-provider").success,
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
    expect(parsed).toMatchObject({
      items: [{ product: { provider: "another_store", id: "milk" } }],
    });
    if (parsed?.view !== "create_shopping_list")
      throw new Error("Expected list view");
    expect(parsed.items[0]).not.toHaveProperty("upc");
  });
});
