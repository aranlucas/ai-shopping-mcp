import type { TransportState } from "agents/mcp";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createMcpTransportStorage } from "../src/mcp-transport-storage.js";

const SESSION_ID = "4ba02f07-0f73-4c35-a348-67240e1a16fb";
const STATE: TransportState = {
  sessionId: SESSION_ID,
  initialized: true,
  initializeParams: {
    capabilities: {},
    clientInfo: { name: "transport-test", version: "1.0.0" },
    protocolVersion: "2025-06-18",
  },
};

function makeKv() {
  const values = new Map<string, string>();
  return {
    values,
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    put: vi.fn(
      async (key: string, value: string, _options?: KVNamespacePutOptions): Promise<void> => {
        values.set(key, value);
      },
    ),
  };
}

describe("MCP transport storage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("persists validated state for seven days and restores it for the same user", async () => {
    const kv = makeKv();
    const storage = createMcpTransportStorage(kv, SESSION_ID, () => "user/123");

    await storage.set(STATE);

    expect(kv.put).toHaveBeenCalledOnce();
    const putCall = kv.put.mock.calls[0];
    expect(putCall?.[0]).toBe(
      `mcp_transport:user:${encodeURIComponent("user/123")}:session:${SESSION_ID}`,
    );
    expect(JSON.parse(putCall?.[1] ?? "null")).toEqual(STATE);
    expect(putCall?.[2]).toEqual({ expirationTtl: 604_800 });
    await expect(storage.get()).resolves.toEqual(STATE);
  });

  it("does not restore another user's session", async () => {
    const kv = makeKv();
    await createMcpTransportStorage(kv, SESSION_ID, () => "user-a").set(STATE);

    await expect(
      createMcpTransportStorage(kv, SESSION_ID, () => "user-b").get(),
    ).resolves.toBeUndefined();
  });

  it("fails closed for invalid session ids without reading KV", async () => {
    const kv = makeKv();

    await expect(
      createMcpTransportStorage(kv, "attacker-controlled", () => "user-a").get(),
    ).resolves.toBeUndefined();
    expect(kv.get).not.toHaveBeenCalled();
  });

  it("discards malformed persisted state", async () => {
    const kv = makeKv();
    kv.values.set(`mcp_transport:user:user-a:session:${SESSION_ID}`, "not-json");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      createMcpTransportStorage(kv, SESSION_ID, () => "user-a").get(),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      "Discarding invalid MCP transport state:",
      expect.any(String),
    );
  });

  it("discards persisted state whose session id does not match its key", async () => {
    const kv = makeKv();
    kv.values.set(
      `mcp_transport:user:user-a:session:${SESSION_ID}`,
      JSON.stringify({ ...STATE, sessionId: "db8cf958-27f5-44c9-9329-1fd467633947" }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      createMcpTransportStorage(kv, SESSION_ID, () => "user-a").get(),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      "Discarding MCP transport state with a mismatched session id",
    );
  });
});
