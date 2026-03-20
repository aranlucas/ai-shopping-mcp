import type { App } from "@modelcontextprotocol/ext-apps/react";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import { useState } from "react";

export interface McpViewResult<T> {
  /** The structured content data, null until received from host. */
  data: T | null;
  /** Update data directly (e.g. after a mutation response). */
  setData: (data: T | null) => void;
  /** The MCP app instance for calling server tools. */
  app: App | undefined;
  /** Whether the app is connected to the host. */
  isConnected: boolean;
  /** Connection error, if any. */
  error: Error | undefined;
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

  return { data, setData, app, isConnected, error };
}
