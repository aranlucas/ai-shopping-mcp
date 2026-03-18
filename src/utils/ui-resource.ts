/**
 * MCP UI resource helper.
 * Uses @mcp-ui/server's createUIResource to produce inline UI content items
 * that can be included directly in tool response content arrays.
 */

import { createUIResource, type UIResource } from "@mcp-ui/server";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

export type { UIResource };

/**
 * Render a React element to a UIResource for inclusion in tool content arrays.
 */
export async function renderReactUI(
  uri: `ui://${string}`,
  element: ReactElement,
): Promise<UIResource> {
  const html = `<!DOCTYPE html>${renderToStaticMarkup(element)}`;
  return createUIResource({
    uri,
    content: { type: "rawHtml", htmlString: html },
    encoding: "text",
  });
}

/**
 * Create a UIResource from raw HTML string.
 */
export async function htmlResource(
  uri: `ui://${string}`,
  html: string,
): Promise<UIResource> {
  return createUIResource({
    uri,
    content: { type: "rawHtml", htmlString: html },
    encoding: "text",
  });
}
