import { ResultAsync, err, ok } from "neverthrow";
import createClient, { type Middleware } from "openapi-fetch";
import * as z from "zod/v4";

import type { KvLike } from "../../utils/kv.js";
import type { paths as CartPaths } from "./cart.js";
import type { paths as IdentityPaths } from "./identity.js";
import type { paths as LocationPaths } from "./location.js";
import type { paths as ProductPaths } from "./product.js";

import { type AppError, apiError, networkError } from "../../errors.js";
import { safeJsonParseWithSchema } from "../../utils/json.js";
import { safeStorage } from "../../utils/result.js";

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

const KROGER_CACHE_TTL_SECONDS = 600;

type KrogerCacheEntry = { status: number; body: string };

const krogerCacheEntrySchema = z.object({
  status: z.number(),
  body: z.string(),
});

function krogerCacheKeyFor(url: string): string {
  return `kroger-cache|v1|${url}`;
}

/**
 * Generic KV-cache middleware for Kroger GET responses, structured like
 * `createKrogerAuthMiddleware`. Only GET requests are ever read from or
 * written to cache; only 2xx responses are cached. KV read/write failures
 * are non-fatal — a read failure falls through to a live request, a write
 * failure is logged and swallowed.
 */
export function createKrogerCacheMiddleware(kv: KvLike | null, ttlSeconds: number): Middleware {
  return {
    async onRequest({ request }) {
      if (!kv || request.method !== "GET") return;

      const key = krogerCacheKeyFor(request.url);
      const raw = await safeStorage(() => kv.get(key), "read Kroger response cache").match(
        (value) => value,
        () => null,
      );
      if (!raw) return;

      const entry = safeJsonParseWithSchema(raw, krogerCacheEntrySchema).match(
        (value): KrogerCacheEntry => value,
        () => null,
      );
      if (!entry) return;

      return new Response(entry.body, {
        status: entry.status,
        headers: { "content-type": "application/json" },
      });
    },

    async onResponse({ request, response }) {
      if (!kv || request.method !== "GET" || !response.ok) return;

      const key = krogerCacheKeyFor(request.url);
      const body = await response.clone().text();
      const entry: KrogerCacheEntry = { status: response.status, body };

      await safeStorage(
        () => kv.put(key, JSON.stringify(entry), { expirationTtl: ttlSeconds }),
        "write Kroger response cache",
      ).orTee((error) =>
        console.warn("Kroger response cache write failed (non-fatal):", error.message),
      );
    },
  };
}

/**
 * Creates all Kroger API clients with authentication middleware applied.
 * Returns fresh client instances — no global mutable state.
 *
 * `productClient` and `locationClient` also get the KV-cache middleware:
 * their GET responses aren't user-specific, so sharing a cache across users
 * is the point. `cartClient`/`identityClient` are deliberately excluded —
 * the cache has no per-user scoping, and caching a future GET on either
 * would leak one user's data to another.
 */
export function createKrogerClients(
  getTokenInfo: () => KrogerTokenInfo | null,
  kv: KvLike | null = null,
) {
  const authMiddleware = createKrogerAuthMiddleware(getTokenInfo);
  const cacheMiddleware = createKrogerCacheMiddleware(kv, KROGER_CACHE_TTL_SECONDS);
  const base = { baseUrl: "https://api.kroger.com" };

  const cartClient = createClient<CartPaths>(base);
  const identityClient = createClient<IdentityPaths>(base);
  const locationClient = createClient<LocationPaths>(base);
  const productClient = createClient<ProductPaths>(base);

  cartClient.use(authMiddleware);
  identityClient.use(authMiddleware);
  locationClient.use(authMiddleware);
  productClient.use(authMiddleware);

  locationClient.use(cacheMiddleware);
  productClient.use(cacheMiddleware);

  return { cartClient, identityClient, locationClient, productClient };
}

export type KrogerClients = ReturnType<typeof createKrogerClients>;
