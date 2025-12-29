import { Hono } from "hono";
import { authClient, identityClient } from "./services/kroger/client";
import {
  krogerOAuthMetadata,
  createProtectedResourceMetadata,
} from "./oauth-metadata";

// Define Env interface with required environment variables
interface Env {
  KROGER_CLIENT_ID: string;
  KROGER_CLIENT_SECRET: string;
}

const app = new Hono<{ Bindings: Env }>();

// OAuth 2.0 Discovery Endpoints
// These tell MCP clients that this server uses Kroger for authentication

/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414)
 * Advertises Kroger's OAuth endpoints to MCP clients
 */
app.get("/.well-known/oauth-authorization-server", (c) => {
  return c.json(krogerOAuthMetadata);
});

/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728)
 * Declares that this MCP server uses Kroger as its authorization server
 */
app.get("/.well-known/oauth-protected-resource", (c) => {
  const resourceServerUrl = new URL(c.req.url).origin;
  return c.json(createProtectedResourceMetadata(resourceServerUrl));
});

/**
 * Simplified OAuth Authorization Endpoint
 * Redirects directly to Kroger for authentication
 */
app.get("/authorize", async (c) => {
  const redirect_uri = c.req.query("redirect_uri");
  const state = c.req.query("state");
  const scope = c.req.query("scope") || "profile.compact cart.basic:write product.compact";

  if (!redirect_uri) {
    return c.text("Missing redirect_uri parameter", 400);
  }

  // Create authorization URL for Kroger
  const authorizeUrl = new URL(
    "https://api.kroger.com/v1/connect/oauth2/authorize",
  );
  authorizeUrl.searchParams.set("client_id", c.env.KROGER_CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", new URL("/callback", c.req.url).href);
  authorizeUrl.searchParams.set("scope", scope);
  authorizeUrl.searchParams.set("response_type", "code");

  // Encode the original redirect_uri and state in our state parameter
  const encodedState = btoa(JSON.stringify({ redirect_uri, state }));
  authorizeUrl.searchParams.set("state", encodedState);

  return c.redirect(authorizeUrl.href, 302);
});

/**
 * OAuth Callback Endpoint
 * Receives authorization code from Kroger and exchanges it for access token
 */
app.get("/callback", async (c) => {
  const code = c.req.query("code");
  const stateParam = c.req.query("state");

  if (!code || !stateParam) {
    return c.text("Missing code or state parameter", 400);
  }

  // Decode the state to get the original redirect_uri
  let originalState: { redirect_uri: string; state?: string };
  try {
    originalState = JSON.parse(atob(stateParam));
  } catch (e) {
    return c.text("Invalid state parameter", 400);
  }

  // Exchange the code for an access token
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

  if (error || !data) {
    console.error("Failed to exchange code for token:", error);
    return c.text("Failed to obtain access token", 500);
  }

  // Extract tokens
  const accessToken = data.access_token;
  const refreshToken = "refresh_token" in data ? data.refresh_token : undefined;
  const expiresIn = data.expires_in || 1800;

  if (!accessToken) {
    return c.text("Missing access token in response", 400);
  }

  // Fetch user profile to get user ID
  const { data: profileData } = await identityClient.GET(
    "/v1/identity/profile",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    },
  );

  const userId = profileData?.data?.id || "unknown";

  // Redirect back to the client with tokens
  // Note: In a real implementation, you'd want to use a more secure method
  // to pass tokens back (e.g., encrypted cookie, session storage, etc.)
  const redirectUrl = new URL(originalState.redirect_uri);
  redirectUrl.searchParams.set("access_token", accessToken);
  if (refreshToken) {
    redirectUrl.searchParams.set("refresh_token", refreshToken);
  }
  redirectUrl.searchParams.set("expires_in", expiresIn.toString());
  redirectUrl.searchParams.set("token_type", "Bearer");
  if (originalState.state) {
    redirectUrl.searchParams.set("state", originalState.state);
  }

  return c.redirect(redirectUrl.href, 302);
});

export { app as KrogerHandler };
