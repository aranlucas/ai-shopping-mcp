import { AppErrorException, validationError, notFoundError } from "../errors.js";
import { MAX_LIST_ITEMS } from "./shopping-schemas.js";
import {
  hasValidPackageCount,
  PACKAGE_COUNT_MESSAGE,
  type ShoppingList,
  type ShoppingListItem,
  type ShoppingListItemPatch,
  type StoredShoppingListItem,
} from "./shopping.js";

export interface ListEdit {
  add?: ShoppingListItem[];
  change?: Array<ShoppingListItemPatch & { itemId: string }>;
  remove?: string[];
}

export function newListItems(items: ShoppingListItem[]): StoredShoppingListItem[] {
  return items.map((item) => ({
    ...item,
    id: `item_${crypto.randomUUID().replaceAll("-", "")}`,
    checked: false,
  }));
}

/** Validate and apply the whole edit to one version of the list. */
export function applyListEdit(list: ShoppingList, edit: ListEdit) {
  const removed = new Set<string>();

  for (const ref of edit.remove ?? []) {
    const key = ref.trim().toLowerCase();

    const item =
      list.items.find((row) => row.id === ref) ??
      list.items.find((row) => row.productName.toLowerCase() === key);

    if (!item) {
      throw new AppErrorException(
        notFoundError(
          `No item "${ref}" on listId=${list.id}. Nothing was changed. Items: ${list.items.map((row) => `itemId=${row.id} ${row.productName}`).join("; ")}`,
        ),
      );
    }

    removed.add(item.id);
  }

  const items = list.items.filter((item) => !removed.has(item.id));
  const changed: StoredShoppingListItem[] = [];

  for (const { itemId, ...patch } of edit.change ?? []) {
    if (!Object.keys(patch).length) {
      throw new AppErrorException(
        validationError(
          `Change for itemId=${itemId} needs productName, quantity, upc, notes, or checked.`,
        ),
      );
    }

    const index = items.findIndex((item) => item.id === itemId);

    if (index < 0) {
      throw new AppErrorException(
        notFoundError(`No list item ${itemId}. Read get_shopping_list for current item IDs.`),
      );
    }

    const updated = { ...items[index], ...patch };

    if (
      (patch.upc !== undefined || patch.quantity !== undefined) &&
      !hasValidPackageCount(updated)
    ) {
      throw new AppErrorException(validationError(PACKAGE_COUNT_MESSAGE));
    }

    items[index] = updated;
    changed.push(updated);
  }

  const added = newListItems(edit.add ?? []);

  if (items.length + added.length > MAX_LIST_ITEMS) {
    throw new AppErrorException(
      validationError(
        `A list holds at most ${MAX_LIST_ITEMS} items. Remove items or create a new list.`,
      ),
    );
  }

  return { list: { ...list, items: [...items, ...added] }, added, changed, removed: [...removed] };
}
