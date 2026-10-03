import { createMcpHandler, type McpAuthContext } from "agents/mcp/server";
import { McpServer, type ServerContext } from "@modelcontextprotocol/server";
import { vi } from "vitest";

export type RequestCustomization = {
  _meta?: ServerContext["mcpReq"]["_meta"];
  notify?: ServerContext["mcpReq"]["notify"];
};

type RequestOperation<T> = (context: ServerContext) => Promise<T>;

/** Execute against the actual SDK request context and Agents auth storage, without a network request. */
export async function authenticatedRequest<T>(
  operation: RequestOperation<T>,
  authContext?: McpAuthContext,
  customization?: RequestCustomization,
): Promise<T> {
  let outcome: { value: T } | undefined;
  let failure: { cause: unknown } | undefined;
  const options = authContext ? { authContext } : undefined;

  const handler = createMcpHandler(() => {
    const server = new McpServer({
      name: "tool-test-context",
      version: "1.0.0",
    });

    server.registerTool("invoke", {}, async (context) => {
      if (customization?._meta !== undefined)
        context.mcpReq._meta = customization._meta;

      if (customization?.notify)
        vi.spyOn(context.mcpReq, "notify").mockImplementation(
          customization.notify,
        );
      // Explicit synthetic user consent preserves the pre-existing test harness policy.
      vi.spyOn(context.mcpReq, "elicitInput").mockResolvedValue({
        action: "accept",
        content: { confirm: true },
      });
      vi.spyOn(context.mcpReq, "requestSampling").mockRejectedValue(
        new Error("Sampling is not configured in this test"),
      );

      try {
        const pending = operation(context);
        // Observe this exact returned promise before Workerd crosses the request scope.
        // The original rejection remains the test result; it is never swallowed.
        const observed = pending.catch(() => undefined);

        try {
          outcome = { value: await pending };
        } catch (cause) {
          failure = { cause };
        }

        await observed;
      } catch (cause) {
        failure = { cause };
      }

      return { content: [{ type: "text", text: "completed" }] };
    });

    return server;
  }, options);

  const response = await handler.fetch(
    new Request("https://example.com/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-03-26",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "invoke", arguments: {} },
      }),
    }),
  );

  await response.text();

  if (failure) throw failure.cause;

  if (!outcome)
    throw new Error(`MCP test invocation failed (${response.status})`);

  return outcome.value;
}
