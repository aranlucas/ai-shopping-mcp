import { describe, expect, it, vi } from "vitest";

import { apiError, authError } from "../../src/errors.js";
import { logProductSearchError } from "../../src/tools/product.js";

describe("logProductSearchError", () => {
  it("logs expected auth failures as warnings instead of errors", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    logProductSearchError("eggs", authError("Kroger access token has expired."));

    expect(warnSpy).toHaveBeenCalledWith(
      'Search unavailable for "eggs":',
      "Kroger access token has expired.",
    );
    expect(errorSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("logs unexpected product failures as errors", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    logProductSearchError("eggs", apiError("Failed to search products"));

    expect(errorSpy).toHaveBeenCalledWith(
      'Error searching products for "eggs":',
      "Failed to search products",
    );
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
