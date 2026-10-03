import { McpServer } from "@modelcontextprotocol/server";
import type { McpAuthContext } from "agents/mcp/server";
import { vi } from "vitest";
import { z } from "zod";
import { authenticatedRequest } from "./authenticated-request.js";
import {
  type TestToolHandler,
  type TestToolConfig,
  parseTestToolResult,
} from "./v2-tool-handler.js";

export type CapturedTool = {
  name: string;
  config: TestToolConfig;
  handler: TestToolHandler;
};

export function capturingServer(
  tools: CapturedTool[],
  auth: () => McpAuthContext | undefined,
) {
  const server = new McpServer({
    name: "registered-tool-test",
    version: "1.0.0",
  });

  const register = server.registerTool.bind(server);
  vi.spyOn(server, "registerTool").mockImplementation(
    (name, config, handler) => {
      const registered = register(name, config, handler);

      if (!(registered.inputSchema instanceof z.ZodObject))
        throw new Error(`Tool ${name} needs its real Zod schema`);
      const registration = { ...config, inputSchema: registered.inputSchema };
      tools.push({
        name,
        config: registration,
        handler: async (args, context) => {
          const parsed = await registration.inputSchema.parseAsync(args);

          const result = await authenticatedRequest(
            (requestContext) =>
              Promise.resolve(handler(parsed, requestContext)),
            auth(),
            context,
          );

          return parseTestToolResult(result);
        },
      });

      return registered;
    },
  );

  return server;
}
