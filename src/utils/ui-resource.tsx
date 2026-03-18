/**
 * MCP UI resource helpers for the MCP Apps extension.
 *
 * Uses registerAppTool/registerAppResource from @modelcontextprotocol/ext-apps
 * so that hosts (Claude, VS Code, etc.) render HTML in sandboxed iframes
 * instead of showing raw HTML text.
 *
 * Flow:
 *  1. At init: registerAppUIResource registers a resource handler per URI
 *  2. At tool call: renderAndStoreUI renders React SSR HTML into htmlStore
 *  3. Host fetches the resource → handler reads from htmlStore → returns HTML
 */

import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
} from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { renderToStaticMarkup } from "react-dom/server";

export type HtmlStore = Map<string, string>;

/**
 * Render a React component to HTML and store it for the resource handler.
 * Call this in the tool handler before returning the text-only result.
 */
export function renderAndStoreUI<P extends Record<string, unknown>>(
  htmlStore: HtmlStore,
  uri: `ui://${string}`,
  Component: React.ComponentType<P>,
  props: P,
): void {
  const html = `<!DOCTYPE html>${renderToStaticMarkup(<Component {...props} />)}`;
  htmlStore.set(uri, html);
}

/**
 * Register an MCP Apps resource that serves SSR HTML from the shared store.
 * Call once per URI at init time.
 */
export function registerAppUIResource(
  server: McpServer,
  name: string,
  uri: `ui://${string}`,
  htmlStore: HtmlStore,
): void {
  registerAppResource(
    server,
    name,
    uri,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => ({
      contents: [
        {
          uri,
          mimeType: RESOURCE_MIME_TYPE,
          text:
            htmlStore.get(uri) ||
            "<!DOCTYPE html><html><body>No content available yet.</body></html>",
        },
      ],
    }),
  );
}
