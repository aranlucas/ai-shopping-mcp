/**
 * MCP UI resource helpers for the MCP Apps extension.
 *
 * Uses @modelcontextprotocol/ext-apps so that hosts (Claude, VS Code, etc.)
 * render HTML in sandboxed iframes instead of showing raw HTML text.
 *
 * Flow:
 *  1. At init: registerAppResource is called per URI (co-located with tool)
 *  2. At tool call: renderAndStoreUI renders React SSR HTML into htmlStore
 *  3. Host fetches the resource → handler reads from htmlStore → returns HTML
 */

import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
} from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { renderToStaticMarkup } from "react-dom/server";

export { RESOURCE_MIME_TYPE };

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
 * Following the ext-apps pattern: co-locate with registerAppTool in each tool file.
 */
export function registerHtmlResource(
  server: McpServer,
  resourceUri: string,
  htmlStore: HtmlStore,
): void {
  registerAppResource(
    server,
    resourceUri,
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => ({
      contents: [
        {
          uri: resourceUri,
          mimeType: RESOURCE_MIME_TYPE,
          text:
            htmlStore.get(resourceUri) ||
            "<!DOCTYPE html><html><body>No content available yet.</body></html>",
        },
      ],
    }),
  );
}
