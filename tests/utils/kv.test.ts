import { describe, expect, it } from "vitest";

import { getUserDataKv, isKvLike } from "../../src/utils/kv.js";

function makeKv() {
  return {
    get: async () => null,
    put: async () => {},
  };
}

describe("isKvLike", () => {
  it("returns true for an object with get and put methods", () => {
    expect(isKvLike(makeKv())).toBe(true);
  });

  it("returns false for undefined", () => {
    expect(isKvLike(undefined)).toBe(false);
  });

  it("returns false for an object missing put", () => {
    expect(isKvLike({ get: async () => null })).toBe(false);
  });

  it("returns false for a non-object", () => {
    expect(isKvLike("not-an-object")).toBe(false);
  });
});

describe("getUserDataKv", () => {
  it("returns the KV binding when present and KV-shaped", () => {
    const kv = makeKv();
    const env = { USER_DATA_KV: kv } as unknown as Env;
    expect(getUserDataKv(env)).toBe(kv);
  });

  it("returns null when USER_DATA_KV is absent", () => {
    const env = {} as unknown as Env;
    expect(getUserDataKv(env)).toBeNull();
  });

  it("returns null when USER_DATA_KV is not KV-shaped", () => {
    const env = { USER_DATA_KV: "not-kv" } as unknown as Env;
    expect(getUserDataKv(env)).toBeNull();
  });
});
