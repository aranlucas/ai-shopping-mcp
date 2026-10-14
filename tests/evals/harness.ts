import { z } from "zod";
/**
 * Shared harness for the small-model MCP evals.
 *
 * Drives the real Worker end-to-end with an issuer-signed Better Auth fixture
 * token through `SELF`, then a real MCP client over
 * `StreamableHTTPClientTransport`. The Kroger API (token, identity, products,
 * locations, cart) is served from deterministic fixtures by a global fetch
 * stub, so evals measure the actual wire payloads a host model would see —
 * tool list, content text, structuredContent — without hitting Kroger.
 */
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { SELF, env } from "cloudflare:test";
import { vi } from "vitest";
import { ensureShoppingSchema } from "../d1-schema.js";
import { fixtureJwks, fixtureToken, seedKrogerConnection } from "../better-auth-fixture.js";

type CapturedCartPut = { items: CapturedCartItem[] };

const MCP_URL = env.MCP_RESOURCE_URL;

// ---------------------------------------------------------------------------
// Kroger API fixtures
// ---------------------------------------------------------------------------

type FixtureProductSpec = {
  upc: string;
  description: string;
  brand: string;
  size: string;
  regular: number;
  promo?: number;
  pickup: boolean;
  aisle?: string;
};

/**
 * Deterministic product catalog keyed by search term. Every term a scenario
 * uses must resolve here; unknown terms get a generic synthesized product so
 * live-model runs can search freely. Terms starting with "zzz" return no
 * results (for not-found paths).
 */
const FIXTURE_CATALOG = {
  milk: [
    {
      upc: "0001111041700",
      description: "Kroger 2% Reduced Fat Milk",
      brand: "Kroger",
      size: "1 gal",
      regular: 3.99,
      promo: 3.49,
      pickup: true,
      aisle: "D4",
    },
    {
      upc: "0001111042850",
      description: "Kroger Vitamin D Whole Milk",
      brand: "Kroger",
      size: "1 gal",
      regular: 4.19,
      pickup: true,
      aisle: "D4",
    },
    {
      upc: "0081121202230",
      description: "Fairlife 2% Ultra-Filtered Milk",
      brand: "Fairlife",
      size: "52 fl oz",
      regular: 4.79,
      pickup: false,
      aisle: "D4",
    },
  ],
  eggs: [
    {
      upc: "0001111060933",
      description: "Kroger Grade A Large Eggs",
      brand: "Kroger",
      size: "12 ct",
      regular: 2.99,
      pickup: true,
      aisle: "D2",
    },
    {
      upc: "0071514171012",
      description: "Vital Farms Pasture-Raised Large Eggs",
      brand: "Vital Farms",
      size: "12 ct",
      regular: 7.49,
      promo: 6.99,
      pickup: true,
      aisle: "D2",
    },
  ],
  bread: [
    {
      upc: "0001111008728",
      description: "Kroger Round Top White Bread",
      brand: "Kroger",
      size: "20 oz",
      regular: 1.79,
      pickup: true,
      aisle: "A7",
    },
    {
      upc: "0007294760112",
      description: "Dave's Killer Bread 21 Whole Grains",
      brand: "Dave's Killer Bread",
      size: "27 oz",
      regular: 6.49,
      promo: 5.49,
      pickup: true,
      aisle: "A7",
    },
  ],
  butter: [
    {
      upc: "0001111042372",
      description: "Kroger Salted Butter Sticks",
      brand: "Kroger",
      size: "16 oz",
      regular: 4.49,
      pickup: true,
      aisle: "D3",
    },
  ],
  cheese: [
    {
      upc: "0001111098765",
      description: "Kroger Medium Cheddar Cheese Block",
      brand: "Kroger",
      size: "8 oz",
      regular: 2.49,
      pickup: true,
      aisle: "D5",
    },
  ],
};

const fixtureCatalog = new Map<string, FixtureProductSpec[]>(Object.entries(FIXTURE_CATALOG));

/** All acceptable fixture UPCs for a term (any is a valid model pick). */
export function upcsForTerm(term: string): string[] {
  const specs = fixtureCatalog.get(term.toLowerCase());

  if (!specs) {
    throw new Error(`No fixture catalog entry for term "${term}"`);
  }

  return specs.map((spec) => spec.upc);
}

const FIXTURE_STORES = [
  {
    locationId: "70500847",
    chain: "QFC",
    name: "QFC - University Village",
    phone: "2065550147",
    address: {
      addressLine1: "2746 NE 45th St",
      city: "Seattle",
      state: "WA",
      zipCode: "98105",
      county: "King",
    },
    hours: {
      timezone: "America/Los_Angeles",
      monday: { open: "06:00", close: "23:00" },
      tuesday: { open: "06:00", close: "23:00" },
    },
  },
  {
    locationId: "70500321",
    chain: "QFC",
    name: "QFC - Wallingford",
    phone: "2065550321",
    address: {
      addressLine1: "1801 N 45th St",
      city: "Seattle",
      state: "WA",
      zipCode: "98103",
      county: "King",
    },
  },
  {
    locationId: "70100999",
    chain: "QFC",
    name: "QFC - Bellevue Village",
    phone: "4255550999",
    address: {
      addressLine1: "10116 NE 8th St",
      city: "Bellevue",
      state: "WA",
      zipCode: "98004",
      county: "King",
    },
  },
];

export const DEFAULT_STORE_ID = FIXTURE_STORES[0].locationId;

/** Builds a full Kroger product payload, including realistic image bulk. */
function makeFixtureProduct(spec: FixtureProductSpec) {
  const imageSizes = ["thumbnail", "small", "medium", "large", "xlarge"].map((id, index) => ({
    id,
    size: String(50 + index * 250),
    url: `https://www.kroger.com/product/images/${id}/front/${spec.upc}?wid=${50 + index * 250}&hei=${50 + index * 250}&fmt=pjpeg&qlt=85,0&resMode=sharp2&op_usm=1.75,0.3,2,0`,
  }));

  return {
    productId: spec.upc,
    upc: spec.upc,
    aisleLocations: spec.aisle
      ? [
          {
            bayNumber: "12",
            description: `Aisle ${spec.aisle}`,
            number: spec.aisle,
            numberOfFacings: "2",
            side: "L",
            shelfNumber: "3",
            shelfPositionInBay: "1",
          },
        ]
      : [],
    brand: spec.brand,
    categories: ["Dairy", "Grocery"],
    countryOrigin: "UNITED STATES",
    description: spec.description,
    images: [
      { perspective: "front", featured: true, sizes: imageSizes },
      { perspective: "back", sizes: imageSizes.slice(0, 2) },
    ],
    items: [
      {
        itemId: spec.upc,
        favorite: false,
        fulfillment: {
          curbside: spec.pickup,
          delivery: spec.pickup,
          inStore: spec.pickup,
          instore: spec.pickup,
          shipToHome: false,
          shiptohome: false,
        },
        price: { regular: spec.regular, promo: spec.promo ?? 0 },
        size: spec.size,
        soldBy: "UNIT",
        inventory: {
          stockLevel: spec.pickup ? "HIGH" : "TEMPORARILY_OUT_OF_STOCK",
        },
      },
    ],
    itemInformation: { depth: "3", height: "9", width: "6" },
    temperature: { indicator: "Refrigerated", heatSensitive: false },
  };
}

function productsForTerm(term: string): ReturnType<typeof makeFixtureProduct>[] {
  const normalized = term.toLowerCase().trim();

  // "zzz…" terms (and the "frobnut" in them, if a model retries a shorter
  // term) have no products, for not-found paths.
  if (normalized.startsWith("zzz") || normalized.includes("frobnut")) {
    return [];
  }

  const exact = fixtureCatalog.get(normalized);

  if (exact) {
    return exact.map(makeFixtureProduct);
  }

  const partialKey = Object.keys(FIXTURE_CATALOG).find(
    (key) => normalized.includes(key) || key.includes(normalized),
  );

  const partial = partialKey ? fixtureCatalog.get(partialKey) : undefined;

  if (partial) {
    return partial.map(makeFixtureProduct);
  }

  // Synthesize a deterministic generic product so open-ended (live-model)
  // searches always find something.
  let hash = 0;

  for (const char of normalized) {
    hash = (hash * 31 + char.charCodeAt(0)) % 1_000_000;
  }

  const upc = String(2_000_000_000_000 + hash).padStart(13, "0");

  return [
    makeFixtureProduct({
      upc,
      description: `Kroger ${term}`,
      brand: "Kroger",
      size: "1 ea",
      regular: 3.29,
      pickup: true,
      aisle: "B1",
    }),
  ];
}

function findProductByUpc(upc: string) {
  for (const specs of Object.values(FIXTURE_CATALOG)) {
    const spec = specs.find((candidate) => candidate.upc === upc);

    if (spec) {
      return makeFixtureProduct(spec);
    }
  }

  if (upc.startsWith("9")) {
    return null;
  } // reserved for not-found tests

  return makeFixtureProduct({
    upc,
    description: "Generic Fixture Product",
    brand: "Kroger",
    size: "1 ea",
    regular: 2.5,
    pickup: true,
  });
}

// ---------------------------------------------------------------------------
// Kroger fetch stub
// ---------------------------------------------------------------------------

type CapturedCartItem = { upc?: string; quantity?: number; modality?: string };

export type KrogerFetchStub = {
  /** Every PUT /v1/cart/add body, in call order. */
  cartPuts: Array<{ items: CapturedCartItem[] }>;
  /** All cart items across all PUTs, flattened. */
  allCartItems: () => CapturedCartItem[];
  restore: () => void;
};

/**
 * Replaces global fetch with a deterministic Kroger API fixture router.
 */
export function installKrogerFetchStub(): KrogerFetchStub {
  const cartPuts: Array<CapturedCartPut> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : null;
      const url = new URL(input instanceof Request ? input.url : input);

      if (url.href === env.BETTER_AUTH_JWKS_URL) {
        return Response.json(await fixtureJwks());
      }

      if (url.href === "https://api.kroger.com/v1/connect/oauth2/token") {
        return Response.json({
          access_token: "kroger-access-token",
          refresh_token: "kroger-refresh-token",
          expires_in: 1800,
        });
      }

      if (url.href === "https://api.kroger.com/v1/identity/profile") {
        return Response.json({ data: { id: "eval-user" } });
      }

      if (url.hostname === "api.kroger.com" && url.pathname === "/v1/products") {
        const term = url.searchParams.get("filter.term") ?? "";
        const limit = Number(url.searchParams.get("filter.limit") ?? "5");

        return Response.json({ data: productsForTerm(term).slice(0, limit) });
      }

      if (url.hostname === "api.kroger.com" && /^\/v1\/products\/[^/]+$/.test(url.pathname)) {
        const upc = url.pathname.split("/").pop() ?? "";
        const product = findProductByUpc(upc);

        return Response.json({ data: product });
      }

      if (url.hostname === "api.kroger.com" && url.pathname === "/v1/locations") {
        const limit = Number(url.searchParams.get("filter.limit") ?? "5");

        return Response.json({ data: FIXTURE_STORES.slice(0, limit) });
      }

      if (url.hostname === "api.kroger.com" && /^\/v1\/locations\/[^/]+$/.test(url.pathname)) {
        const locationId = url.pathname.split("/").pop();

        const store = FIXTURE_STORES.find((candidate) => candidate.locationId === locationId);

        return Response.json({ data: store ?? null });
      }

      if (url.href === "https://api.kroger.com/v1/cart/add") {
        const method = (request ? request.method : init?.method) ?? "GET";

        if (method.toUpperCase() === "PUT") {
          const bodyText = request
            ? await request.text()
            : await new Response(init?.body ?? "{}").text();

          cartPuts.push(
            z
              .object({
                items: z.array(
                  z.object({
                    upc: z.string().optional(),
                    quantity: z.number().optional(),
                    modality: z.string().optional(),
                  }),
                ),
              })
              .parse(JSON.parse(bodyText)),
          );

          return new Response(null, { status: 204 });
        }
      }

      throw new Error(`Unexpected external fetch in eval: ${url.href}`);
    }),
  );

  return {
    cartPuts,
    allCartItems: () => cartPuts.flatMap((put) => put.items),
    restore: () => {
      vi.unstubAllGlobals();
    },
  };
}

// ---------------------------------------------------------------------------
// Better Auth resource token + MCP client setup.
// ---------------------------------------------------------------------------

function fetchThroughSelf(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return SELF.fetch(input instanceof Request ? new Request(input, init) : new Request(input, init));
}

/** Synthetic issuer-signed token and server-side Kroger connection for end-to-end tool evals. */
export async function createEvalMcpClient(): Promise<Client> {
  await ensureShoppingSchema();
  await seedKrogerConnection("eval-user");
  const accessToken = await fixtureToken("eval-user");

  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    fetch: fetchThroughSelf,
    requestInit: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Host: new URL(MCP_URL).host,
      },
    },
  });

  const client = new Client(
    { name: "eval-client", version: "1.0.0" },
    {
      capabilities: { elicitation: {} },
      versionNegotiation: { mode: "auto" },
    },
  );

  client.setRequestHandler("elicitation/create", async () => ({
    action: "accept",
    content: { confirm: true },
  }));
  await client.connect(transport);

  return client;
}

// ---------------------------------------------------------------------------
// Result helpers + token estimation
// ---------------------------------------------------------------------------

export type ToolCallResult = Awaited<ReturnType<Client["callTool"]>>;

/** The text a host model actually reads from a tool result. */
export function contentText(result: ToolCallResult): string {
  return (result.content ?? [])
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n");
}

/**
 * Rough token estimate (~4 chars/token, cl100k-ish). Deterministic and
 * dependency-free; budgets in the eval suites are calibrated against this
 * estimator, so relative regressions are what matters, not absolute accuracy.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Token estimation deliberately delegates arbitrary values to JSON.stringify, without treating them as validated application data.
export function estimateJsonTokens(value: unknown): number {
  return estimateTokens(JSON.stringify(value) ?? "");
}

// --- The "small-model contract": ids must be regex-extractable from text ---

export function extractStoreIds(text: string): string[] {
  return [...text.matchAll(/storeId=([A-Za-z0-9]{8})/g)].map((match) => match[1]);
}

export function extractUpcs(text: string): string[] {
  return [...text.matchAll(/upc=(\d{13})/g)].map((match) => match[1]);
}

export function extractListIds(text: string): string[] {
  return [...text.matchAll(/listId=(list_[0-9a-f]{32})/g)].map((match) => match[1]);
}
