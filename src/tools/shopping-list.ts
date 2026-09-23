import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/server";
import type { ResultAsync } from "neverthrow";
import * as z from "zod/v4";

import type { AppError } from "../errors.js";
import type { ShoppingList, ShoppingListItem } from "../domain/shopping.js";

import { appResult } from "../app-results.js";
import { notFoundError, validationError } from "../errors.js";
import type { ProductService } from "../services/kroger/product-service.js";
import type { WeeklyDealsCache } from "../services/weekly-deals/cache.js";
import { formatShoppingListItemCompact } from "../utils/format-response.js";
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
    quantity: z.coerce.number().min(1).max(999).default(1),
    notes: z.string().max(500).optional(),
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
    .min(1, { message: "Shopping list must include at least one item" }),
});

export const addShoppingListItemsInputSchema = z.object({
  listId: listIdSchema,
  items: z
    .array(shoppingListItemInputSchema)
    .min(1, { message: "Provide at least one item to add" }),
});

export const editShoppingListItemInputSchema = z.object({
  listId: listIdSchema,
  itemId: itemIdSchema,
  productName: z.string().trim().min(1).max(200).optional(),
  quantity: z.coerce.number().min(1).max(999).optional(),
  notes: z.string().max(500).optional(),
  checked: z.boolean().optional(),
  remove: z.boolean().optional(),
});

export const getShoppingListInputSchema = z.object({
  listId: listIdSchema.optional(),
});

type ShoppingListItemInput = z.output<typeof shoppingListItemInputSchema>;

export type ShoppingListProductService = Pick<
  ProductService,
  "enrichProductName"
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
): Promise<ShoppingListItem[]> {
  return Promise.all(
    items.map(async (item) => {
      const productName =
        item.productName ??
        (item.upc
          ? ((await productService.enrichProductName(item.upc)) ?? item.upc)
          : "");
      return {
        productName,
        ...(item.upc === undefined ? {} : { upc: item.upc }),
        quantity: item.quantity,
        ...(item.notes === undefined ? {} : { notes: item.notes }),
      } satisfies ShoppingListItem;
    }),
  );
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
        'Creates a named shopping list; returns `listId` for add_shopping_list_to_cart. Give exact Kroger items their `upc` from search_products, and use `productName` for free text. Example: {"name":"Tuesday dinner","items":[{"upc":"0001111041700","productName":"Milk","quantity":1}]}',
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

      const enrichedItems = await toStoredItems(productService, items);

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
            text: `Created shopping list "${listName}" with ${enrichedItems.length} item(s). listId=${listId}\n\n${lines}`,
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

  server.registerTool(
    "get_shopping_list",
    {
      title: "Get Shopping List",
      description:
        "With a listId, reads that list's items and their `itemId`s. Without one, lists every saved list and its `listId`. Only this tool returns those ids.",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: getShoppingListInputSchema,
    },
    async ({ listId }) => {
      if (!listId) {
        const result = await safeStorage(
          () => shoppingList.list(),
          "read shopping lists",
        );
        if (result.isErr()) return toMcpError(result.error);

        const lists = result.value;
        if (lists.length === 0) {
          return textResult(
            "No saved lists yet. Create one with create_shopping_list.",
          );
        }
        const lines = lists
          .map(
            (list, index) =>
              `${index + 1}. listId=${list.id} "${list.name}" (${list.itemCount} items)`,
          )
          .join("\n");
        return textResult(`${lists.length} shopping list(s).\n\n${lines}`);
      }

      const result = await safeStorage(
        () => shoppingList.get(listId),
        "read shopping list",
      );
      if (result.isErr()) return toMcpError(result.error);

      const list = result.value;
      if (!list) {
        return toMcpError(
          notFoundError(
            `No list with listId=${listId}. Call get_shopping_list with no listId.`,
          ),
        );
      }
      if (list.items.length === 0) {
        return textResult(
          `Shopping list "${list.name}" (listId=${listId}) is empty. Add items with add_shopping_list_items.`,
        );
      }
      const lines = list.items
        .map(
          (item, index) =>
            `${index + 1}. itemId=${item.id} ${formatShoppingListItemCompact(item)}${item.checked ? " | checked off" : ""}`,
        )
        .join("\n");
      return textResult(
        `Shopping list "${list.name}" (listId=${listId}) has ${list.items.length} item(s).\n\n${lines}`,
      );
    },
  );

  server.registerTool(
    "add_shopping_list_items",
    {
      title: "Add Shopping List Items",
      description:
        "Appends items to an existing list, keeping what is already on it. Use upc for exact Kroger matches, or productName for free text.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: addShoppingListItemsInputSchema,
    },
    async ({ listId, items }) => {
      const storedItems = await toStoredItems(productService, items);
      const result = await safeStorage(
        () => shoppingList.addItems(listId, storedItems),
        "add shopping list items",
      );
      if (result.isErr()) return toMcpError(result.error);

      const added = result.value;
      const lines = added
        .map(
          (item, index) =>
            `${index + 1}. itemId=${item.id} ${formatShoppingListItemCompact(item)}`,
        )
        .join("\n");
      return textResult(
        `Added ${added.length} item(s) to listId=${listId}.\n\n${lines}`,
      );
    },
  );

  server.registerTool(
    "edit_shopping_list_item",
    {
      title: "Edit Shopping List Item",
      description:
        "Changes one item on a list: rename it, set quantity or notes, check it off with checked=true, or delete it with remove=true. Only the fields you pass change.",
      annotations: {
        readOnlyHint: false,
        // remove=true deletes the item, so this tool can destroy data.
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: editShoppingListItemInputSchema,
    },
    async ({
      listId,
      itemId,
      productName,
      quantity,
      notes,
      checked,
      remove,
    }) => {
      if (remove) {
        const removed = await safeStorage(
          () => shoppingList.removeItem(listId, itemId),
          "remove shopping list item",
        );
        if (removed.isErr()) return toMcpError(removed.error);
        return textResult(`Removed itemId=${itemId} from listId=${listId}.`);
      }

      const patch = {
        ...(productName === undefined ? {} : { productName }),
        ...(quantity === undefined ? {} : { quantity }),
        ...(notes === undefined ? {} : { notes }),
        ...(checked === undefined ? {} : { checked }),
      };
      if (Object.keys(patch).length === 0) {
        return toMcpError(
          validationError(
            "Pass productName, quantity, notes, checked, or remove=true.",
          ),
        );
      }

      const result = await safeStorage(
        () => shoppingList.updateItem(listId, itemId, patch),
        "update shopping list item",
      );
      if (result.isErr()) return toMcpError(result.error);

      const item = result.value;
      return textResult(
        `Updated itemId=${itemId} on listId=${listId}: ${formatShoppingListItemCompact(item)}${item.checked ? " | checked off" : ""}`,
      );
    },
  );
}
