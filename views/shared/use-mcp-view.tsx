import type { App } from "@modelcontextprotocol/ext-apps/react";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import { useState } from "react";

/** Timeout for app-initiated tool calls (ms). Prevents indefinite hangs when
 *  the host supports serverTools but is slow or unresponsive. */
export const TOOL_CALL_TIMEOUT_MS = 15_000;

export interface McpViewResult<T> {
  /** The structured content data, null until received from host. */
  data: T | null;
  /** Update data directly (e.g. after a mutation response). */
  setData: (data: T | null) => void;
  /** The MCP app instance for calling server tools. */
  app: App | null;
  /** Whether the app is connected to the host. */
  isConnected: boolean;
  /** Whether the host supports app-initiated server tool calls.
   *  Buttons that use callServerTool should be disabled when false. */
  canCallTools: boolean;
  /** Connection error, if any. */
  error: Error | null;
}

/**
 * Shared hook that wires up useApp + useHostStyles + ontoolresult → state.
 *
 * @param name   - App name (e.g. "shopping-list")
 * @param guard  - Predicate to validate the structured content before accepting it.
 *                 Receives the raw `structuredContent` and returns true if it's valid.
 *                 Example: `(sc) => !!sc?.items` or `(sc) => !!sc?.product`
 */
export function useMcpView<T>(
  name: string,
  guard: (sc: T | undefined) => boolean,
): McpViewResult<T> {
  const [data, setData] = useState<T | null>(null);

  const { app, isConnected, error } = useApp({
    appInfo: { name, version: "1.0.0" },
    capabilities: {},
    onAppCreated: (appInstance) => {
      appInstance.ontoolresult = (result) => {
        const content = result.structuredContent as T | undefined;
        if (guard(content)) {
          setData(content as T);
        }
      };
      appInstance.onerror = console.error;
    },
  });

  useHostStyles(app, app?.getHostContext());

  // serverTools capability is required for app-initiated callServerTool() calls.
  // If the host doesn't advertise it, tool calls will hang until timeout.
  const canCallTools = isConnected && !!app?.getHostCapabilities()?.serverTools;

  return { data, setData, app, isConnected, canCallTools, error };
}
