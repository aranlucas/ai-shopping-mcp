import { err, ok } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import type { Props, UserStorage } from "../../src/tools/types.js";

import { apiError, authError, notFoundError } from "../../src/errors.js";
import { KrogerTokenExpiredError } from "../../src/services/kroger/client.js";
import {
  fromApiResponse,
  getProps,
  safeFetch,
  safeResolveLocationId,
  safeStorage,
  toMcpError,
  toMcpResponse,
} from "../../src/utils/result.js";

const authMock = vi.hoisted(() => ({
  context: undefined as { props?: Props } | undefined,
}));

vi.mock("agents/mcp", () => ({
  getMcpAuthContext: () => authMock.context,
}));

// --- toMcpResponse ---

describe("toMcpResponse", () => {
  it("converts Ok to text result", () => {
    const result = toMcpResponse(ok("hello"));
    expect(result).toEqual({
      content: [{ type: "text", text: "hello" }],
    });
    expect(result.isError).toBeUndefined();
  });

  it("converts Err to error result", () => {
    const result = toMcpResponse(err(apiError("failed", { code: 500 })));
    expect(result).toEqual({
      content: [{ type: "text", text: 'failed: {"code":500}' }],
      isError: true,
    });
  });

  it("converts Err without detail", () => {
    const result = toMcpResponse(err(authError("not authenticated")));
    expect(result).toEqual({
      content: [{ type: "text", text: "not authenticated" }],
      isError: true,
    });
  });
});

describe("toMcpError", () => {
  it("converts AppError to MCP error response", () => {
    const result = toMcpError(authError("not authenticated"));
    expect(result).toEqual({
      content: [{ type: "text", text: "not authenticated" }],
      isError: true,
    });
  });

  it("formats API errors with detail", () => {
    const result = toMcpError(apiError("request failed", { status: 400 }));
    expect(result).toEqual({
      content: [{ type: "text", text: 'request failed: {"status":400}' }],
      isError: true,
    });
  });
});

// --- fromApiResponse ---

describe("fromApiResponse", () => {
  it("returns Ok when data present", async () => {
    const result = await fromApiResponse(
      Promise.resolve({
        data: { items: [1, 2, 3] },
        error: undefined,
        response: new Response(null, { status: 200 }),
      }),
      "test api",
    );
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ items: [1, 2, 3] });
  });

  it("returns Ok with undefined data for 204 No Content", async () => {
    const result = await fromApiResponse(
      Promise.resolve({
        data: undefined,
        error: undefined,
        response: new Response(null, { status: 204 }),
      }),
      "test api",
    );
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBeUndefined();
  });

  it("returns Err when error present", async () => {
    const result = await fromApiResponse(
      Promise.resolve({
        data: undefined,
        error: { message: "bad request" },
        response: new Response(null, { status: 400 }),
      }),
      "test api",
    );
    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.type).toBe("API_ERROR");
    expect(error.message).toContain("test api");
    expect(error.type === "API_ERROR" && error.status).toBe(400);
  });

  it("returns Err when response is not ok", async () => {
    const result = await fromApiResponse(
      Promise.resolve({
        data: undefined,
        error: undefined,
        response: new Response(null, { status: 500 }),
      }),
      "test api",
    );
    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.type).toBe("API_ERROR");
    expect(error.type === "API_ERROR" && error.status).toBe(500);
  });

  it("returns Err on promise rejection", async () => {
    const result = await fromApiResponse(Promise.reject(new Error("network fail")), "test api");
    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.type).toBe("NETWORK_ERROR");
    expect(error.message).toContain("network fail");
  });

  it("preserves Kroger expired-token rejections as auth errors", async () => {
    const result = await fromApiResponse(
      Promise.reject(new KrogerTokenExpiredError("Kroger access token has expired. Reconnect.")),
      "search products",
    );

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.type).toBe("AUTH_ERROR");
    expect(error.message).toBe("Kroger access token has expired. Reconnect.");
  });
});

// --- getProps ---

describe("getProps", () => {
  it("returns the props when the request is authenticated", () => {
    const props: Props = {
      id: "user-123",
      accessToken: "token",
      tokenExpiresAt: Date.now() + 30 * 60 * 1000,
    };
    authMock.context = { props };
    expect(getProps()).toEqual(props);
  });

  it("throws when there is no auth context (cannot happen behind OAuthProvider)", () => {
    authMock.context = undefined;
    expect(() => getProps()).toThrow("outside an authenticated MCP request");
  });

  it("throws when the auth context has no props", () => {
    authMock.context = {};
    expect(() => getProps()).toThrow("outside an authenticated MCP request");
  });
});

// --- safeResolveLocationId ---

describe("safeResolveLocationId", () => {
  function mockStorage(preferredLocation: unknown = null) {
    return {
      preferredLocation: {
        get: vi.fn().mockResolvedValue(preferredLocation),
        set: vi.fn(),
        delete: vi.fn(),
      },
      pantry: {},
      equipment: {},
      orderHistory: {},
      shoppingList: {},
    } as unknown as UserStorage;
  }

  it("returns Ok with provided locationId", async () => {
    const storage = mockStorage();
    const result = await safeResolveLocationId(storage, "user1", "70500847");
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ locationId: "70500847" });
  });

  it("falls back to preferred location", async () => {
    const storage = mockStorage({
      locationId: "70500847",
      locationName: "QFC #815",
    });
    const result = await safeResolveLocationId(storage, "user1");
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({
      locationId: "70500847",
      locationName: "QFC #815",
    });
  });

  it("returns Err when no location available", async () => {
    const storage = mockStorage(null);
    const result = await safeResolveLocationId(storage, "user1");
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("NOT_FOUND");
  });

  it("returns Err on storage failure", async () => {
    const storage = {
      preferredLocation: {
        get: vi.fn().mockRejectedValue(new Error("KV unavailable")),
      },
    } as unknown as UserStorage;
    const result = await safeResolveLocationId(storage, "user1");
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("STORAGE_ERROR");
  });
});

// --- safeStorage ---

describe("safeStorage", () => {
  it("returns Ok on success", async () => {
    const result = await safeStorage(() => Promise.resolve([1, 2, 3]), "test");
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual([1, 2, 3]);
  });

  it("returns Err on failure", async () => {
    const result = await safeStorage(() => Promise.reject(new Error("boom")), "test op");
    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.type).toBe("STORAGE_ERROR");
    expect(error.message).toContain("boom");
    expect(error.message).toContain("test op");
  });
});

// --- safeFetch ---

describe("safeFetch", () => {
  it("returns Ok on successful fetch", async () => {
    const mockResponse = new Response("ok", { status: 200 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    const result = await safeFetch("https://example.com", undefined, "test");
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().status).toBe(200);

    vi.unstubAllGlobals();
  });

  it("returns Err on non-ok response", async () => {
    const mockResponse = new Response("not found", {
      status: 404,
      statusText: "Not Found",
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    const result = await safeFetch("https://example.com", undefined, "test");
    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.type).toBe("API_ERROR");
    expect(error.message).toContain("404");

    vi.unstubAllGlobals();
  });

  it("returns Err on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));

    const result = await safeFetch("https://example.com", undefined, "test");
    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.type).toBe("NETWORK_ERROR");
    expect(error.message).toContain("network error");

    vi.unstubAllGlobals();
  });
});

// --- Integration: composing Result utilities like tool handlers ---

describe("tool handler error path integration", () => {
  it("authError → toMcpError surfaces auth failures to the client", () => {
    const mcpResult = toMcpError(authError("token expired"));
    expect(mcpResult.isError).toBe(true);
    expect(mcpResult.content[0].text).toContain("token expired");
  });

  it("safeStorage failure produces valid MCP error via toMcpResponse", async () => {
    const result = await safeStorage(() => Promise.reject(new Error("KV down")), "fetch pantry");
    const mcpResult = toMcpResponse(result.map(() => "unused"));
    expect(mcpResult.isError).toBe(true);
    expect(mcpResult.content[0].text).toContain("KV down");
  });

  it("fromApiResponse → andThen chain produces correct not-found error", async () => {
    const result = await fromApiResponse(
      Promise.resolve({
        data: { item: null },
        error: undefined,
        response: new Response(null, { status: 200 }),
      }),
      "get product",
    ).andThen((data) => {
      if (!(data as { item: unknown }).item) {
        return err(notFoundError("Product not found"));
      }
      return ok("found");
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("NOT_FOUND");
    expect(result._unsafeUnwrapErr().message).toBe("Product not found");
  });

  it("safeResolveLocationId → toMcpError for missing location", async () => {
    const storage = {
      preferredLocation: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn(),
        delete: vi.fn(),
      },
      pantry: {},
      equipment: {},
      orderHistory: {},
      shoppingList: {},
    } as unknown as UserStorage;

    const result = await safeResolveLocationId(storage, "user1");
    expect(result.isErr()).toBe(true);
    const mcpResult = toMcpError(result._unsafeUnwrapErr());
    expect(mcpResult.isError).toBe(true);
    expect(mcpResult.content[0].text).toContain("No location specified");
  });
});
