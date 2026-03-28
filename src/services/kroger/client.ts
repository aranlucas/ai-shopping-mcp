import { ResultAsync, err, ok } from "neverthrow";
import createClient, { type Middleware } from "openapi-fetch";

import type { paths as CartPaths } from "./cart.js";
import type { paths as IdentityPaths } from "./identity.js";
import type { paths as LocationPaths } from "./location.js";
import type { paths as ProductPaths } from "./product.js";

import { type AppError, apiError, networkError } from "../../errors.js";

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

/** Raw response shape from Kroger's OAuth token endpoint */
export interface KrogerTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
}

/**
 * Refreshes a Kroger access token using a refresh token.
 * Returns ResultAsync instead of throwing for consistent error handling.
 */
export function refreshKrogerToken(
  refreshToken: string,
  krogerClientId: string,
  krogerClientSecret: string,
): ResultAsync<KrogerTokenRefreshResult, AppError> {
  const refreshBody = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  return ResultAsync.fromPromise(
    fetch("https://api.kroger.com/v1/connect/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${krogerClientId}:${krogerClientSecret}`)}`,
      },
      body: refreshBody.toString(),
      signal: AbortSignal.timeout(30_000),
    }),
    (e) =>
      networkError(`Token refresh network error: ${e instanceof Error ? e.message : String(e)}`, e),
  ).andThen((refreshResponse) =>
    ResultAsync.fromPromise(refreshResponse.json() as Promise<KrogerTokenResponse>, (e) =>
      networkError(
        `Failed to parse token refresh response: ${e instanceof Error ? e.message : String(e)}`,
        e,
      ),
    ).andThen((responseData) => {
      if (!refreshResponse.ok) {
        console.error("Failed to refresh Kroger access token:", {
          status: refreshResponse.status,
          statusText: refreshResponse.statusText,
          error: responseData.error,
          errorDescription: responseData.error_description,
        });
        return err(
          apiError(
            `Failed to refresh Kroger access token: ${responseData.error_description || responseData.error || "Unknown error"}`,
            responseData,
            refreshResponse.status,
          ),
        );
      }

      if (!responseData.access_token) {
        return err(apiError("Invalid response from Kroger token refresh endpoint"));
      }

      const expiresIn = responseData.expires_in || 1800;

      return ok({
        accessToken: responseData.access_token,
        refreshToken: responseData.refresh_token,
        tokenExpiresAt: Date.now() + expiresIn * 1000,
        expiresIn,
      });
    }),
  );
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
export function createKrogerAuthMiddleware(getTokenInfo: () => KrogerTokenInfo | null): Middleware {
  return {
    async onRequest({ request }) {
      const tokenInfo = getTokenInfo();
      if (!tokenInfo) {
        throw new KrogerTokenExpiredError(`No Kroger token available. ${REAUTH_MSG}`);
      }

      // 1-minute clock skew buffer (vs 5-minute proactive refresh in tokenExchangeCallback)
      if (Date.now() - 60_000 >= tokenInfo.tokenExpiresAt) {
        throw new KrogerTokenExpiredError(`Kroger access token has expired. ${REAUTH_MSG}`);
      }

      request.headers.set("Authorization", `Bearer ${tokenInfo.accessToken}`);
      return request;
    },

    async onResponse({ response }) {
      if (response.status === 401) {
        throw new KrogerTokenExpiredError(`Kroger rejected the access token. ${REAUTH_MSG}`);
      }
      return response;
    },
  };
}

/**
 * Creates all Kroger API clients with authentication middleware applied.
 * Returns fresh client instances — no global mutable state.
 */
export function createKrogerClients(getTokenInfo: () => KrogerTokenInfo | null) {
  const middleware = createKrogerAuthMiddleware(getTokenInfo);
  const base = { baseUrl: "https://api.kroger.com" };

  const cartClient = createClient<CartPaths>(base);
  const identityClient = createClient<IdentityPaths>(base);
  const locationClient = createClient<LocationPaths>(base);
  const productClient = createClient<ProductPaths>(base);

  cartClient.use(middleware);
  identityClient.use(middleware);
  locationClient.use(middleware);
  productClient.use(middleware);

  return { cartClient, identityClient, locationClient, productClient };
}

export type KrogerClients = ReturnType<typeof createKrogerClients>;
