import { DurableObject } from "cloudflare:workers";
import { z } from "zod/v4";
import type { AppEnv } from "./env.js";
import {
  isKrogerTokenExpiring,
  refreshKrogerToken,
  type KrogerTokenInfo,
} from "./services/kroger/client.js";

const connectionSchema = z.object({
  krogerId: z.string().min(1),
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  tokenExpiresAt: z.number().finite().positive(),
});

export type KrogerConnection = z.infer<typeof connectionSchema>;

export type KrogerConnectionStatus =
  | "connected"
  | "not_connected"
  | "reconnect_required";

export type KrogerTokenState =
  | { status: "connected"; token: KrogerTokenInfo }
  | { status: "not_connected" | "reconnect_required" };

type StoredConnection = {
  connection: KrogerConnection;
  refreshPending: boolean;
};

/** One credential owner per auth user serializes Kroger's single-use refresh tokens. */
export class KrogerConnections extends DurableObject<AppEnv> {
  async saveConnection(input: KrogerConnection): Promise<boolean> {
    const connection = connectionSchema.parse(input);

    return this.ctx.blockConcurrencyWhile(async () => {
      const existing =
        await this.ctx.storage.get<StoredConnection>("connection");

      if (existing && existing.connection.krogerId !== connection.krogerId)
        return false;
      await this.ctx.storage.put("connection", {
        connection,
        refreshPending: false,
      });

      return true;
    });
  }
  async getToken(): Promise<KrogerTokenState> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get<StoredConnection>("connection");

      if (!stored) return { status: "not_connected" };

      if (stored.refreshPending) return { status: "reconnect_required" };
      let connection = stored.connection;

      if (isKrogerTokenExpiring(connection.tokenExpiresAt)) {
        // Persist before sending: after a crash or ambiguous response we never reuse this token.
        await this.ctx.storage.put("connection", {
          connection,
          refreshPending: true,
        });

        const result = await refreshKrogerToken(
          connection.refreshToken,
          this.env.KROGER_CLIENT_ID,
          this.env.KROGER_CLIENT_SECRET,
        );

        if (result.isErr() || !result.value.refreshToken)
          return { status: "reconnect_required" };
        connection = {
          krogerId: connection.krogerId,
          ...result.value,
          refreshToken: result.value.refreshToken,
        };
        await this.ctx.storage.put("connection", {
          connection,
          refreshPending: false,
        });
      }

      return {
        status: "connected",
        token: {
          accessToken: connection.accessToken,
          tokenExpiresAt: connection.tokenExpiresAt,
        },
      };
    });
  }
}
