import { describe, expect, it } from "vitest";
import { encode } from "@toon-format/toon";
import { apiError, networkError, storageError } from "../src/errors.js";
import { toonResource } from "../src/utils/toon.js";

describe("opaque infrastructure contracts", () => {
  it("retains arbitrary error objects and arrays by identity", () => {
    const object = { future: { nested: [null, "value"] } };
    const array = [object, new Error("nested")];

    for (const cause of [object, array, new Date("2026-01-01")]) {
      expect(apiError("api", cause).detail).toBe(cause);
      expect(networkError("network", cause).cause).toBe(cause);
      expect(storageError("storage", cause).cause).toBe(cause);
    }

    for (const cause of [42, false, 123n, Symbol("cause")]) {
      expect(networkError("network", cause).cause).toBe(String(cause));
    }

    expect(networkError("network", null).cause).toBeUndefined();
    expect(Object.hasOwn(apiError("api"), "detail")).toBe(true);
    expect(Object.hasOwn(apiError("api"), "status")).toBe(true);
  });

  it("delegates arbitrary TOON input values without normalization", () => {
    for (const value of [
      null,
      undefined,
      false,
      42,
      "text",
      [1, { extra: true }],
      { omitted: undefined, explicit: null, future: ["v"] },
    ]) {
      expect(toonResource("shopping://synthetic", value).contents[0].text).toBe(encode(value));
    }
  });
});
