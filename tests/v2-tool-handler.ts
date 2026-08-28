import type { ServerContext } from "@modelcontextprotocol/server";

export type TestToolHandler = (
  args: Record<string, unknown>,
  requestContext?: ServerContext,
) => Promise<unknown>;

function makeRequestContext(): ServerContext {
  return {
    mcpReq: {
      id: 1,
      method: "tools/call",
      requestState: () => undefined,
      notify: async () => {},
      log: async () => {},
      elicitInput: async () => ({ action: "accept", content: { confirm: true } }),
      requestSampling: async () => {
        throw new Error("Sampling is not configured in this test");
      },
    },
  } as unknown as ServerContext;
}

/**
 * Supplies the minimal v2 request context expected by tool handlers.
 */
export function wrapV2ToolHandler(handler: TestToolHandler, _server: unknown): TestToolHandler {
  return async (args, requestContext) => {
    if (requestContext) return await handler(args, requestContext);
    return await handler(args, makeRequestContext());
  };
}
