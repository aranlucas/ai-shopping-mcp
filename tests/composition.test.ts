import { asValue } from "awilix/browser";
import { describe, expect, it } from "vitest";

import type { AppEnv } from "../src/env.js";
import { createRequestContainer } from "../src/composition.js";
import { createWeeklyDealsCache } from "../src/services/weekly-deals/cache.js";

function makeContainer() {
  return createRequestContainer(
    {} as AppEnv,
    {} as Parameters<typeof createRequestContainer>[1],
  );
}

describe("request composition", () => {
  it("keeps auth and cache resolution lazy until a dependent service is used", () => {
    const container = makeContainer();

    expect(container.resolve("server")).toBeDefined();
    expect(container.resolve("weeklyDealsCache")).toBeDefined();
  });

  it("scopes cache adapters to a request and permits explicit test overrides", () => {
    const first = makeContainer();
    const second = makeContainer();

    const firstCache = first.resolve("weeklyDealsCache");
    expect(first.resolve("weeklyDealsCache")).toBe(firstCache);
    const secondCache = second.resolve("weeklyDealsCache");
    expect(firstCache).not.toBe(secondCache);

    const override = createWeeklyDealsCache(null);
    first.register({ weeklyDealsCache: asValue(override) });
    expect(first.resolve("weeklyDealsCache")).toBe(override);
  });
});
