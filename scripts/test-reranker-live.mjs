import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const MODEL = "@cf/baai/bge-reranker-base";
const REQUEST = {
  query: "whole milk",
  contexts: [
    {
      text: "Chocolate Milk Bar | Hershey's | 1.5 oz | Candy, Snacks | regular=$1.49 | stock=HIGH | curbside=true | instore=true | delivery=false",
    },
    {
      text: "Whole Milk | Kroger | 1 gal | Dairy | regular=$4.99 | stock=HIGH | curbside=true | instore=true | delivery=false",
    },
  ],
  top_k: 2,
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function configPaths() {
  const home = homedir();
  const paths = [
    process.env.WRANGLER_CONFIG_PATH,
    process.platform === "darwin" &&
      join(home, "Library/Preferences/.wrangler/config/default.toml"),
    process.env.XDG_CONFIG_HOME &&
      join(process.env.XDG_CONFIG_HOME, ".wrangler/config/default.toml"),
    join(home, ".config/.wrangler/config/default.toml"),
    join(home, ".wrangler/config/default.toml"),
  ];

  return paths.filter((path) => typeof path === "string");
}

async function readWranglerOAuthToken() {
  for (const path of configPaths()) {
    try {
      await access(path);
      const config = await readFile(path, "utf8");
      const token = /^oauth_token\s*=\s*"([^"]+)"/m.exec(config)?.[1];
      if (token) return token;
    } catch {
      // Try the next standard Wrangler config location.
    }
  }

  throw new Error(
    "No Cloudflare credentials found. Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID for CI, or run `wrangler login` locally.",
  );
}

async function cloudflareJson(url, token, init) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const body = await response.json().catch(() => null);
  assert(response.ok, `Cloudflare request failed with HTTP ${response.status}.`);
  assert(body && typeof body === "object", "Cloudflare returned a non-JSON response.");
  return body;
}

async function credentials() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (token || accountId) {
    assert(
      token && accountId,
      "Set both CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID when using environment credentials.",
    );
    return { token, accountId };
  }

  const oauthToken = await readWranglerOAuthToken();
  const accounts = await cloudflareJson(
    "https://api.cloudflare.com/client/v4/accounts",
    oauthToken,
  );
  assert(
    accounts.success === true && Array.isArray(accounts.result),
    "Could not list Cloudflare accounts.",
  );
  assert(
    accounts.result.length === 1 && typeof accounts.result[0]?.id === "string",
    "Wrangler OAuth can access multiple accounts. Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN explicitly.",
  );
  return { token: oauthToken, accountId: accounts.result[0].id };
}

function assertRanking(body) {
  assert(body.success === true, "Workers AI reported an unsuccessful response.");
  const ranking = body.result?.response;
  assert(
    Array.isArray(ranking) && ranking.length === REQUEST.contexts.length,
    "Expected a complete ranking.",
  );

  const ids = ranking.map((entry) => entry?.id);
  assert(
    ids.every((id) => Number.isInteger(id)) && new Set(ids).size === ids.length,
    "Ranking ids must be unique integers.",
  );
  assert(
    ids.every((id) => id >= 0 && id < REQUEST.contexts.length),
    "Ranking contains an out-of-range context id.",
  );
  assert(
    ranking.every((entry) => typeof entry?.score === "number"),
    "Ranking scores must be numbers.",
  );
  assert(ids[0] === 1, "Expected Whole Milk to rank ahead of Chocolate Milk Bar.");
}

async function main() {
  const { token, accountId } = await credentials();
  const body = await cloudflareJson(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${MODEL}`,
    token,
    { method: "POST", body: JSON.stringify(REQUEST) },
  );

  assertRanking(body);
  const [winner, runnerUp] = body.result.response;
  console.log(
    `Live reranker passed: Whole Milk (score=${winner.score}) > Chocolate Milk Bar (score=${runnerUp.score}).`,
  );
}

main().catch((error) => {
  console.error(`Live reranker failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
