import { describe, expect, it } from "vitest";
import { encode } from "@toon-format/toon";
import { apiError, networkError, storageError } from "../src/errors.js";
import { toonResource } from "../src/utils/toon.js";
import {
  authRequestSchema,
  parseRedirectApproval,
  renderApprovalDialog,
  type ApprovalDialogOptions,
} from "../src/workers-oauth-utils.js";

function hiddenInput(html: string, name: string): string {
  const match = html.match(new RegExp(`name="${name}" value="([^"]+)"`));

  if (!match?.[1]) throw new Error(`Missing ${name}`);

  return match[1];
}

async function approvalRequest(
  state: ApprovalDialogOptions["state"],
  tamper = false,
) {
  const page = renderApprovalDialog(
    new Request("https://worker.test/authorize"),
    {
      client: null,
      server: { name: "Boundary test" },
      state,
    },
  );

  const html = await page.text();

  return new Request("https://worker.test/authorize", {
    method: "POST",
    headers: {
      Cookie: page.headers
        .getSetCookie()
        .map((cookie) => cookie.split(";")[0])
        .join("; "),
    },
    body: new URLSearchParams({
      state: hiddenInput(html, "state"),
      csrf_token: tamper ? "mismatch" : hiddenInput(html, "csrf_token"),
    }),
  });
}

describe("opaque infrastructure contracts", () => {
  it("retains arbitrary error objects and arrays by identity", () => {
    const object = { future: { nested: [null, "value"] } };
    const array = [object, new Error("nested")];

    for (const cause of [object, array, new Date("2026-01-01")]) {
      expect(apiError("api", cause).detail).toBe(cause);
      expect(networkError("network", cause).cause).toBe(cause);
      expect(storageError("storage", cause).cause).toBe(cause);
    }

    for (const cause of [42, false, 123n, Symbol("cause")]) {
      expect(networkError("network", cause).cause).toBe(String(cause));
    }

    expect(networkError("network", null).cause).toBeUndefined();
    expect(Object.hasOwn(apiError("api"), "detail")).toBe(true);
    expect(Object.hasOwn(apiError("api"), "status")).toBe(true);
  });

  it("delegates arbitrary TOON input values without normalization", () => {
    for (const value of [
      null,
      undefined,
      false,
      42,
      "text",
      [1, { extra: true }],
      { omitted: undefined, explicit: null, future: ["v"] },
    ]) {
      expect(toonResource("shopping://synthetic", value).contents[0].text).toBe(
        encode(value),
      );
    }
  });

  it("round-trips opaque OAuth extensions and special own keys without changing bytes", async () => {
    const state: ApprovalDialogOptions["state"] = JSON.parse(
      '{"__proto__":{"future":true},"constructor":"opaque","prototype":[1],"oauthReqInfo":{"clientId":"test-client","redirectUri":"https://client.example/callback","scope":["read","write"],"future":{"nested":true},"__proto__":{"nested":true}},"extension":{"items":[null,{"value":2}]}}',
    );

    const serialized = JSON.stringify(state);

    const result = await parseRedirectApproval(
      await approvalRequest(state),
      "synthetic-signing-secret",
    );

    expect(JSON.stringify(result.state)).toBe(serialized);
    expect(Object.hasOwn(result.state, "__proto__")).toBe(true);
    expect(result.headers.getSetCookie().length).toBeGreaterThan(0);
  });

  it("retains the original validated auth request and its opaque extensions", () => {
    const request = {
      ["__proto__"]: { future: true },
      constructor: "opaque",
      prototype: [1],
      future: { nested: [null, "extension"] },
      responseType: "code",
      clientId: "test-client",
      redirectUri: "https://client.example/callback",
      scope: ["read"],
      state: "synthetic-state",
      codeChallenge: undefined,
    };

    const result = authRequestSchema.parse(request);
    expect(result).toBe(request);
    expect(result.future).toBe(request.future);
    expect(JSON.stringify(result)).toBe(JSON.stringify(request));
    expect(Object.hasOwn(result, "__proto__")).toBe(true);
    expect(Object.hasOwn(result, "codeChallenge")).toBe(true);
    expect(Object.hasOwn(result, "resource")).toBe(false);

    for (const invalid of [
      { ...request, clientId: 42 },
      { ...request, scope: [42] },
      { ...request, redirectUri: null },
      { ...request, codeChallenge: false },
    ]) {
      expect(authRequestSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("rejects mismatched CSRF and malformed approval details before granting approval", async () => {
    const state = {
      oauthReqInfo: {
        clientId: "test-client",
        redirectUri: "https://client.example/callback",
        scope: "read",
      },
      future: { untouched: true },
    };

    await expect(
      parseRedirectApproval(
        await approvalRequest(state, true),
        "synthetic-signing-secret",
      ),
    ).rejects.toThrow("Failed to parse approval form");
    await expect(
      parseRedirectApproval(
        await approvalRequest({
          oauthReqInfo: {
            clientId: 42,
            redirectUri: "https://client.example/callback",
          },
        }),
        "synthetic-signing-secret",
      ),
    ).rejects.toThrow("Failed to parse approval form");
  });
});
