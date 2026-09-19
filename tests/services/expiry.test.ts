import { describe, expect, it } from "vitest";

import { classifyExpiry } from "../../src/services/expiry.js";

const NOW = Date.parse("2026-09-18T12:00:00.000Z");

describe("classifyExpiry", () => {
  it.each([
    [undefined, { status: "none" }],
    ["not-a-date", { status: "invalid" }],
    ["2026-09-18T11:59:59.999Z", { status: "expired", daysUntil: -1 }],
    ["2026-09-18T12:00:00.000Z", { status: "today", daysUntil: 0 }],
    ["2026-09-19T12:00:00.000Z", { status: "soon", daysUntil: 1 }],
    ["2026-09-21T12:00:00.000Z", { status: "soon", daysUntil: 3 }],
    ["2026-09-22T12:00:00.000Z", { status: "ok", daysUntil: 4 }],
  ] as const)("classifies %s", (expiresAt, expected) => {
    expect(classifyExpiry(expiresAt, NOW)).toEqual(expected);
  });

  it("uses whole elapsed days for timestamps near a day boundary", () => {
    expect(classifyExpiry("2026-09-19T11:59:59.999Z", NOW)).toEqual({
      status: "today",
      daysUntil: 0,
    });
  });
});
