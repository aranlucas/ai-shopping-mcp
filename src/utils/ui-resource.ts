/**
 * MCP UI resource helper.
 * Wraps @mcp-ui/server's createUIResource for consistent usage across tools.
 */

import { createUIResource, type UIResource } from "@mcp-ui/server";

/**
 * Create a UI resource content item from raw HTML.
 * Include this in the tool response `content` array alongside text content.
 */
export function htmlResource(uri: `ui://${string}`, html: string): UIResource {
  return createUIResource({
    uri,
    content: { type: "rawHtml", htmlString: html },
    encoding: "text",
  });
}
