import {
  authenticatedRequest,
  type RequestCustomization,
} from "./authenticated-request.js";
import {
  specTypeSchemas,
  type CallToolRequestParams,
  type McpServer,
  type ServerContext,
} from "@modelcontextprotocol/server";
import type { z } from "zod";

/** Use the SDK's own wire validator and keep the convenience fields used by tests. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Test handlers are a raw SDK boundary; the native CallToolResult schema validates their output before it reaches consumers.
export function parseTestToolResult(value: unknown) {
  const parsed = specTypeSchemas.CallToolResult["~standard"].validate(value);

  if (parsed.issues) throw new TypeError("Invalid MCP tool response");
  const result = parsed.value;

  return {
    ...result,
    text: result.content.find((item) => item.type === "text")?.text ?? "",
    isError: result.isError ?? false,
  };
}

export type TestToolResult = ReturnType<typeof parseTestToolResult>;

export type ToolArguments = NonNullable<CallToolRequestParams["arguments"]>;

export type TestToolHandler = (
  args: ToolArguments,
  requestContext?: RequestCustomization,
) => Promise<TestToolResult>;

export type RawToolHandler = (
  args: ToolArguments,
  requestContext?: ServerContext,
) => ReturnType<ReturnType<McpServer["registerTool"]>["executor"]>;

export type TestToolConfig = Omit<
  Parameters<McpServer["registerTool"]>[1],
  "inputSchema"
> & {
  inputSchema: z.ZodObject;
};

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
    const result = await authenticatedRequest(
      (context) => handler(args, context),
      undefined,
      requestContext,
    );

    return parseTestToolResult(result);
  };
}
