import * as z from "zod/v4";

/** Narrowed cause type for error context — captures Error instances, strings, or structured data */
// Error context intentionally retains opaque upstream objects and their identity; it is never trusted as domain data.
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

export interface InvalidResponseError {
  readonly type: "INVALID_RESPONSE";
  readonly message: string;
  readonly cause?: ErrorCause;
}

/** A remote mutation may have committed. Repeating it is unsafe. */
export interface MutationOutcomeUnknownError {
  readonly type: "MUTATION_OUTCOME_UNKNOWN";
  readonly message: string;
  readonly cause?: ErrorCause;
}

export type AppError =
  | ApiError
  | AuthError
  | NotFoundError
  | ValidationError
  | StorageError
  | NetworkError
  | InvalidResponseError
  | MutationOutcomeUnknownError;

/** Preserve typed failures across Promise-based adapter interfaces. */
export class AppErrorException extends Error {
  constructor(readonly appError: AppError) {
    super(appError.message);
    this.name = "AppErrorException";
  }
}

// --- Error constructors ---

function toErrorCause(cause: unknown): ErrorCause {
  if (cause === undefined || cause === null) {
    return undefined;
  }

  if (cause instanceof Error) {
    return cause;
  }

  // Opaque error retention distinguishes primitives without interpreting or cloning third-party objects.
  if (typeof cause === "string") {
    return cause;
  }

  // Preserve arbitrary non-null error objects, including arrays, without inspecting their contents.
  if (typeof cause === "object") {
    // SAFETY: the non-null object above is retained opaquely; the dictionary contract permits only unknown property values.
    // Preserve the exported opaque ErrorCause contract, including object identity.
    return cause as Record<string, unknown>;
  }

  if (typeof cause === "function") {
    return String(cause);
  }

  if (
    typeof cause === "number" ||
    typeof cause === "boolean" ||
    typeof cause === "bigint" ||
    typeof cause === "symbol"
  ) {
    return String(cause);
  }

  return undefined;
}

export const apiError = (message: string, cause?: unknown, status?: number): ApiError => ({
  type: "API_ERROR",
  message,
  detail: toErrorCause(cause),
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

export const invalidResponseError = (message: string, cause?: unknown): InvalidResponseError => ({
  type: "INVALID_RESPONSE",
  message,
  cause: toErrorCause(cause),
});

export const mutationOutcomeUnknown = (
  message: string,
  cause?: unknown,
): MutationOutcomeUnknownError => ({
  type: "MUTATION_OUTCOME_UNKNOWN",
  message,
  cause: toErrorCause(cause),
});

/** Actionable recovery metadata for MCP consumers, without upstream details. */
export function errorRecovery(
  error: AppError,
): "reconnect" | "retry_later" | "check_cart" | "correct_input" | "contact_support" {
  switch (error.type) {
    case "AUTH_ERROR":
      return "reconnect";
    case "MUTATION_OUTCOME_UNKNOWN":
      return "check_cart";
    case "VALIDATION_ERROR":
    case "NOT_FOUND":
      return "correct_input";
    case "API_ERROR":
      return error.status === 429 || (error.status ?? 0) >= 500 ? "retry_later" : "correct_input";
    case "NETWORK_ERROR":
    case "STORAGE_ERROR":
      return "retry_later";
    case "INVALID_RESPONSE":
      return "contact_support";
    default: {
      const unexpected: never = error;
      throw new Error(`Unknown error kind: ${JSON.stringify(unexpected)}`);
    }
  }
}

const MAX_UPSTREAM_REASON_CHARS = 200;

/** Provider reason fields: Kroger's `errors.reason`, then OAuth and generic shapes. */
const upstreamReasonSchema = z.union([
  z.object({ errors: z.object({ reason: z.string() }) }).transform((body) => body.errors.reason),
  z.object({ error_description: z.string() }).transform((body) => body.error_description),
  z.object({ reason: z.string() }).transform((body) => body.reason),
  z.object({ message: z.string() }).transform((body) => body.message),
]);

/** The provider's human-readable reason; never the raw payload. */
function upstreamReason(detail: ErrorCause): string | undefined {
  if (typeof detail !== "object" || detail instanceof Error) {
    return undefined;
  }

  const parsed = upstreamReasonSchema.safeParse(detail);
  const reason = parsed.success ? parsed.data.trim().slice(0, MAX_UPSTREAM_REASON_CHARS) : "";

  return reason.length > 0 ? reason : undefined;
}

/**
 * Text shown to the model. Causes and raw upstream payloads stay server-side;
 * only a client error's provider reason is shown because it tells the model
 * what to correct.
 */
export function formatAppError(error: AppError): string {
  if (error.type === "API_ERROR" && error.status !== undefined && error.status < 500) {
    const reason = error.detail === undefined ? undefined : upstreamReason(error.detail);

    if (reason) {
      return `${error.message}: ${reason}`;
    }
  }

  return error.message;
}

/** Server-side diagnostics retained by an error, if any. */
export function errorDiagnostics(error: AppError): ErrorCause {
  if (error.type === "API_ERROR") {
    return error.detail;
  }

  return "cause" in error ? error.cause : undefined;
}
