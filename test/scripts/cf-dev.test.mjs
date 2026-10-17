import { URL } from "node:url";
import { describe, expect, it } from "vitest";
import { startCfWorker } from "../../scripts/cf-dev.mjs";

describe("cf evaluation Worker", () => {
  it("serves requests through cf dev and stops its server", async () => {
    const worker = await startCfWorker(new URL("./fixtures/cf-dev-worker.ts", import.meta.url), {
      remoteAi: false,
    });

    try {
      const response = await worker.fetch("http://localhost/probe?diagnostics=1", {
        method: "POST",
        body: "evaluation payload",
      });

      expect(response.ok).toBe(true);
      await expect(response.json()).resolves.toEqual({
        method: "POST",
        path: "/probe",
        query: "?diagnostics=1",
        body: "evaluation payload",
      });
    } finally {
      await worker.stop();
    }

    await expect(worker.fetch("http://localhost/")).rejects.toThrow("fetch failed");
  }, 30_000);

  it("reports startup errors and cleans up a failed server", async () => {
    await expect(
      startCfWorker(new URL("./fixtures/missing-worker.ts", import.meta.url), { remoteAi: false }),
    ).rejects.toThrow(/cf dev exited.*before becoming ready/s);
  }, 30_000);
});
