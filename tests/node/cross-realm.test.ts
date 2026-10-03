import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { fromApiResponse } from "../../src/utils/result.js";

type ForeignFactory = () => Promise<{ data: number; response: Response }>;

type ManualSuccess = { value: number };

describe("API response dispatch contracts", () => {
  it("invokes a cross-realm function rather than treating it as a Promise", async () => {
    const context = createContext({ Response });

    const candidate: unknown = runInContext(
      "(function () { return Promise.resolve({ data: 42, response: new Response(null, { status: 200 }) }); })",
      context,
    );

    // The VM fixture above fixes the result contract; native Zod callable validation
    // preserves the original foreign function rather than wrapping it in this realm.
    const factory = z
      .custom<ForeignFactory>((value) => z.function().safeParse(value).success)
      .parse(candidate);

    expect(factory).not.toBeInstanceOf(Function);
    const result = await fromApiResponse(factory, "cross-realm fixture");
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(42);
  });

  it("keeps successful missing data unchanged, including manually selected generic types", async () => {
    const result = await fromApiResponse<ManualSuccess>(
      Promise.resolve({ response: new Response(null, { status: 204 }) }),
      "no content",
    );

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBeUndefined();
  });
});
