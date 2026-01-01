import type {
  AuthRequest,
  OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
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
  // Create authorization URL using standard URL API
  // Parameter order matches Kroger's documentation example
  const authorizeUrl = new URL(
    "https://api.kroger.com/v1/connect/oauth2/authorize",
  );
  const redirectUri = new URL("/callback", request.url).href;

  // Set parameters in the order shown in Kroger's documentation
  // https://developer.kroger.com/reference/api/authorization-endpoints-public
  authorizeUrl.searchParams.set(
    "scope",
    "profile.compact cart.basic:write product.compact",
  );
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", env.KROGER_CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", btoa(JSON.stringify(oauthReqInfo)));

  console.log("Redirecting to Kroger OAuth:", {
    redirect_uri: redirectUri,
    client_id: env.KROGER_CLIENT_ID.substring(0, 20) + "...",
  });

  return new Response(null, {
    status: 302,
    headers: {
      ...headers,
      Location: authorizeUrl.href,
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

  // Get the oauthReqInfo out of state
  const stateParam = c.req.query("state");
  if (!stateParam) {
    console.error("Callback missing state parameter");
    return c.text("Missing state parameter", 400);
  }

  console.log("Callback received with state length:", stateParam.length);

  let oauthReqInfo: AuthRequest;
  try {
    const decodedState = atob(stateParam);
    console.log("Decoded state:", decodedState.substring(0, 100) + "...");
    oauthReqInfo = JSON.parse(decodedState) as AuthRequest;
  } catch (e) {
    console.error("Failed to parse state parameter:", e, "Raw state:", stateParam.substring(0, 50));
    return c.text("Invalid state parameter", 400);
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
    client_id: c.env.KROGER_CLIENT_ID.substring(0, 20) + "...",
  });

  const tokenResponse = await fetch(
    "https://api.kroger.com/v1/connect/oauth2/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${c.env.KROGER_CLIENT_ID}:${c.env.KROGER_CLIENT_SECRET}`)}`,
      },
      body: tokenBody.toString(),
    },
  );

  const tokenData = (await tokenResponse.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
    error?: string;
    error_description?: string;
  };

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
  const profileResponse = await fetch(
    "https://api.kroger.com/v1/identity/profile",
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    },
  );

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
        expiresIn: tokenData.expires_in,
        krogerClientId: c.env.KROGER_CLIENT_ID,
        krogerClientSecret: c.env.KROGER_CLIENT_SECRET,
      },
    });

    console.log("Authorization complete, redirecting to:", redirectTo.substring(0, 100) + "...");

    return Response.redirect(redirectTo);
  } catch (completeError) {
    console.error("Failed to complete authorization:", completeError);
    return c.text(
      `Failed to complete authorization: ${completeError instanceof Error ? completeError.message : "Unknown error"}`,
      500,
    );
  }
});

export { app as KrogerHandler };
