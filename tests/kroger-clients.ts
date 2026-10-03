import createClient from "openapi-fetch";
import type { paths as CartPaths } from "../src/services/kroger/cart.js";
import type { paths as ProductPaths } from "../src/services/kroger/product.js";
import type { paths as LocationPaths } from "../src/services/kroger/location.js";

type TestFetch = (request: Request) => Promise<Response>;

const baseUrl = "https://kroger-test.invalid";

export const cartClient = (fetch: TestFetch) =>
  createClient<CartPaths>({ baseUrl, fetch });

export const productClient = (fetch: TestFetch) =>
  createClient<ProductPaths>({ baseUrl, fetch });

export const locationClient = (fetch: TestFetch) =>
  createClient<LocationPaths>({ baseUrl, fetch });

export type ProductRequestParameters = {
  params: {
    query?: Record<string, string | number>;
    path?: Record<string, string>;
  };
};

export type ApiFixture = {
  data?: unknown;
  error?: unknown;
  response: Response;
};

export type ProductRequest = (
  path: string,
  options: ProductRequestParameters,
) => Promise<ApiFixture>;

/** Existing scenario callbacks now receive requests serialized by the real OpenAPI client. */
export function productClientWith(get: ProductRequest) {
  return productClient(async (request) => {
    if (request.method !== "GET")
      throw new Error(`Unexpected product method ${request.method}`);
    const url = new URL(request.url);
    const query: Record<string, string | number> = {};

    for (const [key, value] of url.searchParams) {
      query[key] =
        key === "filter.limit" || key === "filter.start"
          ? Number(value)
          : value;
    }

    const params: ProductRequestParameters["params"] = {};

    if (url.search) params.query = query;

    const id = url.pathname.startsWith("/v1/products/")
      ? decodeURIComponent(url.pathname.slice("/v1/products/".length))
      : undefined;

    if (id !== undefined) params.path = { id };

    const fixture = await get(
      id === undefined ? url.pathname : "/v1/products/{id}",
      { params },
    );

    const body = fixture.response.ok ? fixture.data : fixture.error;
    const headers = new Headers(fixture.response.headers);

    if (body === undefined) {
      headers.set("content-length", "0");

      return new Response(null, {
        status: fixture.response.status,
        statusText: fixture.response.statusText,
        headers,
      });
    }

    return Response.json(body, {
      status: fixture.response.status,
      statusText: fixture.response.statusText,
      headers,
    });
  });
}
