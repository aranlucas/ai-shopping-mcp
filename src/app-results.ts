import type { CallToolResult } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import {
  normalizeProductIdentity,
  productReferenceSchema,
} from "./domain/product-identity.js";

const APP_VIEW_META_KEY = "dev.aranlucas/view";
const dealSchema = z.object({
  title: z.string(),
  details: z.string().optional(),
  price: z.string().optional(),
  savings: z.string().nullable().optional(),
  validFrom: z.string().optional(),
  validTill: z.string().optional(),
  category: z.string(),
});
const locationSchema = z.object({
  provider: z.string().optional(),
  locationId: z.string().optional(),
  name: z.string().optional(),
  chain: z.string().optional(),
  address: z
    .object({
      addressLine1: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      zipCode: z.string().optional(),
    })
    .optional(),
  phone: z.string().optional(),
  departments: z
    .array(
      z.object({ name: z.string().optional(), phone: z.string().optional() }),
    )
    .optional(),
});
const productSchema = z.object({
  product: productReferenceSchema,
  name: z.string(),
  brand: z.string().optional(),
  category: z.string().optional(),
  size: z.string().optional(),
  price: z.number().optional(),
  regularPrice: z.number().optional(),
  imageUrl: z.string().optional(),
  url: z.string().optional(),
  available: z.boolean(),
  pickup: z.boolean().optional(),
  aisle: z
    .object({
      bayNumber: z.string().optional(),
      description: z.string().optional(),
      number: z.string().optional(),
      sequenceNumber: z.string().optional(),
      side: z.string().optional(),
      shelfNumber: z.string().optional(),
      shelfPositionInBay: z.string().optional(),
    })
    .optional(),
});
const pantryItemSchema = z.object({
  productName: z.string(),
  quantity: z.number(),
  addedAt: z.string().optional(),
  expiresAt: z.string().optional(),
});
const equipmentItemSchema = z.object({
  equipmentName: z.string(),
  category: z.string().optional(),
  addedAt: z.string().optional(),
});
const shoppingListItemSchema = z
  .object({
    productName: z.string(),
    product: productReferenceSchema.optional(),
    upc: z.string().optional(),
    quantity: z.number(),
    notes: z.string().optional(),
    id: z.string().optional(),
    checked: z.boolean().optional(),
  })
  .transform(({ upc, product, ...item }) => {
    const reference = normalizeProductIdentity({ product, upc });
    return { ...item, ...(reference ? { product: reference } : {}) };
  });
const orderItemSchema = z
  .object({
    product: productReferenceSchema.optional(),
    upc: z.string().optional(),
    productName: z.string(),
    quantity: z.number(),
    price: z.number().optional(),
  })
  .transform(({ upc, product, ...item }) => {
    const reference = normalizeProductIdentity({ product, upc });
    return { ...item, ...(reference ? { product: reference } : {}) };
  });
const cartResultSchema = z
  .object({
    outcome: z.enum(["added", "already_added", "needs_match"]),
    addedCount: z.number().int().nonnegative(),
    requestedCount: z.number().int().nonnegative(),
    listId: z.string().optional(),
    name: z.string(),
    items: z.array(
      z.object({
        upc: z.string(),
        quantity: z.number(),
        modality: z.enum(["PICKUP", "DELIVERY"]),
        productName: z.string().optional(),
      }),
    ),
    needsUpc: z.array(
      z.object({ productName: z.string(), quantity: z.number() }),
    ),
    actionDetail: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.addedCount !== value.items.length) {
      ctx.addIssue({
        code: "custom",
        path: ["addedCount"],
        message: "addedCount must equal the number of returned cart items",
      });
    }
    if (value.addedCount > value.requestedCount) {
      ctx.addIssue({
        code: "custom",
        path: ["requestedCount"],
        message: "requestedCount cannot be less than addedCount",
      });
    }
    if (value.outcome === "needs_match" && value.addedCount !== 0) {
      ctx.addIssue({
        code: "custom",
        path: ["outcome"],
        message: "needs_match cannot report added cart items",
      });
    }
    if (
      (value.outcome === "added" || value.outcome === "already_added") &&
      value.addedCount === 0
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["outcome"],
        message: `${value.outcome} must report at least one cart item`,
      });
    }
  });

/** Shared wire contracts; view types are inferred so validation cannot drift. */
export const appPayloadSchemas = {
  get_weekly_deals: z.object({
    deals: z.array(dealSchema),
    validFrom: z.string().optional(),
    validTill: z.string().optional(),
    cache: z.object({ state: z.enum(["miss", "fresh", "stale"]) }).optional(),
    warnings: z.array(z.string()).optional(),
    storeId: z.string().optional(),
  }),
  search_stores: z.object({ stores: z.array(locationSchema) }),
  get_store: z.object({ store: locationSchema }),
  set_preferred_store: z.object({
    store: z.object({
      provider: z.string(),
      locationId: z.string(),
      locationName: z.string(),
      address: z.string(),
      chain: z.string(),
      setAt: z.string(),
    }),
    actionDetail: z.string(),
  }),
  search_products: z.object({
    results: z.array(
      z.object({
        provider: z.string(),
        term: z.string(),
        products: z.array(productSchema),
        count: z.number().optional(),
        failed: z.boolean(),
      }),
    ),
    totalProducts: z.number(),
  }),
  get_product: z.object({ product: productSchema }),
  pantry: z.object({
    items: z.array(pantryItemSchema),
    actionDetail: z.string().optional(),
  }),
  kitchen_equipment: z.object({
    items: z.array(equipmentItemSchema),
    actionDetail: z.string().optional(),
  }),
  create_shopping_list: z.object({
    listId: z.string(),
    name: z.string(),
    items: z.array(shoppingListItemSchema),
    actionDetail: z.string().optional(),
  }),
  add_shopping_list_to_cart: cartResultSchema,
  record_order: z.object({
    orderId: z.string(),
    items: z.array(orderItemSchema),
    totalItems: z.number(),
    estimatedTotal: z.number().optional(),
    placedAt: z.string(),
    locationId: z.string().optional(),
    notes: z.string().optional(),
  }),
};
export type DealData = z.infer<typeof dealSchema>;
export type LocationData = z.infer<typeof locationSchema>;
export type ProductData = z.infer<typeof productSchema>;
export type PantryItemData = z.infer<typeof pantryItemSchema>;
export type KitchenEquipmentItemData = z.infer<typeof equipmentItemSchema>;
export type ShoppingListItemData = z.infer<typeof shoppingListItemSchema>;
type AppResultPayloads = {
  [View in keyof typeof appPayloadSchemas]: z.infer<
    (typeof appPayloadSchemas)[View]
  >;
};

export type AppViewName = keyof AppResultPayloads;

export type AppData = {
  [View in AppViewName]: { view: View } & AppResultPayloads[View];
}[AppViewName];

export type WeeklyDealsContent = Extract<AppData, { view: "get_weekly_deals" }>;
export type StoreResultsContent = Extract<AppData, { view: "search_stores" }>;
export type StoreDetailContent = Extract<AppData, { view: "get_store" }>;
export type PreferredStoreContent = Extract<
  AppData,
  { view: "set_preferred_store" }
>;
export type ProductSearchResultsContent = Extract<
  AppData,
  { view: "search_products" }
>;
export type ProductDetailContent = Extract<AppData, { view: "get_product" }>;
export type PantryListContent = Extract<AppData, { view: "pantry" }>;
export type KitchenEquipmentContent = Extract<
  AppData,
  { view: "kitchen_equipment" }
>;
export type ShoppingListContent = Extract<
  AppData,
  { view: "create_shopping_list" }
>;
export type AddShoppingListToCartContent = Extract<
  AppData,
  { view: "add_shopping_list_to_cart" }
>;
export type OrderHistoryContent = Extract<AppData, { view: "record_order" }>;

export const APP_VIEW_NAMES: Record<AppViewName, true> = {
  get_weekly_deals: true,
  search_stores: true,
  get_store: true,
  set_preferred_store: true,
  search_products: true,
  get_product: true,
  pantry: true,
  kitchen_equipment: true,
  create_shopping_list: true,
  add_shopping_list_to_cart: true,
  record_order: true,
};

const APP_VIEW_NAME_SET = new Set(Object.keys(APP_VIEW_NAMES));

/** Attach a typed MCP Apps payload and its routing metadata to a tool result. */
export function appResult<View extends AppViewName>(
  view: View,
  structuredContent: AppResultPayloads[View],
) {
  return {
    _meta: { [APP_VIEW_META_KEY]: view },
    structuredContent,
  };
}

/** Convert a wire result into the app's internal discriminated view data. */
export function parseAppResult(
  result: CallToolResult | null | undefined,
): AppData | null {
  const structuredContent = result?.structuredContent;
  const view = result?._meta?.[APP_VIEW_META_KEY];
  if (
    !structuredContent ||
    typeof view !== "string" ||
    !APP_VIEW_NAME_SET.has(view as AppViewName)
  ) {
    return null;
  }

  const parsed =
    appPayloadSchemas[view as AppViewName].safeParse(structuredContent);
  if (!parsed.success) return null;
  // The validated schema is selected by the same view discriminator.
  return { ...parsed.data, view } as AppData;
}
