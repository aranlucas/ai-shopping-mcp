import { WorkerEntrypoint } from "cloudflare:workers";

// Test-only state and control surface; never bundled into the shopping Worker.
const accounts = new Map();

let active = 0;

let maxActive = 0;

let calls = [];

let fail = false;

export class KrogerTokens extends WorkerEntrypoint {
  async accessToken(userId) {
    calls.push(userId);
    active++;
    maxActive = Math.max(maxActive, active);

    try {
      await scheduler.wait(5);

      if (fail) {
        throw new Error("Auth service unavailable");
      }

      return accounts.get(userId) ?? null;
    } finally {
      active--;
    }
  }

  async fetch(request) {
    const path = new URL(request.url).pathname;

    if (path === "/reset") {
      accounts.clear();
      calls = [];
      maxActive = 0;
      fail = false;
    } else if (path === "/seed") {
      const { userId, token } = await request.json();

      if (token === null) {
        accounts.delete(userId);
      } else {
        accounts.set(userId, token);
      }
    } else if (path === "/fail") {
      fail = true;
    } else if (path === "/stats") {
      return Response.json({ calls, maxActive });
    } else {
      return new Response(null, { status: 404 });
    }

    return new Response(null, { status: 204 });
  }
}

const authStubWorker = {
  fetch() {
    return new Response(null, { status: 404 });
  },
};

export default authStubWorker;
