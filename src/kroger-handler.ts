import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";

import { Hono } from "hono";

import type { KrogerTokenResponse } from "./services/kroger/client.js";

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
  console.log("GET /authorize - Starting authorization flow");

  let oauthReqInfo: AuthRequest;
  try {
    oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
    console.log("Parsed auth request:", {
      clientId: oauthReqInfo.clientId,
      redirectUri: oauthReqInfo.redirectUri,
      scope: oauthReqInfo.scope,
    });
  } catch (parseError) {
    console.error("Failed to parse auth request:", parseError);
    return c.text(
      `Failed to parse auth request: ${parseError instanceof Error ? parseError.message : "Unknown error"}`,
      400,
    );
  }

  const { clientId } = oauthReqInfo;
  if (!clientId) {
    console.error("Missing clientId in auth request");
    return c.text("Invalid request - missing clientId", 400);
  }

  if (
    await clientIdAlreadyApproved(c.req.raw, oauthReqInfo.clientId, c.env.COOKIE_ENCRYPTION_KEY)
  ) {
    console.log("Client already approved, redirecting to Kroger");
    return redirectToKroger(c.req.raw, oauthReqInfo, c.env);
  }

  console.log("Showing approval dialog");
  return renderApprovalDialog(c.req.raw, {
    client: await c.env.OAUTH_PROVIDER.lookupClient(clientId),
    server: {
      name: "Kroger Shopping List API",
      logo: "https://www.kroger.com/content/v2/binary/image/banner/logowhite/imageset/kroger_svg_logo_link_white--kroger_svg_logo_link_white--freshcart-singlecolor.svg",
      description: "This server allows access to Kroger Shopping List and Product APIs.",
    },
    state: { oauthReqInfo },
  });
});

app.post("/authorize", async (c) => {
  console.log("POST /authorize - Processing approval");

  let state: { oauthReqInfo?: AuthRequest };
  let headers: Record<string, string>;
  try {
    // Validates form submission, extracts state, and generates Set-Cookie headers to skip approval dialog next time
    const result = await parseRedirectApproval(c.req.raw, c.env.COOKIE_ENCRYPTION_KEY);
    state = result.state;
    headers = result.headers;
    console.log("Parsed approval, state has oauthReqInfo:", !!state.oauthReqInfo);
  } catch (parseError) {
    console.error("Failed to parse approval:", parseError);
    return c.text(
      `Failed to parse approval: ${parseError instanceof Error ? parseError.message : "Unknown error"}`,
      400,
    );
  }

  if (!state.oauthReqInfo) {
    console.error("Missing oauthReqInfo in state");
    return c.text("Invalid request - missing oauthReqInfo", 400);
  }

  console.log("Redirecting to Kroger after approval");
  return redirectToKroger(c.req.raw, state.oauthReqInfo as AuthRequest, c.env, headers);
});

async function redirectToKroger(
  request: Request,
  _oauthReqInfo: AuthRequest, // Stored in cookie instead of state param
  env: Env & { OAUTH_PROVIDER: OAuthHelpers },
  headers: Record<string, string> = {},
) {
  console.log("Building Kroger redirect URL");

  if (!env.KROGER_CLIENT_ID || !env.KROGER_CLIENT_SECRET) {
    console.error("Missing Kroger OAuth credentials in environment");
    return new Response("Server configuration error: Missing Kroger OAuth credentials", {
      status: 500,
    });
  }

  const redirectUri = new URL("/callback", request.url).href;

  // Build authorization URL manually with encodeURIComponent to ensure
  // spaces are encoded as %20 (not +) as required by Kroger
  // Parameter order matches Postman working request

  // IMPORTANT: Kroger requires spaces encoded as %20, NOT +
  // Do NOT use URLSearchParams.set() as it encodes spaces as +
  // Must use encodeURIComponent() which produces %20
  const scope = "profile.compact cart.basic:write product.compact";

  // Generate a simple random state for CSRF protection (Kroger requirement)
  // Store oauthReqInfo in a cookie to avoid large state params
  const csrfState = crypto.randomUUID();
  const oauthInfoB64 = btoa(JSON.stringify(_oauthReqInfo));
  const cookieValue = `kroger_oauth_state=${oauthInfoB64}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/`;

  // Order matches Postman: response_type, client_id, scope, redirect_uri, state
  // State is a simple UUID for CSRF protection (not the full oauthReqInfo)
  const fullUrl =
    "https://api.kroger.com/v1/connect/oauth2/authorize?" +
    `response_type=code` +
    `&client_id=${encodeURIComponent(env.KROGER_CLIENT_ID)}` +
    `&scope=${encodeURIComponent(scope)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(csrfState)}`;
  console.log("Kroger OAuth redirect:", {
    redirect_uri: redirectUri,
    client_id: env.KROGER_CLIENT_ID ? `${env.KROGER_CLIENT_ID.substring(0, 20)}...` : "MISSING!",
    full_url_length: fullUrl.length,
    url_preview: `${fullUrl.substring(0, 150)}...`,
  });

  return new Response(null, {
    status: 302,
    headers: {
      ...headers,
      "Set-Cookie": cookieValue,
      Location: fullUrl,
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
  // Check for OAuth errors from Kroger
  const oauthError = c.req.query("error");
  const errorDescription = c.req.query("error_description");

  if (oauthError) {
    console.error("OAuth error from Kroger:", {
      error: oauthError,
      error_description: errorDescription,
    });
    return c.text(
      `Kroger OAuth error: ${oauthError}${errorDescription ? ` - ${errorDescription}` : ""}`,
      400,
    );
  }

  // Verify state parameter exists (CSRF protection)
  const stateParam = c.req.query("state");
  if (!stateParam) {
    console.error("Callback missing state parameter");
    return c.text("Missing state parameter", 400);
  }

  console.log("Callback received with state:", stateParam);

  // Retrieve oauthReqInfo from cookie instead of state parameter
  const cookieHeader = c.req.header("Cookie");
  if (!cookieHeader) {
    console.error("Missing cookie header in callback");
    return c.text("Missing authentication cookie", 400);
  }

  const cookies = Object.fromEntries(
    cookieHeader.split(";").map((c) => {
      const [key, ...values] = c.trim().split("=");
      return [key, values.join("=")];
    }),
  );

  const oauthInfoB64 = cookies.kroger_oauth_state;
  if (!oauthInfoB64) {
    console.error("Missing kroger_oauth_state cookie");
    return c.text("Missing authentication cookie", 400);
  }

  let oauthReqInfo: AuthRequest;
  try {
    const decoded = atob(oauthInfoB64);
    oauthReqInfo = JSON.parse(decoded) as AuthRequest;
    console.log("Retrieved oauthReqInfo from cookie");
  } catch (e) {
    console.error("Failed to parse oauthReqInfo from cookie:", e);
    return c.text("Invalid authentication cookie", 400);
  }

  if (!oauthReqInfo.clientId) {
    console.error("State missing clientId:", JSON.stringify(oauthReqInfo));
    return c.text("Invalid state: missing clientId", 400);
  }

  console.log("OAuth request info:", {
    clientId: oauthReqInfo.clientId,
    redirectUri: oauthReqInfo.redirectUri,
    hasCodeChallenge: !!oauthReqInfo.codeChallenge,
  });

  const code = c.req.query("code");
  if (!code) {
    return c.text("Missing authorization code", 400);
  }

  // Exchange the code for an access token using direct fetch
  // This is more reliable than openapi-fetch for the OAuth token endpoint
  const redirectUri = new URL("/callback", c.req.url).href;
  const tokenBody = new URLSearchParams({
    grant_type: "authorization_code",
    code: code,
    redirect_uri: redirectUri,
  });

  console.log("Exchanging authorization code for token:", {
    redirect_uri: redirectUri,
    client_id: `${c.env.KROGER_CLIENT_ID.substring(0, 20)}...`,
  });

  const tokenResponse = await fetch("https://api.kroger.com/v1/connect/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${c.env.KROGER_CLIENT_ID}:${c.env.KROGER_CLIENT_SECRET}`)}`,
    },
    body: tokenBody.toString(),
    signal: AbortSignal.timeout(30_000),
  });

  const tokenData = (await tokenResponse.json()) as KrogerTokenResponse;

  // Check for errors
  if (!tokenResponse.ok) {
    console.error("Failed to fetch access token:", {
      status: tokenResponse.status,
      statusText: tokenResponse.statusText,
      error: tokenData.error,
      errorDescription: tokenData.error_description,
    });
    return c.text(
      `Failed to fetch access token: ${tokenData.error_description || tokenData.error || "Unknown error"}`,
      500,
    );
  }

  // Extract tokens
  const accessToken = tokenData.access_token;
  const refreshToken = tokenData.refresh_token;

  if (!accessToken) {
    console.error("Token response missing access_token:", tokenData);
    return c.text("Missing access token in response", 400);
  }

  // Fetch the user profile from Kroger using direct fetch
  const profileResponse = await fetch("https://api.kroger.com/v1/identity/profile", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  });

  let id = "unknown";
  if (profileResponse.ok) {
    const profileData = (await profileResponse.json()) as {
      data?: { id?: string };
    };
    id = profileData?.data?.id || "unknown";
  } else {
    console.warn("Failed to fetch user profile, using 'unknown' as user ID");
  }

  // Calculate when the token expires (current time + expires_in seconds)
  const tokenExpiresAt = Date.now() + (tokenData.expires_in || 1800) * 1000;

  // Return back to the MCP client a new token
  console.log("Completing authorization for user:", id);

  try {
    const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
      request: oauthReqInfo,
      userId: id,
      metadata: {},
      scope: oauthReqInfo.scope,
      // This will be available on this.props inside the client
      // Kroger credentials are included so tokenExchangeCallback can refresh tokens
      props: {
        id,
        accessToken,
        refreshToken,
        tokenExpiresAt,
        krogerClientId: c.env.KROGER_CLIENT_ID,
        krogerClientSecret: c.env.KROGER_CLIENT_SECRET,
      },
    });

    console.log("Authorization complete, redirecting to:", `${redirectTo.substring(0, 100)}...`);

    // Clear the OAuth state cookie and redirect
    return new Response(null, {
      status: 302,
      headers: {
        Location: redirectTo,
        "Set-Cookie": "kroger_oauth_state=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/",
      },
    });
  } catch (completeError) {
    console.error("Failed to complete authorization:", completeError);
    return c.text(
      `Failed to complete authorization: ${completeError instanceof Error ? completeError.message : "Unknown error"}`,
      500,
    );
  }
});

export { app as KrogerHandler };
