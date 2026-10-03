import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/server";
import { type Result, type ResultAsync, errAsync, okAsync } from "neverthrow";
import * as z from "zod/v4";

import type { AppError } from "../errors.js";
import type {
  ShoppingList,
  ShoppingListItem,
  ShoppingListSummary,
} from "../domain/shopping.js";

import { appResult } from "../app-results.js";
import { notFoundError, validationError } from "../errors.js";
import { MAX_CATALOG_REQUESTS } from "../services/kroger/catalog-workload.js";
import type { ProductService } from "../services/kroger/product-service.js";
import type { WeeklyDealsCache } from "../services/weekly-deals/cache.js";
import {
  formatListSize,
  formatShoppingListItemCompact,
} from "../utils/format-response.js";
import type {
  PantryStore,
  PreferredLocationStore,
  ShoppingListStore,
} from "../utils/shopping-store.js";
import {
  getProps,
  safeResolveLocationId,
  safeStorage,
  toMcpError,
} from "../utils/result.js";
import { APP_VIEW_URI } from "../utils/view-resource.js";
import {
  getDealsForFlags,
  getPantryForFlags,
  itemFlagLabels,
} from "./item-flags.js";
import { upcSchema } from "./schemas.js";
import { textResult } from "./types.js";

/**
 * One item to write to a list. Exact matches use a normalized UPC.
 * Free-form ingredients can use productName alone.
 */
export const shoppingListItemInputSchema = z
  .strictObject({
    upc: upcSchema.optional().describe("13-digit UPC from search_products"),
    productName: z.string().trim().min(1).max(200).optional(),
    quantity: z.coerce
      .number()
      .min(1)
      .max(999)
      .default(1)
      .describe("Packages to buy, not units"),
    notes: z.string().max(500).optional(),
    price: z.coerce
      .number()
      .min(0)
      .max(10_000)
      .optional()
      .describe("Unit price, if known"),
  })
  .refine((item) => Boolean(item.upc ?? item.productName), {
    message: "Each item needs a UPC or a productName.",
  });

const listIdSchema = z.string().trim().min(1);

const itemIdSchema = z.string().trim().min(1);

export const createShoppingListInputSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(200)
    .describe("List label, e.g. 'Tuesday dinner'."),
  items: z
    .array(shoppingListItemInputSchema)
    .min(1, { message: "Shopping list must include at least one item" })
    .max(MAX_CATALOG_REQUESTS),
});

const shoppingListItemChangeSchema = z.object({
  itemId: itemIdSchema,
  productName: z.string().trim().min(1).max(200).optional(),
  quantity: z.coerce
    .number()
    .min(0)
    .max(999)
    .optional()
    .describe("0 removes the item"),
  notes: z.string().max(500).optional(),
  checked: z.boolean().optional(),
});

export const updateShoppingListInputSchema = z
  .object({
    listId: listIdSchema,
    add: z
      .array(shoppingListItemInputSchema)
      .min(1)
      .max(MAX_CATALOG_REQUESTS)
      .optional(),
    change: z
      .array(shoppingListItemChangeSchema)
      .min(1)
      .optional()
      .describe("Only the fields you pass change"),
    remove: z
      .array(itemIdSchema)
      .min(1)
      .optional()
      .describe("itemIds (or exact item names) to delete"),
  })
  .refine((input) => Boolean(input.add ?? input.change ?? input.remove), {
    message: "Pass at least one of add, change, or remove.",
  });

export const getShoppingListInputSchema = z.object({
  listId: listIdSchema.optional(),
  name: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe("List name, instead of listId"),
});

type ShoppingListItemInput = z.output<typeof shoppingListItemInputSchema>;

export type ShoppingListProductService = Pick<
  ProductService,
  "enrichProductNames"
>;

export type ShoppingListToolDependencies = {
  weeklyDealsCache: WeeklyDealsCache;
  pantry: PantryStore;
  preferredLocation: PreferredLocationStore;
  productService: ShoppingListProductService;
  shoppingList: ShoppingListStore;
};

/**
 * Resolves each input item to the domain model and enriches a UPC when the
 * caller omitted a name.
 */
async function toStoredItems(
  productService: ShoppingListProductService,
  items: ShoppingListItemInput[],
): Promise<Result<ShoppingListItem[], AppError>> {
  const missingUpcs = items.flatMap((item) =>
    !item.productName && item.upc ? [item.upc] : [],
  );

  const enriched = await productService.enrichProductNames(missingUpcs);

  return enriched.map((names) => {
    const nameByUpc = new Map(
      missingUpcs.map((upc, index) => [upc, names[index]]),
    );

    return items.map((item) => {
      const stored: ShoppingListItem = {
        productName:
          item.productName ??
          (item.upc ? (nameByUpc.get(item.upc) ?? item.upc) : ""),
        quantity: item.quantity,
      };

      if (item.upc !== undefined) stored.upc = item.upc;

      if (item.notes !== undefined) stored.notes = item.notes;

      if (item.price !== undefined) stored.price = item.price;

      return stored;
    });
  });
}

export type CreateShoppingListResult = { listId: string; list: ShoppingList };

/**
 * Persists a list and returns the storage-owned id shown to the model. The
 * storage creates the durable id, so the returned record is authoritative.
 */
export function createShoppingListRecord(
  shoppingList: ShoppingListStore,
  name: string,
  items: ShoppingListItem[],
): ResultAsync<CreateShoppingListResult, AppError> {
  return safeStorage(
    () => shoppingList.create({ name, items }),
    "create shopping list",
  ).map((list) => ({ listId: list.id, list }));
}

/** Text plus the editable shopping-list app view for one list. */
export function shoppingListViewResult(list: ShoppingList, text: string) {
  return {
    content: [{ type: "text" as const, text }],
    ...appResult("create_shopping_list", {
      listId: list.id,
      name: list.name,
      items: list.items,
    }),
  };
}

function listItemLines(list: ShoppingList): string {
  return list.items
    .map(
      (item, index) =>
        `${index + 1}. itemId=${item.id} ${formatShoppingListItemCompact(item)}${item.checked ? " | checked off" : ""}`,
    )
    .join("\n");
}

function describeList(list: ShoppingList): string {
  if (list.items.length === 0) {
    return `Shopping list "${list.name}" (listId=${list.id}) is empty. Add items with update_shopping_list.`;
  }

  return `Shopping list "${list.name}" (listId=${list.id}) has ${formatListSize(list.items)}.\n\n${listItemLines(list)}`;
}

function listSummaryLines(lists: ShoppingListSummary[]): string {
  return lists
    .map(
      (list, index) =>
        `${index + 1}. listId=${list.id} "${list.name}" (${list.itemCount} items)`,
    )
    .join("\n");
}

function shoppingListsViewResult(lists: ShoppingListSummary[], text: string) {
  return {
    content: [{ type: "text" as const, text }],
    ...appResult("shopping_lists", { lists }),
  };
}

/**
 * Exact case-insensitive name matches win; otherwise every list whose name
 * contains the query. Summaries arrive most recently updated first.
 */
export function matchListsByName(
  lists: ShoppingListSummary[],
  name: string,
): ShoppingListSummary[] {
  const query = name.trim().toLowerCase();
  const exact = lists.filter((list) => list.name.toLowerCase() === query);

  if (exact.length > 0) return exact;

  return lists.filter((list) => list.name.toLowerCase().includes(query));
}

/** Earlier edits in a batch already committed; say which before the error. */
function partialFailure(error: AppError, applied: string[]) {
  if (applied.length === 0) return toMcpError(error);

  return toMcpError({
    ...error,
    message: `${error.message} Already applied before the failure:\n${applied.join("\n")}`,
  });
}

export function registerShoppingListTools(
  server: McpServer,
  {
    weeklyDealsCache,
    pantry: pantryStore,
    preferredLocation,
    productService,
    shoppingList,
  }: ShoppingListToolDependencies,
): void {
  registerAppTool(
    server,
    "create_shopping_list",
    {
      title: "Create Shopping List",
      description:
        'Creates a NEW named shopping list; use get_shopping_list then update_shopping_list to append to an existing list. Returns `listId` for add_shopping_list_to_cart. Give exact Kroger items their `upc` from search_products, and use `productName` for free text. Example: {"name":"Tuesday dinner","items":[{"upc":"0001111041700","productName":"Milk","quantity":1}]}',
      _meta: { ui: { resourceUri: APP_VIEW_URI } },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: createShoppingListInputSchema,
    },
    async ({ name: listName, items }) => {
      getProps();

      const enriched = await toStoredItems(productService, items);

      if (enriched.isErr()) return toMcpError(enriched.error);
      const enrichedItems = enriched.value;

      // Best-effort pantry/deal flags (see item-flags.ts): a storage/cache
      // miss or error yields no flag, never a failed tool call. Location is
      // resolved best-effort too — no preferred store just means no deal
      // flags, not an error for this tool.
      const [pantryItems, resolvedLocation] = await Promise.all([
        getPantryForFlags(pantryStore),
        safeResolveLocationId(preferredLocation, undefined),
      ]);

      const locationId = resolvedLocation.isOk()
        ? resolvedLocation.value.locationId
        : undefined;

      const deals = await getDealsForFlags(weeklyDealsCache, locationId);

      const lines = enrichedItems
        .map((item, index) => {
          const flags = itemFlagLabels(item.productName, pantryItems, deals);
          const base = formatShoppingListItemCompact(item);

          const suffixed =
            flags.length > 0 ? `${base} | ${flags.join(" | ")}` : base;

          return `${index + 1}. ${suffixed}`;
        })
        .join("\n");

      const result = await createShoppingListRecord(
        shoppingList,
        listName,
        enrichedItems,
      );

      if (result.isErr()) return toMcpError(result.error);
      const { listId, list } = result.value;

      return {
        content: [
          {
            type: "text" as const,
            text: `Created shopping list "${listName}" with ${formatListSize(enrichedItems)}. listId=${listId}\n\n${lines}`,
          },
        ],
        ...appResult("create_shopping_list", {
          listId,
          name: list.name,
          items: list.items,
        }),
      };
    },
  );

  registerAppTool(
    server,
    "get_shopping_list",
    {
      title: "Get Shopping List",
      description:
        "With listId or name, reads that list's items and `itemId`s. With neither, lists every saved list and its `listId`.",
      _meta: { ui: { resourceUri: APP_VIEW_URI } },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: getShoppingListInputSchema,
    },
    async ({ listId, name }) => {
      let resolvedId = listId;

      if (!resolvedId) {
        const result = await safeStorage(
          () => shoppingList.list(),
          "read shopping lists",
        );

        if (result.isErr()) return toMcpError(result.error);

        const lists = result.value;

        if (!name) {
          if (lists.length === 0) {
            return shoppingListsViewResult(
              [],
              "No saved lists yet. Create one with create_shopping_list.",
            );
          }

          return shoppingListsViewResult(
            lists,
            `${lists.length} shopping list(s).\n\n${listSummaryLines(lists)}`,
          );
        }

        const matches = matchListsByName(lists, name);

        if (matches.length === 0) {
          return toMcpError(
            notFoundError(
              `No list named "${name}". Call get_shopping_list with no arguments to see every list.`,
            ),
          );
        }

        const exact = matches[0].name.toLowerCase() === name.toLowerCase();

        if (matches.length > 1 && !exact) {
          return shoppingListsViewResult(
            matches,
            `${matches.length} lists match "${name}". Pass the listId you want.\n\n${listSummaryLines(matches)}`,
          );
        }

        resolvedId = matches[0].id;
      }

      const listIdToRead = resolvedId;

      const result = await safeStorage(
        () => shoppingList.get(listIdToRead),
        "read shopping list",
      );

      if (result.isErr()) return toMcpError(result.error);

      const list = result.value;

      if (!list) {
        return toMcpError(
          notFoundError(
            `No list with listId=${listIdToRead}. Call get_shopping_list with no listId.`,
          ),
        );
      }

      return shoppingListViewResult(list, describeList(list));
    },
  );

  registerAppTool(
    server,
    "update_shopping_list",
    {
      title: "Update Shopping List",
      description:
        "Edits a saved list in one call: add items, change existing items (quantity, productName, notes, checked:true to check off), and remove items. itemIds come from get_shopping_list.",
      _meta: { ui: { resourceUri: APP_VIEW_URI } },
      annotations: {
        readOnlyHint: false,
        // `remove` deletes items.
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: updateShoppingListInputSchema,
    },
    async ({ listId, add, change: requestedChanges, remove: requested }) => {
      const summary: string[] = [];

      // quantity 0 means "take it off the list".
      const change = (requestedChanges ?? []).filter(
        (entry) => entry.quantity !== 0,
      );

      const removeRefs = [
        ...(requested ?? []),
        ...(requestedChanges ?? [])
          .filter((entry) => entry.quantity === 0)
          .map((entry) => entry.itemId),
      ];

      const resolved = await resolveItemIds(listId, removeRefs);

      if (resolved.isErr()) return toMcpError(resolved.error);

      for (const itemId of resolved.value) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- edits apply in order so a failure reports what already changed
        const removed = await safeStorage(
          () => shoppingList.removeItem(listId, itemId),
          "remove shopping list item",
        );

        if (removed.isErr()) return partialFailure(removed.error, summary);
        summary.push(`Removed itemId=${itemId}.`);
      }

      for (const { itemId, ...fields } of change) {
        const patch = Object.fromEntries(
          Object.entries(fields).filter(([, value]) => value !== undefined),
        );

        if (Object.keys(patch).length === 0) {
          return partialFailure(
            validationError(
              `change for itemId=${itemId} needs productName, quantity, notes, or checked.`,
            ),
            summary,
          );
        }

        // oxlint-disable-next-line eslint/no-await-in-loop -- edits apply in order so a failure reports what already changed
        const updated = await safeStorage(
          () => shoppingList.updateItem(listId, itemId, patch),
          "update shopping list item",
        );

        if (updated.isErr()) return partialFailure(updated.error, summary);
        const item = updated.value;
        summary.push(
          `Updated itemId=${itemId}: ${formatShoppingListItemCompact(item)}${item.checked ? " | checked off" : ""}`,
        );
      }

      if (add) {
        const storedItems = await toStoredItems(productService, add);

        if (storedItems.isErr())
          return partialFailure(storedItems.error, summary);

        const added = await safeStorage(
          () => shoppingList.addItems(listId, storedItems.value),
          "add shopping list items",
        );

        if (added.isErr()) return partialFailure(added.error, summary);
        summary.push(
          ...added.value.map(
            (item) =>
              `Added itemId=${item.id} ${formatShoppingListItemCompact(item)}`,
          ),
        );
      }

      return withUpdatedList(
        listId,
        `Updated listId=${listId}:\n${summary.join("\n")}`,
      );
    },
  );

  /**
   * Maps remove references to itemIds. Models sometimes pass an item's name
   * instead of its id; an exact (case-insensitive) name match is accepted.
   */
  function resolveItemIds(
    listId: string,
    refs: string[],
  ): ResultAsync<string[], AppError> {
    if (refs.length === 0) return okAsync([]);

    return safeStorage(
      () => shoppingList.get(listId),
      "read shopping list",
    ).andThen((list) => {
      if (!list) {
        return errAsync(
          notFoundError(
            `No list with listId=${listId}. Call get_shopping_list with no listId.`,
          ),
        );
      }

      const ids: string[] = [];

      for (const ref of refs) {
        const key = ref.trim().toLowerCase();

        const item =
          list.items.find((candidate) => candidate.id === ref) ??
          list.items.find(
            (candidate) => candidate.productName.toLowerCase() === key,
          );

        if (!item) {
          return errAsync(
            notFoundError(
              `No item "${ref}" on listId=${listId}. Nothing was changed. Items: ${list.items
                .map(
                  (candidate) =>
                    `itemId=${candidate.id} ${candidate.productName}`,
                )
                .join("; ")}`,
            ),
          );
        }

        ids.push(item.id);
      }

      return okAsync(ids);
    });
  }

  /**
   * Re-reads the list after a successful edit so the app can show it. The
   * edit already committed, so a failed read only drops the view.
   */
  async function withUpdatedList(listId: string, text: string) {
    const listResult = await safeStorage(
      () => shoppingList.get(listId),
      "read updated shopping list",
    );

    const list = listResult.isOk() ? listResult.value : null;

    if (!list) return textResult(text);

    return shoppingListViewResult(
      list,
      `${text}\n\nList now has ${formatListSize(list.items)}.`,
    );
  }
}
