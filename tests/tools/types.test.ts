import type { Props, ToolContext } from "../../src/tools/types";
import { requireAuth, resolveLocationId } from "../../src/tools/types";

// ----- requireAuth -----

describe("requireAuth", () => {
  it("returns props when user is authenticated", () => {
    const props: Props = {
      id: "user-123",
      accessToken: "token",
      tokenExpiresAt: Date.now() + 30 * 60 * 1000,
      krogerClientId: "client-id",
      krogerClientSecret: "client-secret",
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
        krogerClientId: "id",
        krogerClientSecret: "secret",
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
        get: jest.fn().mockResolvedValue(preferredLocationGetResult),
        set: jest.fn(),
        delete: jest.fn(),
      },
      pantry: {},
      equipment: {},
      orderHistory: {},
      shoppingList: {},
    } as unknown as ReturnType<
      typeof import("../../src/utils/user-storage").createUserStorage
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
