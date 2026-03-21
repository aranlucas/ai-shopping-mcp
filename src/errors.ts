/**
 * Domain-specific error types for the MCP server.
 * Used with neverthrow's Result type for type-safe error handling.
 */

/** Narrowed cause type for error context — captures Error instances, strings, or structured data */
export type ErrorCause = Error | string | Record<string, unknown> | undefined;

/** API call to Kroger or external service failed */
export interface ApiError {
  readonly type: "API_ERROR";
  readonly message: string;
  readonly status?: number;
  readonly detail?: ErrorCause;
}

/** User is not authenticated or token is invalid */
export interface AuthError {
  readonly type: "AUTH_ERROR";
  readonly message: string;
}

/** Requested resource was not found */
export interface NotFoundError {
  readonly type: "NOT_FOUND";
  readonly message: string;
}

/** Input validation failed (beyond Zod schema validation) */
export interface ValidationError {
  readonly type: "VALIDATION_ERROR";
  readonly message: string;
}

/** Cloudflare KV or other storage operation failed */
export interface StorageError {
  readonly type: "STORAGE_ERROR";
  readonly message: string;
  readonly cause?: ErrorCause;
}

/** Network/fetch failure */
export interface NetworkError {
  readonly type: "NETWORK_ERROR";
  readonly message: string;
  readonly cause?: ErrorCause;
}

/** Discriminated union of all application errors */
export type AppError =
  | ApiError
  | AuthError
  | NotFoundError
  | ValidationError
  | StorageError
  | NetworkError;

// --- Error constructors ---

/** Coerce an unknown value into an ErrorCause for safe storage */
function toErrorCause(value: unknown): ErrorCause {
  if (value === undefined || value === null) return undefined;
  if (value instanceof Error) return value;
  if (typeof value === "string") return value;
  if (typeof value === "object") return value as Record<string, unknown>;
  return String(value);
}

export const apiError = (message: string, detail?: unknown, status?: number): ApiError => ({
  type: "API_ERROR",
  message,
  detail: toErrorCause(detail),
  status,
});

export const authError = (message: string): AuthError => ({
  type: "AUTH_ERROR",
  message,
});

export const notFoundError = (message: string): NotFoundError => ({
  type: "NOT_FOUND",
  message,
});

export const validationError = (message: string): ValidationError => ({
  type: "VALIDATION_ERROR",
  message,
});

export const storageError = (message: string, cause?: unknown): StorageError => ({
  type: "STORAGE_ERROR",
  message,
  cause: toErrorCause(cause),
});

export const networkError = (message: string, cause?: unknown): NetworkError => ({
  type: "NETWORK_ERROR",
  message,
  cause: toErrorCause(cause),
});

/** Format any AppError into a user-facing message */
export function formatAppError(error: AppError): string {
  if (error.type === "API_ERROR" && error.detail) {
    return `${error.message}: ${JSON.stringify(error.detail)}`;
  }
  return error.message;
}
