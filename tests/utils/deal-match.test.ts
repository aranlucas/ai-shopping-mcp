import { describe, expect, it } from "vitest";

import type { Deal } from "../../src/utils/deal-match.js";

import { findDealForItem } from "../../src/utils/deal-match.js";

function makeDeal(overrides: Partial<Deal> = {}): Deal {
  return {
    id: "deal-1",
    title: "Deal",
    source: "print",
    ...overrides,
  };
}

describe("findDealForItem", () => {
  it("matches when every item token appears in a messy deal title", () => {
    const deals = [
      makeDeal({
        id: "d1",
        title: "Kroger Boneless Skinless Chicken Breasts, Value Pack, Family Size",
      }),
    ];

    expect(findDealForItem("chicken breast", deals)?.id).toBe("d1");
  });

  it("is case-insensitive and strips punctuation", () => {
    const deals = [makeDeal({ id: "d1", title: "GROUND BEEF, 80% Lean - Value Pack!" })];

    expect(findDealForItem("Ground Beef", deals)?.id).toBe("d1");
  });

  it("matches on overlap ratio when not every token is present", () => {
    // "whole milk gallon" -> 2/3 tokens ("milk", "gallon") appear -> ratio 0.667 >= 0.6
    const deals = [makeDeal({ id: "d1", title: "Kroger Milk, Gallon" })];

    expect(findDealForItem("whole milk gallon", deals)?.id).toBe("d1");
  });

  it("does not match when overlap ratio is below the threshold", () => {
    // Only "milk" (1/3) overlaps -> ratio 0.33 < 0.6
    const deals = [makeDeal({ id: "d1", title: "Milk Chocolate Bar" })];

    expect(findDealForItem("whole milk gallon", deals)).toBeUndefined();
  });

  it("returns undefined when no deals are provided", () => {
    expect(findDealForItem("milk", [])).toBeUndefined();
  });

  it("returns undefined when the item name has no usable tokens", () => {
    const deals = [makeDeal({ title: "Milk" })];
    expect(findDealForItem("!!!", deals)).toBeUndefined();
  });

  it("skips deals whose title has no usable tokens", () => {
    const deals = [makeDeal({ title: "###" }), makeDeal({ id: "d2", title: "Whole Milk Gallon" })];
    expect(findDealForItem("milk", deals)?.id).toBe("d2");
  });

  it("cheaply singularizes trailing s on longer words", () => {
    // "eggs" -> "egg" (len 4 > 3); deal title "Grade A Large Eggs" -> "egg" too
    const deals = [makeDeal({ id: "d1", title: "Grade A Large Eggs, Dozen" })];
    expect(findDealForItem("eggs", deals)?.id).toBe("d1");
  });

  it("returns the highest-overlap match when multiple deals qualify", () => {
    const deals = [
      makeDeal({ id: "partial", title: "Whole Wheat Bread" }),
      makeDeal({ id: "best", title: "Kroger Whole Milk, Gallon" }),
    ];

    // "whole milk" fully matches "best" (2/2) but only partially matches
    // "partial" (1/2, below threshold) — best wins.
    expect(findDealForItem("whole milk", deals)?.id).toBe("best");
  });

  it("does not match unrelated deal titles", () => {
    const deals = [makeDeal({ title: "Frozen Pizza, Family Size" })];
    expect(findDealForItem("whole milk", deals)).toBeUndefined();
  });
});
