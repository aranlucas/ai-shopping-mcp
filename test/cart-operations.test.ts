import { describe, expect, it } from "vitest";
import { cartOperationStore } from "@test/cart-operation-store.js";

describe("cart operation journal", () => {
  it("atomically claims one writer and persists completion across stub reads", async () => {
    const journal = cartOperationStore();

    const claims = await Promise.all(
      Array.from({ length: 8 }, () => journal.begin("list:one", "milk")),
    );

    const owner = claims.find((claim) => claim.status === "started");
    expect(claims.filter((claim) => claim.status === "started")).toHaveLength(1);

    if (owner?.status !== "started") {
      throw new Error("Missing owner");
    }

    await journal.complete("list:one", owner.attempt);
    expect(await journal.begin("list:one", "milk")).toMatchObject({
      status: "completed",
    });
    expect(await journal.begin("list:one", "eggs")).toEqual({
      status: "conflict",
    });
  });

  it("does not let an old rejected attempt clear a newer claim", async () => {
    const journal = cartOperationStore();
    const first = await journal.begin("list:one", "milk");

    if (first.status !== "started") {
      throw new Error("Missing owner");
    }

    await journal.reject("list:one", first.attempt);
    const second = await journal.begin("list:one", "milk");
    expect(second.status).toBe("started");
    await journal.reject("list:one", first.attempt);
    expect(await journal.begin("list:one", "milk")).toMatchObject({
      status: "pending",
    });
    expect(await journal.complete("list:one", first.attempt)).toBe(false);
  });

  it("keeps every entry when cart adds append history concurrently", async () => {
    const journal = cartOperationStore();
    const addedAt = new Date().toISOString();

    await Promise.all(
      ["0001", "0002", "0003", "0004", "0005"].map((upc) =>
        journal.appendHistory([{ upc, quantity: 1, modality: "PICKUP" }], addedAt),
      ),
    );

    expect((await journal.history()).map((entry) => entry.upc).toSorted()).toEqual([
      "0001",
      "0002",
      "0003",
      "0004",
      "0005",
    ]);
  });

  it("keeps the newest 100 history entries", async () => {
    const journal = cartOperationStore();
    const addedAt = new Date().toISOString();

    const items = Array.from({ length: 101 }, (_, index) => ({
      upc: String(index).padStart(13, "0"),
      quantity: 1,
      modality: "PICKUP" as const,
    }));

    const history = await journal.appendHistory(items, addedAt);

    expect(history).toHaveLength(100);
    expect(history[0]?.upc).toBe("0000000000001");
    expect(history.at(-1)?.upc).toBe("0000000000100");
  });

  it("drops history entries older than seven days", async () => {
    const journal = cartOperationStore();
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();

    await journal.appendHistory([{ upc: "old", quantity: 1, modality: "PICKUP" }], eightDaysAgo);
    await journal.appendHistory(
      [{ upc: "new", quantity: 1, modality: "PICKUP" }],
      new Date().toISOString(),
    );

    expect((await journal.history()).map((entry) => entry.upc)).toEqual(["new"]);
  });
});
