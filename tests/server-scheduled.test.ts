import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppEnv } from "../src/env.js";

import worker, { oauthProvider } from "../src/server.js";

describe("scheduled OAuth cleanup", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("purges expired OAuth KV records in bounded batches", async () => {
    const purge = vi.spyOn(oauthProvider, "purgeExpiredData").mockResolvedValue({
      grantsChecked: 2,
      grantsPurged: 1,
      tokensChecked: 3,
      tokensPurged: 1,
      done: true,
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    const scheduled = worker.scheduled;
    if (!scheduled) throw new Error("Missing scheduled handler");

    await scheduled(
      {
        cron: "0 2 * * *",
        noRetry: vi.fn(),
        scheduledTime: Date.now(),
      },
      env as AppEnv,
    );

    expect(purge).toHaveBeenCalledWith(env, { batchSize: 100 });
  });
});
