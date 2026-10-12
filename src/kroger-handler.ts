import { exports } from "cloudflare:workers";
import { Hono } from "hono";
import { generateCookie } from "hono/cookie";
import { parse } from "hono/utils/cookie";
import { base64url } from "jose";
import { createAuthorizationURL } from "better-auth/oauth2";
import { z } from "zod/v4";
import type { AppEnv } from "./env.js";
import type { LoginTransaction } from "./login-transactions.js";
import {
  browserClient,
  discovery,
  exchangeIdentity,
} from "./services/better-auth.js";
import { krogerTokenResponseSchema } from "./services/kroger/client.js";
import { isVerifiedShopperId } from "./utils/shopper-identity.js";

const app = new Hono<{ Bindings: AppEnv }>();

app.use(async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "Lax" as const,
  path: "/",
};

const cookieName = (state: string) => `__Host-shopping-link-${state}`;

async function bindingHash(value: string) {
  return base64url.encode(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  );
}

async function beginTransaction(
  data: LoginTransaction,
  headers = new Headers(),
) {
  const state = crypto.randomUUID();
  const binding = crypto.randomUUID();
  await exports.LoginTransactions.getByName(state).begin(
    data,
    await bindingHash(binding),
  );
  headers.append(
    "Set-Cookie",
    generateCookie(cookieName(state), binding, {
      ...cookieOptions,
      maxAge: 600,
    }),
  );
  headers.set("Cache-Control", "no-store");

  return { state, headers };
}

async function resumeTransaction(request: Request) {
  const state = z
    .uuid()
    .safeParse(new URL(request.url).searchParams.get("state"));

  if (!state.success) return null;
  const cookie = request.headers.get("Cookie");

  // Hono's parser reads browser cookies without accepting query parameters as identity.
  const binding = cookie
    ? parse(cookie, cookieName(state.data))[cookieName(state.data)]
    : undefined;

  if (!binding) return null;

  const data = await exports.LoginTransactions.getByName(state.data).consume(
    await bindingHash(binding),
  );

  if (!data) return null;
  const headers = new Headers({ "Cache-Control": "no-store" });
  headers.append(
    "Set-Cookie",
    generateCookie(cookieName(state.data), "", { ...cookieOptions, maxAge: 0 }),
  );

  return { data, headers };
}

app.get("/connect/kroger", async (c) => {
  const client = browserClient(c.env);
  const metadata = await discovery(c.env);
  const verifier = crypto.randomUUID() + crypto.randomUUID();
  const nonce = crypto.randomUUID();
  const redirectUri = new URL("/auth/callback", c.env.MCP_RESOURCE_URL).href;

  const transaction = await beginTransaction({
    type: "auth",
    verifier,
    nonce,
    redirectUri,
  });

  const url = await createAuthorizationURL({
    id: "shared-auth",
    options: { clientId: client.BETTER_AUTH_CLIENT_ID },
    authorizationEndpoint: metadata.authorization_endpoint,
    redirectURI: redirectUri,
    scopes: ["openid", "mcp:tools"],
    additionalParams: { resource: c.env.MCP_RESOURCE_URL },
    state: transaction.state,
    nonce,
    codeVerifier: verifier,
  });

  transaction.headers.set("Location", url.href);

  return new Response(null, { status: 302, headers: transaction.headers });
});

app.get("/auth/callback", async (c) => {
  const resumed = await resumeTransaction(c.req.raw);

  if (!resumed || resumed.data.type !== "auth")
    return c.text(
      "Invalid or expired sign-in. Start connecting Kroger again.",
      400,
    );

  if (c.req.query("error"))
    return new Response(
      "Sign-in was declined. Start connecting Kroger again.",
      { status: 400, headers: resumed.headers },
    );
  const code = c.req.query("code");

  if (!code)
    return new Response("Missing sign-in code.", {
      status: 400,
      headers: resumed.headers,
    });
  let identity;

  try {
    identity = await exchangeIdentity(c.env, code, resumed.data);
  } catch (error) {
    console.error(
      "Shared sign-in verification failed",
      error instanceof Error ? error.name : "unknown",
    );

    return new Response(
      "Unable to verify shared sign-in. Start connecting Kroger again.",
      { status: 502, headers: resumed.headers },
    );
  }

  const next = await beginTransaction(
    { type: "kroger", identity },
    resumed.headers,
  );

  const redirectUri = new URL("/callback", c.env.MCP_RESOURCE_URL).href;
  // Kroger requires spaces as %20, rather than URLSearchParams' + encoding.
  next.headers.set(
    "Location",
    "https://api.kroger.com/v1/connect/oauth2/authorize?" +
      `response_type=code&client_id=${encodeURIComponent(c.env.KROGER_CLIENT_ID)}` +
      `&scope=${encodeURIComponent("profile.compact cart.basic:write product.compact")}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(next.state)}`,
  );

  return new Response(null, { status: 302, headers: next.headers });
});

const profileSchema = z.object({
  data: z.object({ id: z.string().refine(isVerifiedShopperId) }),
});

app.get("/callback", async (c) => {
  const resumed = await resumeTransaction(c.req.raw);

  if (!resumed || resumed.data.type !== "kroger")
    return c.text("Invalid or expired Kroger connection. Start again.", 400);

  if (c.req.query("error"))
    return new Response(
      "Kroger access was declined. Start connecting Kroger again.",
      { status: 400, headers: resumed.headers },
    );
  const code = c.req.query("code");

  if (!code)
    return new Response("Missing Kroger authorization code.", {
      status: 400,
      headers: resumed.headers,
    });

  const response = await fetch(
    "https://api.kroger.com/v1/connect/oauth2/token",
    {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${c.env.KROGER_CLIENT_ID}:${c.env.KROGER_CLIENT_SECRET}`)}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: new URL("/callback", c.env.MCP_RESOURCE_URL).href,
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );

  const parsed = krogerTokenResponseSchema.safeParse(await response.json());

  if (
    !response.ok ||
    !parsed.success ||
    !parsed.data.access_token ||
    !parsed.data.refresh_token ||
    !parsed.data.expires_in ||
    parsed.data.expires_in <= 0
  )
    return new Response(
      "Kroger authorization failed. Start connecting Kroger again.",
      { status: 502, headers: resumed.headers },
    );
  const token = parsed.data;

  const profileResponse = await fetch(
    "https://api.kroger.com/v1/identity/profile",
    {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        Accept: "application/json",
      },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    },
  );

  const profile = profileSchema.safeParse(await profileResponse.json());

  if (!profileResponse.ok || !profile.success)
    return new Response("Unable to verify your Kroger shopper. Start again.", {
      status: 502,
      headers: resumed.headers,
    });

  const connected = await exports.KrogerConnections.getByName(
    resumed.data.identity.id,
  ).saveConnection({
    krogerId: profile.data.data.id,
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token,
    tokenExpiresAt: Date.now() + parsed.data.expires_in * 1000,
  });

  if (!connected)
    return new Response(
      "This shared-auth account is already linked to another Kroger shopper. Reconnect the same Kroger account.",
      { status: 409, headers: resumed.headers },
    );

  return new Response(
    "Kroger is connected. Return to your AI client and retry your shopping request.",
    { headers: resumed.headers },
  );
});

app.get("/", (c) =>
  c.text(
    "Shopping MCP: connect your AI client to /mcp. Use /connect/kroger to link Kroger through shared sign-in.",
  ),
);

app.onError((error, c) => {
  console.error("Kroger connection unavailable", error.name);

  return c.text("Connection service unavailable. Please try again.", 503);
});

export const KrogerWorker = {
  fetch(request: Request, env: AppEnv, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<AppEnv>;

export { app as KrogerHandler };
