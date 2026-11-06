import { ResultAsync, err, ok } from "neverthrow";
import {
  type AppError,
  AppErrorException,
  apiError,
  authError,
  networkError,
  storageError,
  invalidResponseError,
} from "../errors.js";

type ApiResponse<T> = { data?: T; error?: unknown; response: Response };

/**
 * Wraps an openapi-fetch response into a ResultAsync.
 *
 * Uses `response.ok` to determine success, so 204 No Content responses are
 * handled correctly without any extra flags — `T` is inferred as `undefined`
 * for endpoints that return no body.
 */
export function fromApiResponse<T>(
  promise: Promise<ApiResponse<T>> | (() => Promise<ApiResponse<T>>),
  context: string,
): ResultAsync<T, AppError> {
  const mapFailure = (cause: unknown): AppError => {
    if (cause instanceof AppErrorException) {
      return cause.appError;
    }

    if (cause instanceof SyntaxError) {
      return invalidResponseError(`${context}: upstream returned malformed JSON.`, cause);
    }

    if (cause instanceof Error && cause.name === "KrogerTokenExpiredError") {
      return authError(cause.message);
    }

    return networkError(
      `${context}: ${cause instanceof Error ? cause.message : String(cause)}`,
      cause,
    );
  };

  const result =
    // This typed Promise-or-thunk overload dispatch must recognize cross-realm functions without changing the public API.
    typeof promise === "function"
      ? ResultAsync.fromThrowable(promise, mapFailure)()
      : ResultAsync.fromPromise(promise, mapFailure);

  return result.andThen(({ data, error, response }) => {
    if (response.status === 401) {
      return err(authError("Authentication expired. Reconnect the MCP server."));
    }

    if (error !== undefined || !response.ok) {
      return err(apiError(`Failed to ${context}`, error, response.status));
    }

    // SAFETY: Preserve the generated SDK success contract, where no-content endpoints include undefined in T.
    // This bridge does not validate T at runtime: manually supplied responses with absent data still return undefined (existing behavior).
    return ok(data as T);
  });
}

export function safeStorage<T>(
  operation: () => Promise<T>,
  context: string,
): ResultAsync<T, AppError> {
  return ResultAsync.fromThrowable(operation, (e): AppError =>
    e instanceof AppErrorException
      ? e.appError
      : storageError(`${context}: ${e instanceof Error ? e.message : String(e)}`, e),
  )();
}
