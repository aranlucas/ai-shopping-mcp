import { afterEach, describe, expect, it, vi } from "vitest";

import { createGatewayClient } from "../src/services/gateway/client.js";
import { createGatewayShoppingStore } from "../src/utils/gateway-storage.js";

type CapturedRequest = { method: string; url: string; headers: Headers; body?: unknown };

function mockGateway(
  responder: (request: Request, body: unknown) => { status?: number; body?: unknown },
) {
  const requests: CapturedRequest[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const body = request.body ? await request.clone().json() : undefined;
      requests.push({
        method: request.method,
        url: request.url,
        headers: new Headers(request.headers),
        body,
      });
      const result = responder(request, body);
      return Response.json(result.body ?? {}, { status: result.status ?? 200 });
    }),
  );
  return requests;
}

function makeStore() {
  return createGatewayShoppingStore(
    createGatewayClient("https://gateway.example", "mcp-access-token"),
  );
}

describe("gateway shopping storage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("adds pantry items with the MCP bearer token and adapts unix timestamps", async () => {
    const requests = mockGateway(() => ({
      body: {
        items: [
          {
            name: "Eggs",
            quantity: 12,
            added_at: 1_784_333_400,
            expires_at: 1_784_938_200,
          },
        ],
      },
    }));

    const pantry = await makeStore().pantry.add({
      productName: "Eggs",
      quantity: 12,
      addedAt: "2026-07-18T00:00:00.000Z",
      expiresAt: "2026-07-25T00:00:00.000Z",
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: "POST",
      url: "https://gateway.example/api/grocery/pantry",
      body: { items: [{ name: "Eggs", quantity: 12, expires_at: 1_784_937_600 }] },
    });
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer mcp-access-token");
    expect(requests[0]?.headers.has("x-shopping-service-secret")).toBe(false);
    expect(requests[0]?.headers.has("x-shopping-user-id")).toBe(false);
    expect(pantry).toEqual([
      {
        productName: "Eggs",
        quantity: 12,
        addedAt: "2026-07-18T00:10:00.000Z",
        expiresAt: "2026-07-25T00:10:00.000Z",
      },
    ]);
  });

  it("creates a personal gateway list with UPCs and returns the gateway id", async () => {
    const requests = mockGateway(() => ({
      status: 201,
      body: {
        id: "gateway-list-123",
        household_id: null,
        owner_user_id: "user-1",
        title: "Tuesday dinner",
        status: "active",
        created_at: 1_784_332_800_000,
        updated_at: 1_784_332_800_000,
        items: [
          {
            id: "item-1",
            list_id: "gateway-list-123",
            name: "Milk",
            quantity: "2",
            note: "organic",
            upc: "0001111042578",
            position: 0,
            added_by: "user-1",
            checked_by: null,
            checked_at: null,
            updated_at: 1_784_332_800_000,
          },
        ],
      },
    }));

    const list = await makeStore().shoppingList.create("ignored-client-id", "Tuesday dinner", [
      {
        productName: "Milk",
        upc: "0001111042578",
        quantity: 2,
        notes: "organic",
      },
    ]);

    expect(requests[0]).toMatchObject({
      method: "POST",
      url: "https://gateway.example/api/grocery/lists",
      body: {
        title: "Tuesday dinner",
        items: [
          {
            name: "Milk",
            quantity: "2",
            note: "organic",
            upc: "0001111042578",
          },
        ],
      },
    });
    expect(requests[0]?.body as Record<string, unknown>).not.toHaveProperty("household_id");
    expect(list).toEqual({
      id: "gateway-list-123",
      name: "Tuesday dinner",
      items: [
        {
          productName: "Milk",
          upc: "0001111042578",
          quantity: 2,
          notes: "organic",
        },
      ],
      createdAt: "2026-07-18T00:00:00.000Z",
    });
  });

  it("records orders with gateway field names and returns validated history", async () => {
    const wireOrder = {
      id: "order-123",
      items: [{ upc: "0001111042578", name: "Milk", quantity: 2, price: 3.5 }],
      total_items: 2,
      estimated_total: 7,
      placed_at: 1_784_332_800,
      location_id: "70500847",
      notes: "Pickup",
    };
    const requests = mockGateway((request) =>
      request.method === "POST" ? { status: 201, body: wireOrder } : { body: { orders: [] } },
    );

    const history = await makeStore().orderHistory.add({
      orderId: "order-123",
      items: [{ upc: "0001111042578", productName: "Milk", quantity: 2, price: 3.5 }],
      totalItems: 2,
      estimatedTotal: 7,
      placedAt: "2026-07-18T00:00:00.000Z",
      locationId: "70500847",
      notes: "Pickup",
    });

    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      method: "GET",
      url: "https://gateway.example/api/grocery/orders?limit=50",
    });
    expect(requests[1]).toMatchObject({
      method: "POST",
      body: {
        id: "order-123",
        items: [{ upc: "0001111042578", name: "Milk", quantity: 2, price: 3.5 }],
        total_items: 2,
        estimated_total: 7,
        placed_at: 1_784_332_800,
        location_id: "70500847",
        notes: "Pickup",
      },
    });
    expect(history).toEqual([
      {
        orderId: "order-123",
        items: [{ upc: "0001111042578", productName: "Milk", quantity: 2, price: 3.5 }],
        totalItems: 2,
        estimatedTotal: 7,
        placedAt: "2026-07-18T00:00:00.000Z",
        locationId: "70500847",
        notes: "Pickup",
      },
    ]);
  });

  it("throws on non-success and malformed gateway responses", async () => {
    mockGateway(() => ({ status: 503, body: { error: "grocery_api_unavailable" } }));
    await expect(makeStore().pantry.getAll()).rejects.toThrow("Gateway request failed (503)");

    vi.unstubAllGlobals();
    mockGateway(() => ({ body: { items: [{ name: "Milk", quantity: "wrong" }] } }));
    await expect(makeStore().pantry.getAll()).rejects.toThrow();
  });

  it("maps not-found nullable reads to null", async () => {
    mockGateway(() => ({ status: 404, body: { error: "grocery_not_found" } }));
    const store = makeStore();

    await expect(store.preferredLocation.get()).resolves.toBeNull();
    await expect(store.shoppingList.get("missing-list")).resolves.toBeNull();
  });

  it("rejects unsupported order-history clearing explicitly", async () => {
    await expect(makeStore().orderHistory.clear()).rejects.toThrow(
      "Gateway does not support clearing order history",
    );
  });
});
