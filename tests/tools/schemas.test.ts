import { describe, expect, it } from "vitest";

import { modalityEnum, quantitySchema, storeIdSchema, upcSchema } from "../../src/tools/schemas.js";

describe("upcSchema", () => {
  it("accepts a 13-digit UPC unchanged", () => {
    expect(upcSchema.parse("0001111041700")).toBe("0001111041700");
  });

  it("left-pads a 10-digit UPC to 13 digits", () => {
    expect(upcSchema.parse("1111041700")).toBe("0001111041700");
  });

  it("left-pads a single digit to 13 digits", () => {
    expect(upcSchema.parse("7")).toBe("0000000000007");
  });

  it("trims surrounding whitespace before validating", () => {
    expect(upcSchema.parse("  1111041700  ")).toBe("0001111041700");
  });

  it("rejects a UPC containing letters", () => {
    const result = upcSchema.safeParse("abc1111041700");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("UPC must be up to 13 digits");
      expect(result.error.issues[0]?.message).toContain("search_products");
    }
  });

  it("rejects a UPC longer than 13 digits", () => {
    expect(upcSchema.safeParse("00011110417001").success).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(upcSchema.safeParse("").success).toBe(false);
  });
});

describe("storeIdSchema", () => {
  it("accepts an 8-character storeId", () => {
    expect(storeIdSchema.parse("70500034")).toBe("70500034");
  });

  it("trims whitespace before validating length", () => {
    expect(storeIdSchema.parse("  70500034  ")).toBe("70500034");
  });

  it("rejects a storeId shorter than 8 characters", () => {
    const result = storeIdSchema.safeParse("7050003");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("8-character storeId");
      expect(result.error.issues[0]?.message).toContain("search_stores");
    }
  });

  it("rejects a storeId longer than 8 characters", () => {
    expect(storeIdSchema.safeParse("705000345").success).toBe(false);
  });
});

describe("quantitySchema", () => {
  it("coerces a numeric string into a number", () => {
    expect(quantitySchema(1, 999).parse("5")).toBe(5);
  });

  it("accepts a number within bounds", () => {
    expect(quantitySchema(1, 10).parse(3)).toBe(3);
  });

  it("rejects a value below the minimum", () => {
    expect(quantitySchema(1, 10).safeParse(0).success).toBe(false);
  });

  it("rejects a value above the maximum", () => {
    expect(quantitySchema(1, 10).safeParse(11).success).toBe(false);
  });
});

describe("modalityEnum", () => {
  it("accepts uppercase PICKUP and DELIVERY", () => {
    expect(modalityEnum.parse("PICKUP")).toBe("PICKUP");
    expect(modalityEnum.parse("DELIVERY")).toBe("DELIVERY");
  });

  it("upcases lowercase input before validating", () => {
    expect(modalityEnum.parse("pickup")).toBe("PICKUP");
    expect(modalityEnum.parse("delivery")).toBe("DELIVERY");
  });

  it("upcases mixed-case input before validating", () => {
    expect(modalityEnum.parse("PickUp")).toBe("PICKUP");
  });

  it("rejects an unknown modality value", () => {
    expect(modalityEnum.safeParse("SHIP").success).toBe(false);
  });
});
