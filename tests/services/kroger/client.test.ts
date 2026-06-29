import { afterEach, describe, expect, it, vi } from "vitest";

import {
  KrogerTokenExpiredError,
  createKrogerAuthMiddleware,
  createKrogerClients,
  isKrogerTokenExpiring,
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
  it("is an instance of Error with correct name and message", () => {
    const error = new KrogerTokenExpiredError("test message");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("KrogerTokenExpiredError");
    expect(error.message).toBe("test message");
  });
});

// ----- refreshKrogerToken -----

describe("refreshKrogerToken", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refreshes token successfully and returns parsed token data", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: "new-access-token",
          refresh_token: "new-refresh-token",
          expires_in: 1800,
        }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await refreshKrogerToken("old-refresh-token", "client-id", "client-secret");

    expect(result.isOk()).toBe(true);
    const value = result._unsafeUnwrap();
    expect(value.accessToken).toBe("new-access-token");
    expect(value.refreshToken).toBe("new-refresh-token");
    expect(value.expiresIn).toBe(1800);
    expect(value.tokenExpiresAt).toBeGreaterThan(Date.now());

    const [[url, init]] = mockFetch.mock.calls as [[string, RequestInit]];
    const headers = init.headers as Record<string, string>;
    expect(url).toBe("https://api.kroger.com/v1/connect/oauth2/token");
    expect(init.method).toBe("POST");
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(headers["Authorization"]).toContain("Basic ");
  });

  it("returns Err with API_ERROR on non-ok response containing error_description", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: () =>
          Promise.resolve({
            error: "invalid_grant",
            error_description: "Refresh token is invalid",
          }),
      }),
    );

    const result = await refreshKrogerToken("bad-token", "client-id", "client-secret");
    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.type).toBe("API_ERROR");
    expect(error.message).toContain("Refresh token is invalid");
  });

  it("falls back to error field when error_description is absent on non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        json: () =>
          Promise.resolve({
            error: "invalid_client",
          }),
      }),
    );

    const result = await refreshKrogerToken("token", "client-id", "client-secret");
    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.type).toBe("API_ERROR");
    expect(error.message).toContain("invalid_client");
    expect(error.message).not.toContain("Unknown error");
  });

  it("falls back to 'Unknown error' when both error and error_description are absent on non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: () => Promise.resolve({}),
      }),
    );

    const result = await refreshKrogerToken("token", "client-id", "client-secret");
    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.type).toBe("API_ERROR");
    expect(error.message).toContain("Unknown error");
  });

  it("returns Err with NETWORK_ERROR when fetch itself throws (network failure)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network failure: connection refused")),
    );

    const result = await refreshKrogerToken("token", "client-id", "client-secret");
    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.type).toBe("NETWORK_ERROR");
    expect(error.message).toContain("Network failure: connection refused");
  });

  it("returns Err with NETWORK_ERROR when response.json() throws (malformed JSON body)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.reject(new Error("Unexpected token < in JSON")),
      }),
    );

    const result = await refreshKrogerToken("token", "client-id", "client-secret");
    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.type).toBe("NETWORK_ERROR");
    expect(error.message).toContain("Unexpected token < in JSON");
  });

  it("returns Err when ok response has no access_token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      }),
    );

    const result = await refreshKrogerToken("token", "client-id", "client-secret");
    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.message).toContain("Invalid response from Kroger token refresh endpoint");
  });

  it("defaults expires_in to 1800 when not provided in the response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ access_token: "token" }),
      }),
    );

    const result = await refreshKrogerToken("token", "id", "secret");
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().expiresIn).toBe(1800);
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

    await expect(callOnRequest(middleware, request)).rejects.toThrow(KrogerTokenExpiredError);
  });

  it("adds Authorization Bearer header when token is valid", async () => {
    const middleware = createKrogerAuthMiddleware(() => ({
      accessToken: "my-access-token",
      tokenExpiresAt: Date.now() + 30 * 60 * 1000,
    }));

    const request = new Request("https://api.kroger.com/v1/products");
    const result = await callOnRequest(middleware, request);

    expect((result as Request).headers.get("Authorization")).toBe("Bearer my-access-token");
  });

  it("throws KrogerTokenExpiredError when token expired more than 60 seconds ago", async () => {
    const middleware = createKrogerAuthMiddleware(() => ({
      accessToken: "expired-token",
      tokenExpiresAt: Date.now() - 90 * 1000, // 90 seconds ago — past the 60s grace period
    }));

    const request = new Request("https://api.kroger.com/v1/products");

    await expect(callOnRequest(middleware, request)).rejects.toThrow(KrogerTokenExpiredError);
  });

  it("does not throw for a token that expired less than 60 seconds ago (clock-skew grace period)", async () => {
    // The 1-minute grace buffer means tokens that JUST expired still get through;
    // actual 401s from Kroger are caught by onResponse instead.
    const middleware = createKrogerAuthMiddleware(() => ({
      accessToken: "recent-token",
      tokenExpiresAt: Date.now() - 30 * 1000, // 30 seconds ago — within grace period
    }));

    const request = new Request("https://api.kroger.com/v1/products");
    const result = await callOnRequest(middleware, request);

    expect((result as Request).headers.get("Authorization")).toBe("Bearer recent-token");
  });

  it("throws KrogerTokenExpiredError on 401 response from Kroger", async () => {
    const middleware = createKrogerAuthMiddleware(() => ({
      accessToken: "token",
      tokenExpiresAt: Date.now() + 30 * 60 * 1000,
    }));

    const response = new Response(JSON.stringify({}), { status: 401 });
    const request = new Request("https://api.kroger.com/v1/products");

    await expect(callOnResponse(middleware, request, response)).rejects.toThrow(
      KrogerTokenExpiredError,
    );
  });

  it("passes through non-401 responses unchanged", async () => {
    const middleware = createKrogerAuthMiddleware(() => ({
      accessToken: "token",
      tokenExpiresAt: Date.now() + 30 * 60 * 1000,
    }));

    const response = new Response(JSON.stringify({ data: [] }), { status: 200 });
    const request = new Request("https://api.kroger.com/v1/products");

    const result = await callOnResponse(middleware, request, response);

    expect((result as Response).status).toBe(200);
  });
});

// ----- createKrogerClients -----

describe("createKrogerClients", () => {
  it("returns an object containing all four client properties", () => {
    const clients = createKrogerClients(() => ({
      accessToken: "valid-token",
      tokenExpiresAt: Date.now() + 30 * 60 * 1000,
    }));

    expect(clients).toHaveProperty("cartClient");
    expect(clients).toHaveProperty("identityClient");
    expect(clients).toHaveProperty("locationClient");
    expect(clients).toHaveProperty("productClient");
  });

  it("applies auth middleware so requests throw KrogerTokenExpiredError when no token is available", async () => {
    // All four clients share the same middleware from createKrogerClients;
    // verifying one is sufficient — the middleware throw happens before fetch is called.
    const { cartClient } = createKrogerClients(() => null);

    await expect(cartClient.PUT("/v1/cart/add", {})).rejects.toThrow(KrogerTokenExpiredError);
  });
});
