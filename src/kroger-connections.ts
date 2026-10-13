import { DurableObject } from "cloudflare:workers";
import { z } from "zod/v4";
import type { AppEnv } from "./env.js";
import type { KrogerTokenInfo } from "./services/kroger/client.js";

const tokenSchema = z.object({
  accessToken: z.string().min(1),
  expiresAt: z.number().finite().positive(),
});

export type KrogerTokenState =
  | { status: "connected"; token: KrogerTokenInfo }
  | { status: "not_connected" };

/** Serializes Auth token requests per verified user, without storing credentials. */
export class KrogerConnections extends DurableObject<AppEnv> {
  async getToken(userId: string): Promise<KrogerTokenState> {
    z.string().min(1).max(256).parse(userId);

    const outcome = await this.ctx.blockConcurrencyWhile(
      async (): Promise<{ state: KrogerTokenState } | { error: unknown }> => {
        try {
          const result = await this.env.AUTH.accessToken(userId);

          if (result === null) {
            return { state: { status: "not_connected" } };
          }

          const token = tokenSchema.parse(result);

          if (token.expiresAt <= Date.now()) {
            throw new Error("Auth returned an expired Kroger token");
          }

          return {
            state: {
              status: "connected",
              token: {
                accessToken: token.accessToken,
                tokenExpiresAt: token.expiresAt,
              },
            },
          };
        } catch (error) {
          // Re-throw outside the input gate so an Auth outage does not reset this object.
          return { error };
        }
      },
    );

    if ("error" in outcome) {
      throw outcome.error;
    }

    return outcome.state;
  }
}
