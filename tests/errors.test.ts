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
  it("creates ApiError", () => {
    const e = apiError("api failed", { status: 500 }, 500);
    expect(e).toEqual({
      type: "API_ERROR",
      message: "api failed",
      detail: { status: 500 },
      status: 500,
    });
  });

  it("creates ApiError without detail", () => {
    const e = apiError("api failed");
    expect(e).toEqual({
      type: "API_ERROR",
      message: "api failed",
      detail: undefined,
      status: undefined,
    });
  });

  it("creates AuthError", () => {
    const e = authError("not authenticated");
    expect(e).toEqual({ type: "AUTH_ERROR", message: "not authenticated" });
  });

  it("creates NotFoundError", () => {
    const e = notFoundError("item not found");
    expect(e).toEqual({ type: "NOT_FOUND", message: "item not found" });
  });

  it("creates ValidationError", () => {
    const e = validationError("bad input");
    expect(e).toEqual({ type: "VALIDATION_ERROR", message: "bad input" });
  });

  it("creates StorageError", () => {
    const cause = new Error("kv failed");
    const e = storageError("storage issue", cause);
    expect(e).toEqual({
      type: "STORAGE_ERROR",
      message: "storage issue",
      cause,
    });
  });

  it("creates NetworkError", () => {
    const e = networkError("timeout");
    expect(e).toEqual({
      type: "NETWORK_ERROR",
      message: "timeout",
      cause: undefined,
    });
  });
});

describe("formatAppError", () => {
  it("formats ApiError with detail", () => {
    const e = apiError("api failed", { code: "ERR" });
    expect(formatAppError(e)).toBe('api failed: {"code":"ERR"}');
  });

  it("formats ApiError without detail", () => {
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
