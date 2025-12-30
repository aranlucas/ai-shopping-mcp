import createClient, { type Middleware } from "openapi-fetch";
import type { paths as AuthPaths } from "./auth.js";
import type { paths as CartPaths } from "./cart.js";
import type { paths as IdentityPaths } from "./identity.js";
import type { paths as LocationPaths } from "./location.js";
import type { paths as ProductPaths } from "./product.js";

export interface KrogerTokenInfo {
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt: number;
  krogerClientId: string;
  krogerClientSecret: string;
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

/**
 * Creates a Kroger OAuth middleware that automatically refreshes tokens when needed.
 * Note: This middleware updates tokens in memory for the current session.
 * For persistent token sync, use tokenExchangeCallback in OAuthProvider.
 */
export function createKrogerAuthMiddleware(
  getTokenInfo: () => KrogerTokenInfo | null,
  updateTokenInfo: (tokenInfo: Partial<KrogerTokenInfo>) => void,
): Middleware {
  const middleware: Middleware = {
    async onRequest({ request }) {
      const tokenInfo = getTokenInfo();

      if (!tokenInfo) {
        throw new Error("No Kroger token information available");
      }

      let accessToken = tokenInfo.accessToken;

      // Check if token needs refresh
      if (isKrogerTokenExpiring(tokenInfo.tokenExpiresAt)) {
        if (!tokenInfo.refreshToken) {
          throw new Error(
            "Access token expired and no refresh token available",
          );
        }

        console.log("Refreshing Kroger access token in middleware...");

        const refreshResult = await refreshKrogerToken(
          tokenInfo.refreshToken,
          tokenInfo.krogerClientId,
          tokenInfo.krogerClientSecret,
        );

        accessToken = refreshResult.accessToken;

        // Update in-memory token info
        updateTokenInfo({
          accessToken: refreshResult.accessToken,
          refreshToken: refreshResult.refreshToken,
          tokenExpiresAt: refreshResult.tokenExpiresAt,
        });

        console.log("Access token refreshed successfully in middleware");
      }

      // Add Authorization header to the request
      request.headers.set("Authorization", `Bearer ${accessToken}`);
      return request;
    },
  };

  return middleware;
}

// Create clients with base configuration (no auth initially)
const authClient = createClient<AuthPaths>({
  baseUrl: "https://api.kroger.com",
});

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
  updateTokenInfo: (tokenInfo: Partial<KrogerTokenInfo>) => void,
): void {
  const authMiddleware = createKrogerAuthMiddleware(
    getTokenInfo,
    updateTokenInfo,
  );

  // Apply auth middleware to all clients that need authentication
  cartClient.use(authMiddleware);
  identityClient.use(authMiddleware);
  locationClient.use(authMiddleware);
  productClient.use(authMiddleware);
  // Note: authClient doesn't need auth middleware as it's used for authentication itself
}

export {
  authClient,
  cartClient,
  identityClient,
  locationClient,
  productClient,
};
