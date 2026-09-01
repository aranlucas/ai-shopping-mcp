import type { ServerContext } from "@modelcontextprotocol/server";
import { z } from "zod";

const toolResultSchema = z
  .object({
    content: z.array(z.object({ text: z.string() })),
    isError: z.boolean().optional(),
    structuredContent: z.unknown().optional(),
    _meta: z.unknown().optional(),
  })
  .loose()
  .transform((result) => ({
    ...result,
    text: result.content[0]?.text ?? "",
    isError: result.isError ?? false,
  }));

export type TestToolResult = z.infer<typeof toolResultSchema>;

export type TestToolHandler = (
  args: Record<string, unknown>,
  requestContext?: ServerContext,
) => Promise<TestToolResult>;

type RawToolHandler = (
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
export function wrapV2ToolHandler(handler: RawToolHandler, _server: unknown): TestToolHandler {
  return async (args, requestContext) => {
    const result = requestContext
      ? await handler(args, requestContext)
      : await handler(args, makeRequestContext());
    return toolResultSchema.parse(result);
  };
}
