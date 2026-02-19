import createClient, { type Middleware } from "openapi-fetch";
import type { paths as CartPaths } from "./cart.js";
import type { paths as IdentityPaths } from "./identity.js";
import type { paths as LocationPaths } from "./location.js";
import type { paths as ProductPaths } from "./product.js";

export interface KrogerTokenInfo {
  accessToken: string;
  tokenExpiresAt: number;
}

export interface KrogerTokenRefreshResult {
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt: number;
  expiresIn: number;
}

/**
 * Refreshes a Kroger access token using a refresh token.
 * This is a standalone function that can be used by both the middleware
 * and the OAuth tokenExchangeCallback.
 */
export async function refreshKrogerToken(
  refreshToken: string,
  krogerClientId: string,
  krogerClientSecret: string,
): Promise<KrogerTokenRefreshResult> {
  const refreshBody = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const refreshResponse = await fetch(
    "https://api.kroger.com/v1/connect/oauth2/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${krogerClientId}:${krogerClientSecret}`)}`,
      },
      body: refreshBody.toString(),
    },
  );

  const responseData = (await refreshResponse.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!refreshResponse.ok) {
    console.error("Failed to refresh Kroger access token:", {
      status: refreshResponse.status,
      statusText: refreshResponse.statusText,
      error: responseData.error,
      errorDescription: responseData.error_description,
    });
    throw new Error(
      `Failed to refresh Kroger access token: ${responseData.error_description || responseData.error || "Unknown error"}`,
    );
  }

  if (!responseData.access_token) {
    throw new Error("Invalid response from Kroger token refresh endpoint");
  }

  const expiresIn = responseData.expires_in || 1800;

  return {
    accessToken: responseData.access_token,
    refreshToken: responseData.refresh_token,
    tokenExpiresAt: Date.now() + expiresIn * 1000,
    expiresIn,
  };
}

/**
 * Checks if a Kroger token needs to be refreshed.
 * Returns true if the token will expire within the buffer time.
 */
export function isKrogerTokenExpiring(
  tokenExpiresAt: number,
  bufferTimeMs: number = 5 * 60 * 1000, // 5 minutes default
): boolean {
  return Date.now() + bufferTimeMs >= tokenExpiresAt;
}

export class KrogerTokenExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KrogerTokenExpiredError";
  }
}

const REAUTH_MSG = "Please reconnect to the MCP server to re-authenticate.";

/**
 * Middleware that adds Kroger Bearer tokens to requests.
 * Does NOT refresh tokens — that's handled exclusively by tokenExchangeCallback
 * to avoid conflicts with Kroger's single-use refresh tokens.
 */
export function createKrogerAuthMiddleware(
  getTokenInfo: () => KrogerTokenInfo | null,
): Middleware {
  return {
    async onRequest({ request }) {
      const tokenInfo = getTokenInfo();
      if (!tokenInfo) {
        throw new KrogerTokenExpiredError(
          `No Kroger token available. ${REAUTH_MSG}`,
        );
      }

      // 1-minute clock skew buffer (vs 5-minute proactive refresh in tokenExchangeCallback)
      if (Date.now() - 60_000 >= tokenInfo.tokenExpiresAt) {
        throw new KrogerTokenExpiredError(
          `Kroger access token has expired. ${REAUTH_MSG}`,
        );
      }

      request.headers.set("Authorization", `Bearer ${tokenInfo.accessToken}`);
      return request;
    },

    async onResponse({ response }) {
      if (response.status === 401) {
        throw new KrogerTokenExpiredError(
          `Kroger rejected the access token. ${REAUTH_MSG}`,
        );
      }
      return response;
    },
  };
}

// Create clients with base configuration (no auth initially)
// Note: OAuth token exchange is handled directly in kroger-handler.ts using fetch
// following Kroger's OAuth 2.0 documentation, not through openapi-fetch

const cartClient = createClient<CartPaths>({
  baseUrl: "https://api.kroger.com",
});

const identityClient = createClient<IdentityPaths>({
  baseUrl: "https://api.kroger.com",
});

const locationClient = createClient<LocationPaths>({
  baseUrl: "https://api.kroger.com",
});

const productClient = createClient<ProductPaths>({
  baseUrl: "https://api.kroger.com",
});

/**
 * Configures all Kroger API clients with authentication middleware
 */
export function configureKrogerAuth(
  getTokenInfo: () => KrogerTokenInfo | null,
): void {
  const authMiddleware = createKrogerAuthMiddleware(getTokenInfo);

  // Apply auth middleware to all clients that need authentication
  cartClient.use(authMiddleware);
  identityClient.use(authMiddleware);
  locationClient.use(authMiddleware);
  productClient.use(authMiddleware);
}

export { cartClient, identityClient, locationClient, productClient };
