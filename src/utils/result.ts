import { z } from "zod/v4";
/**
 * neverthrow utilities for bridging Result types with MCP tool responses
 * and wrapping common async operations.
 */
import { getMcpAuthContext } from "agents/mcp/server";
import { ResultAsync, err, ok, okAsync } from "neverthrow";
import { isVerifiedShopperId } from "./shopper-identity.js";

import type { Props } from "../tools/types.js";
import type { PreferredLocationStore } from "./shopping-store.js";

import {
  type AppError,
  AppErrorException,
  apiError,
  authError,
  formatAppError,
  networkError,
  notFoundError,
  storageError,
  errorRecovery,
  invalidResponseError,
} from "../errors.js";

export { safeJsonParse, safeJsonParseWithSchema } from "./json.js";

// --- MCP Response Bridge ---

/** MCP tool result type (mirrors what registerTool handlers return) */
type McpToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: true;
  structuredContent?: {
    error: {
      code: AppError["type"];
      message: string;
      recovery: ReturnType<typeof errorRecovery>;
    };
  };
};

/**
 * Converts an AppError directly into an MCP error response.
 * Use this when you have an error but not a full Result (e.g., early returns).
 */
export function toMcpError(error: AppError): McpToolResult {
  return {
    content: [{ type: "text" as const, text: formatAppError(error) }],
    isError: true as const,
    structuredContent: {
      error: {
        code: error.type,
        message: error.message,
        recovery: errorRecovery(error),
      },
    },
  };
}

// --- API Call Wrappers ---

/**
 * Wraps an openapi-fetch response into a ResultAsync.
 *
 * Uses `response.ok` to determine success, so 204 No Content responses are
 * handled correctly without any extra flags — `T` is inferred as `undefined`
 * for endpoints that return no body.
 */
export function fromApiResponse<T>(
  promise:
    | Promise<{ data?: T; error?: unknown; response: Response }>
    | (() => Promise<{ data?: T; error?: unknown; response: Response }>),
  context: string,
): ResultAsync<T, AppError> {
  const mapFailure = (cause: unknown): AppError => {
    if (cause instanceof AppErrorException) return cause.appError;

    if (cause instanceof SyntaxError)
      return invalidResponseError(
        `${context}: upstream returned malformed JSON.`,
        cause,
      );

    if (cause instanceof Error && cause.name === "KrogerTokenExpiredError") {
      return authError(cause.message);
    }

    return networkError(
      `${context}: ${cause instanceof Error ? cause.message : String(cause)}`,
      cause,
    );
  };

  const result =
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- This typed Promise-or-thunk overload dispatch must recognize cross-realm functions without changing the public API.
    typeof promise === "function"
      ? ResultAsync.fromThrowable(promise, mapFailure)()
      : ResultAsync.fromPromise(promise, mapFailure);

  return result.andThen(({ data, error, response }) => {
    if (response.status === 401)
      return err(
        authError("Authentication expired. Reconnect the MCP server."),
      );

    if (error !== undefined || !response.ok) {
      return err(apiError(`Failed to ${context}`, error, response.status));
    }

    // SAFETY: Preserve the generated SDK success contract, where no-content endpoints include undefined in T.
    // This bridge does not validate T at runtime: manually supplied responses with absent data still return undefined (existing behavior).
    return ok(data as T);
  });
}

// --- Auth Helpers ---

/**
 * Returns the auth props for the current MCP request.
 *
 * `OAuthProvider` gates every `/mcp` request (see `server.ts` `apiHandlers`),
 * so `props` is always populated by the time a tool or resource handler runs.
 * The non-null return type expresses that invariant in the type system instead
 * of re-checking it at every call site.
 *
 * The SDK types the auth context as `{ props: Record<string, unknown> }`, so we
 * validate the fields and build a real `Props` rather than blindly asserting
 * `as Props`. Throws if called outside an authenticated MCP request, or if the
 * props are missing the expected fields — both are programming/configuration
 * errors, not reachable runtime states.
 */
const authenticatedPropsSchema = z.object({
  props: z.object({
    id: z.string().refine(isVerifiedShopperId),
    accessToken: z.string(),
    // Preserve the existing number contract; token expiry is enforced by the client.
    tokenExpiresAt: z.union([
      z.number(),
      z.nan(),
      z.literal(Infinity),
      z.literal(-Infinity),
    ]),
  }),
});

/** Parse provider-owned request data without trusting its declared extension types. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- The provider auth-context boundary is untrusted until authenticatedPropsSchema validates it below.
export function parseAuthenticatedProps(value: unknown): Props {
  const parsed = authenticatedPropsSchema.safeParse(value);

  if (!parsed.success)
    throw new Error("getProps() called outside an authenticated MCP request");

  return parsed.data.props;
}

export function getProps(): Props {
  return parseAuthenticatedProps(getMcpAuthContext());
}

// --- Location Resolution ---

/**
 * Result-based version of resolveLocationId.
 * Returns Ok with resolved location info or Err with validation error.
 */
export function safeResolveLocationId(
  preferredLocation: PreferredLocationStore,
  locationId?: string,
): ResultAsync<{ locationId: string; locationName?: string }, AppError> {
  if (locationId) {
    return okAsync<{ locationId: string; locationName?: string }, AppError>({
      locationId,
    });
  }

  return safeStorage(
    () => preferredLocation.get(),
    "fetch preferred location",
  ).andThen((location) => {
    if (!location) {
      return err(
        notFoundError(
          "No location specified and no preferred store set. Please provide a locationId or set your preferred store using set_preferred_store.",
        ),
      );
    }

    return ok({
      locationId: location.locationId,
      locationName: location.locationName,
    });
  });
}

// --- Storage Wrappers ---

/**
 * Wraps a storage operation that may throw into a ResultAsync.
 */
export function safeStorage<T>(
  operation: () => Promise<T>,
  context: string,
): ResultAsync<T, AppError> {
  return ResultAsync.fromThrowable(operation, (e): AppError =>
    e instanceof AppErrorException
      ? e.appError
      : storageError(
          `${context}: ${e instanceof Error ? e.message : String(e)}`,
          e,
        ),
  )();
}
