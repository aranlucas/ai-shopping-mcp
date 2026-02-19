import { describe, expect, it, vi } from "vitest";
import type { Props, ToolContext } from "../../src/tools/types.js";
import { requireAuth, resolveLocationId } from "../../src/tools/types.js";

// ----- requireAuth -----

describe("requireAuth", () => {
  it("returns props when user is authenticated", () => {
    const props: Props = {
      id: "user-123",
      accessToken: "token",
      tokenExpiresAt: Date.now() + 30 * 60 * 1000,
    };

    const ctx = {
      getProps: () => props,
    } as unknown as ToolContext;

    const result = requireAuth(ctx);
    expect(result).toEqual(props);
    expect(result.id).toBe("user-123");
  });

  it("throws when props is undefined", () => {
    const ctx = {
      getProps: () => undefined,
    } as unknown as ToolContext;

    expect(() => requireAuth(ctx)).toThrow("User not authenticated");
  });

  it("throws when props.id is empty", () => {
    const ctx = {
      getProps: () => ({
        id: "",
        accessToken: "token",
        tokenExpiresAt: Date.now(),
      }),
    } as unknown as ToolContext;

    expect(() => requireAuth(ctx)).toThrow("User not authenticated");
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
    } as unknown as ReturnType<
      typeof import("../../src/utils/user-storage.js").createUserStorage
    >;
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
