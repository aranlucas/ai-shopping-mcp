import type { Middleware } from "openapi-fetch";

export const REQUEST_TIMEOUT_MS = 10_000;

/** A fresh deadline for each request, combined with the caller's cancellation. */
export function requestTimeoutMiddleware(
  signal?: AbortSignal,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Middleware {
  return {
    onRequest({ request }) {
      return new Request(request, {
        signal: AbortSignal.any([
          request.signal,
          AbortSignal.timeout(timeoutMs),
          ...(signal ? [signal] : []),
        ]),
      });
    },
  };
}
