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

/**
 * Creates a Kroger OAuth middleware that automatically refreshes tokens when needed
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

      // Check if token is expired or will expire in the next 5 minutes
      const now = Date.now();
      const bufferTime = 5 * 60 * 1000; // 5 minutes in milliseconds

      let accessToken = tokenInfo.accessToken;

      if (now + bufferTime >= tokenInfo.tokenExpiresAt) {
        // Token needs to be refreshed
        if (!tokenInfo.refreshToken) {
          throw new Error(
            "Access token expired and no refresh token available",
          );
        }

        console.log("Refreshing Kroger access token...");

        // Use direct fetch for refresh token since openapi-fetch has type constraints
        const refreshBody = new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: tokenInfo.refreshToken,
        });

        const refreshResponse = await fetch(
          "https://api.kroger.com/v1/connect/oauth2/token",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Authorization: `Basic ${btoa(`${tokenInfo.krogerClientId}:${tokenInfo.krogerClientSecret}`)}`,
            },
            body: refreshBody.toString(),
          },
        );

        const responseData = await refreshResponse.json();

        if (!refreshResponse.ok) {
          console.error("Failed to refresh access token:", {
            status: refreshResponse.status,
            statusText: refreshResponse.statusText,
            error: responseData.error,
            errorDescription: responseData.error_description,
          });
          throw new Error(
            `Failed to refresh access token: ${responseData.error_description || responseData.error || "Unknown error"}`,
          );
        }

        // Handle the response
        if (responseData.access_token) {
          accessToken = responseData.access_token;

          const newTokenInfo: Partial<KrogerTokenInfo> = {
            accessToken: responseData.access_token,
            tokenExpiresAt: Date.now() + (responseData.expires_in || 1800) * 1000,
          };

          // Update refresh token if a new one was provided
          if (responseData.refresh_token) {
            newTokenInfo.refreshToken = responseData.refresh_token;
          }

          updateTokenInfo(newTokenInfo);
          console.log("Access token refreshed successfully");
        } else {
          throw new Error("Invalid response from token refresh endpoint");
        }
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
