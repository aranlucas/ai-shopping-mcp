import { describe, expect, it } from "vitest";
import { cartOperationStore } from "./cart-operation-store.js";
import {
  cartItemsFingerprint,
  claimCartOperation,
} from "../src/cart-operations.js";

describe("cart operation journal", () => {
  it("atomically claims one writer and persists completion across stub reads", async () => {
    const journal = cartOperationStore();
    const claims = await Promise.all(
      Array.from({ length: 8 }, () => journal.begin("list:one", "milk")),
    );
    const owner = claims.find((claim) => claim.status === "started");
    expect(claims.filter((claim) => claim.status === "started")).toHaveLength(
      1,
    );
    if (!owner || owner.status !== "started") throw new Error("Missing owner");
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
    if (first.status !== "started") throw new Error("Missing owner");
    await journal.reject("list:one", first.attempt);
    const second = await journal.begin("list:one", "milk");
    expect(second.status).toBe("started");
    await journal.reject("list:one", first.attempt);
    expect(await journal.begin("list:one", "milk")).toMatchObject({
      status: "pending",
    });
    expect(await journal.complete("list:one", first.attempt)).toBe(false);
  });

  it("migrates a matching legacy receipt into the journal", async () => {
    const journal = cartOperationStore();
    const items = [
      { upc: "0001111042578", quantity: 2, modality: "PICKUP" as const },
    ];
    const fingerprint = cartItemsFingerprint(items);

    const claim = await claimCartOperation(
      journal,
      "list:legacy",
      fingerprint,
      async () => items,
    );

    expect(claim).toMatchObject({ status: "completed", fingerprint });
    expect(await journal.begin("list:legacy", fingerprint)).toMatchObject({
      status: "completed",
    });
  });

  it("keeps a changed list in conflict with a migrated legacy receipt", async () => {
    const journal = cartOperationStore();
    const legacy = [
      { upc: "0001111042578", quantity: 1, modality: "PICKUP" as const },
    ];
    const changed = [
      { upc: "0001111042578", quantity: 2, modality: "PICKUP" as const },
    ];

    expect(
      await claimCartOperation(
        journal,
        "list:legacy-change",
        cartItemsFingerprint(changed),
        async () => legacy,
      ),
    ).toEqual({ status: "conflict" });
    expect(
      await journal.begin("list:legacy-change", cartItemsFingerprint(legacy)),
    ).toMatchObject({ status: "completed" });
  });

  it("does not read a corrupt legacy receipt after a known journal completion", async () => {
    const journal = cartOperationStore();
    const items = [
      { upc: "0001111042578", quantity: 1, modality: "PICKUP" as const },
    ];
    const fingerprint = cartItemsFingerprint(items);
    const owner = await journal.begin("list:known", fingerprint);
    if (owner.status !== "started") throw new Error("Missing owner");
    await journal.complete("list:known", owner.attempt);

    let reads = 0;
    const claim = await claimCartOperation(
      journal,
      "list:known",
      fingerprint,
      async () => {
        reads += 1;
        throw new Error("corrupt legacy receipt");
      },
    );

    expect(claim.status).toBe("completed");
    expect(reads).toBe(0);
  });
});
