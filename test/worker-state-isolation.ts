import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { krogerToken } from "@/services/kroger-token.js";

// Both test files deliberately reuse these identities to detect leaked storage.
const identity = "cross-file-cleanup";

export function workerStateIsolationTests() {
  describe("reused Worker storage isolation", () => {
    it("starts with an empty KV namespace", async () => {
      expect(await env.USER_DATA_KV.get(identity)).toBeNull();
      await env.USER_DATA_KV.put(identity, "previous file");
    });

    it("starts with a fresh Durable Object journal", async () => {
      const journal = exports.CartOperations.getByName(identity);
      expect(await journal.begin(identity, "milk")).toMatchObject({ status: "started" });
    });

    it("starts with a fresh D1 database", async () => {
      const existing = await env.SHOPPING_DB.prepare(
        "SELECT name FROM sqlite_master WHERE name = 'test_file_cleanup'",
      ).all();

      expect(existing.results).toEqual([]);
      await env.SHOPPING_DB.exec("CREATE TABLE test_file_cleanup (id INTEGER PRIMARY KEY)");
    });

    it("resets the auxiliary Auth worker's in-memory state", async () => {
      const response = await env.AUTH.fetch("https://auth-stub/stats");
      expect(await response.json()).toMatchObject({ calls: [] });
      expect(await krogerToken(env, identity)).toBeNull();
    });
  });
}
