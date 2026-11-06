import { useCallback, useEffect, useState } from "react";
import { ActionButton } from "../shared/components.js";
import { callTool, type ShoppingAppClient } from "../shared/types.js";

const PREFERRED_STAR_ICON = (
  <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z"
    />
  </svg>
);

type PreferredStoreButtonProps = {
  app: ShoppingAppClient | null;
  storeId: string;
  canCallTools: boolean;
  idleLabel: string;
  doneLabel: string;
};

export function PreferredStoreButton({
  app,
  storeId,
  canCallTools,
  idleLabel,
  doneLabel,
}: PreferredStoreButtonProps) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");

  useEffect(() => {
    if (state !== "error") {
      return;
    }

    const timer = setTimeout(() => setState("idle"), 2000);

    return () => clearTimeout(timer);
  }, [state]);

  const handleSetPreferred = useCallback(async () => {
    setState("loading");

    try {
      const result = await callTool(app, {
        name: "set_preferred_store",
        arguments: { storeId },
      });

      setState(result.isError ? "error" : "done");
    } catch {
      setState("error");
    }
  }, [app, storeId]);

  return (
    <ActionButton
      state={state}
      onClick={handleSetPreferred}
      disabled={!canCallTools || state === "done"}
      idleLabel={idleLabel}
      loadingLabel="Saving..."
      doneLabel={doneLabel}
      failLabel="Failed"
      variant="primary"
      icon={PREFERRED_STAR_ICON}
    />
  );
}
