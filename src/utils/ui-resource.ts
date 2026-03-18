/**
 * MCP Apps UI helpers.
 *
 * Integrates SSR React components with the MCP Apps extension.
 * Tools use `registerAppTool` with `_meta.ui.resourceUri` so that
 * claude.ai (and other MCP Apps hosts) fetch and render the UI
 * in a sandboxed iframe alongside the text result.
 *
 * Flow:
 *   1. Tool handler renders React → static HTML → stores in `ctx.htmlStore`
 *   2. Resource handler (registered once per URI) reads `ctx.htmlStore` and returns it
 *   3. Host fetches resource after tool call and renders the HTML
 */

import type { ToolCallback } from "@modelcontextprotocol/ext-apps/server";
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import type {
  AnySchema,
  ZodRawShapeCompat,
} from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ToolContext } from "../tools/types.js";

export { RESOURCE_MIME_TYPE };

/**
 * Render a React element to static HTML and store it in the htmlStore
 * so the corresponding MCP Apps resource handler can serve it.
 */
export function storeReactHtml(
  ctx: ToolContext,
  uri: string,
  element: ReactElement,
): void {
  const html = `<!DOCTYPE html>${renderToStaticMarkup(element)}`;
  ctx.htmlStore.set(uri, html);
}

/**
 * Register an MCP Apps resource that serves SSR HTML from the htmlStore.
 * Call once per resource URI during tool registration (in `init()`).
 * Skips registration if the URI has already been registered (uses htmlStore
 * keys with a sentinel prefix to track registrations per context).
 */
export function registerHtmlAppResource(
  ctx: ToolContext,
  name: string,
  uri: string,
): void {
  const sentinel = `__registered__${uri}`;
  if (ctx.htmlStore.has(sentinel)) return;
  ctx.htmlStore.set(sentinel, "1");
  registerAppResource(ctx.server, name, uri, {}, async () => ({
    contents: [
      {
        uri,
        mimeType: RESOURCE_MIME_TYPE,
        text:
          ctx.htmlStore.get(uri) ??
          "<html><body><p>No data yet.</p></body></html>",
      },
    ],
  }));
}

/** Config for registerAppToolWithUI — mirrors McpUiAppToolConfig without _meta (added automatically). */
export interface AppToolConfig<
  InputArgs extends undefined | ZodRawShapeCompat | AnySchema = undefined,
  OutputArgs extends ZodRawShapeCompat | AnySchema = ZodRawShapeCompat,
> {
  title?: string;
  description?: string;
  inputSchema?: InputArgs;
  outputSchema?: OutputArgs;
  annotations?: ToolAnnotations;
}

/**
 * Convenience: register an MCP Apps tool + its resource in one call.
 * Adds `_meta.ui.resourceUri` automatically.
 */
export function registerAppToolWithUI<
  InputArgs extends undefined | ZodRawShapeCompat | AnySchema = undefined,
  OutputArgs extends ZodRawShapeCompat | AnySchema = ZodRawShapeCompat,
>(
  ctx: ToolContext,
  toolName: string,
  resourceUri: string,
  resourceDisplayName: string,
  config: AppToolConfig<InputArgs, OutputArgs>,
  cb: ToolCallback<InputArgs>,
): void {
  registerHtmlAppResource(ctx, resourceDisplayName, resourceUri);
  registerAppTool(
    ctx.server,
    toolName,
    {
      ...config,
      _meta: { ui: { resourceUri } },
    },
    cb,
  );
}
