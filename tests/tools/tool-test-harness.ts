import { vi } from "vitest";

import type { ToolContext, UserStorage } from "../../src/tools/types.js";
import type {
  CartSnapshotItem,
  EquipmentItem,
  OrderRecord,
  PantryItem,
  PreferredLocation,
  ShoppingListItem,
} from "../../src/utils/user-storage.js";

type ShoppingListRecord = {
  id: string;
  name: string;
  items: ShoppingListItem[];
  createdAt: string;
};

type AuthContext = {
  props?: {
    id: string;
    accessToken: string;
    tokenExpiresAt: number;
  };
};

export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

export type CapturedTool = {
  name: string;
  config: unknown;
  handler: ToolHandler;
};

export type ElicitResult = {
  action: "accept" | "decline" | "cancel";
  content?: { confirm?: boolean };
};

const testState = vi.hoisted(() => ({
  authContext: undefined as AuthContext | undefined,
  capturedTools: [] as CapturedTool[],
}));

vi.mock("agents/mcp", () => ({
  getMcpAuthContext: () => testState.authContext,
}));

vi.mock("@modelcontextprotocol/ext-apps/server", () => ({
  registerAppTool: (_server: unknown, name: string, config: unknown, handler: ToolHandler) => {
    testState.capturedTools.push({ name, config, handler });
  },
}));

export function authenticate(userId = "user-123") {
  testState.authContext = {
    props: {
      id: userId,
      accessToken: "test-token",
      tokenExpiresAt: Date.now() + 60_000,
    },
  };
}

export function unauthenticate() {
  testState.authContext = undefined;
}

export function resetToolTestHarness() {
  testState.capturedTools.length = 0;
  authenticate();
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null;
}

export function textFromResult(result: unknown): string {
  if (!isRecord(result) || !Array.isArray(result.content)) return "";
  const first = result.content[0];
  if (!isRecord(first) || typeof first.text !== "string") return "";
  return first.text;
}

export function isErrorResult(result: unknown): boolean {
  return isRecord(result) && result.isError === true;
}

export function makeStorage(overrides: Partial<UserStorage> = {}): UserStorage {
  const pantryItems: PantryItem[] = [];
  const equipmentItems: EquipmentItem[] = [];
  const orders: OrderRecord[] = [];
  const preferredLocations: PreferredLocation[] = [];
  const createdLists: ShoppingListRecord[] = [];
  const snapshots = new Map<string, CartSnapshotItem[]>();

  const storage = {
    pantry: {
      add: async (_userId: string, item: PantryItem) => {
        pantryItems.push(item);
      },
      remove: async (_userId: string, productName: string) => {
        const index = pantryItems.findIndex((item) => item.productName === productName);
        if (index >= 0) {
          pantryItems.splice(index, 1);
        }
      },
      clear: async () => {
        pantryItems.length = 0;
      },
      getAll: async () => pantryItems,
    },
    equipment: {
      add: async (_userId: string, item: EquipmentItem) => {
        equipmentItems.push(item);
      },
      remove: async (_userId: string, equipmentName: string) => {
        const index = equipmentItems.findIndex((item) => item.equipmentName === equipmentName);
        if (index >= 0) {
          equipmentItems.splice(index, 1);
        }
      },
      clear: async () => {
        equipmentItems.length = 0;
      },
      getAll: async () => equipmentItems,
    },
    orderHistory: {
      add: async (_userId: string, order: OrderRecord) => {
        orders.push(order);
      },
      getAll: async () => orders,
      getRecent: async (_userId: string, limit = 10) => orders.slice(0, limit),
    },
    shoppingList: {
      create: async (id: string, name: string, items: ShoppingListItem[]) => {
        const record: ShoppingListRecord = {
          id,
          name,
          items,
          createdAt: new Date().toISOString(),
        };
        createdLists.push(record);
        return record;
      },
      get: async (id: string) => createdLists.find((list) => list.id === id) ?? null,
      clear: async (id: string) => {
        const index = createdLists.findIndex((list) => list.id === id);
        if (index >= 0) createdLists.splice(index, 1);
      },
    },
    cartSnapshot: {
      get: async (id: string) => snapshots.get(id) ?? null,
      set: async (id: string, items: CartSnapshotItem[]) => {
        snapshots.set(id, items);
      },
      clear: async (id: string) => {
        snapshots.delete(id);
      },
    },
    cartMirror: {
      getAll: async () => [],
      append: async (_userId: string, items: CartSnapshotItem[], addedAt: string) =>
        items.map((item) => ({ ...item, addedAt })),
      clear: async () => {},
    },
    preferredLocation: {
      set: async (_userId: string, location: PreferredLocation) => {
        preferredLocations.push(location);
      },
      get: async () => preferredLocations.at(-1) ?? null,
    },
  };

  return { ...storage, ...overrides } as unknown as UserStorage;
}

export function makeContext(storage = makeStorage()): ToolContext {
  return {
    server: {
      registerTool: (name: string, config: unknown, handler: ToolHandler) => {
        testState.capturedTools.push({ name, config, handler });
      },
      server: {
        elicitInput: async () => ({ action: "accept", content: { confirm: true } }),
      },
    } as unknown as ToolContext["server"],
    clients: {
      cartClient: {
        PUT: async () => ({
          data: undefined,
          response: new Response(null, { status: 204 }),
        }),
      },
    } as unknown as ToolContext["clients"],
    storage,
    getEnv: () => ({}) as Env,
    getSessionId: () => "session-1",
  };
}

export function makeContextWithElicit(
  storage: UserStorage,
  elicitResult: ElicitResult,
  cartStatus = 204,
): ToolContext {
  return {
    server: {
      registerTool: (name: string, config: unknown, handler: ToolHandler) => {
        testState.capturedTools.push({ name, config, handler });
      },
      server: {
        elicitInput: async () => elicitResult,
      },
    } as unknown as ToolContext["server"],
    clients: {
      cartClient: {
        PUT: async () => ({
          data: undefined,
          response: new Response(null, { status: cartStatus }),
        }),
      },
    } as unknown as ToolContext["clients"],
    storage,
    getEnv: () => ({}) as Env,
    getSessionId: () => "session-1",
  };
}

export function getCapturedHandler(name: string): ToolHandler {
  const tool = testState.capturedTools.find((captured) => captured.name === name);
  if (!tool) throw new Error(`Tool ${name} was not captured`);
  return tool.handler;
}

export function getCapturedTool(name: string): CapturedTool {
  const tool = testState.capturedTools.find((captured) => captured.name === name);
  if (!tool) throw new Error(`Tool ${name} was not captured`);
  return tool;
}
