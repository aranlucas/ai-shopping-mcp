/**
 * neverthrow utilities for bridging Result types with MCP tool responses
 * and wrapping common async operations.
 */
import { getMcpAuthContext } from "agents/mcp";
import { type Result, ResultAsync, err, ok, okAsync } from "neverthrow";

import type { Props, UserStorage } from "../tools/types.js";

import {
  type AppError,
  apiError,
  authError,
  formatAppError,
  networkError,
  notFoundError,
  storageError,
} from "../errors.js";
export { safeJsonParse, safeJsonParseWithSchema } from "./json.js";

// --- MCP Response Bridge ---

/** MCP tool result type (mirrors what registerTool handlers return) */
type McpToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: true;
};

/**
 * Converts a Result<string, AppError> into an MCP tool response.
 * Ok values become textResult, Err values become errorResult.
 */
export function toMcpResponse(result: Result<string, AppError>): McpToolResult {
  return result.match(
    (text) => ({ content: [{ type: "text" as const, text }] }),
    (error) => toMcpError(error),
  );
}

/**
 * Converts an AppError directly into an MCP error response.
 * Use this when you have an error but not a full Result (e.g., early returns).
 */
export function toMcpError(error: AppError): McpToolResult {
  return {
    content: [{ type: "text" as const, text: formatAppError(error) }],
    isError: true as const,
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
  promise: Promise<{ data?: T; error?: unknown; response: Response }>,
  context: string,
): ResultAsync<T, AppError> {
  return ResultAsync.fromPromise(promise, (e) => {
    if (e instanceof Error && e.name === "KrogerTokenExpiredError") {
      return authError(e.message);
    }
    return networkError(`${context}: ${e instanceof Error ? e.message : String(e)}`, e);
  }).andThen(({ data, error, response }) => {
    if (error || !response.ok) {
      return err(apiError(`Failed to ${context}`, error, response.status));
    }
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
export function getProps(): Props {
  const props = getMcpAuthContext()?.props;
  if (
    !props ||
    typeof props.id !== "string" ||
    typeof props.accessToken !== "string" ||
    typeof props.tokenExpiresAt !== "number"
  ) {
    throw new Error("getProps() called outside an authenticated MCP request");
  }
  return {
    id: props.id,
    accessToken: props.accessToken,
    tokenExpiresAt: props.tokenExpiresAt,
  };
}

// --- Location Resolution ---

/**
 * Result-based version of resolveLocationId.
 * Returns Ok with resolved location info or Err with validation error.
 */
export function safeResolveLocationId(
  storage: UserStorage,
  locationId?: string,
): ResultAsync<{ locationId: string; locationName?: string }, AppError> {
  if (locationId) {
    return okAsync<{ locationId: string; locationName?: string }, AppError>({
      locationId,
    });
  }

  return safeStorage(() => storage.preferredLocation.get(), "fetch preferred location").andThen(
    (preferredLocation) => {
      if (!preferredLocation) {
        return err(
          notFoundError(
            "No location specified and no preferred store set. Please provide a locationId or set your preferred store using set_preferred_store.",
          ),
        );
      }
      return ok({
        locationId: preferredLocation.locationId,
        locationName: preferredLocation.locationName,
      });
    },
  );
}

// --- Storage Wrappers ---

/**
 * Wraps a storage operation that may throw into a ResultAsync.
 */
export function safeStorage<T>(
  operation: () => Promise<T>,
  context: string,
): ResultAsync<T, AppError> {
  return ResultAsync.fromPromise(operation(), (e) =>
    storageError(`${context}: ${e instanceof Error ? e.message : String(e)}`, e),
  );
}

// --- Fetch Wrapper ---

/**
 * Wraps a fetch call into a ResultAsync, handling network errors and non-ok responses.
 */
export function safeFetch(
  input: RequestInfo,
  init?: RequestInit,
  context = "fetch",
): ResultAsync<Response, AppError> {
  return ResultAsync.fromPromise(fetch(input, init), (e) =>
    networkError(`${context}: ${e instanceof Error ? e.message : String(e)}`, e),
  ).andThen((response) => {
    if (!response.ok) {
      return err(
        apiError(
          `${context} failed: ${response.status} ${response.statusText}`,
          undefined,
          response.status,
        ),
      );
    }
    return ok(response);
  });
}
