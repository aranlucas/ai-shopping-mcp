import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("Kroger credential ownership", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("serializes refresh, persists the rotated token, and never returns the refresh credential", async () => {
    const connection = exports.KrogerConnections.getByName(crypto.randomUUID());
    await connection.saveConnection({
      krogerId: "shopper",
      accessToken: "expired",
      refreshToken: "single-use",
      tokenExpiresAt: Date.now() + 1000,
    });

    const upstream = vi.fn<() => Promise<Response>>(async () =>
      Response.json({
        access_token: "fresh",
        refresh_token: "rotated",
        expires_in: 1800,
      }),
    );

    vi.stubGlobal("fetch", upstream);

    const results = await Promise.all(
      Array.from({ length: 8 }, () => connection.getToken()),
    );

    expect(upstream).toHaveBeenCalledTimes(1);

    for (const result of results) {
      expect(result).toMatchObject({
        status: "connected",
        token: { accessToken: "fresh" },
      });
      expect(JSON.stringify(result)).not.toContain("rotated");
    }

    await connection.getToken();
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it.each(["network", "missing_rotation", "invalid_grant"])(
    "does not reuse a refresh token after %s",
    async (failure) => {
      const connection = exports.KrogerConnections.getByName(
        crypto.randomUUID(),
      );

      await connection.saveConnection({
        krogerId: "shopper",
        accessToken: "expired",
        refreshToken: "single-use",
        tokenExpiresAt: Date.now() + 1000,
      });

      const upstream = vi.fn<() => Promise<Response>>(async () => {
        if (failure === "network") throw new Error("Ambiguous network failure");

        return failure === "missing_rotation"
          ? Response.json({ access_token: "new", expires_in: 1800 })
          : Response.json({ error: "invalid_grant" }, { status: 400 });
      });

      vi.stubGlobal("fetch", upstream);
      expect(await connection.getToken()).toEqual({
        status: "reconnect_required",
      });
      expect(await connection.getToken()).toEqual({
        status: "reconnect_required",
      });
      expect(upstream).toHaveBeenCalledTimes(1);
      expect(
        await connection.saveConnection({
          krogerId: "other-shopper",
          accessToken: "other",
          refreshToken: "other",
          tokenExpiresAt: Date.now() + 1_800_000,
        }),
      ).toBe(false);
      expect(
        await connection.saveConnection({
          krogerId: "shopper",
          accessToken: "reconnected",
          refreshToken: "next",
          tokenExpiresAt: Date.now() + 1_800_000,
        }),
      ).toBe(true);
      expect(await connection.getToken()).toMatchObject({
        status: "connected",
        token: { accessToken: "reconnected" },
      });
    },
  );

  it("consumes browser redirect state once and only with the correct binding", async () => {
    const state = exports.LoginTransactions.getByName(crypto.randomUUID());

    const data = {
      type: "auth" as const,
      verifier: "verifier",
      nonce: "nonce",
      redirectUri: "https://example.com/auth/callback",
    };

    await state.begin(data, "browser-binding");
    expect(await state.consume("other-browser")).toBeNull();

    const consumed = await Promise.all([
      state.consume("browser-binding"),
      state.consume("browser-binding"),
    ]);

    expect(consumed.filter(Boolean)).toEqual([data]);
    expect(await state.consume("browser-binding")).toBeNull();
  });
});
