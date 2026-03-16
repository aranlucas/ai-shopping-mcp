/**
 * Domain-specific error types for the MCP server.
 * Used with neverthrow's Result type for type-safe error handling.
 */

/** API call to Kroger or external service failed */
export interface ApiError {
  readonly type: "API_ERROR";
  readonly message: string;
  readonly status?: number;
  readonly detail?: unknown;
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
  readonly cause?: unknown;
}

/** Network/fetch failure */
export interface NetworkError {
  readonly type: "NETWORK_ERROR";
  readonly message: string;
  readonly cause?: unknown;
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

export const apiError = (
  message: string,
  detail?: unknown,
  status?: number,
): ApiError => ({ type: "API_ERROR", message, detail, status });

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

export const storageError = (
  message: string,
  cause?: unknown,
): StorageError => ({ type: "STORAGE_ERROR", message, cause });

export const networkError = (
  message: string,
  cause?: unknown,
): NetworkError => ({ type: "NETWORK_ERROR", message, cause });

/** Format any AppError into a user-facing message */
export function formatAppError(error: AppError): string {
  switch (error.type) {
    case "API_ERROR":
      return error.detail
        ? `${error.message}: ${JSON.stringify(error.detail)}`
        : error.message;
    case "AUTH_ERROR":
    case "NOT_FOUND":
    case "VALIDATION_ERROR":
      return error.message;
    case "STORAGE_ERROR":
    case "NETWORK_ERROR":
      return error.message;
  }
}
