/**
 * MCP UI resource helper.
 * Renders React components to static HTML and wraps them as MCP UI resources.
 */

import { createUIResource, type UIResource } from "@mcp-ui/server";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Create a UI resource content item from raw HTML string.
 */
export function htmlResource(uri: `ui://${string}`, html: string): UIResource {
  return createUIResource({
    uri,
    content: { type: "rawHtml", htmlString: html },
    encoding: "text",
  });
}

/**
 * Render a React element to a MCP UI resource.
 * Uses renderToStaticMarkup for lightweight output (no React hydration attributes).
 */
export function reactResource(
  uri: `ui://${string}`,
  element: ReactElement,
): UIResource {
  const html = `<!DOCTYPE html>${renderToStaticMarkup(element)}`;
  return htmlResource(uri, html);
}
