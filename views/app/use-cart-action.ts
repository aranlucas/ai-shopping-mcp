import type { App } from "@modelcontextprotocol/ext-apps/react";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useResettableState } from "../shared/hooks.js";
import { createCartAction, type CartRequest } from "./cart-action.js";

/** Keep the operation across rerenders and reconnects; reset only for a new request. */
export function useCartAction(
  app: App | null,
  request: CartRequest,
  resetAfterMs?: number,
) {
  const [action] = useResettableState(JSON.stringify(request), () =>
    createCartAction(request),
  );
  const state = useSyncExternalStore(
    action.subscribe,
    action.getSnapshot,
    action.getSnapshot,
  );
  const submit = useCallback(() => action.submit(app), [action, app]);

  useEffect(() => {
    if (
      (state.status !== "added" && state.status !== "already_added") ||
      resetAfterMs === undefined
    )
      return;
    const timer = setTimeout(action.reset, resetAfterMs);
    return () => clearTimeout(timer);
  }, [action, state.status, resetAfterMs]);

  return { state, submit };
}
