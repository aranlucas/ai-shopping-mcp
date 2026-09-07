/** Retry one transient GET failure within the original request deadline. */
export async function fetchWithReadRetry(request: Request): Promise<Response> {
  const response = await fetch(request);
  // Leave explicit Retry-After policies to the caller; never repeat mutations.
  if (
    request.method !== "GET" ||
    ![502, 503, 504].includes(response.status) ||
    response.headers.has("retry-after")
  ) {
    return response;
  }
  await response.body?.cancel();
  await scheduler.wait(200, { signal: request.signal });
  return fetch(request);
}
