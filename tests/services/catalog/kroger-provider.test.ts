import { describe, expect, it } from "vitest";

import type { components as ProductComponents } from "../../../src/services/kroger/product.js";

import { toCatalogProduct } from "../../../src/services/catalog/kroger-provider.js";

type Product = ProductComponents["schemas"]["products.productModel"];
type Inventory =
  ProductComponents["schemas"]["products.productItemInventoryModel"];

describe("toCatalogProduct", () => {
  it.each<{ stockLevel: Inventory["stockLevel"]; available: boolean }>([
    { stockLevel: "HIGH", available: true },
    { stockLevel: "LOW", available: true },
    { stockLevel: "TEMPORARILY_OUT_OF_STOCK", available: false },
    { stockLevel: undefined, available: true },
  ])(
    "reports $stockLevel stock as available=$available",
    ({ stockLevel, available }) => {
      const product = toCatalogProduct({
        items: [{ inventory: { stockLevel }, fulfillment: { instore: true } }],
      });

      expect(product.available).toBe(available);
    },
  );

  it.each([
    { fulfillment: { instore: true }, pickup: false },
    { fulfillment: { curbside: false, instore: true }, pickup: false },
    { fulfillment: { curbside: true, instore: false }, pickup: true },
    { fulfillment: undefined, pickup: false },
  ])(
    "requires curbside fulfillment for pickup: $fulfillment",
    ({ fulfillment, pickup }) => {
      expect(toCatalogProduct({ items: [{ fulfillment }] }).pickup).toBe(
        pickup,
      );
    },
  );

  it.each([
    {
      price: { regular: 4, promo: 3 },
      expected: { price: 3, regularPrice: 4 },
    },
    { price: { regular: 4, promo: 0 }, expected: { price: 4 } },
    { price: { regular: 4, promo: 4 }, expected: { price: 4 } },
    { price: { regular: 4 }, expected: { price: 4 } },
    { price: { promo: 3 }, expected: { price: 3 } },
    { price: undefined, expected: {} },
  ])("preserves current and sale prices for $price", ({ price, expected }) => {
    const product = toCatalogProduct({ items: [{ price }] });

    expect({
      price: product.price,
      regularPrice: product.regularPrice,
    }).toEqual(expected);
  });

  it("prefers the default image and thumbnail regardless of response order", () => {
    const images: Product["images"] = [
      {
        perspective: "front",
        sizes: [{ url: "https://example.com/front.jpg" }],
      },
      {
        default: true,
        sizes: [
          { size: "small", url: "https://example.com/small.jpg" },
          { size: "thumbnail", url: "https://example.com/thumbnail.jpg" },
        ],
      },
    ];

    expect(toCatalogProduct({ images }).imageUrl).toBe(
      "https://example.com/thumbnail.jpg",
    );
    expect(toCatalogProduct({ images: images.toReversed() }).imageUrl).toBe(
      "https://example.com/thumbnail.jpg",
    );
  });

  it("skips unusable images and sizes when choosing a front image", () => {
    const product = toCatalogProduct({
      images: [
        { default: true, sizes: [{ size: "thumbnail", url: "" }] },
        {
          perspective: "back",
          sizes: [{ url: "https://example.com/back.jpg" }],
        },
        {
          perspective: "front",
          sizes: [
            { size: "thumbnail" },
            { size: "small", url: "https://example.com/front.jpg" },
          ],
        },
      ],
    });

    expect(product.imageUrl).toBe("https://example.com/front.jpg");
  });

  it("uses another usable image when no default or front image is present", () => {
    const product = toCatalogProduct({
      images: [
        { perspective: "back" },
        {
          perspective: "left",
          sizes: [{}, { size: "large", url: "https://example.com/left.jpg" }],
        },
      ],
    });

    expect(product.imageUrl).toBe("https://example.com/left.jpg");
  });

  it("projects only catalog aisle fields and preserves leading zeros in identity", () => {
    const product = toCatalogProduct({
      upc: "0001111041700",
      description: "Milk",
      aisleLocations: [{ number: "10", numberOfFacings: "5", side: "L" }],
    });

    expect(product.ref).toEqual({ provider: "kroger", id: "0001111041700" });
    expect(product.aisle).toEqual({ number: "10", side: "L" });
    expect(product.aisle).not.toHaveProperty("numberOfFacings");
  });

  it("omits missing optional fields from the serialized catalog response", () => {
    const product = toCatalogProduct({
      upc: "123",
      images: [{ sizes: [{}] }],
    });

    expect(JSON.parse(JSON.stringify(product))).toEqual({
      ref: { provider: "kroger", id: "123" },
      name: "Unknown product",
      available: true,
      pickup: false,
    });
  });
});
