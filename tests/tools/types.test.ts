import { describe, expect, it, vi } from "vitest";
import type { Props, ToolContext, UserStorage } from "../../src/tools/types.js";
import {
  errorResult,
  resolveLocationId,
  textResult,
} from "../../src/tools/types.js";

// ----- requireUser (via ToolContext) -----

describe("requireUser", () => {
  function makeCtx(props: Props | undefined): ToolContext {
    return {
      getUser: () => props ?? null,
      requireUser: () => {
        if (!props?.id) throw new Error("User not authenticated");
        return props;
      },
    } as unknown as ToolContext;
  }

  it("returns props when user is authenticated", () => {
    const props: Props = {
      id: "user-123",
      accessToken: "token",
      tokenExpiresAt: Date.now() + 30 * 60 * 1000,
    };

    const ctx = makeCtx(props);

    const result = ctx.requireUser();
    expect(result).toEqual(props);
    expect(result.id).toBe("user-123");
  });

  it("throws when props is undefined", () => {
    const ctx = makeCtx(undefined);

    expect(() => ctx.requireUser()).toThrow("User not authenticated");
  });

  it("throws when props.id is empty", () => {
    const ctx = makeCtx({
      id: "",
      accessToken: "token",
      tokenExpiresAt: Date.now(),
    });

    expect(() => ctx.requireUser()).toThrow("User not authenticated");
  });
});

// ----- getUser -----

describe("getUser", () => {
  it("returns null when not authenticated", () => {
    const ctx = {
      getUser: () => null,
    } as unknown as ToolContext;

    expect(ctx.getUser()).toBeNull();
  });

  it("returns props when authenticated", () => {
    const props: Props = {
      id: "user-123",
      accessToken: "token",
      tokenExpiresAt: Date.now(),
    };
    const ctx = {
      getUser: () => props,
    } as unknown as ToolContext;

    expect(ctx.getUser()).toEqual(props);
  });
});

// ----- textResult / errorResult -----

describe("textResult", () => {
  it("wraps text in MCP content format", () => {
    expect(textResult("hello")).toEqual({
      content: [{ type: "text", text: "hello" }],
    });
  });
});

describe("errorResult", () => {
  it("wraps text in MCP error format", () => {
    expect(errorResult("bad")).toEqual({
      content: [{ type: "text", text: "bad" }],
      isError: true,
    });
  });
});

// ----- resolveLocationId -----

describe("resolveLocationId", () => {
  function mockStorage(preferredLocationGetResult: unknown = null) {
    return {
      preferredLocation: {
        get: vi.fn().mockResolvedValue(preferredLocationGetResult),
        set: vi.fn(),
        delete: vi.fn(),
      },
      pantry: {},
      equipment: {},
      orderHistory: {},
      shoppingList: {},
    } as unknown as UserStorage;
  }

  it("returns the provided locationId directly", async () => {
    const storage = mockStorage();

    const result = await resolveLocationId(storage, "user1", "70500847");
    expect(result).toEqual({ locationId: "70500847" });
    expect(storage.preferredLocation.get).not.toHaveBeenCalled();
  });

  it("falls back to preferred location when no locationId provided", async () => {
    const storage = mockStorage({
      locationId: "70500847",
      locationName: "QFC #815",
      address: "100 Main St",
      chain: "QFC",
      setAt: "2025-01-01T00:00:00Z",
    });

    const result = await resolveLocationId(storage, "user1");
    expect(result).toEqual({
      locationId: "70500847",
      locationName: "QFC #815",
    });
  });

  it("throws when no locationId and no preferred location", async () => {
    const storage = mockStorage(null);

    await expect(resolveLocationId(storage, "user1")).rejects.toThrow(
      "No location specified",
    );
  });
});
