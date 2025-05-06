/**
 * Constructs an authorization URL for an upstream service.
 *
 * @param {Object} options
 * @param {string} options.upstream_url - The base URL of the upstream service.
 * @param {string} options.client_id - The client ID of the application.
 * @param {string} options.redirect_uri - The redirect URI of the application.
 * @param {string} [options.state] - The state parameter.
 *
 * @returns {string} The authorization URL.
 */
export function getUpstreamAuthorizeUrl({
  upstream_url,
  client_id,
  scope,
  redirect_uri,
  state,
}: {
  upstream_url: string;
  client_id: string;
  scope: string;
  redirect_uri: string;
  state?: string;
}) {
  const upstream = new URL(upstream_url);
  upstream.searchParams.set("client_id", client_id);
  upstream.searchParams.set("redirect_uri", redirect_uri);
  upstream.searchParams.set("scope", scope);
  if (state) upstream.searchParams.set("state", state);
  upstream.searchParams.set("response_type", "code");
  return upstream.href;
}

/**
 * Fetches an authorization token from an upstream service.
 *
 * @param {Object} options
 * @param {string} options.client_id - The client ID of the application.
 * @param {string} options.client_secret - The client secret of the application.
 * @param {string} options.code - The authorization code.
 * @param {string} options.redirect_uri - The redirect URI of the application.
 * @param {string} options.upstream_url - The token endpoint URL of the upstream service.
 *
 * @returns {Promise<[string, null] | [null, Response] | [string, string, null]>} A promise that resolves to an array containing the access token, optionally the refresh token, or an error response.
 */
export async function fetchUpstreamAuthToken({
  client_id,
  client_secret,
  code,
  redirect_uri,
  upstream_url,
}: {
  code: string | undefined;
  upstream_url: string;
  client_secret: string;
  redirect_uri: string;
  client_id: string;
}): Promise<[string, null] | [null, Response] | [string, string, null]> {
  if (!code) {
    return [null, new Response("Missing code", { status: 400 })];
  }

  const resp = await fetch(upstream_url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${client_id}:${client_secret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri,
    }).toString(),
  });

  if (!resp.ok) {
    console.log(await resp.text());
    return [
      null,
      new Response("Failed to fetch access token", { status: 500 }),
    ];
  }

  // Try parsing as JSON first for Kroger API
  const contentType = resp.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const data = (await resp.json()) as {
      access_token?: string;
      refresh_token?: string;
    };
    const accessToken = data.access_token;
    const refreshToken = data.refresh_token;

    if (!accessToken) {
      return [null, new Response("Missing access token", { status: 400 })];
    }

    if (refreshToken) {
      return [accessToken, refreshToken, null];
    }

    return [accessToken, null];
  }

  // Fall back to form data for GitHub API
  try {
    const body = await resp.formData();
    const accessToken = body.get("access_token") as string;

    if (!accessToken) {
      return [null, new Response("Missing access token", { status: 400 })];
    }

    return [accessToken, null];
  } catch (error) {
    return [
      null,
      new Response("Failed to parse token response", { status: 500 }),
    ];
  }
}

// Context from the auth process, encrypted & stored in the auth token
// and provided to the DurableMCP as this.props
export type Props = {
  // GitHub specific props
  login?: string;
  name?: string;
  // Kroger specific props
  id?: string;
  firstName?: string;
  lastName?: string;
  // Common props
  email?: string;
  accessToken: string;
  refreshToken?: string;
};
