import * as z from "zod/v4";

/**
 * The warning codes are part of the weekly-deals domain contract.  Callers
 * can choose their own wording for a warning without having to parse a
 * diagnostic string produced by a lower layer.
 */
export const weeklyDealWarningCodeSchema = z.enum([
  "legacy",
  "circular_fetch_failed",
  "print_ad_failed",
  "print_ad_partial",
  "search_augmentation_failed",
  "search_partial",
  "search_failed",
  "cache_served",
  "cache_read_failed",
  "live_refresh_partial",
  "cache_write_failed",
  "live_refresh_failed",
]);

const warningDetailValueSchema = z.union([z.string(), z.number(), z.boolean()]);

export const weeklyDealWarningSchema = z.object({
  code: weeklyDealWarningCodeSchema,
  details: z.record(z.string(), warningDetailValueSchema).optional(),
});

export type WeeklyDealWarningCode = z.output<
  typeof weeklyDealWarningCodeSchema
>;
export type WeeklyDealWarning = z.output<typeof weeklyDealWarningSchema>;

/** Construct a warning while keeping the details free of presentation text. */
export function weeklyDealWarning(
  code: Exclude<WeeklyDealWarningCode, "legacy">,
  details?: Record<string, string | number | boolean>,
): WeeklyDealWarning {
  return details === undefined ? { code } : { code, details };
}

/**
 * Circular metadata returned by the Kroger Digital Ads endpoint.  The API
 * response is deliberately parsed at the source boundary instead of being
 * accepted through a generated TypeScript type assertion.
 */
export const circularSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  eventName: z.string(),
  eventStartDate: z.string(),
  eventEndDate: z.string(),
  divisionCode: z.string(),
  divisionName: z.string(),
  week: z.string(),
  previewCircular: z.boolean(),
  timezone: z.string(),
  circularType: z.string(),
  tags: z.array(z.string()),
  description: z.string(),
  locationId: z.string(),
});

export const circularsResponseSchema = z.object({
  data: z.array(circularSchema),
});

export type Circular = z.output<typeof circularSchema>;

/** Raw DACS responses used by the print-ad adapter. */
export const dacsListingResponseSchema = z.object({
  pages: z
    .array(
      z.object({
        eventPageId: z.string().optional(),
        page: z.string().optional(),
      }),
    )
    .optional(),
  adId: z.string().optional(),
  adTitle: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export const dacsPageResponseSchema = z.object({
  eventPageId: z.string().optional(),
  contents: z
    .array(
      z.object({
        contentType: z.string().optional(),
        mapConfig: z.string().optional(),
      }),
    )
    .optional(),
});

export const dacsOfferDetailsSchema = z.object({
  headline: z.string().optional(),
  bodyCopy: z.string().nullable().optional(),
  pricingText: z.string().nullable().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  imageURL: z.string().nullable().optional(),
  disclaimer: z.string().nullable().optional(),
  isShoppable: z.boolean().optional(),
});

export const dacsMapConfigSchema = z.object({
  content: z.object({
    id: z.number(),
    headline: z.string(),
    bodyCopy: z.string().nullable().optional(),
    imageURL: z.string().nullable().optional(),
    offerVersionProductGroupId: z.number().optional(),
  }),
});

/**
 * Only fields used by deal normalization are retained from product search
 * responses.  Unknown product fields are harmless and are accepted by the
 * source adapter, but fields used by normalization must have the expected
 * runtime types.
 */
const productSearchItemSchema = z.object({
  size: z.string().optional(),
  price: z
    .object({
      regular: z.number().optional(),
      promo: z.number().optional(),
    })
    .optional(),
});

const productSearchImageSizeSchema = z.object({
  size: z.string().optional(),
  url: z.string().optional(),
});

const productSearchImageSchema = z.object({
  default: z.boolean().optional(),
  sizes: z.array(productSearchImageSizeSchema).optional(),
});

export const productSearchProductSchema = z.object({
  productId: z.string().optional(),
  upc: z.string().optional(),
  description: z.string().optional(),
  categories: z.array(z.string()).optional(),
  items: z.array(productSearchItemSchema).optional(),
  images: z.array(productSearchImageSchema).optional(),
});

export const productSearchProductsSchema = z.array(productSearchProductSchema);
export type ProductSearchProduct = z.output<typeof productSearchProductSchema>;

const normalizedDealSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  details: z.string().optional(),
  price: z.string().optional(),
  savings: z.string().optional(),
  loyalty: z.string().optional(),
  department: z.string().optional(),
  validFrom: z.string().optional(),
  validTill: z.string().optional(),
  disclaimer: z.string().optional(),
  imageUrl: z.string().optional(),
  source: z.enum(["search_api", "print"]),
  rawType: z.string().optional(),
});

export const normalizedWeeklyDealsMetaSchema = z.object({
  termCount: z.number().int().nonnegative().optional(),
  pageCount: z.number().int().nonnegative().optional(),
  augmentedCount: z.number().int().nonnegative().optional(),
  degraded: z.boolean().optional(),
  failedTermCount: z.number().int().nonnegative().optional(),
  failureMessages: z.array(z.string()).optional(),
});

/** Fully normalized result shared by live source, cache, and tools. */
export const normalizedWeeklyDealsResultSchema = z.object({
  sourceMode: z.enum(["search_api", "print_fallback"]),
  locationId: z.string().min(1),
  divisionCode: z.string().min(1),
  shoppableCircular: circularSchema.optional(),
  printCircular: circularSchema.optional(),
  warnings: z.array(weeklyDealWarningSchema),
  deals: z.array(normalizedDealSchema),
  meta: normalizedWeeklyDealsMetaSchema.optional(),
});

export type NormalizedWeeklyDeal = z.output<typeof normalizedDealSchema>;
export type QfcDealsApiResponse = z.output<
  typeof normalizedWeeklyDealsResultSchema
>;

/**
 * A cache entry may contain warnings written by the previous string-based
 * model.  Convert those records to an explicit legacy warning at the cache
 * boundary; every value returned from this parser is still normalized.
 */
const cacheWarningSchema = z
  .union([weeklyDealWarningSchema, z.string()])
  .transform((warning): WeeklyDealWarning =>
    typeof warning === "string"
      ? { code: "legacy", details: { message: warning } }
      : warning,
  );

export const cacheWeeklyDealsResultSchema =
  normalizedWeeklyDealsResultSchema.extend({
    warnings: z.array(cacheWarningSchema),
  });

export type CachedQfcDealsApiResponse = z.output<
  typeof cacheWeeklyDealsResultSchema
>;

export const weeklyDealCacheEntrySchema = z
  .object({
    version: z.literal(1),
    createdAt: z.number().finite(),
    freshUntil: z.number().finite(),
    staleUntil: z.number().finite(),
    data: cacheWeeklyDealsResultSchema,
  })
  .refine((entry) => entry.createdAt <= entry.staleUntil, {
    message: "createdAt must not be after staleUntil",
  })
  .refine((entry) => entry.freshUntil <= entry.staleUntil, {
    message: "freshUntil must not be after staleUntil",
  });

export type WeeklyDealsCacheEntry = z.output<typeof weeklyDealCacheEntrySchema>;
