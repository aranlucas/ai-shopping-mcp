import { afterEach, describe, expect, it, vi } from "vitest";

import { KrogerHandler } from "../src/kroger-handler.js";

describe("Kroger OAuth handler", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function makeEnv() {
    return {
      COOKIE_ENCRYPTION_KEY: "test-cookie-secret",
      KROGER_CLIENT_ID: "test-client-id",
      KROGER_CLIENT_SECRET: "test-client-secret",
      OAUTH_PROVIDER: {
        completeAuthorization: vi.fn().mockResolvedValue({ redirectTo: "https://mcp.test/done" }),
        lookupClient: vi.fn(),
        parseAuthRequest: vi.fn().mockResolvedValue({
          clientId: "mcp-client",
          codeChallenge: "challenge",
          redirectUri: "https://mcp.test/callback",
          scope: "tools",
        }),
      },
    };
  }

  function extractHiddenInput(html: string, name: string) {
    const match = html.match(new RegExp(`name="${name}" value="([^"]+)"`));
    if (!match) throw new Error(`Missing hidden input: ${name}`);
    return match[1];
  }

  function getCookieHeader(response: Response) {
    return response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .join("; ");
  }

  async function approveClient(env: ReturnType<typeof makeEnv>) {
    const consentResponse = await KrogerHandler.request(
      "https://worker.test/authorize?client_id=mcp-client",
      undefined,
      env,
    );
    const consentHtml = await consentResponse.text();

    return KrogerHandler.request(
      "https://worker.test/authorize",
      {
        body: new URLSearchParams({
          csrf_token: extractHiddenInput(consentHtml, "csrf_token"),
          state: extractHiddenInput(consentHtml, "state"),
        }),
        headers: {
          Cookie: getCookieHeader(consentResponse),
        },
        method: "POST",
      },
      env,
    );
  }

  it("rejects a Kroger callback when the returned state does not match the authorization state", async () => {
    const env = makeEnv();
    const authorizeResponse = await approveClient(env);
    const stateCookie = authorizeResponse.headers.get("Set-Cookie");
    expect(stateCookie).toContain("kroger_oauth_state=");

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: "access-token",
          expires_in: 1800,
          refresh_token: "refresh-token",
        }),
    });

    const callbackResponse = await KrogerHandler.request(
      "https://worker.test/callback?code=auth-code&state=attacker-state",
      {
        headers: {
          Cookie: stateCookie ?? "",
        },
      },
      env,
    );

    expect(callbackResponse.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(env.OAUTH_PROVIDER.completeAuthorization).not.toHaveBeenCalled();
  });

  it("rejects approval submissions without the consent-form CSRF token", async () => {
    const env = makeEnv();
    const oauthReqInfo = {
      clientId: "mcp-client",
      codeChallenge: "challenge",
      redirectUri: "https://mcp.test/callback",
      scope: "tools",
    };

    const response = await KrogerHandler.request(
      "https://worker.test/authorize",
      {
        body: new URLSearchParams({
          state: btoa(JSON.stringify({ oauthReqInfo })),
        }),
        method: "POST",
      },
      env,
    );

    expect(response.status).toBe(400);
  });

  it("sets both the approved-client cookie and the Kroger state cookie after approval", async () => {
    const env = makeEnv();
    const response = await approveClient(env);

    expect(response.status).toBe(302);
    expect(response.headers.getSetCookie()).toEqual(
      expect.arrayContaining([
        expect.stringContaining("__Host-mcp-approved-clients="),
        expect.stringContaining("kroger_oauth_state="),
      ]),
    );
  });

  it("accepts approval submissions when duplicate CSRF cookies include the form token", async () => {
    const env = makeEnv();
    const consentResponse = await KrogerHandler.request(
      "https://worker.test/authorize?client_id=mcp-client",
      undefined,
      env,
    );
    const consentHtml = await consentResponse.text();
    const csrfToken = extractHiddenInput(consentHtml, "csrf_token");
    const csrfCookie = consentResponse.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith("__Host-CSRF_TOKEN="));

    const response = await KrogerHandler.request(
      "https://worker.test/authorize",
      {
        body: new URLSearchParams({
          csrf_token: csrfToken,
          state: extractHiddenInput(consentHtml, "state"),
        }),
        headers: {
          Cookie: `__Host-CSRF_TOKEN=stale-token; ${csrfCookie?.split(";")[0] ?? ""}`,
        },
        method: "POST",
      },
      env,
    );

    expect(response.status).toBe(302);
  });

  it("requires fresh approval when an approved client changes redirect URI", async () => {
    const env = makeEnv();
    const approvedResponse = await approveClient(env);
    const approvedCookie = approvedResponse.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith("__Host-mcp-approved-clients="));

    env.OAUTH_PROVIDER.parseAuthRequest = vi.fn().mockResolvedValue({
      clientId: "mcp-client",
      codeChallenge: "challenge",
      redirectUri: "https://attacker.test/callback",
      scope: "tools",
    });

    const response = await KrogerHandler.request(
      "https://worker.test/authorize?client_id=mcp-client",
      {
        headers: {
          Cookie: approvedCookie ?? "",
        },
      },
      env,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Location")).toBeNull();
    expect(await response.text()).toContain("is requesting access");
  });
});
