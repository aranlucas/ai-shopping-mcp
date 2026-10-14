import { env, reset } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { authIdentity } from "../src/services/better-auth.js";
import { seedKrogerConnection } from "./better-auth-fixture.js";

describe("Auth-owned Kroger credentials", () => {
  beforeEach(async () => {
    await reset();
    await env.AUTH.fetch("https://auth-stub/reset");
  });

  it("serializes RPC calls for a user and maps Auth's expiry without returning refresh credentials", async () => {
    const identity = await seedKrogerConnection("shopper");
    const connection = exports.KrogerConnections.getByName(identity.id);

    const results = await Promise.all(
      Array.from({ length: 8 }, () => connection.getToken(identity.subject)),
    );

    for (const result of results) {
      expect(result).toMatchObject({
        status: "connected",
        token: {
          accessToken: "kroger-access-token",
          // SAFETY: Vitest consumes this asymmetric matcher; unknown avoids leaking its any return into the expected payload.
          tokenExpiresAt: expect.any(Number) as unknown,
        },
      });
      expect(JSON.stringify(result)).not.toContain("refreshToken");
    }

    expect(await (await env.AUTH.fetch("https://auth-stub/stats")).json()).toEqual({
      maxActive: 1,
      calls: Array.from({ length: 8 }, () => "shopper"),
    });
  });

  it("observes unlinking on the next request and never serves cached credentials", async () => {
    const identity = await seedKrogerConnection("shopper");
    const connection = exports.KrogerConnections.getByName(identity.id);
    expect(await connection.getToken("shopper")).toMatchObject({
      status: "connected",
    });
    await env.AUTH.fetch("https://auth-stub/seed", {
      method: "POST",
      body: JSON.stringify({ userId: "shopper", token: null }),
    });
    expect(await connection.getToken("shopper")).toEqual({
      status: "not_connected",
    });
  });

  it("isolates Auth subjects", async () => {
    await seedKrogerConnection("shopper-a");
    const identity = authIdentity(env.BETTER_AUTH_ISSUER, "shopper-b");
    expect(
      await exports.KrogerConnections.getByName(identity.id).getToken(identity.subject),
    ).toEqual({ status: "not_connected" });
  });

  it("propagates Auth outages instead of treating them as an unlinked account", async () => {
    const identity = authIdentity(env.BETTER_AUTH_ISSUER, "shopper");
    const connection = exports.KrogerConnections.getByName(identity.id);

    await env.AUTH.fetch("https://auth-stub/fail");
    // Convert the RPC thenable to a native Promise before Vitest attaches rejection handlers.
    await expect(Promise.resolve(connection.getToken("shopper"))).rejects.toThrow(
      "Auth service unavailable",
    );
    await env.AUTH.fetch("https://auth-stub/reset");
    await seedKrogerConnection("shopper");
    expect(await connection.getToken("shopper")).toMatchObject({
      status: "connected",
    });
  });

  it("rejects an expired token returned by Auth", async () => {
    const identity = await seedKrogerConnection("shopper", Date.now() - 1000);
    await expect(
      Promise.resolve(exports.KrogerConnections.getByName(identity.id).getToken(identity.subject)),
    ).rejects.toThrow("expired Kroger token");
  });
});
