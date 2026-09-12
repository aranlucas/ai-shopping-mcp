import { App } from "@modelcontextprotocol/ext-apps";
import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import { Client, InMemoryTransport, ProtocolError } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";

import { describe, expect, it } from "vitest";

import { callTool, parseToolResult, type ToolCall } from "../../views/shared/types.js";

describe("MCP Apps v2 protocol bridge", () => {
  it("handshakes, routes tool results, and preserves ProtocolError rejections", async () => {
    const [viewTransport, hostTransport] = InMemoryTransport.createLinkedPair();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = new McpServer({ name: "shopping-server-test", version: "2.0.0" });
    server.registerTool(
      "search_products",
      {
        inputSchema: z.object({ terms: z.array(z.string()) }),
      },
      async () => ({
        content: [{ type: "text", text: "called search_products" }],
        structuredContent: { accepted: true, name: "search_products" },
      }),
    );
    const client = new Client({ name: "shopping-client-test", version: "2.0.0" });
    const app = new App(
      { name: "shopping-app-test", version: "1.0.0" },
      {},
      {
        autoResize: false,
        strict: true,
      },
    );
    const bridge = new AppBridge(
      client,
      { name: "shopping-host-test", version: "2.0.0" },
      { serverTools: {} },
    );

    let parsedResult: ReturnType<typeof parseToolResult> = null;
    app.ontoolresult = (result) => {
      parsedResult = parseToolResult(result);
    };

    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      await Promise.all([app.connect(viewTransport), bridge.connect(hostTransport)]);

      expect(app.getHostVersion()).toEqual({ name: "shopping-host-test", version: "2.0.0" });
      expect(app.getHostCapabilities()?.serverTools).toEqual({});

      await bridge.sendToolInput({ arguments: { terms: ["milk"] } });
      await bridge.sendToolResult({
        content: [{ type: "text", text: "Found milk" }],
        _meta: { "dev.aranlucas/view": "search_products" },
        structuredContent: {
          results: [
            {
              provider: "kroger",
              term: "milk",
              products: [],
              failed: false,
            },
          ],
          totalProducts: 0,
        },
      });

      expect(parsedResult).toEqual({
        view: "search_products",
        results: [
          {
            provider: "kroger",
            term: "milk",
            products: [],
            failed: false,
          },
        ],
        totalProducts: 0,
      });

      const call: ToolCall = {
        name: "search_products",
        arguments: { terms: ["milk"] },
      };
      await expect(callTool(app, call)).resolves.toMatchObject({
        content: [{ type: "text", text: "called search_products" }],
        structuredContent: { accepted: true, name: "search_products" },
      });

      const rejectedCall = callTool(app, { name: "get_store", arguments: { storeId: "missing" } });
      await expect(rejectedCall).rejects.toMatchObject({
        code: -32602,
        message: expect.stringContaining("get_store"),
      });
      await expect(rejectedCall).rejects.toSatisfy(
        (error: unknown) => error instanceof ProtocolError,
      );
    } finally {
      await Promise.all([app.close(), bridge.close(), client.close(), server.close()]);
    }
  });
});
