import { memoryKv } from "../../memory-kv.js";
import { describe, expect, it, vi } from "vitest";

import type { QfcDealsApiResponse } from "../../../src/services/weekly-deals/schema.js";
import {
  buildWeeklyDealsCacheKey,
  createWeeklyDealsCache,
} from "../../../src/services/weekly-deals/cache.js";

const weeklyDeals: QfcDealsApiResponse = {
  sourceMode: "search_api",
  locationId: "70500847",
  divisionCode: "705",
  warnings: [],
  deals: [],
};

describe("createWeeklyDealsCache", () => {
  it("turns an absent KV binding into a miss and a no-op write", async () => {
    const cache = createWeeklyDealsCache(null);

    const read = await cache.read("weekly-deals");
    const write = await cache.write("weekly-deals", weeklyDeals);

    expect(read._unsafeUnwrap()).toEqual({ kind: "miss" });
    expect(write.isOk()).toBe(true);
  });

  it("adapts KV reads and writes while preserving the cache freshness policy", async () => {
    const values = new Map<string, string>();

    const kv = memoryKv(values);
    vi.spyOn(kv, "get");
    vi.spyOn(kv, "put");

    const cache = createWeeklyDealsCache(kv);

    const key = buildWeeklyDealsCacheKey({
      locationId: weeklyDeals.locationId,
      limit: 50,
      pageLimit: 2,
    });

    const write = await cache.write(key, weeklyDeals);
    const read = await cache.read(key);

    expect(write.isOk()).toBe(true);
    expect(read._unsafeUnwrap()).toMatchObject({
      kind: "fresh",
      entry: { data: weeklyDeals },
    });
    expect(kv.put).toHaveBeenCalledTimes(1);
    expect(kv.get).toHaveBeenCalledWith(key);
  });

  it("treats malformed values as misses at the adapter boundary", async () => {
    const kv = memoryKv(new Map([["bad-entry", "not-json"]]));

    const result = await createWeeklyDealsCache(kv).read("bad-entry");

    expect(result._unsafeUnwrap()).toEqual({ kind: "miss" });
  });
});
