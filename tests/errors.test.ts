import { describe, expect, it } from "vitest";

import {
  apiError,
  authError,
  formatAppError,
  networkError,
  notFoundError,
  storageError,
  validationError,
} from "../src/errors.js";

describe("error constructors", () => {
  describe("apiError", () => {
    it("creates ApiError with object detail and status", () => {
      const e = apiError("api failed", { status: 500 }, 500);
      expect(e).toEqual({
        type: "API_ERROR",
        message: "api failed",
        detail: { status: 500 },
        status: 500,
      });
    });

    it("creates ApiError without detail or status", () => {
      const e = apiError("api failed");
      expect(e).toEqual({
        type: "API_ERROR",
        message: "api failed",
        detail: undefined,
        status: undefined,
      });
    });

    it("stores a string detail as-is", () => {
      const e = apiError("api failed", "string detail");
      expect(e.detail).toBe("string detail");
    });

    it("stores an Error instance as detail", () => {
      const cause = new Error("upstream");
      const e = apiError("api failed", cause);
      expect(e.detail).toBe(cause);
    });

    it("coerces null detail to undefined", () => {
      const e = apiError("api failed", null);
      expect(e.detail).toBeUndefined();
    });

    it("stringifies a numeric detail via primitive fallback", () => {
      const e = apiError("api failed", 42);
      expect(e.detail).toBe("42");
    });
  });

  describe("authError", () => {
    it("creates AuthError", () => {
      const e = authError("not authenticated");
      expect(e).toEqual({ type: "AUTH_ERROR", message: "not authenticated" });
    });
  });

  describe("notFoundError", () => {
    it("creates NotFoundError", () => {
      const e = notFoundError("item not found");
      expect(e).toEqual({ type: "NOT_FOUND", message: "item not found" });
    });
  });

  describe("validationError", () => {
    it("creates ValidationError", () => {
      const e = validationError("bad input");
      expect(e).toEqual({ type: "VALIDATION_ERROR", message: "bad input" });
    });
  });

  describe("storageError", () => {
    it("creates StorageError with an Error cause", () => {
      const cause = new Error("kv failed");
      const e = storageError("storage issue", cause);
      expect(e).toEqual({
        type: "STORAGE_ERROR",
        message: "storage issue",
        cause,
      });
    });

    it("creates StorageError without cause", () => {
      const e = storageError("kv failed");
      expect(e).toEqual({
        type: "STORAGE_ERROR",
        message: "kv failed",
        cause: undefined,
      });
    });
  });

  describe("networkError", () => {
    it("creates NetworkError without cause", () => {
      const e = networkError("timeout");
      expect(e).toEqual({
        type: "NETWORK_ERROR",
        message: "timeout",
        cause: undefined,
      });
    });

    it("creates NetworkError with an Error cause", () => {
      const cause = new Error("net");
      const e = networkError("timeout", cause);
      expect(e).toEqual({
        type: "NETWORK_ERROR",
        message: "timeout",
        cause,
      });
    });
  });
});

describe("formatAppError", () => {
  it("formats ApiError with an object detail as JSON", () => {
    const e = apiError("api failed", { code: "ERR" });
    expect(formatAppError(e)).toBe('api failed: {"code":"ERR"}');
  });

  it("formats ApiError with a string detail (JSON.stringify wraps in quotes)", () => {
    const e = apiError("api failed", "some string");
    expect(formatAppError(e)).toBe('api failed: "some string"');
  });

  it("formats ApiError without detail using only the message", () => {
    const e = apiError("api failed");
    expect(formatAppError(e)).toBe("api failed");
  });

  it("formats AuthError", () => {
    expect(formatAppError(authError("unauthorized"))).toBe("unauthorized");
  });

  it("formats NotFoundError", () => {
    expect(formatAppError(notFoundError("missing"))).toBe("missing");
  });

  it("formats ValidationError", () => {
    expect(formatAppError(validationError("invalid"))).toBe("invalid");
  });

  it("formats StorageError", () => {
    expect(formatAppError(storageError("kv error"))).toBe("kv error");
  });

  it("formats NetworkError", () => {
    expect(formatAppError(networkError("timeout"))).toBe("timeout");
  });
});
