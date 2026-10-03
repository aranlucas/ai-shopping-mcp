import { describe, expect, it } from "vitest";
import { strictFake } from "./strict-fake.js";

interface Counter {
  count: number;
  increment: () => number;
  missing: () => void;
}

const token = Symbol("token");

interface SymbolOwner {
  [token]: string;
  absent: string;
}

class PrivateCounter {
  #count = 2;
  increment() {
    return ++this.#count;
  }
  toString() {
    return `count:${this.#count}`;
  }
}

describe("strict runtime fakes", () => {
  it("returns provided data, preserves method receivers and stable identity", () => {
    const members = {
      count: 0,
      increment() {
        return ++this.count;
      },
    };

    const counter = strictFake<Counter>(members);
    expect(counter.increment()).toBe(1);
    expect(counter.count).toBe(1);
    expect(members.count).toBe(1);
    expect(counter.increment).toBe(counter.increment);
    expect(() => counter.missing()).toThrow(
      "Unimplemented fake member: missing",
    );
  });
  it("rejects missing and undefined properties, including symbol keys", () => {
    const value = strictFake<SymbolOwner>({ [token]: "present" });
    expect(value[token]).toBe("present");
    expect(() => value.absent).toThrow("Unimplemented fake member: absent");
    const absent = strictFake<SymbolOwner>({ absent: undefined });
    expect(() => absent.absent).toThrow("Unimplemented fake member: absent");
    expect(() => absent[token]).toThrow(
      "Unimplemented fake member: Symbol(token)",
    );
  });
  it("resolves prototype descriptors without losing private-field receivers", () => {
    const owner = new PrivateCounter();
    const counter = strictFake<PrivateCounter>(owner);
    expect(counter.increment()).toBe(3);
    expect(counter.constructor).toBe(PrivateCounter);
    expect(counter.toString()).toBe("count:3");
    expect(counter instanceof PrivateCounter).toBe(true);
  });
});

it("requires an explicit ordinary-data contract before allowing Promise assimilation", async () => {
  const data = strictFake<Counter>({ count: 2 }, { nonThenable: true });
  expect(await Promise.resolve(data)).toBe(data);
  const missingPromise = strictFake<Promise<number>>({});
  await expect(Promise.resolve(missingPromise)).rejects.toThrow(
    "Unimplemented fake member: then",
  );
});
