import { describe, expect, it } from "vitest";

import type { components as ProductComponents } from "../../../src/services/kroger/product.js";

import {
  toProductData,
  toProductPageUrl,
} from "../../../src/services/kroger/product-data.js";

type Product = ProductComponents["schemas"]["products.productModel"];
type Inventory =
  ProductComponents["schemas"]["products.productItemInventoryModel"];

describe("toProductData", () => {
  it.each<{ stockLevel: Inventory["stockLevel"]; available: boolean }>([
    { stockLevel: "HIGH", available: true },
    { stockLevel: "LOW", available: true },
    { stockLevel: "TEMPORARILY_OUT_OF_STOCK", available: false },
    { stockLevel: undefined, available: true },
  ])(
    "reports $stockLevel stock as available=$available",
    ({ stockLevel, available }) => {
      const product = toProductData({
        upc: "0001111041700",
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
      expect(
        toProductData({ upc: "0001111041700", items: [{ fulfillment }] })
          .pickup,
      ).toBe(pickup);
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
    const product = toProductData({
      upc: "0001111041700",
      items: [{ price }],
    });

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

    expect(toProductData({ upc: "0001111041700", images }).imageUrl).toBe(
      "https://example.com/thumbnail.jpg",
    );
    expect(
      toProductData({ upc: "0001111041700", images: images.toReversed() })
        .imageUrl,
    ).toBe("https://example.com/thumbnail.jpg");
  });

  it("skips unusable images and sizes when choosing a front image", () => {
    const product = toProductData({
      upc: "0001111041700",
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
    const product = toProductData({
      upc: "0001111041700",
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

  it("projects the UPC and optional aisle fields while preserving leading zeros", () => {
    const raw = {
      upc: "0001111041700",
      description: "Milk",
      aisleLocations: [{ number: "10", numberOfFacings: "5", side: "L" }],
    };

    expect(toProductData(raw, true)).toMatchObject({
      upc: "0001111041700",
      name: "Milk",
      aisle: { number: "10", side: "L" },
    });
    expect(toProductData(raw, true).aisle).not.toHaveProperty(
      "numberOfFacings",
    );
    expect(toProductData(raw).aisle).toBeUndefined();
  });

  it("omits missing optional fields from the serialized Kroger response", () => {
    const product = toProductData({
      upc: "123",
      images: [{ sizes: [{}] }],
    });

    expect(JSON.parse(JSON.stringify(product))).toEqual({
      upc: "123",
      name: "Unknown product",
      available: true,
      pickup: false,
    });
  });

  it("builds a kroger.com product link without tracking parameters", () => {
    expect(
      toProductData({
        upc: "0001111041700",
        productPageURI:
          "/p/kroger-2-reduced-fat-milk/0001111041700?cid=dis.api.tpi",
      }).url,
    ).toBe("https://www.kroger.com/p/kroger-2-reduced-fat-milk/0001111041700");
  });

  it.each([
    undefined,
    "",
    "p/relative",
    "//evil.example/p/x",
    "https://evil.example/p/x",
    "javascript:alert(1)",
  ])("rejects a product page path that leaves kroger.com: %s", (path) => {
    expect(toProductPageUrl(path)).toBeUndefined();
  });
});
