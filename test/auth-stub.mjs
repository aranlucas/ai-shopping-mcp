import { WorkerEntrypoint } from "cloudflare:workers";

// Test-only state and control surface; never bundled into the shopping Worker.
/** @typedef {{ accessToken: string, expiresAt: number }} Token */
/** @param {unknown} body */
function parseSeed(body) {
  if (
    body === null ||
    typeof body !== "object" ||
    !("userId" in body) ||
    typeof body.userId !== "string" ||
    !("token" in body)
  ) {
    throw new Error("Invalid auth seed");
  }

  const token = body.token;

  if (token === null) {
    return { userId: body.userId, token: null };
  }

  if (
    typeof token !== "object" ||
    !("accessToken" in token) ||
    typeof token.accessToken !== "string" ||
    !("expiresAt" in token) ||
    typeof token.expiresAt !== "number"
  ) {
    throw new Error("Invalid auth token seed");
  }

  return {
    userId: body.userId,
    token: { accessToken: token.accessToken, expiresAt: token.expiresAt },
  };
}

/** @type {Map<string, Token>} */
const accounts = new Map();

let active = 0;

let maxActive = 0;

/** @type {string[]} */
let calls = [];

let fail = false;

export class KrogerTokens extends WorkerEntrypoint {
  /** @param {string} userId */
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

  /** @param {Request} request */
  async fetch(request) {
    const path = new URL(request.url).pathname;

    if (path === "/reset") {
      accounts.clear();
      calls = [];
      maxActive = 0;
      fail = false;
    } else if (path === "/seed") {
      const { userId, token } = parseSeed(await request.json());

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
