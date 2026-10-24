import { env, reset } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { krogerToken } from "@/services/kroger-token.js";
import { seedKrogerConnection } from "@test/better-auth-fixture.js";

describe("Auth-owned Kroger credentials", () => {
  beforeEach(async () => {
    await reset();
    await env.AUTH.fetch("https://auth-stub/reset");
  });

  it("reads Auth for each request and maps expiry without returning refresh credentials", async () => {
    const expiresAt = Date.now() + 1_800_000;
    const identity = await seedKrogerConnection("shopper", expiresAt);

    const results = await Promise.all(
      Array.from({ length: 8 }, () => krogerToken(env, identity.subject)),
    );

    for (const result of results) {
      expect(result).toEqual({
        accessToken: "kroger-access-token",
        tokenExpiresAt: expiresAt,
      });
      expect(JSON.stringify(result)).not.toContain("refreshToken");
    }

    expect(await (await env.AUTH.fetch("https://auth-stub/stats")).json()).toMatchObject({
      calls: Array.from({ length: 8 }, () => "shopper"),
    });
  });

  it("observes unlinking on the next request and never serves cached credentials", async () => {
    await seedKrogerConnection("shopper");
    expect(await krogerToken(env, "shopper")).toMatchObject({
      accessToken: "kroger-access-token",
    });
    await env.AUTH.fetch("https://auth-stub/seed", {
      method: "POST",
      body: JSON.stringify({ userId: "shopper", token: null }),
    });
    expect(await krogerToken(env, "shopper")).toBeNull();
  });

  it("isolates Auth subjects", async () => {
    await seedKrogerConnection("shopper-a");
    expect(await krogerToken(env, "shopper-b")).toBeNull();
  });

  it("propagates Auth outages instead of treating them as an unlinked account", async () => {
    await env.AUTH.fetch("https://auth-stub/fail");
    await expect(krogerToken(env, "shopper")).rejects.toThrow("Auth service unavailable");
    await env.AUTH.fetch("https://auth-stub/reset");
    await seedKrogerConnection("shopper");
    expect(await krogerToken(env, "shopper")).toMatchObject({
      accessToken: "kroger-access-token",
    });
  });

  it("rejects an expired token returned by Auth", async () => {
    const identity = await seedKrogerConnection("shopper", Date.now() - 1000);
    await expect(krogerToken(env, identity.subject)).rejects.toThrow("expired Kroger token");
  });
});
