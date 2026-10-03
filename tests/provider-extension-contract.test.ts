import { OAuthAuthorizationServer } from "@cloudflare/workers-oauth-provider";
import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { oauthProvider } from "../src/server.js";
import type { AppEnv } from "../src/env.js";

const resource = env.MCP_RESOURCE_URL;

const redirectUri = "https://synthetic-client.example/callback";

// Real SDK helpers create only synthetic grants in the in-process test KV.
// The exported production provider handles the exchange; its callback stays private.
const issuer = new OAuthAuthorizationServer<AppEnv>({
  issuer: resource,
  resources: [resource],
  defaultResource: resource,
  authorizeEndpoint: `${resource}/authorize`,
  tokenEndpoint: `${resource}/token`,
  scopesSupported: ["profile.compact"],
});

function grantProps() {
  return {
    ["__proto__"]: { future: true },
    constructor: "opaque",
    prototype: [1],
    extension: { nested: [null, "provider-extension"] },
    id: "synthetic-extension-user",
    accessToken: "synthetic-kroger-access",
    tokenExpiresAt: Date.now() + 1_800_000,
    refreshToken: "synthetic-kroger-refresh",
    krogerClientId: "synthetic-kroger-client",
    krogerClientSecret: "synthetic-kroger-secret",
  };
}

async function exchangeGrant(
  props:
    | ReturnType<typeof grantProps>
    | (Omit<ReturnType<typeof grantProps>, "accessToken"> & {
        accessToken: number;
      }),
) {
  const helpers = issuer.getOAuthApi(env);

  const client = await helpers.createClient({
    redirectUris: [redirectUri],
    clientName: "Synthetic extension client",
    tokenEndpointAuthMethod: "client_secret_basic",
  });

  if (!client.clientSecret)
    throw new Error("Synthetic confidential client has no secret");
  const authorizeUrl = new URL(`${resource}/authorize`);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", client.clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", "profile.compact");
  authorizeUrl.searchParams.set("state", "synthetic-client-state");
  const request = await helpers.parseAuthRequest(new Request(authorizeUrl));

  const completed = await helpers.completeAuthorization({
    request,
    userId: props.id,
    metadata: {},
    scope: request.scope,
    props,
  });

  const code = new URL(completed.redirectTo).searchParams.get("code");

  if (!code) throw new Error("Synthetic authorization code missing");
  const ctx = createExecutionContext();

  const response = await oauthProvider.fetch(
    new Request(`${resource}/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${client.clientId}:${client.clientSecret}`)}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    }),
    env,
    ctx,
  );

  await waitOnExecutionContext(ctx);

  return response;
}

describe("production grant extension forwarding", () => {
  it("retains opaque own keys while removing grant-only credentials", async () => {
    const props = grantProps();
    const response = await exchangeGrant(props);
    expect(response.status).toBe(200);

    const token = z
      .object({ access_token: z.string() })
      .parse(await response.json());

    const validated = await issuer.validateToken<unknown>(
      resource,
      token.access_token,
      env,
    );

    const { refreshToken, krogerClientId, krogerClientSecret, ...expected } =
      props;

    expect(refreshToken).toBe("synthetic-kroger-refresh");
    expect(krogerClientId).toBe("synthetic-kroger-client");
    expect(krogerClientSecret).toBe("synthetic-kroger-secret");
    expect(JSON.stringify(validated?.props)).toBe(JSON.stringify(expected));
    expect(validated?.props).toEqual(expected);
  });

  it("still rejects malformed named grant fields before issuing a token", async () => {
    const response = await exchangeGrant({ ...grantProps(), accessToken: 42 });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_grant" });
  });
});
