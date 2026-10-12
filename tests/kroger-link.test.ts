import { SELF, env, reset } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authIdentity, pkceChallenge } from "../src/services/better-auth.js";
import {
  fixtureDiscovery,
  fixtureJwks,
  fixtureToken,
} from "./better-auth-fixture.js";

const appOrigin = new URL(env.MCP_RESOURCE_URL).origin;

function bindingCookie(response: Response, state: string) {
  const cookie = response.headers
    .getSetCookie()
    .find((value) => value.startsWith(`__Host-shopping-link-${state}=`));

  if (!cookie) throw new Error("Missing browser binding cookie");

  return cookie.split(";")[0];
}

function authUrl(
  state: string,
  issuer: string | null = env.BETTER_AUTH_ISSUER,
) {
  const url = new URL("/auth/callback", appOrigin);
  url.searchParams.set("code", "auth-code");
  url.searchParams.set("state", state);

  if (issuer !== null) url.searchParams.set("iss", issuer);

  return url;
}

describe("browser Kroger account connection", () => {
  let nonce: string;
  let badNonce: boolean;
  let badProfile: boolean;
  let issuerParameterSupported: boolean | undefined;
  let codeChallenge: string;
  let tokenCalls: number;
  let krogerCalls: number;

  let exchangeDetails:
    | {
        redirectUri: string | null;
        resource: string | null;
        codeChallenge: string;
      }
    | undefined;

  beforeEach(async () => {
    await reset();
    nonce = "";
    badNonce = false;
    badProfile = false;
    issuerParameterSupported = true;
    codeChallenge = "";
    tokenCalls = 0;
    krogerCalls = 0;
    exchangeDetails = undefined;
    const jwks = await fixtureJwks();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const url = input instanceof Request ? input.url : input.toString();

        if (url === env.BETTER_AUTH_JWKS_URL) return Response.json(jwks);

        if (url.endsWith("/.well-known/openid-configuration"))
          return Response.json({
            ...fixtureDiscovery(),
            authorization_response_iss_parameter_supported:
              issuerParameterSupported,
          });

        if (url === `${env.BETTER_AUTH_ISSUER}/oauth2/token`) {
          tokenCalls++;
          const body = new URLSearchParams(String(init?.body));
          exchangeDetails = {
            redirectUri: body.get("redirect_uri"),
            resource: body.get("resource"),
            codeChallenge: await pkceChallenge(body.get("code_verifier") ?? ""),
          };

          const accessToken = await fixtureToken("browser-user", {
            client_id: env.BETTER_AUTH_CLIENT_ID,
          });

          const idToken = await fixtureToken(
            "browser-user",
            {
              aud: env.BETTER_AUTH_CLIENT_ID,
              nonce: badNonce ? "wrong-nonce" : nonce,
              scope: undefined,
              client_id: undefined,
            },
            "JWT",
          );

          return Response.json({
            access_token: accessToken,
            id_token: idToken,
          });
        }

        if (url === "https://api.kroger.com/v1/connect/oauth2/token") {
          krogerCalls++;

          return Response.json({
            access_token: "kroger-access",
            refresh_token: "kroger-refresh",
            expires_in: 1800,
          });
        }

        if (url === "https://api.kroger.com/v1/identity/profile")
          return Response.json({
            data: { id: badProfile ? "unknown" : "kroger-shopper" },
          });
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function start() {
    const response = await SELF.fetch(
      new Request(`${appOrigin}/connect/kroger`, {
        redirect: "manual",
      }),
    );

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("Location") ?? "");
    nonce = location.searchParams.get("nonce") ?? "";
    codeChallenge = location.searchParams.get("code_challenge") ?? "";
    const state = location.searchParams.get("state") ?? "";

    return {
      response,
      location,
      state,
      cookie: bindingCookie(response, state),
    };
  }

  async function authCallback(issuer: string | null = env.BETTER_AUTH_ISSUER) {
    const flow = await start();

    const response = await SELF.fetch(
      new Request(authUrl(flow.state, issuer), {
        redirect: "manual",
        headers: { Cookie: flow.cookie },
      }),
    );

    return { ...flow, callback: response };
  }

  it("uses OIDC state, nonce, S256 and the configured callback; links only the verified subject", async () => {
    const flow = await authCallback();
    expect(flow.location.searchParams.get("scope")).toBe("openid mcp:tools");
    expect(flow.location.searchParams.get("code_challenge_method")).toBe(
      "S256",
    );
    expect(flow.location.searchParams.get("resource")).toBe(
      env.MCP_RESOURCE_URL,
    );
    expect(flow.callback.status).toBe(302);
    const location = new URL(flow.callback.headers.get("Location") ?? "");
    expect(location.origin).toBe("https://api.kroger.com");
    expect(location.href).toContain(
      "profile.compact%20cart.basic%3Awrite%20product.compact",
    );
    const state = location.searchParams.get("state") ?? "";
    const cookie = bindingCookie(flow.callback, state);
    const callbackUrl = `${appOrigin}/callback?code=kroger-code&state=${state}`;

    const response = await SELF.fetch(
      new Request(callbackUrl, { headers: { Cookie: cookie } }),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Kroger is connected");
    expect(tokenCalls).toBe(1);
    expect(exchangeDetails).toEqual({
      redirectUri: `${appOrigin}/auth/callback`,
      resource: env.MCP_RESOURCE_URL,
      codeChallenge,
    });
    expect(krogerCalls).toBe(1);
    const identity = authIdentity(env.BETTER_AUTH_ISSUER, "browser-user");
    expect(
      await exports.KrogerConnections.getByName(identity.id).getToken(),
    ).toMatchObject({
      status: "connected",
      token: { accessToken: "kroger-access" },
    });
    expect(
      (
        await SELF.fetch(
          new Request(callbackUrl, { headers: { Cookie: cookie } }),
        )
      ).status,
    ).toBe(400);
    expect(krogerCalls).toBe(1);
  });

  it("rejects a stolen state in another browser and accepts the bound browser only once", async () => {
    const flow = await start();
    const url = authUrl(flow.state);
    expect((await SELF.fetch(url)).status).toBe(400);
    expect(tokenCalls).toBe(0);
    expect(
      (
        await SELF.fetch(
          new Request(url, {
            redirect: "manual",
            headers: { Cookie: flow.cookie },
          }),
        )
      ).status,
    ).toBe(302);
    expect(
      (
        await SELF.fetch(
          new Request(url, {
            redirect: "manual",
            headers: { Cookie: flow.cookie },
          }),
        )
      ).status,
    ).toBe(400);
    expect(tokenCalls).toBe(1);
  });

  it("rejects a nonce mismatch before authorizing Kroger", async () => {
    badNonce = true;
    const flow = await authCallback();
    expect(flow.callback.status).toBe(502);
    expect(flow.callback.headers.get("Location")).toBeNull();
    expect(krogerCalls).toBe(0);
  });

  it.each([
    null,
    "",
    "https://attacker.example",
    `${env.BETTER_AUTH_ISSUER}/`,
    env.BETTER_AUTH_ISSUER.toUpperCase(),
  ])(
    "rejects missing or mismatched response issuer %s before exchanging a code",
    async (issuer) => {
      const flow = await authCallback(issuer);
      expect(flow.callback.status).toBe(400);
      expect(flow.callback.headers.get("Location")).toBeNull();
      expect(tokenCalls).toBe(0);
      expect(krogerCalls).toBe(0);
    },
  );

  it("rejects duplicate issuers and validates issuer before handling provider errors", async () => {
    const flow = await start();
    const url = authUrl(flow.state);
    url.searchParams.append("iss", env.BETTER_AUTH_ISSUER);
    url.searchParams.set("error", "access_denied");

    const response = await SELF.fetch(
      new Request(url, { headers: { Cookie: flow.cookie } }),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Invalid sign-in issuer");
    expect(tokenCalls).toBe(0);
  });

  it("rejects a mismatched issuer on an error response", async () => {
    const flow = await start();
    const url = authUrl(flow.state, "https://attacker.example");
    url.searchParams.set("error", "access_denied");

    const response = await SELF.fetch(
      new Request(url, { headers: { Cookie: flow.cookie } }),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Invalid sign-in issuer");
    expect(tokenCalls).toBe(0);
  });

  it("uses the issuer-support flag captured when sign-in started", async () => {
    const flow = await start();
    issuerParameterSupported = false;

    const response = await SELF.fetch(
      new Request(authUrl(flow.state, null), {
        headers: { Cookie: flow.cookie },
      }),
    );

    expect(response.status).toBe(400);
    expect(tokenCalls).toBe(0);
  });

  it.each([false, undefined])(
    "permits an absent issuer when the advertisement is %s",
    async (advertised) => {
      issuerParameterSupported = advertised;
      const flow = await authCallback(null);
      expect(flow.callback.status).toBe(302);
      expect(tokenCalls).toBe(1);
    },
  );

  it("handles a declined sign-in only after validating its issuer", async () => {
    const flow = await start();
    const url = authUrl(flow.state);
    url.searchParams.set("error", "access_denied");

    const response = await SELF.fetch(
      new Request(url, { headers: { Cookie: flow.cookie } }),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Sign-in was declined");
    expect(tokenCalls).toBe(0);
    expect(krogerCalls).toBe(0);
  });

  it("still rejects a wrong issuer when support was not advertised", async () => {
    issuerParameterSupported = false;
    const flow = await authCallback("https://attacker.example");
    expect(flow.callback.status).toBe(400);
    expect(tokenCalls).toBe(0);
  });

  it("does not connect an unverifiable Kroger profile", async () => {
    badProfile = true;
    const flow = await authCallback();
    const location = new URL(flow.callback.headers.get("Location") ?? "");
    const state = location.searchParams.get("state") ?? "";

    const response = await SELF.fetch(
      new Request(`${appOrigin}/callback?code=kroger-code&state=${state}`, {
        headers: { Cookie: bindingCookie(flow.callback, state) },
      }),
    );

    expect(response.status).toBe(502);
    const identity = authIdentity(env.BETTER_AUTH_ISSUER, "browser-user");
    expect(
      await exports.KrogerConnections.getByName(identity.id).getToken(),
    ).toEqual({ status: "not_connected" });
  });
});
