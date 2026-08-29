import {
  CLIENT_CAPABILITIES_META_KEY,
  Server,
  isInputRequiredResult,
  type ServerContext,
} from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";

import {
  ELICITATION_UNSUPPORTED_MESSAGE,
  clientSupportsFormElicitation,
  requestCheckoutConfirmation,
} from "../../src/tools/shopping-list.js";

describe("ELICITATION_UNSUPPORTED_MESSAGE stays pinned to the installed SDK", () => {
  it("matches the exact message the SDK's Server#elicitInput throws for a client without form-elicitation capability", async () => {
    // A freshly constructed Server has no connected transport, so
    // `_clientCapabilities` is unset and `elicitInput` throws before making
    // any request — no InMemoryTransport/Client pairing needed. This test
    // exercises the *real* installed SDK, not a mock, so an SDK upgrade that
    // rewords the message fails this test instead of silently breaking
    // `requestCheckoutConfirmation`'s capability-absent detection.
    const server = new Server({ name: "elicitation-pin-test", version: "0.0.0" });

    await expect(
      server.elicitInput({
        message: "test",
        requestedSchema: {
          type: "object",
          properties: { confirm: { type: "boolean" } },
        },
      }),
    ).rejects.toThrow(ELICITATION_UNSUPPORTED_MESSAGE);
  });
});

describe("requestCheckoutConfirmation", () => {
  function modernContext(
    inputResponses?: Record<string, unknown>,
    clientCapabilities?: Record<string, unknown>,
  ): ServerContext {
    return {
      mcpReq: {
        envelope: clientCapabilities ? { [CLIENT_CAPABILITIES_META_KEY]: clientCapabilities } : {},
        inputResponses,
      },
    } as unknown as ServerContext;
  }

  function elicitingContext(inputResponses?: Record<string, unknown>): ServerContext {
    return modernContext(inputResponses, { elicitation: { form: {} } });
  }

  describe("MCP 2.0 stateless elicitation", () => {
    it("returns input_required before a confirmation response is available", async () => {
      const elicitInput = vi.fn();
      const result = await requestCheckoutConfirmation(
        { elicitInput },
        [{ productName: "Milk", quantity: 1 }],
        elicitingContext(),
      );

      expect(isInputRequiredResult(result)).toBe(true);
      expect(elicitInput).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        inputRequests: {
          checkout_confirmation: {
            method: "elicitation/create",
            params: { message: expect.stringContaining("Milk x1") },
          },
        },
      });
    });

    it("accepts a validated confirmation from the retried request", async () => {
      const result = await requestCheckoutConfirmation(
        { elicitInput: vi.fn() },
        [{ productName: "Milk", quantity: 1 }],
        modernContext({
          checkout_confirmation: { action: "accept", content: { confirm: true } },
        }),
      );

      expect(isInputRequiredResult(result)).toBe(false);
      if (isInputRequiredResult(result)) throw new Error("expected confirmation result");
      expect(result.isOk()).toBe(true);
    });

    it("rejects a declined confirmation from the retried request", async () => {
      const result = await requestCheckoutConfirmation(
        { elicitInput: vi.fn() },
        [{ productName: "Milk", quantity: 1 }],
        modernContext({ checkout_confirmation: { action: "decline" } }),
      );

      expect(isInputRequiredResult(result)).toBe(false);
      if (isInputRequiredResult(result)) throw new Error("expected confirmation result");
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain("cancelled");
    });

    it("proceeds (ok) when the envelope is present but the client did not declare elicitation", async () => {
      const elicitInput = vi.fn();
      const result = await requestCheckoutConfirmation(
        { elicitInput },
        [{ productName: "Milk", quantity: 1 }],
        modernContext(),
      );

      expect(isInputRequiredResult(result)).toBe(false);
      if (isInputRequiredResult(result)) throw new Error("expected confirmation result");
      expect(result.isOk()).toBe(true);
      expect(elicitInput).not.toHaveBeenCalled();
    });

    it("treats a bare elicitation: {} declaration as form support", async () => {
      const result = await requestCheckoutConfirmation(
        { elicitInput: vi.fn() },
        [{ productName: "Milk", quantity: 1 }],
        modernContext(undefined, { elicitation: {} }),
      );

      expect(isInputRequiredResult(result)).toBe(true);
    });

    it("does not request form elicitation from a URL-only client", async () => {
      const result = await requestCheckoutConfirmation(
        { elicitInput: vi.fn() },
        [{ productName: "Milk", quantity: 1 }],
        modernContext(undefined, { elicitation: { url: {} } }),
      );

      expect(isInputRequiredResult(result)).toBe(false);
      if (isInputRequiredResult(result)) throw new Error("expected confirmation result");
      expect(result.isOk()).toBe(true);
    });
  });

  describe("clientSupportsFormElicitation", () => {
    it("is false when the envelope has no clientCapabilities", () => {
      expect(clientSupportsFormElicitation(modernContext())).toBe(false);
    });

    it("is true when elicitation.form is declared", () => {
      expect(clientSupportsFormElicitation(elicitingContext())).toBe(true);
    });
  });

  describe("elicitation not supported by client", () => {
    it("proceeds (ok) when the client does not support form elicitation", async () => {
      const result = await requestCheckoutConfirmation(
        {
          elicitInput: vi
            .fn()
            .mockRejectedValue(new Error("Client does not support form elicitation.")),
        },
        [{ productName: "Milk", quantity: 1 }],
      );

      expect(result.isOk()).toBe(true);
    });
  });

  describe("elicitation errors", () => {
    it("returns an error when elicitation fails unexpectedly", async () => {
      const result = await requestCheckoutConfirmation(
        {
          elicitInput: vi.fn().mockRejectedValue(new Error("network timeout")),
        },
        [{ productName: "Milk", quantity: 1 }],
      );

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain("unexpectedly");
    });
  });

  describe("user declines or cancels", () => {
    it("returns an error when the user declines confirmation", async () => {
      const result = await requestCheckoutConfirmation(
        {
          elicitInput: vi.fn().mockResolvedValue({ action: "decline" }),
        },
        [{ productName: "Milk", quantity: 1 }],
      );

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain("cancelled");
    });

    it("returns an error when the user cancels the elicitation dialog", async () => {
      const result = await requestCheckoutConfirmation(
        {
          elicitInput: vi.fn().mockResolvedValue({ action: "cancel" }),
        },
        [{ productName: "Milk", quantity: 1 }],
      );

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain("cancelled");
    });

    it("returns an error when action is accept but confirm is explicitly false", async () => {
      const result = await requestCheckoutConfirmation(
        {
          elicitInput: vi.fn().mockResolvedValue({ action: "accept", content: { confirm: false } }),
        },
        [{ productName: "Milk", quantity: 1 }],
      );

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain("cancelled");
    });
  });

  describe("user confirms", () => {
    it("returns ok when the user accepts with confirm set to true", async () => {
      const result = await requestCheckoutConfirmation(
        {
          elicitInput: vi.fn().mockResolvedValue({ action: "accept", content: { confirm: true } }),
        },
        [{ productName: "Milk", quantity: 1 }],
      );

      expect(result.isOk()).toBe(true);
    });

    it("returns ok when the user accepts without providing a content field", async () => {
      const result = await requestCheckoutConfirmation(
        {
          elicitInput: vi.fn().mockResolvedValue({ action: "accept" }),
        },
        [{ productName: "Milk", quantity: 1 }],
      );

      expect(result.isOk()).toBe(true);
    });
  });

  describe("elicitInput message content", () => {
    it("calls elicitInput with the item count and formatted item list", async () => {
      const mockElicit = vi
        .fn()
        .mockResolvedValue({ action: "accept", content: { confirm: true } });

      await requestCheckoutConfirmation({ elicitInput: mockElicit }, [
        { productName: "Milk", quantity: 1 },
        { productName: "Bread", quantity: 2 },
      ]);

      expect(mockElicit).toHaveBeenCalledOnce();
      const [call] = mockElicit.mock.calls;
      const message: string = (call as [{ message: string }])[0].message;
      expect(message).toContain("2 item(s)");
      expect(message).toContain("Milk x1");
      expect(message).toContain("Bread x2");
    });

    it("calls elicitInput with a single item count when one item is present", async () => {
      const mockElicit = vi
        .fn()
        .mockResolvedValue({ action: "accept", content: { confirm: true } });

      await requestCheckoutConfirmation({ elicitInput: mockElicit }, [
        { productName: "Eggs", quantity: 12 },
      ]);

      const [call] = mockElicit.mock.calls;
      const message: string = (call as [{ message: string }])[0].message;
      expect(message).toContain("1 item(s)");
      expect(message).toContain("Eggs x12");
    });
  });
});
