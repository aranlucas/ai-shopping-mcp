import type {
  ShoppingAppClient,
  AppData,
  ShoppingListSummaryData,
  ShoppingListsContent,
} from "../../shared/types.js";

import { useCallback, useMemo, useState } from "react";
import { Badge } from "../../shared/ui/badge";
import { Button } from "../../shared/ui/button";
import { ActionButton, SectionHeader } from "../../shared/components.js";
import { EmptyState } from "../../shared/status.js";
import { deleteShoppingList, openShoppingList } from "../tool-calls.js";

type ShoppingListSummaryProps = {
  list: ShoppingListSummaryData;
  canOpen: boolean;
  onOpen: (listId: string) => Promise<void>;
  onDelete: (listId: string) => Promise<void>;
};

type ShoppingListsViewProps = {
  data: ShoppingListsContent;
  setData: (data: AppData | null) => void;
  app: ShoppingAppClient | null;
  canCallTools: boolean;
};

const EMPTY_LISTS_ICON = (
  <svg
    aria-hidden="true"
    className="size-5"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"
    />
  </svg>
);

function formatUpdated(value: string): string {
  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

type DeleteState = "idle" | "confirming" | "deleting";

function ListRow({ list, canOpen, onOpen, onDelete }: ShoppingListSummaryProps) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [deleteState, setDeleteState] = useState<DeleteState>("idle");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleOpen = useCallback(async () => {
    setState("loading");

    try {
      await onOpen(list.id);
    } catch {
      setState("error");
    }
  }, [list.id, onOpen]);

  const handleAskDelete = useCallback(() => {
    setDeleteError(null);
    setDeleteState("confirming");
  }, []);

  const handleCancelDelete = useCallback(() => setDeleteState("idle"), []);

  const confirmDelete = useCallback(async () => {
    setDeleteState("deleting");
    setDeleteError(null);

    try {
      // On success the parent replaces the lists and this row unmounts.
      await onDelete(list.id);
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : "Could not delete that list");
      setDeleteState("confirming");
    }
  }, [list.id, onDelete]);

  const handleConfirmDelete = useCallback(() => {
    confirmDelete().catch(console.error);
  }, [confirmDelete]);

  const updated = formatUpdated(list.updatedAt);
  const deleting = deleteState === "deleting";

  return (
    <li className="py-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-gray-900">{list.name}</div>
          <div className="mbs-0.5 flex items-center gap-2 text-xs text-gray-500">
            <span>
              {list.itemCount} {list.itemCount === 1 ? "item" : "items"}
            </span>
            {updated && <span>· Updated {updated}</span>}
          </div>
        </div>
        {deleteState === "idle" ? (
          <>
            <ActionButton
              state={state}
              onClick={handleOpen}
              disabled={!canOpen}
              idleLabel="Open"
              loadingLabel="Opening…"
              failLabel="Retry"
              labelContext={list.name}
              variant="secondary"
            />
            <Button
              variant="ghost"
              disabled={!canOpen}
              aria-label={`Delete: ${list.name}`}
              onClick={handleAskDelete}
            >
              Delete
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="destructive"
              disabled={deleting}
              aria-busy={deleting}
              aria-label={`Confirm delete: ${list.name}`}
              onClick={handleConfirmDelete}
            >
              {deleting ? "Deleting…" : "Confirm delete"}
            </Button>
            <Button variant="ghost" disabled={deleting} onClick={handleCancelDelete}>
              Cancel
            </Button>
          </>
        )}
      </div>
      {deleteError && (
        <p role="alert" className="mbs-1.5 text-sm text-red-600">
          {deleteError}
        </p>
      )}
    </li>
  );
}

export function ShoppingListsView({ data, setData, app, canCallTools }: ShoppingListsViewProps) {
  const { lists } = data;

  const handleOpen = useCallback(
    async (listId: string) => {
      setData(await openShoppingList(app, listId));
    },
    [app, setData],
  );

  const handleDelete = useCallback(
    async (listId: string) => {
      setData({ view: "shopping_lists", lists: await deleteShoppingList(app, listId) });
    },
    [app, setData],
  );

  const headerBadge = useMemo(
    () => <Badge variant="secondary">{lists.length}</Badge>,
    [lists.length],
  );

  return (
    <div className="mx-auto max-w-2xl px-4 py-5 sm:px-6">
      <SectionHeader title="Shopping lists" badge={headerBadge} />
      {lists.length === 0 ? (
        <EmptyState
          icon={EMPTY_LISTS_ICON}
          message="No saved lists yet"
          description="Ask your assistant to create a shopping list."
        />
      ) : (
        <ul className="m-0 list-none divide-y divide-border p-0">
          {lists.map((list) => (
            <ListRow
              key={list.id}
              list={list}
              canOpen={canCallTools}
              onOpen={handleOpen}
              onDelete={handleDelete}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
