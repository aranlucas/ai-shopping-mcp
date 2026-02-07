import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createKrogerAuthMiddleware,
  isKrogerTokenExpiring,
  KrogerTokenExpiredError,
  refreshKrogerToken,
} from "../../../src/services/kroger/client.js";

// ----- isKrogerTokenExpiring -----

describe("isKrogerTokenExpiring", () => {
  it("returns true when token is already expired", () => {
    const pastTime = Date.now() - 60 * 1000; // 1 minute ago
    expect(isKrogerTokenExpiring(pastTime)).toBe(true);
  });

  it("returns true when token expires within the buffer period", () => {
    const soonTime = Date.now() + 3 * 60 * 1000; // 3 minutes from now
    // Default buffer is 5 minutes
    expect(isKrogerTokenExpiring(soonTime)).toBe(true);
  });

  it("returns false when token has plenty of time left", () => {
    const farTime = Date.now() + 30 * 60 * 1000; // 30 minutes from now
    expect(isKrogerTokenExpiring(farTime)).toBe(false);
  });

  it("respects custom buffer time", () => {
    const soonTime = Date.now() + 3 * 60 * 1000; // 3 minutes from now
    // With 1-minute buffer, this should NOT be expiring
    expect(isKrogerTokenExpiring(soonTime, 60 * 1000)).toBe(false);
    // With 5-minute buffer, this SHOULD be expiring
    expect(isKrogerTokenExpiring(soonTime, 5 * 60 * 1000)).toBe(true);
  });

  it("returns true when token expires exactly at the buffer boundary", () => {
    const bufferMs = 5 * 60 * 1000;
    const exactBoundary = Date.now() + bufferMs;
    expect(isKrogerTokenExpiring(exactBoundary)).toBe(true);
  });
});

// ----- KrogerTokenExpiredError -----

describe("KrogerTokenExpiredError", () => {
  it("is an instance of Error", () => {
    const err = new KrogerTokenExpiredError("test message");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("KrogerTokenExpiredError");
    expect(err.message).toBe("test message");
  });
});

// ----- refreshKrogerToken -----

describe("refreshKrogerToken", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("refreshes token successfully", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: "new-access-token",
          refresh_token: "new-refresh-token",
          expires_in: 1800,
        }),
    });

    const result = await refreshKrogerToken(
      "old-refresh-token",
      "client-id",
      "client-secret",
    );

    expect(result.accessToken).toBe("new-access-token");
    expect(result.refreshToken).toBe("new-refresh-token");
    expect(result.expiresIn).toBe(1800);
    expect(result.tokenExpiresAt).toBeGreaterThan(Date.now());

    // Verify fetch was called with correct parameters
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    const fetchCall = fetchMock.mock.calls[0];
    expect(fetchCall[0]).toBe("https://api.kroger.com/v1/connect/oauth2/token");
    expect(fetchCall[1].method).toBe("POST");
    expect(fetchCall[1].headers["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(fetchCall[1].headers.Authorization).toContain("Basic ");
  });

  it("throws on non-ok response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      json: () =>
        Promise.resolve({
          error: "invalid_grant",
          error_description: "Refresh token is invalid",
        }),
    });

    await expect(
      refreshKrogerToken("bad-token", "client-id", "client-secret"),
    ).rejects.toThrow("Refresh token is invalid");
  });

  it("throws when response has no access_token", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    await expect(
      refreshKrogerToken("token", "client-id", "client-secret"),
    ).rejects.toThrow("Invalid response from Kroger token refresh endpoint");
  });

  it("defaults expires_in to 1800 when not provided", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: "token",
        }),
    });

    const result = await refreshKrogerToken("token", "id", "secret");
    expect(result.expiresIn).toBe(1800);
  });
});

// ----- createKrogerAuthMiddleware -----

describe("createKrogerAuthMiddleware", () => {
  function makeRequestParams(request: Request) {
    return {
      request,
      schemaPath: "/v1/products",
      params: {},
      options: {} as never,
      id: "test",
    };
  }

  function makeResponseParams(request: Request, response: Response) {
    return {
      request,
      response,
      schemaPath: "/v1/products",
      params: {},
      options: {} as never,
      id: "test",
    };
  }

  function callOnRequest(
    middleware: ReturnType<typeof createKrogerAuthMiddleware>,
    request: Request,
  ) {
    const onRequest = middleware.onRequest;
    if (!onRequest) throw new Error("onRequest not defined");
    return onRequest(makeRequestParams(request));
  }

  function callOnResponse(
    middleware: ReturnType<typeof createKrogerAuthMiddleware>,
    request: Request,
    response: Response,
  ) {
    const onResponse = middleware.onResponse;
    if (!onResponse) throw new Error("onResponse not defined");
    return onResponse(makeResponseParams(request, response));
  }

  it("throws KrogerTokenExpiredError when no token info available", async () => {
    const middleware = createKrogerAuthMiddleware(() => null);
    const request = new Request("https://api.kroger.com/v1/products");

    await expect(callOnRequest(middleware, request)).rejects.toThrow(
      KrogerTokenExpiredError,
    );
  });

  it("adds Authorization header when token is valid", async () => {
    const middleware = createKrogerAuthMiddleware(() => ({
      accessToken: "my-access-token",
      tokenExpiresAt: Date.now() + 30 * 60 * 1000,
      krogerClientId: "id",
      krogerClientSecret: "secret",
    }));

    const request = new Request("https://api.kroger.com/v1/products");
    const result = await callOnRequest(middleware, request);

    expect((result as Request).headers.get("Authorization")).toBe(
      "Bearer my-access-token",
    );
  });

  it("throws KrogerTokenExpiredError when token is expired", async () => {
    const middleware = createKrogerAuthMiddleware(() => ({
      accessToken: "expired-token",
      tokenExpiresAt: Date.now() - 10 * 60 * 1000,
      krogerClientId: "id",
      krogerClientSecret: "secret",
    }));

    const request = new Request("https://api.kroger.com/v1/products");

    await expect(callOnRequest(middleware, request)).rejects.toThrow(
      KrogerTokenExpiredError,
    );
  });

  it("throws KrogerTokenExpiredError on 401 response", async () => {
    const middleware = createKrogerAuthMiddleware(() => ({
      accessToken: "token",
      tokenExpiresAt: Date.now() + 30 * 60 * 1000,
      krogerClientId: "id",
      krogerClientSecret: "secret",
    }));

    const response = new Response(JSON.stringify({}), { status: 401 });
    const request = new Request("https://api.kroger.com/v1/products");

    await expect(callOnResponse(middleware, request, response)).rejects.toThrow(
      KrogerTokenExpiredError,
    );
  });

  it("passes through non-401 responses", async () => {
    const middleware = createKrogerAuthMiddleware(() => ({
      accessToken: "token",
      tokenExpiresAt: Date.now() + 30 * 60 * 1000,
      krogerClientId: "id",
      krogerClientSecret: "secret",
    }));

    const response = new Response(JSON.stringify({ data: [] }), {
      status: 200,
    });
    const request = new Request("https://api.kroger.com/v1/products");

    const result = await callOnResponse(middleware, request, response);

    expect((result as Response).status).toBe(200);
  });
});
