import { getProps } from "../src/utils/result.js";
import { authenticatedRequest } from "./authenticated-request.js";
import { createMcpHandler, getMcpAuthContext } from "agents/mcp/server";
import { McpServer } from "@modelcontextprotocol/server";
import { expect, it } from "vitest";

it("runs through the real Agents auth context", async () => {
  let observed: string | undefined;

  const handler = createMcpHandler(
    () => {
      const server = new McpServer({ name: "auth-probe", version: "1.0.0" });
      server.registerTool("probe", {}, async () => {
        const context = getMcpAuthContext();

        if (context?.props.id === "user-123") observed = context.props.id;

        return { content: [{ type: "text", text: "ok" }] };
      });

      return server;
    },
    { authContext: { props: { id: "user-123" } } },
  );

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
        params: { name: "probe", arguments: {} },
      }),
    }),
  );

  expect(await response.text()).toContain("ok");
  expect(observed).toBe("user-123");
});

it("preserves an operation rejection", async () => {
  await expect(
    authenticatedRequest(async () => {
      throw new Error("synthetic failure");
    }),
  ).rejects.toThrow("synthetic failure");
});

it("validates the real request context and preserves the numeric contract", async () => {
  await Promise.all(
    [Date.now() + 1000, Number.NaN, Infinity, -Infinity].map(
      async (tokenExpiresAt) => {
        const props = {
          id: "user-123",
          accessToken: "synthetic",
          tokenExpiresAt,
        };

        await expect(
          authenticatedRequest(() => Promise.resolve(getProps()), { props }),
        ).resolves.toEqual(props);
      },
    ),
  );
});
