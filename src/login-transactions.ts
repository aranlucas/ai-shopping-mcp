import { DurableObject } from "cloudflare:workers";
import type { AuthIdentity, OidcTransaction } from "./services/better-auth.js";

export type LoginTransaction =
  | OidcTransaction
  | { type: "kroger"; identity: AuthIdentity };

type StoredLogin = {
  data: LoginTransaction;
  binding: string;
  expiresAt: number;
};

/** A random state identifies one browser-bound, single-use redirect transaction. */
export class LoginTransactions extends DurableObject<Env> {
  async begin(data: LoginTransaction, binding: string): Promise<void> {
    const expiresAt = Date.now() + 600_000;
    await this.ctx.storage.put("login", { data, binding, expiresAt });
    await this.ctx.storage.setAlarm(expiresAt);
  }
  async consume(binding: string): Promise<LoginTransaction | null> {
    return this.ctx.storage.transaction(async (txn) => {
      const stored = await txn.get<StoredLogin>("login");

      if (
        !stored ||
        stored.binding !== binding ||
        stored.expiresAt <= Date.now()
      )
        return null;
      await txn.delete("login");

      return stored.data;
    });
  }
  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}
