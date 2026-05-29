/**
 * MCP Apps resource helper for serving Vite-built Views from the ASSETS binding.
 *
 * A single unified View HTML file (built by Vite + vite-plugin-singlefile)
 * uses @modelcontextprotocol/ext-apps/react to receive tool results
 * via ontoolresult and render them client-side.  The view routes internally
 * based on hostContext.toolInfo.tool.name.
 *
 * Flow:
 *  1. At init: registerViewResource registers a single resource backed by ASSETS
 *  2. At tool call: tool returns structuredContent (JSON data)
 *  3. Host fetches the resource → ASSETS.fetch() returns the built HTML
 *  4. Host renders iframe with the HTML, passes tool result via ontoolresult
 *  5. Client-side React in the iframe routes to the correct view component
 */

import {
  type McpUiAppToolConfig,
  RESOURCE_MIME_TYPE,
  type ToolCallback,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import type { RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AnySchema, ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";

import type { ToolContext } from "../tools/types.js";

export { RESOURCE_MIME_TYPE };

/** Single resource URI shared by all app tools. */
export const APP_VIEW_URI = "ui://shopping-app";

/** Schema argument accepted by `registerAppTool` (a Zod object or any Standard Schema). */
type ToolSchema = NonNullable<McpUiAppToolConfig["inputSchema"]>;

/**
 * `registerAppTool` bound to this server's single shared app view.
 *
 * Every view-backed tool renders into the same `APP_VIEW_URI` resource, so this
 * wrapper injects `_meta.ui.resourceUri` instead of each tool repeating it (and
 * importing `APP_VIEW_URI`). It mirrors `registerAppTool`'s generics so handler
 * argument inference from `inputSchema` is fully preserved.
 */
export function registerViewTool<
  OutputArgs extends ToolSchema,
  InputArgs extends ToolSchema | undefined = undefined,
>(
  ctx: ToolContext,
  name: string,
  config: Omit<McpUiAppToolConfig, "_meta"> & {
    inputSchema?: InputArgs;
    outputSchema?: OutputArgs;
  },
  cb: ToolCallback<
    InputArgs extends undefined | ZodRawShapeCompat | AnySchema ? InputArgs : AnySchema
  >,
): RegisteredTool {
  return registerAppTool(
    ctx.server,
    name,
    { ...config, _meta: { ui: { resourceUri: APP_VIEW_URI } } },
    cb,
  );
}

const ERROR_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/></head>
<body><div style="text-align:center;padding:32px;color:#9ca3af">
Error loading view</div></body></html>`;

/**
 * Load a built View HTML file from the Cloudflare Workers ASSETS binding.
 */
async function loadViewHtml(env: Env, htmlPath: string): Promise<string> {
  try {
    const assets = env.ASSETS;
    if (!assets) {
      throw new Error("ASSETS binding not available");
    }

    const url = new URL(htmlPath, "https://assets.invalid");
    const response = await assets.fetch(new Request(url.toString()));

    if (!response.ok) {
      throw new Error(`Failed to fetch view HTML: ${response.status}`);
    }

    return await response.text();
  } catch (error) {
    console.error(`Failed to load view ${htmlPath}:`, error);
    return ERROR_HTML;
  }
}

/**
 * Register an MCP Apps resource that serves a Vite-built View HTML file.
 *
 * The HTML is loaded from the ASSETS binding at request time (not at
 * registration time), so the Env is resolved lazily via ctx.getEnv().
 */
export function registerViewResource(
  ctx: ToolContext,
  resourceUri: string,
  filename: string,
): void {
  registerAppResource(
    ctx.server,
    resourceUri,
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => {
      const html = await loadViewHtml(ctx.getEnv(), `/${filename}`);
      return {
        contents: [
          {
            uri: resourceUri,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
          },
        ],
      };
    },
  );
}
