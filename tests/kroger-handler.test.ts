import { afterEach, describe, expect, it, vi } from "vitest";

import { KrogerHandler } from "../src/kroger-handler.js";
import { createSignedCookiePayload } from "../src/workers-oauth-utils.js";

const COOKIE_SECRET = "test-cookie-secret";
const BASE_URL = "https://worker.test";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEnv() {
  return {
    COOKIE_ENCRYPTION_KEY: COOKIE_SECRET,
    KROGER_CLIENT_ID: "test-client-id",
    KROGER_CLIENT_SECRET: "test-client-secret",
    OAUTH_PROVIDER: {
      completeAuthorization: vi.fn().mockResolvedValue({ redirectTo: "https://mcp.test/done" }),
      lookupClient: vi.fn().mockResolvedValue(null),
      parseAuthRequest: vi.fn().mockResolvedValue({
        clientId: "mcp-client",
        codeChallenge: "challenge",
        redirectUri: "https://mcp.test/callback",
        scope: "tools",
      }),
    },
  };
}

function extractHiddenInput(html: string, name: string): string {
  const match = html.match(new RegExp(`name="${name}" value="([^"]+)"`));
  if (!match) throw new Error(`Missing hidden input: ${name}`);
  return match[1];
}

/** Collapse all Set-Cookie headers into a single Cookie header value. */
function getCookieHeader(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

/** Go through the full consent-form approval flow and return the 302 redirect response. */
async function approveClient(env: ReturnType<typeof makeEnv>): Promise<Response> {
  const consentResponse = await KrogerHandler.request(
    `${BASE_URL}/authorize?client_id=mcp-client`,
    undefined,
    env,
  );
  const consentHtml = await consentResponse.text();

  return KrogerHandler.request(
    `${BASE_URL}/authorize`,
    {
      body: new URLSearchParams({
        csrf_token: extractHiddenInput(consentHtml, "csrf_token"),
        state: extractHiddenInput(consentHtml, "state"),
      }),
      headers: { Cookie: getCookieHeader(consentResponse) },
      method: "POST",
    },
    env,
  );
}

/**
 * Returns the kroger_oauth_state cookie value and the matching csrfState param
 * by going through the full approval flow. Used by callback tests that need a
 * valid signed cookie.
 */
async function getCallbackSetup(
  env: ReturnType<typeof makeEnv>,
): Promise<{ stateCookieValue: string; stateParam: string }> {
  const approveResponse = await approveClient(env);

  const stateCookieHeader =
    approveResponse.headers.getSetCookie().find((c) => c.startsWith("kroger_oauth_state=")) ?? "";
  const stateCookieValue = stateCookieHeader.split(";")[0].replace("kroger_oauth_state=", "");

  const location = approveResponse.headers.get("Location") ?? "";
  const stateParam = new URL(location).searchParams.get("state") ?? "";

  return { stateCookieValue, stateParam };
}

/**
 * Creates a signed kroger_oauth_state cookie with a known csrfState and a
 * default valid oauthReqInfo. Use for callback tests that need to reach
 * specific handler branches without going through the full approval flow.
 */
async function makeStateCookie(
  csrfState: string,
  oauthReqInfo: Record<string, unknown> = {
    clientId: "mcp-client",
    redirectUri: "https://mcp.test/callback",
    scope: "tools",
    codeChallenge: "challenge",
  },
): Promise<string> {
  return createSignedCookiePayload({ csrfState, oauthReqInfo }, COOKIE_SECRET);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Kroger OAuth handler", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // GET /authorize
  // -------------------------------------------------------------------------

  describe("GET /authorize", () => {
    it("returns 400 when parseAuthRequest throws", async () => {
      const env = makeEnv();
      env.OAUTH_PROVIDER.parseAuthRequest = vi
        .fn()
        .mockRejectedValue(new Error("bad request params"));

      const response = await KrogerHandler.request(
        `${BASE_URL}/authorize?client_id=mcp-client`,
        undefined,
        env,
      );

      expect(response.status).toBe(400);
      expect(await response.text()).toContain("bad request params");
    });

    it("returns 400 when parsed auth request has no clientId", async () => {
      const env = makeEnv();
      env.OAUTH_PROVIDER.parseAuthRequest = vi.fn().mockResolvedValue({
        clientId: undefined,
        redirectUri: "https://mcp.test/callback",
        scope: "tools",
      });

      const response = await KrogerHandler.request(
        `${BASE_URL}/authorize?client_id=mcp-client`,
        undefined,
        env,
      );

      expect(response.status).toBe(400);
      expect(await response.text()).toContain("missing clientId");
    });

    it("shows the approval dialog when the client has not yet been approved", async () => {
      const env = makeEnv();

      const response = await KrogerHandler.request(
        `${BASE_URL}/authorize?client_id=mcp-client`,
        undefined,
        env,
      );

      expect(response.status).toBe(200);
      expect(await response.text()).toContain("is requesting access");
    });

    it("skips dialog and redirects to Kroger when client is already approved", async () => {
      const env = makeEnv();
      const approvedResponse = await approveClient(env);
      const approvedClientCookie =
        approvedResponse.headers
          .getSetCookie()
          .find((c) => c.startsWith("__Host-mcp-approved-clients="))
          ?.split(";")[0] ?? "";

      const response = await KrogerHandler.request(
        `${BASE_URL}/authorize?client_id=mcp-client`,
        { headers: { Cookie: approvedClientCookie } },
        env,
      );

      expect(response.status).toBe(302);
      const location = response.headers.get("Location") ?? "";
      expect(location).toContain("api.kroger.com");
    });

    it("shows dialog again when an approved client changes its redirect URI", async () => {
      const env = makeEnv();
      const approvedResponse = await approveClient(env);
      const approvedCookie =
        approvedResponse.headers
          .getSetCookie()
          .find((cookie) => cookie.startsWith("__Host-mcp-approved-clients=")) ?? "";

      env.OAUTH_PROVIDER.parseAuthRequest = vi.fn().mockResolvedValue({
        clientId: "mcp-client",
        codeChallenge: "challenge",
        redirectUri: "https://attacker.test/callback",
        scope: "tools",
      });

      const response = await KrogerHandler.request(
        `${BASE_URL}/authorize?client_id=mcp-client`,
        { headers: { Cookie: approvedCookie } },
        env,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("Location")).toBeNull();
      expect(await response.text()).toContain("is requesting access");
    });
  });

  // -------------------------------------------------------------------------
  // POST /authorize
  // -------------------------------------------------------------------------

  describe("POST /authorize", () => {
    it("returns 400 when CSRF token is absent from form submission", async () => {
      const env = makeEnv();
      const oauthReqInfo = {
        clientId: "mcp-client",
        codeChallenge: "challenge",
        redirectUri: "https://mcp.test/callback",
        scope: "tools",
      };

      const response = await KrogerHandler.request(
        `${BASE_URL}/authorize`,
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

    it("returns 400 when form state has no oauthReqInfo", async () => {
      const env = makeEnv();
      // Get a valid CSRF token from the consent page without going through the
      // full approval so we can craft a custom state.
      const consentResponse = await KrogerHandler.request(
        `${BASE_URL}/authorize?client_id=mcp-client`,
        undefined,
        env,
      );
      const consentHtml = await consentResponse.text();
      const csrfToken = extractHiddenInput(consentHtml, "csrf_token");

      const response = await KrogerHandler.request(
        `${BASE_URL}/authorize`,
        {
          body: new URLSearchParams({
            csrf_token: csrfToken,
            state: btoa(JSON.stringify({ someOtherField: "no-oauth-info" })),
          }),
          headers: { Cookie: getCookieHeader(consentResponse) },
          method: "POST",
        },
        env,
      );

      expect(response.status).toBe(400);
    });

    it("sets both the approved-client cookie and Kroger state cookie after approval", async () => {
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

    it("accepts approval when duplicate CSRF cookies include the matching form token", async () => {
      const env = makeEnv();
      const consentResponse = await KrogerHandler.request(
        `${BASE_URL}/authorize?client_id=mcp-client`,
        undefined,
        env,
      );
      const consentHtml = await consentResponse.text();
      const csrfToken = extractHiddenInput(consentHtml, "csrf_token");
      const csrfCookie = consentResponse.headers
        .getSetCookie()
        .find((cookie) => cookie.startsWith("__Host-CSRF_TOKEN="));

      const response = await KrogerHandler.request(
        `${BASE_URL}/authorize`,
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
  });

  // -------------------------------------------------------------------------
  // redirectToKroger (exercised via POST /authorize)
  // -------------------------------------------------------------------------

  describe("redirectToKroger", () => {
    /** Get a valid CSRF token + state value from the consent page. */
    async function getConsentFormData(env: ReturnType<typeof makeEnv>) {
      const consentResponse = await KrogerHandler.request(
        `${BASE_URL}/authorize?client_id=mcp-client`,
        undefined,
        env,
      );
      const consentHtml = await consentResponse.text();
      return {
        csrfToken: extractHiddenInput(consentHtml, "csrf_token"),
        state: extractHiddenInput(consentHtml, "state"),
        csrfCookieValue: getCookieHeader(consentResponse),
      };
    }

    it("returns 500 when KROGER_CLIENT_ID is missing from env", async () => {
      const env = makeEnv();
      env.KROGER_CLIENT_ID = "";
      const { csrfToken, state, csrfCookieValue } = await getConsentFormData(env);

      const response = await KrogerHandler.request(
        `${BASE_URL}/authorize`,
        {
          body: new URLSearchParams({ csrf_token: csrfToken, state }),
          headers: { Cookie: csrfCookieValue },
          method: "POST",
        },
        env,
      );

      expect(response.status).toBe(500);
      expect(await response.text()).toContain("Server configuration error");
    });

    it("returns 500 when KROGER_CLIENT_SECRET is missing from env", async () => {
      const env = makeEnv();
      env.KROGER_CLIENT_SECRET = "";
      const { csrfToken, state, csrfCookieValue } = await getConsentFormData(env);

      const response = await KrogerHandler.request(
        `${BASE_URL}/authorize`,
        {
          body: new URLSearchParams({ csrf_token: csrfToken, state }),
          headers: { Cookie: csrfCookieValue },
          method: "POST",
        },
        env,
      );

      expect(response.status).toBe(500);
      expect(await response.text()).toContain("Server configuration error");
    });

    it("encodes scope with %20 (not +) in the Kroger redirect URL", async () => {
      const env = makeEnv();
      const response = await approveClient(env);

      const location = response.headers.get("Location") ?? "";
      expect(location).toContain("%20");
      expect(location).not.toMatch(/scope=[^&]*\+/);
      // Decoding must preserve the colon in cart.basic:write
      const decoded = decodeURIComponent(location);
      expect(decoded).toContain("cart.basic:write");
    });
  });

  // -------------------------------------------------------------------------
  // GET /callback
  // -------------------------------------------------------------------------

  describe("GET /callback", () => {
    it("returns 400 when Kroger returns an OAuth error param", async () => {
      const env = makeEnv();

      const response = await KrogerHandler.request(
        `${BASE_URL}/callback?error=access_denied`,
        undefined,
        env,
      );

      expect(response.status).toBe(400);
      expect(await response.text()).toContain("access_denied");
    });

    it("includes Kroger error description in the 400 response", async () => {
      const env = makeEnv();

      const response = await KrogerHandler.request(
        `${BASE_URL}/callback?error=server_error&error_description=Internal+error+occurred`,
        undefined,
        env,
      );

      expect(response.status).toBe(400);
      const body = await response.text();
      expect(body).toContain("server_error");
      expect(body).toContain("Internal error occurred");
    });

    it("returns 400 when state query param is missing", async () => {
      const env = makeEnv();

      const response = await KrogerHandler.request(
        `${BASE_URL}/callback?code=auth-code`,
        undefined,
        env,
      );

      expect(response.status).toBe(400);
      expect(await response.text()).toContain("Missing state parameter");
    });

    it("returns 400 when the Cookie header is absent", async () => {
      const env = makeEnv();

      const response = await KrogerHandler.request(
        `${BASE_URL}/callback?code=auth-code&state=some-state`,
        { headers: {} },
        env,
      );

      expect(response.status).toBe(400);
      expect(await response.text()).toContain("Missing authentication cookie");
    });

    it("returns 400 when the Cookie header has no kroger_oauth_state cookie", async () => {
      const env = makeEnv();

      const response = await KrogerHandler.request(
        `${BASE_URL}/callback?code=auth-code&state=some-state`,
        { headers: { Cookie: "some_other_cookie=value" } },
        env,
      );

      expect(response.status).toBe(400);
      expect(await response.text()).toContain("Missing authentication cookie");
    });

    it("returns 400 when kroger_oauth_state cookie has a tampered signature", async () => {
      const env = makeEnv();
      const validCookieValue = await makeStateCookie("test-csrf-state");
      // Flip the first 10 hex chars of the signature to invalidate it
      const tamperedCookieValue = "0000000000" + validCookieValue.slice(10);

      const response = await KrogerHandler.request(
        `${BASE_URL}/callback?code=auth-code&state=test-csrf-state`,
        { headers: { Cookie: `kroger_oauth_state=${tamperedCookieValue}` } },
        env,
      );

      expect(response.status).toBe(400);
      expect(await response.text()).toContain("Invalid authentication cookie");
    });

    it("returns 400 when state mismatch (CSRF protection)", async () => {
      const env = makeEnv();
      const { stateCookieValue } = await getCallbackSetup(env);

      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const response = await KrogerHandler.request(
        `${BASE_URL}/callback?code=auth-code&state=attacker-injected-state`,
        { headers: { Cookie: `kroger_oauth_state=${stateCookieValue}` } },
        env,
      );

      expect(response.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(env.OAUTH_PROVIDER.completeAuthorization).not.toHaveBeenCalled();
    });

    it("returns 400 when oauthReqInfo in state cookie has no clientId", async () => {
      const env = makeEnv();
      const csrfState = "csrf-no-client-id";
      const cookieValue = await makeStateCookie(csrfState, {
        redirectUri: "https://mcp.test/callback",
        scope: "tools",
        // clientId intentionally omitted
      });

      const response = await KrogerHandler.request(
        `${BASE_URL}/callback?code=auth-code&state=${csrfState}`,
        { headers: { Cookie: `kroger_oauth_state=${cookieValue}` } },
        env,
      );

      expect(response.status).toBe(400);
      expect(await response.text()).toContain("missing clientId");
    });

    it("returns 400 when code query param is missing", async () => {
      const env = makeEnv();
      const { stateCookieValue, stateParam } = await getCallbackSetup(env);

      const response = await KrogerHandler.request(
        `${BASE_URL}/callback?state=${stateParam}`,
        { headers: { Cookie: `kroger_oauth_state=${stateCookieValue}` } },
        env,
      );

      expect(response.status).toBe(400);
      expect(await response.text()).toContain("Missing authorization code");
    });

    it("returns 500 when Kroger token exchange returns non-ok HTTP status", async () => {
      const env = makeEnv();
      const csrfState = "csrf-token-error";
      const cookieValue = await makeStateCookie(csrfState);

      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response(
              JSON.stringify({ error: "invalid_grant", error_description: "Code has expired" }),
              { status: 400, headers: { "Content-Type": "application/json" } },
            ),
          ),
      );

      const response = await KrogerHandler.request(
        `${BASE_URL}/callback?code=bad-code&state=${csrfState}`,
        { headers: { Cookie: `kroger_oauth_state=${cookieValue}` } },
        env,
      );

      expect(response.status).toBe(500);
      expect(await response.text()).toContain("Code has expired");
    });

    it("returns 400 when Kroger token response has no access_token", async () => {
      const env = makeEnv();
      const csrfState = "csrf-no-token";
      const cookieValue = await makeStateCookie(csrfState);

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ expires_in: 1800 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );

      const response = await KrogerHandler.request(
        `${BASE_URL}/callback?code=auth-code&state=${csrfState}`,
        { headers: { Cookie: `kroger_oauth_state=${cookieValue}` } },
        env,
      );

      expect(response.status).toBe(400);
      expect(await response.text()).toContain("Missing access token");
    });

    it("falls back to 'unknown' userId when user profile fetch fails", async () => {
      const env = makeEnv();
      const csrfState = "csrf-profile-fail";
      const cookieValue = await makeStateCookie(csrfState);

      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValueOnce(
            new Response(
              JSON.stringify({
                access_token: "access-token",
                expires_in: 1800,
                refresh_token: "refresh-token",
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
          )
          .mockResolvedValueOnce(new Response("Service Unavailable", { status: 503 })),
      );

      const response = await KrogerHandler.request(
        `${BASE_URL}/callback?code=auth-code&state=${csrfState}`,
        { headers: { Cookie: `kroger_oauth_state=${cookieValue}` } },
        env,
      );

      expect(response.status).toBe(302);
      expect(env.OAUTH_PROVIDER.completeAuthorization).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "unknown" }),
      );
    });

    it("full happy path: exchanges code, fetches profile, redirects to MCP client", async () => {
      const env = makeEnv();
      const csrfState = "csrf-happy-path";
      const cookieValue = await makeStateCookie(csrfState);

      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValueOnce(
            new Response(
              JSON.stringify({
                access_token: "access-token",
                expires_in: 1800,
                refresh_token: "refresh-token",
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
          )
          .mockResolvedValueOnce(
            new Response(JSON.stringify({ data: { id: "user-123" } }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          ),
      );

      const response = await KrogerHandler.request(
        `${BASE_URL}/callback?code=auth-code&state=${csrfState}`,
        { headers: { Cookie: `kroger_oauth_state=${cookieValue}` } },
        env,
      );

      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("https://mcp.test/done");
      // State cookie must be cleared
      expect(response.headers.getSetCookie()).toEqual(
        expect.arrayContaining([expect.stringMatching(/kroger_oauth_state=;/)]),
      );
      expect(env.OAUTH_PROVIDER.completeAuthorization).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "user-123" }),
      );
    });

    it("stores Kroger credentials in grant props so token refresh can use them", async () => {
      const env = makeEnv();
      const csrfState = "csrf-check-props";
      const cookieValue = await makeStateCookie(csrfState);

      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValueOnce(
            new Response(
              JSON.stringify({
                access_token: "at",
                refresh_token: "rt",
                expires_in: 1800,
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
          )
          .mockResolvedValueOnce(
            new Response(JSON.stringify({ data: { id: "user-456" } }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          ),
      );

      await KrogerHandler.request(
        `${BASE_URL}/callback?code=auth-code&state=${csrfState}`,
        { headers: { Cookie: `kroger_oauth_state=${cookieValue}` } },
        env,
      );

      expect(env.OAUTH_PROVIDER.completeAuthorization).toHaveBeenCalledWith(
        expect.objectContaining({
          props: expect.objectContaining({
            accessToken: "at",
            refreshToken: "rt",
            krogerClientId: "test-client-id",
            krogerClientSecret: "test-client-secret",
          }),
        }),
      );
    });

    it("returns 500 when completeAuthorization throws", async () => {
      const env = makeEnv();
      const csrfState = "csrf-complete-throws";
      const cookieValue = await makeStateCookie(csrfState);

      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValueOnce(
            new Response(
              JSON.stringify({ access_token: "at", expires_in: 1800, refresh_token: "rt" }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
          )
          .mockResolvedValueOnce(
            new Response(JSON.stringify({ data: { id: "user-789" } }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          ),
      );
      env.OAUTH_PROVIDER.completeAuthorization = vi
        .fn()
        .mockRejectedValue(new Error("authorization server rejected"));

      const response = await KrogerHandler.request(
        `${BASE_URL}/callback?code=auth-code&state=${csrfState}`,
        { headers: { Cookie: `kroger_oauth_state=${cookieValue}` } },
        env,
      );

      expect(response.status).toBe(500);
      expect(await response.text()).toContain("Failed to complete authorization");
    });
  });
});
