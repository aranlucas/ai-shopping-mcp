import createClient from "openapi-fetch";
import type { paths as cartPaths } from "./cart.d.ts";
import type { paths as locationPaths } from "./location.d.ts";
import type { paths as productPaths } from "./product.d.ts";

const baseUrl = "https://api.kroger.com";

export const cartClient = createClient<cartPaths>({ baseUrl: baseUrl });
export const locationClient = createClient<locationPaths>({ baseUrl: baseUrl });
export const productClient = createClient<productPaths>({ baseUrl: baseUrl });
