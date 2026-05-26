type FetchHandler = {
  fetch(request: Request, env: unknown, ctx: ExecutionContext): Promise<Response> | Response;
};

type OriginProtectionOptions = {
  allowedOrigins?: string[];
};

function jsonRpcError(status: number, message: string) {
  return Response.json(
    {
      error: { code: -32000, message },
      id: null,
      jsonrpc: "2.0",
    },
    { status },
  );
}

function normalizeOrigin(origin: string) {
  try {
    return new URL(origin).origin;
  } catch {
    return null;
  }
}

export function isAllowedMcpOrigin(
  origin: string | null,
  requestUrl: string,
  allowedOrigins: string[] = [],
) {
  if (!origin) return true;

  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) return false;

  const requestOrigin = new URL(requestUrl).origin;
  return normalizedOrigin === requestOrigin || allowedOrigins.includes(normalizedOrigin);
}

export function withMcpOriginProtection<TEnv = unknown>(
  handler: FetchHandler,
  options: OriginProtectionOptions = {},
) {
  return {
    async fetch(request: Request, env: TEnv, ctx: ExecutionContext) {
      if (!isAllowedMcpOrigin(request.headers.get("Origin"), request.url, options.allowedOrigins)) {
        return jsonRpcError(403, "Forbidden: invalid Origin header");
      }

      return handler.fetch(request, env, ctx);
    },
  };
}
