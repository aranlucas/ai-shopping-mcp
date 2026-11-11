import { cartOperationStore } from "@test/cart-operation-store.js";
import { describe, expect, it } from "vitest";

import { createCartStore } from "@/utils/cart-store.js";

describe("createCartStore", () => {
  it("isolates cart operations by authenticated client", async () => {
    const journal = cartOperationStore();
    const first = createCartStore(journal, "client1");
    const second = createCartStore(journal, "client2");

    const claim = await first.operations.begin("list:one", "milk");

    if (claim.status !== "started") {
      throw new Error("Missing owner");
    }

    await first.operations.complete("list:one", claim.attempt);

    expect(await first.operations.begin("list:one", "milk")).toMatchObject({
      status: "completed",
    });
    expect(await second.operations.begin("list:one", "eggs")).toMatchObject({
      status: "started",
    });
  });

  it("shares add history and the saved cart ID across the user's clients", async () => {
    const journal = cartOperationStore();
    const first = createCartStore(journal, "client1");
    const second = createCartStore(journal, "client2");

    await first.cartMirror.append(
      [{ upc: "0001111042578", quantity: 1, modality: "PICKUP" }],
      new Date().toISOString(),
    );
    await first.cartId.set("cart-a");

    expect((await second.cartMirror.getAll()).map((entry) => entry.upc)).toEqual(["0001111042578"]);
    expect(await second.cartId.get()).toBe("cart-a");
  });
});
