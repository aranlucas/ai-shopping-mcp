import { describe, expect, it } from "vitest";
import { memoryKv } from "./memory-kv.js";

describe("memory KV adapter", () => {
  it("retains its receiver when methods are captured for mocks or callbacks", async () => {
    const kv = memoryKv();
    const { get, put, delete: remove, list } = kv;
    await put("key", "value");
    expect(await get("key")).toBe("value");
    expect((await list()).keys).toEqual([{ name: "key" }]);
    await remove("key");
    expect(await get("key")).toBeNull();
  });
});
