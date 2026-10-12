import type { McpServer } from "@modelcontextprotocol/server";
import type { KrogerConnectionStatus } from "../kroger-connections.js";

export function registerConnectKroger(
  server: McpServer,
  resource: string,
  status: KrogerConnectionStatus,
) {
  const url = new URL("/connect/kroger", resource).href;
  server.registerTool(
    "connect_kroger",
    {
      description:
        "Get the secure browser URL to connect or reconnect Kroger. Ask the user to open it, sign in to the same shared-auth account they use for this MCP connection, and approve Kroger access. Retry shopping after they finish.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status,
            url,
            message:
              "Open this URL to connect Kroger, then retry the shopping request.",
          }),
        },
      ],
    }),
  );
}
