import type {
  AuthRequest,
  OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import { identityClient } from "./services/kroger/client";
import { fetchUpstreamAuthToken, getUpstreamAuthorizeUrl } from "./utils";
import {
  clientIdAlreadyApproved,
  parseRedirectApproval,
  renderApprovalDialog,
} from "./workers-oauth-utils";

// Define Env interface with required environment variables
interface Env {
  KROGER_CLIENT_ID: string;
  KROGER_CLIENT_SECRET: string;
  COOKIE_ENCRYPTION_KEY: string;
}

const app = new Hono<{ Bindings: Env & { OAUTH_PROVIDER: OAuthHelpers } }>();

app.get("/authorize", async (c) => {
  const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  const { clientId } = oauthReqInfo;
  if (!clientId) {
    return c.text("Invalid request", 400);
  }

  if (
    await clientIdAlreadyApproved(
      c.req.raw,
      oauthReqInfo.clientId,
      c.env.COOKIE_ENCRYPTION_KEY,
    )
  ) {
    return redirectToKroger(c.req.raw, oauthReqInfo, c.env);
  }

  return renderApprovalDialog(c.req.raw, {
    client: await c.env.OAUTH_PROVIDER.lookupClient(clientId),
    server: {
      name: "Kroger Shopping List API",
      logo: "https://www.kroger.com/content/v2/binary/image/banner/logowhite/imageset/kroger_svg_logo_link_white--kroger_svg_logo_link_white--freshcart-singlecolor.svg",
      description:
        "This server allows access to Kroger Shopping List and Product APIs.",
    },
    state: { oauthReqInfo },
  });
});

app.post("/authorize", async (c) => {
  // Validates form submission, extracts state, and generates Set-Cookie headers to skip approval dialog next time
  const { state, headers } = await parseRedirectApproval(
    c.req.raw,
    c.env.COOKIE_ENCRYPTION_KEY,
  );
  if (!state.oauthReqInfo) {
    return c.text("Invalid request", 400);
  }

  return redirectToKroger(
    c.req.raw,
    state.oauthReqInfo as AuthRequest,
    c.env,
    headers,
  );
});

async function redirectToKroger(
  request: Request,
  oauthReqInfo: AuthRequest,
  env: Env & { OAUTH_PROVIDER: OAuthHelpers },
  headers: Record<string, string> = {},
) {
  return new Response(null, {
    status: 302,
    headers: {
      ...headers,
      location: getUpstreamAuthorizeUrl({
        upstream_url: "https://api.kroger.com/v1/connect/oauth2/authorize",
        scope: "profile.compact cart.basic:write product.compact",
        client_id: env.KROGER_CLIENT_ID,
        redirect_uri: new URL("/callback", request.url).href,
        state: btoa(JSON.stringify(oauthReqInfo)),
      }),
    },
  });
}

/**
 * OAuth Callback Endpoint
 *
 * This route handles the callback from Kroger after user authentication.
 * It exchanges the temporary code for an access token, then stores some
 * user metadata & the auth token as part of the 'props' on the token passed
 * down to the client. It ends by redirecting the client back to _its_ callback URL
 */
app.get("/callback", async (c) => {
  // Get the oathReqInfo out of state
  const oauthReqInfo = JSON.parse(
    atob(c.req.query("state") as string),
  ) as AuthRequest;
  if (!oauthReqInfo.clientId) {
    return c.text("Invalid state", 400);
  }

  // Exchange the code for an access token
  const tokenResponse = await fetchUpstreamAuthToken({
    upstream_url: "https://api.kroger.com/v1/connect/oauth2/token",
    client_id: c.env.KROGER_CLIENT_ID,
    client_secret: c.env.KROGER_CLIENT_SECRET,
    code: c.req.query("code"),
    redirect_uri: new URL("/callback", c.req.url).href,
  });

  // Check error response
  if (tokenResponse.length === 2 && tokenResponse[1] instanceof Response) {
    return tokenResponse[1];
  }

  // Extract tokens
  const accessToken = tokenResponse[0];
  let refreshToken = "";

  // Check if we have a refresh token (it will be at index 1 if there are 3 elements)
  if (tokenResponse.length === 3) {
    refreshToken = tokenResponse[1] as string;
  }

  // Fetch the user profile from Kroger
  const { data } = await identityClient.GET("/v1/identity/profile", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  // Safely access profile data with defaults
  const id = data?.data?.id || "unknown";

  // Return back to the MCP client a new token
  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthReqInfo,
    userId: id,
    metadata: {},
    scope: oauthReqInfo.scope,
    // This will be available on this.props inside the client
    props: {
      id,
      accessToken,
      refreshToken,
    },
  });

  return Response.redirect(redirectTo);
});

export { app as KrogerHandler };
