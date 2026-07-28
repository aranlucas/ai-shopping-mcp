import {
  isInputRequiredResult,
  type ElicitResult,
  type ServerContext,
} from "@modelcontextprotocol/server";

import { testCartConfirmationCodec } from "./cart-confirmation.js";

export type TestToolHandler = (
  args: Record<string, unknown>,
  requestContext?: ServerContext,
) => Promise<unknown>;

type LegacyTestServer = {
  registerTool?: unknown;
  server?: {
    elicitInput?: (request: unknown) => Promise<ElicitResult>;
  };
};

function makeRequestContext(
  state?: unknown,
  inputResponses?: Record<string, unknown>,
): ServerContext {
  return {
    mcpReq: {
      id: 1,
      method: "tools/call",
      inputResponses,
      requestState: () => state,
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
 * Adapts the tests' old one-call confirmation convention to the v2
 * input_required → retry exchange. Passing an explicit request context skips
 * the adapter so tests can still inspect either round directly.
 */
export function wrapV2ToolHandler(
  handler: TestToolHandler,
  server: LegacyTestServer,
): TestToolHandler {
  return async (args, requestContext) => {
    if (requestContext) return handler(args, requestContext);

    const initialContext = makeRequestContext();
    const initialResult = await handler(args, initialContext);
    if (!isInputRequiredResult(initialResult)) return initialResult;

    const elicitation =
      (await server.server?.elicitInput?.(initialResult.inputRequests?.["checkout"])) ??
      ({ action: "accept", content: { confirm: true } } satisfies ElicitResult);
    const state =
      initialResult.requestState === undefined
        ? undefined
        : await testCartConfirmationCodec.verify(initialResult.requestState, initialContext);

    return handler(
      args,
      makeRequestContext(state, {
        checkout: elicitation,
      }),
    );
  };
}
