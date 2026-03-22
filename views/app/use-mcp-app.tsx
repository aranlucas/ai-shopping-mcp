/**
 * Unified MCP App hook — single hook for all views.
 *
 * Fixes two issues with the previous per-view useMcpView + useHostStyles approach:
 * 1. Dark mode: useHostStyles internally calls useHostStyleVariables then useHostFonts,
 *    both of which set onhostcontextchanged — the second overwrites the first, so
 *    theme/variable updates are lost. This hook uses a single unified handler.
 * 2. Tool routing: uses hostContext.toolInfo to determine which tool created this
 *    view, with fallback to a `_view` discriminator in structuredContent.
 */

import {
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import type { App } from "@modelcontextprotocol/ext-apps/react";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import { useEffect, useState } from "react";

export interface McpAppState {
  /** Which tool created this view (e.g. "search_products"). */
  toolName: string | null;
  /** The structured content data from ontoolresult. */
  data: unknown;
  /** Update data directly (e.g. after a mutation response). */
  setData: (data: unknown) => void;
  /** The MCP app instance for calling server tools. */
  app: App | null;
  /** Whether the app is connected to the host. */
  isConnected: boolean;
  /** Whether the host supports app-initiated server tool calls. */
  canCallTools: boolean;
  /** Connection error, if any. */
  error: Error | null;
}

/** Apply all host styles from a partial context update. */
function applyStyles(ctx: Partial<McpUiHostContext>) {
  if (ctx.theme === "light" || ctx.theme === "dark") {
    applyDocumentTheme(ctx.theme);
  }
  if (ctx.styles?.variables) {
    applyHostStyleVariables(ctx.styles.variables);
  }
  if (ctx.styles?.css?.fonts) {
    applyHostFonts(ctx.styles.css.fonts);
  }
}

export function useMcpApp(): McpAppState {
  const [toolName, setToolName] = useState<string | null>(null);
  const [data, setData] = useState<unknown>(null);

  const { app, isConnected, error } = useApp({
    appInfo: { name: "shopping-app", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (appInstance) => {
      appInstance.ontoolresult = (result) => {
        if (result.structuredContent) {
          setData(result.structuredContent);
          // Primary: read toolInfo from host context (App class merges
          // onhostcontextchanged updates into _hostContext before this fires)
          const ctxName = appInstance.getHostContext()?.toolInfo?.tool?.name;
          if (ctxName) {
            setToolName(ctxName);
          }
        }
      };

      // Unified host context handler — handles theme, variables, fonts,
      // AND toolInfo updates sent after initial connection.
      appInstance.onhostcontextchanged = (params) => {
        const name = params.toolInfo?.tool?.name;
        if (name) setToolName(name);
        applyStyles(params);
      };

      appInstance.onerror = console.error;
    },
  });

  // After connection: apply initial styles and resolve tool name
  useEffect(() => {
    if (!app || !isConnected) return;

    const ctx = app.getHostContext();
    if (ctx) applyStyles(ctx);

    // Primary: get tool name from host context (MCP Apps standard)
    const name = ctx?.toolInfo?.tool?.name;
    if (name) setToolName((prev) => prev ?? name);
  }, [app, isConnected]);

  const canCallTools = isConnected && !!app?.getHostCapabilities()?.serverTools;

  return { toolName, data, setData, app, isConnected, canCallTools, error };
}
