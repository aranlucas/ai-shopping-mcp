import { InitializeRequestParamsSchema } from "@modelcontextprotocol/sdk/types.js";
import type { TransportState } from "agents/mcp";
import * as z from "zod/v4";

import type { PersistenceKv } from "./utils/kv.js";
import { safeJsonParseWithSchema } from "./utils/json.js";

const MCP_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const transportSessionIdSchema = z.uuid();
const transportStateSchema = z.object({
  sessionId: transportSessionIdSchema.optional(),
  initialized: z.boolean(),
  initializeParams: InitializeRequestParamsSchema.optional(),
});

type TransportStateKv = Pick<PersistenceKv, "get" | "put">;

function transportStateKey(userId: string, sessionId: string): string {
  return `mcp_transport:user:${encodeURIComponent(userId)}:session:${sessionId}`;
}

/**
 * Persists the Agents SDK's minimal protocol state for one authenticated MCP
 * session. The user id is resolved lazily because `getMcpAuthContext()` is only
 * populated while `createMcpHandler` is handling the request.
 */
export function createMcpTransportStorage(
  kv: TransportStateKv,
  requestedSessionId: string | undefined,
  getUserId: () => string,
) {
  return {
    get: async (): Promise<TransportState | undefined> => {
      const sessionId = transportSessionIdSchema.safeParse(requestedSessionId);
      if (!sessionId.success) return undefined;

      const key = transportStateKey(getUserId(), sessionId.data);
      const value = await kv.get(key);
      if (value == null) return undefined;

      const state = safeJsonParseWithSchema(value, transportStateSchema);
      if (state.isErr()) {
        console.warn("Discarding invalid MCP transport state:", state.error.message);
        return undefined;
      }
      if (state.value.sessionId !== sessionId.data) {
        console.warn("Discarding MCP transport state with a mismatched session id");
        return undefined;
      }

      return state.value;
    },
    set: async (state: TransportState): Promise<void> => {
      const parsed = transportStateSchema.safeParse(state);
      if (!parsed.success || !parsed.data.sessionId) {
        throw new Error("Cannot persist invalid MCP transport state");
      }

      await kv.put(
        transportStateKey(getUserId(), parsed.data.sessionId),
        JSON.stringify(parsed.data),
        { expirationTtl: MCP_SESSION_TTL_SECONDS },
      );
    },
  };
}
