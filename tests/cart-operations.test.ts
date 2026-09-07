import { describe, expect, it } from "vitest";
import { cartOperationStore } from "./cart-operation-store.js";

describe("cart operation journal", () => {
  it("atomically claims one writer and persists completion across stub reads", async () => {
    const journal = cartOperationStore();
    const claims = await Promise.all(
      Array.from({ length: 8 }, () => journal.begin("list:one", "milk")),
    );
    const owner = claims.find((claim) => claim.status === "started");
    expect(claims.filter((claim) => claim.status === "started")).toHaveLength(1);
    if (!owner || owner.status !== "started") throw new Error("Missing owner");
    await journal.complete("list:one", owner.attempt);
    expect(await journal.begin("list:one", "milk")).toMatchObject({ status: "completed" });
    expect(await journal.begin("list:one", "eggs")).toEqual({ status: "conflict" });
  });

  it("does not let an old rejected attempt clear a newer claim", async () => {
    const journal = cartOperationStore();
    const first = await journal.begin("list:one", "milk");
    if (first.status !== "started") throw new Error("Missing owner");
    await journal.reject("list:one", first.attempt);
    const second = await journal.begin("list:one", "milk");
    expect(second.status).toBe("started");
    await journal.reject("list:one", first.attempt);
    expect(await journal.begin("list:one", "milk")).toMatchObject({ status: "pending" });
    expect(await journal.complete("list:one", first.attempt)).toBe(false);
  });
});
