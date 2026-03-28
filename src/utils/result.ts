/**
 * neverthrow utilities for bridging Result types with MCP tool responses
 * and wrapping common async operations.
 */
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
  return ResultAsync.fromPromise(promise, (e) =>
    networkError(`${context}: ${e instanceof Error ? e.message : String(e)}`, e),
  ).andThen(({ data, error, response }) => {
    if (error || !response.ok) {
      return err(apiError(`Failed to ${context}`, error));
    }
    return ok(data as T);
  });
}

// --- Auth Helpers ---

/**
 * Result-based version of requireUser.
 * Returns Ok(Props) or Err(AuthError).
 */
export function requireAuth(getUser: () => Props | null): Result<Props, AppError> {
  const props = getUser();
  if (!props?.id) {
    return err(authError("User not authenticated"));
  }
  return ok(props);
}

// --- Location Resolution ---

/**
 * Result-based version of resolveLocationId.
 * Returns Ok with resolved location info or Err with validation error.
 */
export function safeResolveLocationId(
  storage: UserStorage,
  userId: string,
  locationId?: string,
): ResultAsync<{ locationId: string; locationName?: string }, AppError> {
  if (locationId) {
    return okAsync<{ locationId: string; locationName?: string }, AppError>({
      locationId,
    });
  }

  return ResultAsync.fromPromise(storage.preferredLocation.get(userId), (e) =>
    storageError(
      `Failed to fetch preferred location: ${e instanceof Error ? e.message : String(e)}`,
      e,
    ),
  ).andThen((preferredLocation) => {
    if (!preferredLocation) {
      return err(
        notFoundError(
          "No location specified and no preferred location set. Please provide a locationId or set your preferred location using set_preferred_location.",
        ),
      );
    }
    return ok({
      locationId: preferredLocation.locationId,
      locationName: preferredLocation.locationName,
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
