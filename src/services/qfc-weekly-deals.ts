import type {
  Circular,
  CircularsResponse,
  Coupon,
  CouponsResponse,
  WeeklyDeal as QfcShoppableDeal,
  WeeklyDealsResponse,
} from "./kroger/weekly-deals.js";

const QFC_WEEKLY_AD_BASE = "https://www.qfc.com";
const KROGER_DIGITAL_ADS_BASE = "https://api.kroger.com";
const DACS_BASE = "https://oms-kroger-webapp-da-classic-api-prod.przone.net";
const DACS_PUBLIC_API_KEY = "bqwwosbzrzcvffztxzyczieljzsahmkp";
const DEFAULT_QFC_LOCATION_ID = "70500847";

type JsonRecord = Record<string, unknown>;

export interface QfcWeeklyDealsOptions {
  locationId?: string;
  divisionCode?: string;
  includeCoupons?: boolean;
  limit?: number;
  pageLimit?: number;
  lafObject?: unknown;
  signal?: AbortSignal;
}

export interface NormalizedWeeklyDeal {
  id: string;
  title: string;
  details?: string;
  price?: string;
  savings?: string;
  loyalty?: string;
  department?: string;
  validFrom?: string;
  validTill?: string;
  disclaimer?: string;
  imageUrl?: string;
  source: "shoppable" | "print";
  rawType?: string;
}

export interface QfcDealsApiResponse {
  sourceMode: "shoppable" | "print_fallback";
  locationId: string;
  divisionCode: string;
  shoppableCircular?: Circular;
  printCircular?: Circular;
  warnings: string[];
  shoppableError?: string;
  printError?: string;
  deals: NormalizedWeeklyDeal[];
  coupons?: Coupon[];
  meta?: {
    adGroupCount?: number;
    pageCount?: number;
    lafBootstrap?: LafBootstrapStatus;
  };
}

type LafBootstrapStatus = "provided" | "bootstrapped" | "unavailable";

interface ModalityPreferencesResponse {
  data?: {
    modalityPreferences?: {
      lafObject?: unknown[];
    };
  };
}

interface DacsListingResponse {
  pages?: Array<{
    eventPageId?: string;
    page?: string;
  }>;
  adId?: string;
  adTitle?: string;
  startDate?: string;
  endDate?: string;
}

interface DacsPageResponse {
  eventPageId?: string;
  contents?: Array<{
    contentType?: string;
    mapConfig?: string;
  }>;
}

interface ParsedDacsOffer {
  id: string;
  title: string;
  details?: string;
  imageUrl?: string;
}

function getDefaultLocationId(locationId?: string): string {
  return locationId || DEFAULT_QFC_LOCATION_ID;
}

function inferDivisionCode(locationId: string, explicit?: string): string {
  if (explicit) return explicit;
  return locationId.slice(0, 3);
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function formatPrice(
  value: number | null | undefined,
  uom?: string | null,
): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "";
  const price =
    value >= 1 ? `$${value.toFixed(2)}` : `${Math.round(value * 100)}¢`;
  return uom ? `${price}/${uom}` : price;
}

function parseBooleanFlag(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function validateLafObject(lafObject: unknown): unknown[] | undefined {
  if (!lafObject) return undefined;
  if (!Array.isArray(lafObject)) {
    throw new Error("lafObject must be a JSON array");
  }
  return lafObject;
}

function makeQfcHeaders(params: {
  locationId: string;
  lafObject: unknown[];
  refererPath?: string;
  callOrigin?: { page: string; component: string };
}): HeadersInit {
  const {
    locationId,
    lafObject,
    refererPath = "/weeklyad/weeklyad",
    callOrigin,
  } = params;
  return {
    accept: "application/json, text/plain, */*",
    "user-agent": "Mozilla/5.0",
    referer: `${QFC_WEEKLY_AD_BASE}${refererPath}`,
    origin: QFC_WEEKLY_AD_BASE,
    dnt: "1",
    "x-kroger-channel": "WEB",
    "x-modality": JSON.stringify({ type: "PICKUP", locationId }),
    "x-modality-type": "PICKUP",
    "x-facility-id": locationId,
    "x-call-origin": JSON.stringify(
      callOrigin || { component: "weekly ad", page: "weekly ad" },
    ),
    "x-laf-object": JSON.stringify(lafObject),
    "user-time-zone": "America/Los_Angeles",
  };
}

async function fetchJson<T>(
  url: string,
  init?: RequestInit,
): Promise<{ data: T; response: Response }> {
  const response = await fetch(url, init);
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `Invalid JSON from ${url} (status ${response.status}): ${text.slice(0, 200)}`,
    );
  }

  if (!response.ok) {
    const errorText =
      typeof parsed === "object" && parsed && "errors" in (parsed as JsonRecord)
        ? JSON.stringify((parsed as JsonRecord).errors)
        : JSON.stringify(parsed).slice(0, 400);
    throw new Error(`HTTP ${response.status} for ${url}: ${errorText}`);
  }

  return { data: parsed as T, response };
}

async function fetchQfcWeeklyCirculars(params: {
  divisionCode: string;
  signal?: AbortSignal;
}): Promise<Circular[]> {
  const url = new URL("/digitalads/v1/circulars", KROGER_DIGITAL_ADS_BASE);
  url.searchParams.append("filter.tags", "SHOPPABLE");
  url.searchParams.append("filter.tags", "CLASSIC_VIEW");
  url.searchParams.append("filter.div", params.divisionCode);

  const { data } = await fetchJson<CircularsResponse>(url.toString(), {
    headers: { accept: "application/json", "user-agent": "Mozilla/5.0" },
    signal: params.signal,
  });

  return data.data || [];
}

function selectCurrentCirculars(circulars: Circular[]) {
  const now = Date.now();
  const active = circulars.filter((c) => {
    const start = Date.parse(c.eventStartDate);
    const end = Date.parse(c.eventEndDate);
    return (
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      start <= now &&
      now <= end
    );
  });

  const shoppable =
    active.find(
      (c) => c.circularType === "weeklyAd" && c.tags.includes("SHOPPABLE"),
    ) ||
    circulars.find((c) => c.circularType === "weeklyAd" && !c.previewCircular);

  const print =
    active.find(
      (c) => c.circularType === "print" && c.tags.includes("CLASSIC_VIEW"),
    ) ||
    circulars.find((c) => c.circularType === "print" && !c.previewCircular);

  return { shoppable, print };
}

async function tryBootstrapLafObjectFromQfc(params: {
  locationId: string;
  signal?: AbortSignal;
}): Promise<unknown[] | undefined> {
  const locationId = params.locationId;

  const weeklyAdResp = await fetch(`${QFC_WEEKLY_AD_BASE}/weeklyad`, {
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "user-agent": "Mozilla/5.0",
    },
    signal: params.signal,
  });

  if (!weeklyAdResp.ok) {
    throw new Error(
      `Failed to bootstrap QFC session: HTTP ${weeklyAdResp.status}`,
    );
  }

  const getSetCookie =
    // Cloudflare Workers has getAll in some runtimes; Node/undici exposes getSetCookie
    (
      weeklyAdResp.headers as Headers & { getSetCookie?: () => string[] }
    ).getSetCookie?.() || [];

  const cookieJar = getSetCookie.map((cookie) => cookie.split(";", 1)[0]);
  cookieJar.push(
    `x-active-modality=${JSON.stringify({
      type: "PICKUP",
      locationId,
      source: "FALLBACK_ACTIVE_MODALITY_COOKIE",
      createdDate: Date.now(),
    })}`,
  );
  cookieJar.push(`DD_modStore=${locationId}`);

  const { data } = await fetchJson<ModalityPreferencesResponse>(
    `${QFC_WEEKLY_AD_BASE}/atlas/v1/modality/preferences?filter.restrictLafToFc=false`,
    {
      method: "POST",
      headers: {
        accept: "application/json, text/plain, */*",
        "user-agent": "Mozilla/5.0",
        referer: `${QFC_WEEKLY_AD_BASE}/weeklyad`,
        origin: QFC_WEEKLY_AD_BASE,
        dnt: "1",
        "x-kroger-channel": "WEB",
        "x-call-origin": JSON.stringify({ page: "all", component: "CSR" }),
        cookie: cookieJar.join("; "),
      },
      signal: params.signal,
    },
  );

  return validateLafObject(data?.data?.modalityPreferences?.lafObject);
}

async function fetchShoppableWeeklyDeals(params: {
  locationId: string;
  circularId: string;
  lafObject: unknown[];
  signal?: AbortSignal;
}): Promise<WeeklyDealsResponse["data"]["shoppableWeeklyDeals"]> {
  const url = new URL(
    "/atlas/v1/shoppable-weekly-deals/deals",
    QFC_WEEKLY_AD_BASE,
  );
  url.searchParams.set("filter.circularId", params.circularId);
  url.searchParams.set("filter.adGroupName.like", "");
  url.searchParams.set("fields.ads", "");

  const { data } = await fetchJson<WeeklyDealsResponse>(url.toString(), {
    headers: makeQfcHeaders({
      locationId: params.locationId,
      lafObject: params.lafObject,
    }),
    signal: params.signal,
  });

  return data.data.shoppableWeeklyDeals;
}

async function fetchWeeklyDigitalCoupons(params: {
  locationId: string;
  lafObject: unknown[];
  signal?: AbortSignal;
}): Promise<Coupon[]> {
  const url = new URL(
    "/atlas/v1/savings-coupons/v1/coupons",
    QFC_WEEKLY_AD_BASE,
  );
  url.searchParams.append("filter.specialSavings", "wdd");
  url.searchParams.append("projections", "coupons.compact");

  const { data } = await fetchJson<CouponsResponse>(url.toString(), {
    headers: makeQfcHeaders({
      locationId: params.locationId,
      lafObject: params.lafObject,
    }),
    signal: params.signal,
  });

  return data.data.coupons || [];
}

async function fetchPrintAdListing(params: {
  eventId: string;
  locationId: string;
  signal?: AbortSignal;
}): Promise<DacsListingResponse> {
  const url = new URL(`/api/dacs/${params.eventId}`, DACS_BASE);
  url.searchParams.set("location", params.locationId);

  const { data } = await fetchJson<DacsListingResponse>(url.toString(), {
    headers: {
      accept: "*/*",
      "user-agent": "Mozilla/5.0",
      referer: `${QFC_WEEKLY_AD_BASE}/weeklyad`,
      origin: QFC_WEEKLY_AD_BASE,
      xapikey: DACS_PUBLIC_API_KEY,
      "content-type": "application/json",
    },
    signal: params.signal,
  });

  return data;
}

async function fetchPrintAdPage(params: {
  eventId: string;
  eventPageId: string;
  locationId: string;
  signal?: AbortSignal;
}): Promise<DacsPageResponse> {
  const url = new URL(
    `/api/dacs/${params.eventId}/pages/${params.eventPageId}`,
    DACS_BASE,
  );
  url.searchParams.set("location", params.locationId);

  const { data } = await fetchJson<DacsPageResponse>(url.toString(), {
    headers: {
      accept: "*/*",
      "user-agent": "Mozilla/5.0",
      referer: `${QFC_WEEKLY_AD_BASE}/weeklyad`,
      origin: QFC_WEEKLY_AD_BASE,
      xapikey: DACS_PUBLIC_API_KEY,
      "content-type": "application/json",
    },
    signal: params.signal,
  });

  return data;
}

function parseDacsOfferFromMapConfig(
  mapConfig: string,
): ParsedDacsOffer | null {
  try {
    const parsed = JSON.parse(mapConfig) as JsonRecord;
    const content = parsed.content as JsonRecord | undefined;
    if (!content) return null;

    const id = content.id;
    const title = content.headline;
    if (typeof id !== "number" || typeof title !== "string" || !title.trim()) {
      return null;
    }

    const bodyCopy =
      typeof content.bodyCopy === "string" && content.bodyCopy.trim()
        ? content.bodyCopy
        : undefined;
    const imageURL =
      typeof content.imageURL === "string" && content.imageURL.trim()
        ? content.imageURL
        : undefined;

    return {
      id: String(id),
      title: title.trim(),
      details: bodyCopy,
      imageUrl: imageURL,
    };
  } catch {
    return null;
  }
}

function dedupeDealsById<T extends { id: string }>(deals: T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const deal of deals) {
    if (seen.has(deal.id)) continue;
    seen.add(deal.id);
    unique.push(deal);
  }
  return unique;
}

function normalizeShoppableDeals(
  shoppable: WeeklyDealsResponse["data"]["shoppableWeeklyDeals"],
  limit?: number,
): { deals: NormalizedWeeklyDeal[]; adGroupCount: number } {
  const ads = shoppable.ads || [];
  const max = Math.max(1, Math.min(limit || 50, 200));

  const deals = ads.slice(0, max).map((deal: QfcShoppableDeal) => {
    const department = deal.departments?.[0]?.department;
    const price = formatPrice(
      deal.salePrice ?? deal.retailPrice ?? deal.price,
      deal.uom,
    );

    let savings: string | undefined;
    if (typeof deal.saveAmount === "number" && deal.saveAmount > 0) {
      savings = `Save ${formatPrice(deal.saveAmount)}`;
    } else if (typeof deal.savePercent === "number" && deal.savePercent > 0) {
      savings = `Save ${deal.savePercent}%`;
    } else if (typeof deal.percentOff === "number" && deal.percentOff > 0) {
      savings = `${deal.percentOff}% off`;
    }

    return {
      id: deal.id,
      title: deal.mainlineCopy || "Unknown Deal",
      details: deal.underlineCopy || undefined,
      price: price || undefined,
      savings,
      loyalty: deal.loyaltyIndicator || undefined,
      department,
      validFrom: deal.validFrom || undefined,
      validTill: deal.validTill || undefined,
      disclaimer: deal.disclaimer || undefined,
      imageUrl: deal.images?.[0]?.url,
      source: "shoppable" as const,
      rawType: deal.type,
    };
  });

  return {
    deals,
    adGroupCount:
      ((shoppable as unknown as { adGroups?: unknown[] }).adGroups?.length as
        | number
        | undefined) || 0,
  };
}

async function normalizePrintDeals(params: {
  printCircular: Circular;
  locationId: string;
  pageLimit?: number;
  limit?: number;
  signal?: AbortSignal;
}): Promise<{ deals: NormalizedWeeklyDeal[]; pageCount: number }> {
  const listing = await fetchPrintAdListing({
    eventId: params.printCircular.eventId,
    locationId: params.locationId,
    signal: params.signal,
  });

  const pages = listing.pages || [];
  const pageLimit = Math.max(1, Math.min(params.pageLimit || 2, 10));
  const limit = Math.max(1, Math.min(params.limit || 50, 200));

  const selectedPages = pages.slice(0, pageLimit);
  const pageResponses = await Promise.all(
    selectedPages.map((page) =>
      page.eventPageId
        ? fetchPrintAdPage({
            eventId: params.printCircular.eventId,
            eventPageId: page.eventPageId,
            locationId: params.locationId,
            signal: params.signal,
          }).catch(() => ({ contents: [] }))
        : Promise.resolve({ contents: [] }),
    ),
  );

  const offers: NormalizedWeeklyDeal[] = [];
  for (const page of pageResponses) {
    for (const content of page.contents || []) {
      if (content.contentType !== "Offer" || !content.mapConfig) continue;
      const parsed = parseDacsOfferFromMapConfig(content.mapConfig);
      if (!parsed) continue;
      offers.push({
        id: parsed.id,
        title: parsed.title,
        details: parsed.details,
        price: "See print ad",
        validFrom: params.printCircular.eventStartDate,
        validTill: params.printCircular.eventEndDate,
        imageUrl: parsed.imageUrl,
        source: "print",
      });
    }
  }

  return {
    deals: dedupeDealsById(offers).slice(0, limit),
    pageCount: selectedPages.length,
  };
}

export async function getQfcWeeklyDeals(
  options: QfcWeeklyDealsOptions = {},
): Promise<QfcDealsApiResponse> {
  const locationId = getDefaultLocationId(options.locationId);
  const divisionCode = inferDivisionCode(locationId, options.divisionCode);
  const includeCoupons = options.includeCoupons !== false;
  const warnings: string[] = [];

  const circulars = await fetchQfcWeeklyCirculars({
    divisionCode,
    signal: options.signal,
  });
  const { shoppable: shoppableCircular, print: printCircular } =
    selectCurrentCirculars(circulars);

  if (!shoppableCircular && !printCircular) {
    throw new Error(
      `No current QFC weekly ad circulars found for division ${divisionCode}`,
    );
  }

  let lafObject = validateLafObject(options.lafObject);
  let lafBootstrap: LafBootstrapStatus | undefined;
  if (lafObject) {
    lafBootstrap = "provided";
  }

  let shoppableError: string | undefined;

  if (!lafObject && shoppableCircular) {
    try {
      lafObject = await tryBootstrapLafObjectFromQfc({
        locationId,
        signal: options.signal,
      });
      if (lafObject) lafBootstrap = "bootstrapped";
    } catch (error) {
      shoppableError = safeErrorMessage(error);
      warnings.push(
        "Unable to bootstrap QFC modality LAF object for shoppable deals; falling back to print-ad parsing.",
      );
      lafBootstrap = "unavailable";
    }
  }

  if (shoppableCircular && lafObject) {
    try {
      const shoppable = await fetchShoppableWeeklyDeals({
        locationId,
        circularId: shoppableCircular.id,
        lafObject,
        signal: options.signal,
      });

      const { deals, adGroupCount } = normalizeShoppableDeals(
        shoppable,
        options.limit,
      );

      let coupons: Coupon[] | undefined;
      if (includeCoupons) {
        try {
          coupons = await fetchWeeklyDigitalCoupons({
            locationId,
            lafObject,
            signal: options.signal,
          });
        } catch (error) {
          warnings.push(
            `Weekly digital coupons unavailable: ${safeErrorMessage(error)}`,
          );
        }
      }

      return {
        sourceMode: "shoppable",
        locationId,
        divisionCode,
        shoppableCircular,
        printCircular,
        warnings,
        deals,
        coupons,
        meta: {
          adGroupCount,
          lafBootstrap,
        },
      };
    } catch (error) {
      shoppableError = safeErrorMessage(error);
      warnings.push(
        `Shoppable weekly deals request failed; using print-ad fallback. (${shoppableError})`,
      );
    }
  }

  if (!printCircular) {
    throw new Error(
      `Shoppable deals failed and no print circular was available. ${shoppableError || ""}`.trim(),
    );
  }

  let printError: string | undefined;
  try {
    const { deals, pageCount } = await normalizePrintDeals({
      printCircular,
      locationId,
      pageLimit: options.pageLimit,
      limit: options.limit,
      signal: options.signal,
    });

    return {
      sourceMode: "print_fallback",
      locationId,
      divisionCode,
      shoppableCircular,
      printCircular,
      warnings,
      shoppableError,
      deals,
      meta: {
        pageCount,
        lafBootstrap,
      },
    };
  } catch (error) {
    printError = safeErrorMessage(error);
    throw new Error(
      `Failed to fetch weekly deals from both shoppable and print sources. Shoppable: ${shoppableError || "n/a"} | Print: ${printError}`,
    );
  }
}

export function getQfcWeeklyDealsDefaults() {
  return { defaultLocationId: DEFAULT_QFC_LOCATION_ID };
}

export function parseLafObjectQueryParam(
  value: string | undefined,
): unknown[] | undefined {
  if (!value) return undefined;
  const parsed = JSON.parse(value) as unknown;
  return validateLafObject(parsed);
}

export function parseDealsQueryParams(input: {
  locationId?: string;
  divisionCode?: string;
  includeCoupons?: string;
  limit?: string;
  pageLimit?: string;
  lafObject?: string;
}): QfcWeeklyDealsOptions {
  const limit = input.limit ? Number.parseInt(input.limit, 10) : undefined;
  const pageLimit = input.pageLimit
    ? Number.parseInt(input.pageLimit, 10)
    : undefined;

  return {
    locationId: input.locationId,
    divisionCode: input.divisionCode,
    includeCoupons:
      typeof input.includeCoupons === "string"
        ? parseBooleanFlag(input.includeCoupons)
        : undefined,
    limit: Number.isFinite(limit as number) ? limit : undefined,
    pageLimit: Number.isFinite(pageLimit as number) ? pageLimit : undefined,
    lafObject: parseLafObjectQueryParam(input.lafObject),
  };
}
