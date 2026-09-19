import type { App } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { describe, expect, it, vi } from "vitest";
import {
  createCartAction,
  type CartRequest,
} from "../../views/app/cart-action.js";

const productRequest: CartRequest = {
  kind: "product",
  product: {
    productName: "Milk",
    productRef: "kroger:0001111041700",
    quantity: 1,
  },
  modality: "PICKUP",
};
const listRequest: CartRequest = {
  kind: "list",
  listId: "original-list",
  modality: "PICKUP",
};
const listCreated = {
  content: [],
  structuredContent: { listId: "original-list" },
};
function cartSuccess(
  outcome: "added" | "already_added" | "needs_match" = "added",
): CallToolResult {
  return {
    content: [],
    _meta: { "dev.aranlucas/view": "add_shopping_list_to_cart" },
    structuredContent: {
      outcome,
      addedCount: outcome === "needs_match" ? 0 : 1,
      requestedCount: 1,
      listId: "original-list",
      name: "Milk",
      items:
        outcome === "needs_match"
          ? []
          : [{ upc: "0001111041700", quantity: 1, modality: "PICKUP" }],
      needsUpc:
        outcome === "needs_match" ? [{ productName: "Milk", quantity: 1 }] : [],
      actionDetail:
        outcome === "added"
          ? 'Added 1 item(s) from list "Milk" to cart'
          : outcome === "already_added"
            ? 'Already added 1 item(s) from list "Milk"'
            : "No Kroger items to add; match items to Kroger before retrying",
    },
  };
}
const success = cartSuccess();
const failure = (code: string, recovery: string): CallToolResult => ({
  content: [{ type: "text", text: "Cart request failed" }],
  isError: true,
  structuredContent: { error: { code, recovery } },
});
function makeApp(results: Array<CallToolResult | Error>) {
  const callServerTool = vi.fn<App["callServerTool"]>(async () => {
    const result = results.shift();
    if (result instanceof Error) throw result;
    if (!result) throw new Error("Unexpected tool call");
    return result;
  });
  return { app: { callServerTool } as unknown as App, callServerTool };
}

describe("cart action state transitions", () => {
  it("checkpoints the created list before submitting the cart", async () => {
    const { app, callServerTool } = makeApp([listCreated, success]);
    const action = createCartAction(productRequest);
    const observed: string[] = [];
    action.subscribe(() =>
      observed.push(
        `${action.getSnapshot().status}:${action.getSnapshot().request.kind}`,
      ),
    );
    await action.submit(app);
    expect(observed).toEqual([
      "submitting:product",
      "submitting:list",
      "added:list",
    ]);
    expect(callServerTool.mock.calls.map(([call]) => call)).toEqual([
      {
        name: "create_shopping_list",
        arguments: {
          name: "Milk",
          items: [
            {
              productName: "Milk",
              productRef: "kroger:0001111041700",
              quantity: 1,
            },
          ],
        },
      },
      {
        name: "add_shopping_list_to_cart",
        arguments: { listId: "original-list", modality: "PICKUP" },
      },
    ]);
  });

  it("retries a rejected cart against the same list, including after reconnect", async () => {
    const first = makeApp([listCreated, failure("AUTH_ERROR", "reconnect")]);
    const second = makeApp([success]);
    const action = createCartAction(productRequest);
    await action.submit(first.app);
    expect(action.getSnapshot()).toMatchObject({
      status: "retryable",
      request: listRequest,
      message: "Cart request failed",
    });
    await action.submit(second.app);
    expect(second.callServerTool.mock.calls[0]).toEqual(
      first.callServerTool.mock.calls[1],
    );
    expect(action.getSnapshot().status).toBe("added");
  });

  it("keeps an already-added result distinct from a new add", async () => {
    const { app } = makeApp([cartSuccess("already_added")]);
    const action = createCartAction(listRequest);

    await action.submit(app);

    expect(action.getSnapshot()).toMatchObject({
      status: "already_added",
      request: listRequest,
    });
  });

  it("surfaces a needs-match result without claiming a cart add", async () => {
    const { app } = makeApp([cartSuccess("needs_match")]);
    const action = createCartAction(listRequest);

    await action.submit(app);

    expect(action.getSnapshot()).toMatchObject({
      status: "needs_match",
      request: listRequest,
      message: "No Kroger items to add; match items to Kroger before retrying",
    });
  });

  it("blocks retry after a fulfilled but malformed cart result", async () => {
    const { app, callServerTool } = makeApp([{ content: [] }]);
    const action = createCartAction(listRequest);

    await action.submit(app);

    expect(action.getSnapshot()).toMatchObject({
      status: "check_cart",
      request: listRequest,
      message:
        "The cart response was malformed. Check your Kroger cart before retrying.",
    });
    await action.submit(app);
    expect(callServerTool).toHaveBeenCalledTimes(1);
  });

  it.each([
    failure("MUTATION_OUTCOME_UNKNOWN", "check_cart"),
    new Error("host disconnected"),
  ])(
    "blocks retries and resets after an ambiguous outcome %j",
    async (error) => {
      const { app, callServerTool } = makeApp([listCreated, error]);
      const action = createCartAction(productRequest);
      await action.submit(app);
      action.reset();
      await action.submit(app);
      expect(action.getSnapshot()).toMatchObject({
        status: "check_cart",
        request: listRequest,
      });
      expect(callServerTool).toHaveBeenCalledTimes(2);
    },
  );

  it.each([productRequest, listRequest])(
    "coalesces concurrent clicks for $kind actions",
    async (request) => {
      const results =
        request.kind === "product" ? [listCreated, success] : [success];
      const expectedCalls = results.length;
      const { app, callServerTool } = makeApp(results);
      const action = createCartAction(request);
      const first = action.submit(app);
      expect(action.submit(app)).toBe(first);
      await first;
      await action.submit(app);
      expect(callServerTool).toHaveBeenCalledTimes(expectedCalls);
      expect(action.getSnapshot().status).toBe("added");
    },
  );

  it("only starts a new intentional product add after confirmed success is reset", async () => {
    const { app, callServerTool } = makeApp([
      listCreated,
      success,
      { content: [], structuredContent: { listId: "new-list" } },
      success,
    ]);
    const action = createCartAction(productRequest);
    await action.submit(app);
    action.reset();
    await action.submit(app);
    expect(callServerTool).toHaveBeenCalledTimes(4);
    expect(action.getSnapshot()).toMatchObject({
      status: "added",
      request: { kind: "list", listId: "new-list" },
    });
  });

  it("retries list creation when it failed before a cart request", async () => {
    const { app, callServerTool } = makeApp([
      new Error("list service unavailable"),
      listCreated,
      success,
    ]);
    const action = createCartAction(productRequest);
    await action.submit(app);
    expect(action.getSnapshot()).toMatchObject({
      status: "retryable",
      request: productRequest,
    });
    await action.submit(app);
    expect(callServerTool.mock.calls.map(([call]) => call.name)).toEqual([
      "create_shopping_list",
      "create_shopping_list",
      "add_shopping_list_to_cart",
    ]);
  });

  it("snapshots the input so caller mutations cannot change a pending request", async () => {
    const request = structuredClone(productRequest);
    const action = createCartAction(request);
    if (request.kind !== "product") throw new Error("Expected product fixture");
    request.product.quantity = 99;
    const { app, callServerTool } = makeApp([listCreated, success]);
    await action.submit(app);
    expect(callServerTool.mock.calls[0][0].arguments).toMatchObject({
      items: [{ quantity: 1 }],
    });
  });

  it("keeps failures before submission retryable and detaches subscriptions", async () => {
    const action = createCartAction(listRequest);
    const listener = vi.fn<() => void>();
    const unsubscribe = action.subscribe(listener);
    unsubscribe();
    await action.submit(null);
    expect(action.getSnapshot().status).toBe("retryable");
    expect(listener).not.toHaveBeenCalled();
  });
});
