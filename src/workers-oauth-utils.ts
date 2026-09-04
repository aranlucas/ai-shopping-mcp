import type { ClientInfo } from "@cloudflare/workers-oauth-provider"; // Adjust path if necessary
import { generateCookie, generateSignedCookie } from "hono/cookie";
import { parse, parseSigned } from "hono/utils/cookie";

import { safeJsonParse } from "./utils/json.js";

const COOKIE_NAME = "__Host-mcp-approved-clients";
const CSRF_COOKIE_NAME = "__Host-CSRF_TOKEN";
const ONE_YEAR_IN_SECONDS = 31536000;
const TEN_MINUTES_IN_SECONDS = 600;

// --- Helper Functions ---

type ApprovalRequest = {
  clientId?: string;
  redirectUri?: string;
  scope?: string | string[];
};

type ApprovedClientRecord = {
  clientId: string;
  redirectUri: string;
  scope: string;
};

function normalizeScope(scope: unknown): string {
  if (Array.isArray(scope)) {
    return scope
      .filter((item): item is string => typeof item === "string")
      .flatMap((item) => item.split(/\s+/))
      .filter(Boolean)
      .toSorted()
      .join(" ");
  }

  if (typeof scope === "string") {
    return scope.split(/\s+/).filter(Boolean).toSorted().join(" ");
  }

  return "";
}

function toApprovalRecord(request: ApprovalRequest): ApprovedClientRecord | null {
  if (!request.clientId || !request.redirectUri) return null;

  return {
    clientId: request.clientId,
    redirectUri: request.redirectUri,
    scope: normalizeScope(request.scope),
  };
}

function isApprovedClientRecord(value: unknown): value is ApprovedClientRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    "clientId" in value &&
    "redirectUri" in value &&
    "scope" in value &&
    typeof value.clientId === "string" &&
    typeof value.redirectUri === "string" &&
    typeof value.scope === "string"
  );
}

function approvalRecordsMatch(a: ApprovedClientRecord, b: ApprovedClientRecord): boolean {
  return a.clientId === b.clientId && a.redirectUri === b.redirectUri && a.scope === b.scope;
}

/**
 * Decodes a URL-safe base64 string back to its original data.
 * @param encoded - The URL-safe base64 encoded string.
 * @returns The original data.
 */
function decodeState<T = unknown>(encoded: string): T {
  try {
    const jsonString = atob(encoded);
    return safeJsonParse(jsonString).match(
      (state) => state as T,
      (error) => {
        throw error;
      },
    );
  } catch (e) {
    console.error("Error decoding state:", e);
    throw new Error("Could not decode state", { cause: e });
  }
}

async function parseSignedCookieJson<T>(
  cookieHeader: string,
  cookieName: string,
  cookieSecret: string,
): Promise<T | null> {
  if (!cookieSecret) {
    throw new Error(
      "COOKIE_ENCRYPTION_KEY is not defined. A secret key is required for signing cookies.",
    );
  }

  const signedCookies = await parseSigned(cookieHeader, cookieSecret, cookieName);
  const payload = signedCookies[cookieName];
  if (typeof payload !== "string") return null;

  return safeJsonParse(payload).match(
    (parsed) => parsed as T,
    (error) => {
      console.error("Error parsing cookie payload:", error);
      return null;
    },
  );
}

/**
 * Parses the signed cookie and verifies its integrity.
 * @param cookieHeader - The value of the Cookie header from the request.
 * @param secret - The secret key used for signing.
 * @returns A promise resolving to the list of approved client IDs if the cookie is valid, otherwise null.
 */
async function getApprovedClientsFromCookie(
  cookieHeader: string | null,
  secret: string,
): Promise<ApprovedClientRecord[] | null> {
  if (!cookieHeader) return null;

  const approvedClients = await parseSignedCookieJson<unknown>(cookieHeader, COOKIE_NAME, secret);

  if (!Array.isArray(approvedClients)) {
    return null;
  }

  if (!approvedClients.every(isApprovedClientRecord)) {
    return null;
  }

  return approvedClients;
}

function generateCSRFProtection() {
  const token = crypto.randomUUID();
  const setCookie = generateCookie(CSRF_COOKIE_NAME, token, {
    httpOnly: true,
    maxAge: TEN_MINUTES_IN_SECONDS,
    path: "/",
    sameSite: "Lax",
    secure: true,
  });
  return { setCookie, token };
}

function validateCSRFToken(formData: FormData, request: Request) {
  const tokenFromForm = formData.get("csrf_token");
  if (typeof tokenFromForm !== "string" || !tokenFromForm) {
    throw new Error("Missing or invalid CSRF token.");
  }

  const cookieHeader = request.headers.get("Cookie") || "";
  const tokenMatchesCookie = cookieHeader
    .split(";")
    .some((cookie) => parse(cookie, CSRF_COOKIE_NAME)[CSRF_COOKIE_NAME] === tokenFromForm);
  if (!tokenMatchesCookie) {
    throw new Error("CSRF token mismatch.");
  }

  return generateCookie(CSRF_COOKIE_NAME, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "Lax",
    secure: true,
  });
}

// --- Exported Functions ---

/**
 * Checks if a given client ID has already been approved by the user,
 * based on a signed cookie.
 *
 * @param request - The incoming Request object to read cookies from.
 * @param clientId - The OAuth client ID to check approval for.
 * @param cookieSecret - The secret key used to sign/verify the approval cookie.
 * @returns A promise resolving to true if the client ID is in the list of approved clients in a valid cookie, false otherwise.
 */
export async function clientIdAlreadyApproved(
  request: Request,
  oauthRequest: ApprovalRequest,
  cookieSecret: string,
): Promise<boolean> {
  const requestedApproval = toApprovalRecord(oauthRequest);
  if (!requestedApproval) return false;

  const cookieHeader = request.headers.get("Cookie");
  const approvedClients = await getApprovedClientsFromCookie(cookieHeader, cookieSecret);

  return (
    approvedClients?.some((approved) => approvalRecordsMatch(approved, requestedApproval)) ?? false
  );
}

export interface ApprovalDialogOptions {
  client: ClientInfo | null;
  server: {
    name: string;
    logo?: string;
    description?: string;
  };
  state: Record<string, unknown>;
}

/**
 * Renders an approval dialog for OAuth authorization
 * The dialog displays information about the client and server
 * and includes a form to submit approval
 *
 * @param request - The HTTP request
 * @param options - Configuration for the approval dialog
 * @returns A Response containing the HTML approval dialog
 */
export function renderApprovalDialog(request: Request, options: ApprovalDialogOptions): Response {
  const { client, server, state } = options;

  // Encode state for form submission
  const encodedState = btoa(JSON.stringify(state));
  const csrf = generateCSRFProtection();

  // Sanitize any untrusted content
  const serverName = sanitizeHtml(server.name);
  const clientName = client?.clientName ? sanitizeHtml(client.clientName) : "Unknown MCP Client";
  const serverDescription = server.description ? sanitizeHtml(server.description) : "";

  // Safe URLs
  const logoUrl = server.logo ? sanitizeHtml(sanitizeUrl(server.logo)) : "";
  const clientUri = client?.clientUri ? sanitizeHtml(sanitizeUrl(client.clientUri)) : "";
  const policyUri = client?.policyUri ? sanitizeHtml(sanitizeUrl(client.policyUri)) : "";
  const tosUri = client?.tosUri ? sanitizeHtml(sanitizeUrl(client.tosUri)) : "";

  // Client contacts
  const contacts =
    client?.contacts && client.contacts.length > 0 ? sanitizeHtml(client.contacts.join(", ")) : "";

  // Get redirect URIs
  const redirectUris =
    client?.redirectUris && client.redirectUris.length > 0
      ? client.redirectUris.map((uri) => sanitizeHtml(sanitizeUrl(uri))).filter(Boolean)
      : [];

  // Generate HTML for the approval dialog
  const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${clientName} | Authorization Request</title>
        <style>
          /* Modern, responsive styling with system fonts */
          :root {
            --primary-color: #0070f3;
            --error-color: #f44336;
            --border-color: #e5e7eb;
            --text-color: #333;
            --background-color: #fff;
            --card-shadow: 0 8px 36px 8px rgba(0, 0, 0, 0.1);
          }
          
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, 
                         Helvetica, Arial, sans-serif, "Apple Color Emoji", 
                         "Segoe UI Emoji", "Segoe UI Symbol";
            line-height: 1.6;
            color: var(--text-color);
            background-color: #f9fafb;
            margin: 0;
            padding: 0;
          }
          
          .container {
            max-width: 600px;
            margin: 2rem auto;
            padding: 1rem;
          }
          
          .precard {
            padding: 2rem;
            text-align: center;
          }
          
          .card {
            background-color: var(--background-color);
            border-radius: 8px;
            box-shadow: var(--card-shadow);
            padding: 2rem;
          }
          
          .header {
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 1.5rem;
          }
          
          .logo {
            width: 48px;
            height: 48px;
            margin-right: 1rem;
            border-radius: 8px;
            object-fit: contain;
          }
          
          .title {
            margin: 0;
            font-size: 1.3rem;
            font-weight: 400;
          }
          
          .alert {
            margin: 0;
            font-size: 1.5rem;
            font-weight: 400;
            margin: 1rem 0;
            text-align: center;
          }
          
          .description {
            color: #555;
          }
          
          .client-info {
            border: 1px solid var(--border-color);
            border-radius: 6px;
            padding: 1rem 1rem 0.5rem;
            margin-bottom: 1.5rem;
          }
          
          .client-name {
            font-weight: 600;
            font-size: 1.2rem;
            margin: 0 0 0.5rem 0;
          }
          
          .client-detail {
            display: flex;
            margin-bottom: 0.5rem;
            align-items: baseline;
          }
          
          .detail-label {
            font-weight: 500;
            min-width: 120px;
          }
          
          .detail-value {
            font-family: SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
            word-break: break-all;
          }
          
          .detail-value a {
            color: inherit;
            text-decoration: underline;
          }
          
          .detail-value.small {
            font-size: 0.8em;
          }
          
          .external-link-icon {
            font-size: 0.75em;
            margin-left: 0.25rem;
            vertical-align: super;
          }
          
          .actions {
            display: flex;
            justify-content: flex-end;
            gap: 1rem;
            margin-top: 2rem;
          }
          
          .button {
            padding: 0.75rem 1.5rem;
            border-radius: 6px;
            font-weight: 500;
            cursor: pointer;
            border: none;
            font-size: 1rem;
          }
          
          .button-primary {
            background-color: var(--primary-color);
            color: white;
          }
          
          .button-secondary {
            background-color: transparent;
            border: 1px solid var(--border-color);
            color: var(--text-color);
          }
          
          /* Responsive adjustments */
          @media (max-width: 640px) {
            .container {
              margin: 1rem auto;
              padding: 0.5rem;
            }
            
            .card {
              padding: 1.5rem;
            }
            
            .client-detail {
              flex-direction: column;
            }
            
            .detail-label {
              min-width: unset;
              margin-bottom: 0.25rem;
            }
            
            .actions {
              flex-direction: column;
            }
            
            .button {
              width: 100%;
            }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="precard">
            <div class="header">
              ${logoUrl ? `<img src="${logoUrl}" alt="${serverName} Logo" class="logo">` : ""}
            <h1 class="title"><strong>${serverName}</strong></h1>
            </div>
            
            ${serverDescription ? `<p class="description">${serverDescription}</p>` : ""}
          </div>
            
          <div class="card">
            
            <h2 class="alert"><strong>${clientName || "A new MCP Client"}</strong> is requesting access</h1>
            
            <div class="client-info">
              <div class="client-detail">
                <div class="detail-label">Name:</div>
                <div class="detail-value">
                  ${clientName}
                </div>
              </div>
              
              ${
                clientUri
                  ? `
                <div class="client-detail">
                  <div class="detail-label">Website:</div>
                  <div class="detail-value small">
                    <a href="${clientUri}" target="_blank" rel="noopener noreferrer">
                      ${clientUri}
                    </a>
                  </div>
                </div>
              `
                  : ""
              }
              
              ${
                policyUri
                  ? `
                <div class="client-detail">
                  <div class="detail-label">Privacy Policy:</div>
                  <div class="detail-value">
                    <a href="${policyUri}" target="_blank" rel="noopener noreferrer">
                      ${policyUri}
                    </a>
                  </div>
                </div>
              `
                  : ""
              }
              
              ${
                tosUri
                  ? `
                <div class="client-detail">
                  <div class="detail-label">Terms of Service:</div>
                  <div class="detail-value">
                    <a href="${tosUri}" target="_blank" rel="noopener noreferrer">
                      ${tosUri}
                    </a>
                  </div>
                </div>
              `
                  : ""
              }
              
              ${
                redirectUris.length > 0
                  ? `
                <div class="client-detail">
                  <div class="detail-label">Redirect URIs:</div>
                  <div class="detail-value small">
                    ${redirectUris.map((uri) => `<div>${uri}</div>`).join("")}
                  </div>
                </div>
              `
                  : ""
              }
              
              ${
                contacts
                  ? `
                <div class="client-detail">
                  <div class="detail-label">Contact:</div>
                  <div class="detail-value">${contacts}</div>
                </div>
              `
                  : ""
              }
            </div>
            
            <p>This MCP Client is requesting to be authorized on ${serverName}. If you approve, you will be redirected to complete authentication.</p>
            
            <form method="post" action="${new URL(request.url).pathname}" onsubmit="this.querySelector('button[type=submit]').disabled=true">
              <input type="hidden" name="state" value="${encodedState}">
              <input type="hidden" name="csrf_token" value="${csrf.token}">

              <div class="actions">
                <a href="/" class="button button-secondary">Cancel</a>
                <button type="submit" class="button button-primary">Approve</button>
              </div>
            </form>
          </div>
        </div>
      </body>
    </html>
  `;

  return new Response(htmlContent, {
    headers: {
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
      "Content-Type": "text/html; charset=utf-8",
      "Set-Cookie": csrf.setCookie,
      "X-Frame-Options": "DENY",
    },
  });
}

/**
 * Result of parsing the approval form submission.
 */
export interface ParsedApprovalResult {
  /** The original state object passed through the form. */
  state: Record<string, unknown>;
  /** Headers to set on the redirect response, including the Set-Cookie header. */
  headers: Headers;
}

/**
 * Parses the form submission from the approval dialog, extracts the state,
 * and generates Set-Cookie headers to mark the client as approved.
 *
 * @param request - The incoming POST Request object containing the form data.
 * @param cookieSecret - The secret key used to sign the approval cookie.
 * @returns A promise resolving to an object containing the parsed state and necessary headers.
 * @throws If the request method is not POST, form data is invalid, or state is missing.
 */
export async function parseRedirectApproval(
  request: Request,
  cookieSecret: string,
): Promise<ParsedApprovalResult> {
  if (request.method !== "POST") {
    throw new Error("Invalid request method. Expected POST.");
  }

  interface DecodedState extends Record<string, unknown> {
    oauthReqInfo?: ApprovalRequest;
  }

  let state: DecodedState;
  let approvedClient: ApprovedClientRecord | null;
  let clearCsrfCookie: string;

  try {
    const formData = await request.formData();
    clearCsrfCookie = validateCSRFToken(formData, request);
    const encodedState = formData.get("state");

    if (typeof encodedState !== "string" || !encodedState) {
      throw new Error("Missing or invalid 'state' in form data.");
    }

    state = decodeState<DecodedState>(encodedState);
    approvedClient = state.oauthReqInfo ? toApprovalRecord(state.oauthReqInfo) : null;

    if (!approvedClient) {
      throw new Error("Could not extract client approval details from state object.");
    }
  } catch (e) {
    console.error("Error processing form submission:", e);
    // Rethrow or handle as appropriate, maybe return a specific error response
    throw new Error(
      `Failed to parse approval form: ${e instanceof Error ? e.message : String(e)}`,
      { cause: e },
    );
  }

  // Get existing approved clients
  const cookieHeader = request.headers.get("Cookie");
  const existingApprovedClients =
    (await getApprovedClientsFromCookie(cookieHeader, cookieSecret)) || [];

  // Add the newly approved client ID (avoid duplicates)
  const updatedApprovedClients = [
    ...existingApprovedClients.filter(
      (approved) => !approvalRecordsMatch(approved, approvedClient),
    ),
    approvedClient,
  ];

  const headers = new Headers();
  headers.append(
    "Set-Cookie",
    await generateSignedCookie(COOKIE_NAME, JSON.stringify(updatedApprovedClients), cookieSecret, {
      httpOnly: true,
      maxAge: ONE_YEAR_IN_SECONDS,
      path: "/",
      sameSite: "Lax",
      secure: true,
    }),
  );
  headers.append("Set-Cookie", clearCsrfCookie);

  return { state, headers };
}

/**
 * Sanitizes HTML content to prevent XSS attacks
 * @param unsafe - The unsafe string that might contain HTML
 * @returns A safe string with HTML special characters escaped
 */
function sanitizeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function sanitizeUrl(unsafe: string): string {
  try {
    const parsed = new URL(unsafe);
    return ["http:", "https:"].includes(parsed.protocol) ? unsafe : "";
  } catch {
    return "";
  }
}
