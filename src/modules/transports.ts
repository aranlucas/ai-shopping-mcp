import { randomUUID } from "node:crypto";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Application, Request, Response } from "express";

// Store transports for each session type
const transports = {
  streamable: {} as Record<string, StreamableHTTPServerTransport>,
  sse: {} as Record<string, SSEServerTransport>,
};

export function setupMCPEndpoint(app: Application, server: McpServer) {
  app.all("/mcp", async (req: Request, res: Response) => {
    // console.log("Request Session ID:", req.sessionId);
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports.streamable[sessionId]) {
      transport = transports.streamable[sessionId];
    } else {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sessionId) => {
          // Store the transport by session ID
          transports.streamable[sessionId] = transport;
        },
      });

      // Clean up transport when closed
      transport.onclose = () => {
        if (transport.sessionId) {
          delete transports.streamable[transport.sessionId];
        }
      };
      await server.connect(transport);
    }
    await transport.handleRequest(req, res, req.body);
  });
}

export function setupSSEEndpoint(app: Application, server: McpServer) {
  app.get("/sse", async (req: Request, res: Response) => {
    const transport = new SSEServerTransport("/messages", res);
    transports.sse[transport.sessionId] = transport;

    console.log(
      `SSE connection established. Session ID: ${transport.sessionId}`,
    );

    res.on("close", () => {
      console.log(`SSE connection closed. Session ID: ${transport.sessionId}`);
      delete transports.sse[transport.sessionId];
    });

    try {
      await server.connect(transport);
      console.log(
        `Transport connected to MCP server. Session ID: ${transport.sessionId}`,
      );
    } catch (error) {
      console.error(
        `Error connecting transport to MCP server. Session ID: ${transport.sessionId}`,
        error,
      );
    }
  });
}

export function setupMessageEndpoint(app: Application) {
  app.post("/messages", async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string;
    const transport = transports.sse[sessionId] ?? Object.values(transports)[0];

    if (transport) {
      console.log(`Handling message for Session ID: ${sessionId}`);
      try {
        await transport.handlePostMessage(req, res);
      } catch (error) {
        console.error(
          `Error handling message for Session ID: ${sessionId}`,
          error,
        );
        res.status(500).send("Internal Server Error");
      }
    } else {
      console.error(`No transport found for Session ID: ${sessionId}`);
      res.status(400).send("No transport found for sessionId");
    }
  });
}
