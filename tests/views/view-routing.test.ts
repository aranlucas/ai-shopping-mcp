import { describe, expect, it } from "vitest";

import {
  APP_VIEW_NAMES,
  appPayloadSchemas,
  appResult,
  parseAppResult,
} from "../../src/app-results.js";

describe("MCP App view routing", () => {
  it("routes from namespaced result metadata without exposing _view on the wire", () => {
    const result = parseAppResult({
      content: [],
      _meta: { "dev.aranlucas/view": "search_products" },
      structuredContent: { results: [], totalProducts: 0 },
    });

    expect(result).toEqual({
      view: "search_products",
      results: [],
      totalProducts: 0,
    });
  });

  it("does not accept the removed structuredContent _view convention", () => {
    expect(
      parseAppResult({
        content: [],
        structuredContent: {
          _view: "search_products",
          results: [],
          totalProducts: 0,
        },
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
  it.each(Object.keys(appPayloadSchemas))(
    "rejects a missing payload for %s",
    (view) => {
      expect(
        parseAppResult({
          content: [],
          _meta: { "dev.aranlucas/view": view },
          structuredContent: {},
        }),
      ).toBeNull();
    },
  );

  it.each([
    { results: null, totalProducts: 0 },
    { results: {}, totalProducts: 0 },
    {
      results: [{ term: "milk", failed: false, products: [{}] }],
      totalProducts: 1,
    },
    { results: [], totalProducts: "zero" },
  ])("rejects malformed nested product results %j", (payload) => {
    expect(
      parseAppResult({
        content: [],
        _meta: { "dev.aranlucas/view": "search_products" },
        structuredContent: payload,
      }),
    ).toBeNull();
  });

  it("validates nested list items and preserves editing identifiers", () => {
    const result = {
      content: [],
      ...appResult("create_shopping_list", {
        listId: "list-1",
        name: "Groceries",
        items: [
          { id: "item-1", checked: true, productName: "Milk", quantity: 2 },
        ],
      }),
    };
    expect(parseAppResult(result)).toMatchObject({
      items: [{ id: "item-1", checked: true }],
    });
    expect(
      parseAppResult({
        ...result,
        structuredContent: {
          ...result.structuredContent,
          items: [{ productName: "Milk", quantity: "two" }],
        },
      }),
    ).toBeNull();
  });

  it("uses trusted routing metadata even if the payload includes a view", () => {
    expect(
      parseAppResult({
        content: [],
        _meta: { "dev.aranlucas/view": "search_products" },
        structuredContent: { view: "pantry", results: [], totalProducts: 0 },
      }),
    ).toEqual({ view: "search_products", results: [], totalProducts: 0 });
  });
  it.each([
    ["get_weekly_deals", { deals: [{ title: "Milk", category: "Dairy" }] }],
    ["search_stores", { stores: [{}] }],
    ["get_store", { store: {} }],
    [
      "set_preferred_store",
      {
        store: {
          locationId: "1",
          locationName: "QFC",
          address: "",
          chain: "QFC",
          setAt: "2026-09-18",
        },
        actionDetail: "Saved",
      },
    ],
    [
      "search_products",
      {
        results: [
          {
            term: "milk",
            products: [
              {
                upc: "0000000000001",
                name: "Milk",
                available: true,
              },
            ],
            failed: false,
          },
        ],
        totalProducts: 1,
      },
    ],
    [
      "get_product",
      {
        product: {
          upc: "0000000000001",
          name: "Milk",
          available: true,
        },
      },
    ],
    ["pantry", { items: [{ productName: "Milk", quantity: 1 }] }],
    ["kitchen_equipment", { items: [{ equipmentName: "Oven" }] }],
    [
      "create_shopping_list",
      {
        listId: "1",
        name: "Groceries",
        items: [{ productName: "Milk", quantity: 1 }],
      },
    ],
    [
      "add_shopping_list_to_cart",
      {
        outcome: "added",
        addedCount: 1,
        requestedCount: 1,
        name: "Groceries",
        items: [{ upc: "1", quantity: 1, modality: "PICKUP" }],
        needsUpc: [],
      },
    ],
    [
      "record_order",
      {
        orderId: "1",
        items: [{ productName: "Milk", quantity: 1 }],
        totalItems: 1,
        placedAt: "2026-09-18",
      },
    ],
  ])(
    "accepts valid %s payloads including optional-field omissions",
    (view, payload) => {
      expect(
        parseAppResult({
          content: [],
          _meta: { "dev.aranlucas/view": view },
          structuredContent: payload,
        }),
      ).toEqual({ ...payload, view });
    },
  );

  it("normalizes a persisted Kroger product reference to its UPC", () => {
    expect(
      parseAppResult({
        content: [],
        _meta: { "dev.aranlucas/view": "get_product" },
        structuredContent: {
          product: {
            product: { provider: "kroger", id: "1" },
            name: "Milk",
            available: true,
          },
        },
      }),
    ).toEqual({
      view: "get_product",
      product: { upc: "0000000000001", name: "Milk", available: true },
    });
  });

  it("rejects a non-Kroger legacy identity even with a conflicting UPC", () => {
    expect(
      parseAppResult({
        content: [],
        _meta: { "dev.aranlucas/view": "get_product" },
        structuredContent: {
          product: {
            product: { provider: "other_store", id: "milk" },
            upc: "0000000000001",
            name: "Milk",
            available: true,
          },
        },
      }),
    ).toBeNull();
  });

  it("normalizes legacy list and order product references to optional UPCs", () => {
    const list = parseAppResult({
      content: [],
      _meta: { "dev.aranlucas/view": "create_shopping_list" },
      structuredContent: {
        listId: "1",
        name: "Groceries",
        items: [
          {
            productName: "Milk",
            product: { provider: "kroger", id: "1" },
            quantity: 1,
          },
        ],
      },
    });
    expect(list).toMatchObject({ items: [{ upc: "0000000000001" }] });

    const order = parseAppResult({
      content: [],
      _meta: { "dev.aranlucas/view": "record_order" },
      structuredContent: {
        orderId: "1",
        items: [
          {
            productName: "Milk",
            product: { provider: "kroger", id: "1" },
            quantity: 1,
          },
        ],
        totalItems: 1,
        placedAt: "2026-09-18",
      },
    });
    expect(order).toMatchObject({ items: [{ upc: "0000000000001" }] });

    const foreignList = parseAppResult({
      content: [],
      _meta: { "dev.aranlucas/view": "create_shopping_list" },
      structuredContent: {
        listId: "2",
        name: "Review",
        items: [
          {
            productName: "Milk",
            product: { provider: "other_store", id: "milk" },
            upc: "0000000000001",
            quantity: 1,
          },
        ],
      },
    });
    expect(foreignList).toMatchObject({
      items: [{ productName: "Milk", quantity: 1 }],
    });
    expect(foreignList).not.toMatchObject({
      items: [{ upc: "0000000000001" }],
    });
  });
});
