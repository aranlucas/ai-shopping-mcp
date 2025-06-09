import type {
  AuthRequest,
  OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import { authClient, identityClient } from "./services/kroger/client";
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
  const authorizeUrl = new URL(
    "https://api.kroger.com/v1/connect/oauth2/authorize",
  );
  authorizeUrl.searchParams.set("client_id", env.KROGER_CLIENT_ID);
  authorizeUrl.searchParams.set(
    "redirect_uri",
    new URL("/callback", request.url).href,
  );
  authorizeUrl.searchParams.set(
    "scope",
    "profile.compact cart.basic:write product.compact",
  );
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("state", btoa(JSON.stringify(oauthReqInfo)));

  return new Response(null, {
    status: 302,
    headers: {
      ...headers,
      location: authorizeUrl.href,
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

  const code = c.req.query("code");
  if (!code) {
    return c.text("Missing code", 400);
  }

  // Exchange the code for an access token using the auth client
  const { data, error } = await authClient.POST("/v1/connect/oauth2/token", {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    params: {
      header: {
        Authorization: `Basic ${btoa(`${c.env.KROGER_CLIENT_ID}:${c.env.KROGER_CLIENT_SECRET}`)}`,
      },
    },
    body: {
      grant_type: "authorization_code",
      code: code,
      redirect_uri: new URL("/callback", c.req.url).href,
    },
    bodySerializer(body) {
      const fd = new URLSearchParams();
      for (const name in body) {
        fd.append(name, body[name as keyof typeof body]);
      }
      return fd.toString();
    },
  });

  // Check for errors
  if (error || !data) {
    console.error("Failed to fetch access token:", error);
    return c.text("Failed to fetch access token", 500);
  }

  // Extract tokens
  const accessToken = data.access_token;

  if (!accessToken) {
    return c.text("Missing access token", 400);
  }

  // Fetch the user profile from Kroger
  const { data: profileData } = await identityClient.GET(
    "/v1/identity/profile",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    },
  );

  const id = profileData?.data?.id || "unknown";

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
      expiresIn: data.expires_in,
    },
  });

  return Response.redirect(redirectTo);
});

export { app as KrogerHandler };
