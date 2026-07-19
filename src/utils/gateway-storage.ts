import * as z from "zod/v4";

import type { GatewayClient } from "../services/gateway/client.js";
import type {
  EquipmentItem,
  OrderRecord,
  PantryItem,
  PreferredLocation,
  ShoppingList,
  ShoppingListItem,
} from "./user-storage.js";

const unixSecondsSchema = z.number().int();
const unixMillisecondsSchema = z.number().int();
const nullableStringSchema = z.string().nullable().optional();
const nullableNumberSchema = z.number().nullable().optional();

const pantryItemSchema = z.object({
  name: z.string(),
  quantity: z.number(),
  added_at: unixSecondsSchema,
  expires_at: unixSecondsSchema.nullable().optional(),
});

const equipmentItemSchema = z.object({
  name: z.string(),
  category: nullableStringSchema,
  added_at: unixSecondsSchema,
});

const orderItemSchema = z.object({
  upc: z.string(),
  name: z.string(),
  quantity: z.number().int(),
  price: nullableNumberSchema,
});

const orderSchema = z.object({
  id: z.string(),
  items: z.array(orderItemSchema),
  total_items: z.number().int(),
  estimated_total: nullableNumberSchema,
  placed_at: unixSecondsSchema,
  location_id: nullableStringSchema,
  notes: nullableStringSchema,
});

const preferredStoreSchema = z.object({
  location_id: z.string(),
  name: z.string(),
  address: z.string(),
  chain: z.string(),
  set_at: unixSecondsSchema,
});

const listItemSchema = z.object({
  id: z.string(),
  list_id: z.string(),
  name: z.string(),
  quantity: z.string(),
  note: z.string().nullable(),
  upc: nullableStringSchema,
  position: z.number().int(),
  added_by: z.string(),
  checked_by: z.string().nullable(),
  checked_at: unixMillisecondsSchema.nullable(),
  updated_at: unixMillisecondsSchema,
});

const listSchema = z.object({
  id: z.string(),
  household_id: z.string().nullable(),
  owner_user_id: z.string(),
  title: z.string(),
  status: z.string(),
  artifact_version: z.number().int().optional(),
  created_at: unixMillisecondsSchema,
  updated_at: unixMillisecondsSchema,
  items: z.array(listItemSchema),
});

const pantryResponseSchema = z.object({ items: z.array(pantryItemSchema) });
const equipmentResponseSchema = z.object({ items: z.array(equipmentItemSchema) });
const ordersResponseSchema = z.object({ orders: z.array(orderSchema) });

type GatewayCall = Promise<{ data?: unknown; error?: unknown; response: Response }>;

class GatewayRequestError extends Error {
  readonly cause: unknown;

  constructor(message: string, cause: unknown) {
    super(message);
    this.cause = cause;
    this.name = "GatewayRequestError";
  }
}

function gatewayFailure(response: Response, error: unknown): Error {
  const detail = z.object({ error: z.string() }).safeParse(error).data?.error;
  return new GatewayRequestError(
    `Gateway request failed (${response.status})${detail ? `: ${detail}` : ""}`,
    error,
  );
}

async function readGateway<TSchema extends z.ZodType>(
  call: GatewayCall,
  schema: TSchema,
): Promise<z.output<TSchema>> {
  const result = await call;
  if (!result.response.ok || result.error !== undefined) {
    throw gatewayFailure(result.response, result.error);
  }
  return schema.parse(result.data);
}

async function readOptionalGateway<TSchema extends z.ZodType>(
  call: GatewayCall,
  schema: TSchema,
): Promise<z.output<TSchema> | null> {
  const result = await call;
  if (result.response.status === 404) return null;
  if (!result.response.ok || result.error !== undefined) {
    throw gatewayFailure(result.response, result.error);
  }
  return schema.parse(result.data);
}

async function expectGatewaySuccess(call: GatewayCall): Promise<void> {
  const result = await call;
  if (!result.response.ok || result.error !== undefined) {
    throw gatewayFailure(result.response, result.error);
  }
}

function fromUnixSeconds(value: number): string {
  return new Date(value * 1000).toISOString();
}

function fromUnixMilliseconds(value: number): string {
  return new Date(value).toISOString();
}

function toUnixSeconds(value: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw new Error(`Invalid ISO timestamp: ${value}`);
  }
  return Math.floor(milliseconds / 1000);
}

function adaptPantryItem(item: z.output<typeof pantryItemSchema>): PantryItem {
  return {
    productName: item.name,
    quantity: item.quantity,
    addedAt: fromUnixSeconds(item.added_at),
    ...(item.expires_at == null ? {} : { expiresAt: fromUnixSeconds(item.expires_at) }),
  };
}

function adaptEquipmentItem(item: z.output<typeof equipmentItemSchema>): EquipmentItem {
  return {
    equipmentName: item.name,
    ...(item.category == null ? {} : { category: item.category }),
    addedAt: fromUnixSeconds(item.added_at),
  };
}

function adaptOrder(order: z.output<typeof orderSchema>): OrderRecord {
  return {
    orderId: order.id,
    items: order.items.map((item) => ({
      upc: item.upc,
      productName: item.name,
      quantity: item.quantity,
      ...(item.price == null ? {} : { price: item.price }),
    })),
    totalItems: order.total_items,
    ...(order.estimated_total == null ? {} : { estimatedTotal: order.estimated_total }),
    placedAt: fromUnixSeconds(order.placed_at),
    ...(order.location_id == null ? {} : { locationId: order.location_id }),
    ...(order.notes == null ? {} : { notes: order.notes }),
  };
}

function adaptPreferredStore(store: z.output<typeof preferredStoreSchema>): PreferredLocation {
  return {
    locationId: store.location_id,
    locationName: store.name,
    address: store.address,
    chain: store.chain,
    setAt: fromUnixSeconds(store.set_at),
  };
}

function adaptShoppingList(list: z.output<typeof listSchema>): ShoppingList {
  return {
    id: list.id,
    name: list.title,
    items: list.items.map((item) => ({
      productName: item.name,
      ...(item.upc == null ? {} : { upc: item.upc }),
      quantity: Number.parseFloat(item.quantity) || 1,
      ...(item.note == null ? {} : { notes: item.note }),
    })),
    createdAt: fromUnixMilliseconds(list.created_at),
  };
}

export interface ShoppingStore {
  preferredLocation: {
    get(): Promise<PreferredLocation | null>;
    set(location: PreferredLocation): Promise<void>;
    delete(): Promise<void>;
  };
  pantry: {
    getAll(): Promise<PantryItem[]>;
    add(items: PantryItem | PantryItem[]): Promise<PantryItem[]>;
    remove(names: string | string[]): Promise<PantryItem[]>;
    updateQuantity(productName: string, quantity: number): Promise<PantryItem[]>;
    clear(): Promise<void>;
  };
  equipment: {
    getAll(): Promise<EquipmentItem[]>;
    add(items: EquipmentItem | EquipmentItem[]): Promise<EquipmentItem[]>;
    remove(names: string | string[]): Promise<EquipmentItem[]>;
    clear(): Promise<void>;
  };
  shoppingList: {
    create(listId: string, name: string, items: ShoppingListItem[]): Promise<ShoppingList>;
    get(listId: string): Promise<ShoppingList | null>;
    clear(listId: string): Promise<void>;
  };
  orderHistory: {
    getAll(): Promise<OrderRecord[]>;
    add(order: OrderRecord): Promise<OrderRecord[]>;
    getRecent(limit?: number): Promise<OrderRecord[]>;
    clear(): Promise<void>;
  };
}

/** Adapts the gateway wire contract to the existing MCP tool storage contract. */
export function createGatewayShoppingStore(client: GatewayClient): ShoppingStore {
  const getOrders = async (limit?: number): Promise<OrderRecord[]> => {
    const data = await readGateway(
      client.GET("/api/grocery/orders", {
        params: { query: limit === undefined ? {} : { limit } },
      }),
      ordersResponseSchema,
    );
    return data.orders.map(adaptOrder);
  };

  return {
    preferredLocation: {
      get: async () => {
        const data = await readOptionalGateway(
          client.GET("/api/grocery/preferred-store"),
          preferredStoreSchema,
        );
        return data == null ? null : adaptPreferredStore(data);
      },
      set: async (location) => {
        await readGateway(
          client.PUT("/api/grocery/preferred-store", {
            body: {
              location_id: location.locationId,
              name: location.locationName,
              address: location.address,
              chain: location.chain,
              set_at: toUnixSeconds(location.setAt),
            },
          }),
          preferredStoreSchema,
        );
      },
      delete: async () => {
        await expectGatewaySuccess(client.DELETE("/api/grocery/preferred-store"));
      },
    },
    pantry: {
      getAll: async () => {
        const data = await readGateway(client.GET("/api/grocery/pantry"), pantryResponseSchema);
        return data.items.map(adaptPantryItem);
      },
      add: async (items) => {
        const data = await readGateway(
          client.POST("/api/grocery/pantry", {
            body: {
              items: (Array.isArray(items) ? items : [items]).map((item) => ({
                name: item.productName,
                quantity: item.quantity,
                ...(item.expiresAt === undefined
                  ? {}
                  : { expires_at: toUnixSeconds(item.expiresAt) }),
              })),
            },
          }),
          pantryResponseSchema,
        );
        return data.items.map(adaptPantryItem);
      },
      remove: async (names) => {
        const data = await readGateway(
          client.POST("/api/grocery/pantry/remove", {
            body: { names: Array.isArray(names) ? names : [names] },
          }),
          pantryResponseSchema,
        );
        return data.items.map(adaptPantryItem);
      },
      updateQuantity: async (productName, quantity) => {
        const data = await readGateway(
          client.POST("/api/grocery/pantry/quantity", {
            body: { name: productName, quantity },
          }),
          pantryResponseSchema,
        );
        return data.items.map(adaptPantryItem);
      },
      clear: async () => {
        await readGateway(
          client.POST("/api/grocery/pantry/remove", { body: { all: true } }),
          pantryResponseSchema,
        );
      },
    },
    equipment: {
      getAll: async () => {
        const data = await readGateway(
          client.GET("/api/grocery/equipment"),
          equipmentResponseSchema,
        );
        return data.items.map(adaptEquipmentItem);
      },
      add: async (items) => {
        const data = await readGateway(
          client.POST("/api/grocery/equipment", {
            body: {
              items: (Array.isArray(items) ? items : [items]).map((item) => ({
                name: item.equipmentName,
                ...(item.category === undefined ? {} : { category: item.category }),
              })),
            },
          }),
          equipmentResponseSchema,
        );
        return data.items.map(adaptEquipmentItem);
      },
      remove: async (names) => {
        const data = await readGateway(
          client.POST("/api/grocery/equipment/remove", {
            body: { names: Array.isArray(names) ? names : [names] },
          }),
          equipmentResponseSchema,
        );
        return data.items.map(adaptEquipmentItem);
      },
      clear: async () => {
        await readGateway(
          client.POST("/api/grocery/equipment/remove", { body: { all: true } }),
          equipmentResponseSchema,
        );
      },
    },
    shoppingList: {
      create: async (_listId, name, items) => {
        const data = await readGateway(
          client.POST("/api/grocery/lists", {
            body: {
              title: name,
              items: items.map((item) => ({
                name: item.productName,
                quantity: String(item.quantity),
                note: item.notes ?? null,
                ...(item.upc === undefined ? {} : { upc: item.upc }),
              })),
            },
          }),
          listSchema,
        );
        return adaptShoppingList(data);
      },
      get: async (listId) => {
        const data = await readOptionalGateway(
          client.GET("/api/grocery/lists/{id}", { params: { path: { id: listId } } }),
          listSchema,
        );
        return data == null ? null : adaptShoppingList(data);
      },
      // Gateway lists are durable records; cart checkout does not delete them.
      clear: async () => {},
    },
    orderHistory: {
      getAll: () => getOrders(50),
      add: async (order) => {
        // Preserve the old add() return value without doing a fallible read
        // after the mutation has already succeeded.
        const history = await getOrders(50);
        const recorded = await readGateway(
          client.POST("/api/grocery/orders", {
            body: {
              id: order.orderId,
              items: order.items.map((item) => ({
                upc: item.upc,
                name: item.productName,
                quantity: item.quantity,
                ...(item.price === undefined ? {} : { price: item.price }),
              })),
              total_items: order.totalItems,
              ...(order.estimatedTotal === undefined
                ? {}
                : { estimated_total: order.estimatedTotal }),
              placed_at: toUnixSeconds(order.placedAt),
              ...(order.locationId === undefined ? {} : { location_id: order.locationId }),
              ...(order.notes === undefined ? {} : { notes: order.notes }),
            },
          }),
          orderSchema,
        );
        const adapted = adaptOrder(recorded);
        return [adapted, ...history.filter((item) => item.orderId !== adapted.orderId)].slice(
          0,
          50,
        );
      },
      getRecent: (limit = 10) => getOrders(limit),
      clear: async () => {
        throw new Error("Gateway does not support clearing order history");
      },
    },
  };
}
