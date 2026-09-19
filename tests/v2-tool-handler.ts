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

export type TestToolConfig = {
  inputSchema: z.ZodType<Record<string, unknown>>;
};

function makeRequestContext(): ServerContext {
  return {
    mcpReq: {
      id: 1,
      method: "tools/call",
      requestState: () => undefined,
      notify: async () => {},
      log: async () => {},
      elicitInput: async () => ({
        action: "accept",
        content: { confirm: true },
      }),
      requestSampling: async () => {
        throw new Error("Sampling is not configured in this test");
      },
    },
  } as unknown as ServerContext;
}

/**
 * Applies the registered input contract before invoking the callback, as MCP does.
 */
export function wrapV2ToolHandler(
  handler: RawToolHandler,
  config: TestToolConfig,
): TestToolHandler {
  const invoke = wrapRawV2ToolHandler(handler);
  return async (args, requestContext) => {
    const parsed = await config.inputSchema.parseAsync(args);
    return invoke(parsed, requestContext);
  };
}

/** Explicit escape hatch for tests of a callback outside the MCP input boundary. */
export function wrapRawV2ToolHandler(handler: RawToolHandler): TestToolHandler {
  return async (args, requestContext) => {
    const result = await handler(args, requestContext ?? makeRequestContext());
    return toolResultSchema.parse(result);
  };
}
