/**
 * MCP UI resource helper.
 * Uses @mcp-ui/server's createUIResource to produce inline UI content items
 * that can be included directly in tool response content arrays.
 */

import { createUIResource, type UIResource } from "@mcp-ui/server";
import { renderToStaticMarkup } from "react-dom/server";

export type { UIResource };

/**
 * Render a React element to a UIResource for inclusion in tool content arrays.
 */
export async function renderReactUI<P extends Record<string, unknown>>(
  uri: `ui://${string}`,
  Component: React.ComponentType<P>,
  props: P,
): Promise<UIResource> {
  const html = `<!DOCTYPE html>${renderToStaticMarkup(<Component {...props} />)}`;
  return createUIResource({
    uri,
    content: { type: "rawHtml", htmlString: html },
    encoding: "text",
  });
}
