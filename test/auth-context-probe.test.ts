import { getProps } from "@/utils/result.js";
import { authenticatedRequest } from "@test/authenticated-request.js";
import { expect, it } from "vitest";

it("preserves an operation rejection", async () => {
  await expect(
    authenticatedRequest(async () => {
      throw new Error("synthetic failure");
    }),
  ).rejects.toThrow("synthetic failure");
});

it("validates the real request context and preserves the numeric contract", async () => {
  await Promise.all(
    [Date.now() + 1000, Number.NaN, Infinity, -Infinity].map(async (tokenExpiresAt) => {
      const props = {
        id: "user-123",
        accessToken: "synthetic",
        tokenExpiresAt,
      };

      await expect(
        authenticatedRequest(() => Promise.resolve(getProps()), { props }),
      ).resolves.toEqual(props);
    }),
  );
});
