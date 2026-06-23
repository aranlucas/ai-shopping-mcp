import * as z from "zod/v4";

/**
 * Output schemas for tools that return `structuredContent`.
 *
 * Per the MCP spec (2025-11-25): when a tool declares an `outputSchema`,
 * its results must conform to it. Schemas are intentionally loose
 * (`z.looseObject`) on nested API payloads so additional Kroger API fields
 * pass through without validation churn.
 *
 * The `_view` discriminator drives client-side view routing in the React app
 * (see `views/shared/types.ts`).
 */

const productSchema = z.looseObject({
  upc: z.string().optional(),
  description: z.string().optional(),
  brand: z.string().optional(),
  categories: z.array(z.string()).optional(),
  aisleLocations: z
    .array(z.looseObject({ description: z.string().optional(), number: z.string().optional() }))
    .optional(),
  images: z
    .array(
      z.looseObject({
        perspective: z.string().optional(),
        default: z.boolean().optional(),
        sizes: z
          .array(
            z.looseObject({
              id: z.string().optional(),
              size: z.string().optional(),
              url: z.string().optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
  items: z
    .array(
      z.looseObject({
        itemId: z.string().optional(),
        size: z.string().optional(),
        price: z
          .looseObject({ regular: z.number().optional(), promo: z.number().optional() })
          .optional(),
        fulfillment: z
          .looseObject({
            curbside: z.boolean().optional(),
            delivery: z.boolean().optional(),
            instore: z.boolean().optional(),
            shiptohome: z.boolean().optional(),
          })
          .optional(),
        inventory: z.looseObject({ stockLevel: z.string().optional() }).optional(),
      }),
    )
    .optional(),
});

const locationSchema = z.looseObject({
  locationId: z.string().optional(),
  name: z.string().optional(),
  chain: z.string().optional(),
  address: z
    .looseObject({
      addressLine1: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      zipCode: z.string().optional(),
    })
    .optional(),
  phone: z.string().optional(),
  departments: z
    .array(z.looseObject({ name: z.string().optional(), phone: z.string().optional() }))
    .optional(),
});

const pantryItemSchema = z.looseObject({
  productName: z.string(),
  quantity: z.number(),
  addedAt: z.string().optional(),
  expiresAt: z.string().optional(),
});

const shoppingListItemSchema = z.looseObject({
  productName: z.string(),
  upc: z.string().optional(),
  quantity: z.number(),
  notes: z.string().optional(),
  addedAt: z.string().optional(),
  checked: z.boolean(),
});

const recipeSchema = z.looseObject({
  title: z.string(),
  description: z.string().optional(),
  cuisine: z.string().optional(),
  difficulty: z.string().optional(),
  prepTime: z.number().optional(),
  cookTime: z.number().optional(),
  totalTime: z.number().optional(),
  servings: z.string().optional(),
  slug: z.string(),
  ingredients: z
    .array(
      z.looseObject({
        quantity: z.string().optional(),
        unit: z.string().optional(),
        name: z.string(),
        notes: z.string().optional(),
      }),
    )
    .optional(),
  instructions: z
    .array(z.looseObject({ stepNumber: z.number(), instruction: z.string() }))
    .optional(),
});

const dealSchema = z.looseObject({
  title: z.string(),
  details: z.string().optional(),
  price: z.string().optional(),
  savings: z.string().nullable().optional(),
  validFrom: z.string().optional(),
  validTill: z.string().optional(),
});

export const searchProductsOutputSchema = z.object({
  _view: z.literal("search_products"),
  results: z.array(
    z.looseObject({
      term: z.string(),
      products: z.array(productSchema),
      count: z.number().optional(),
      failed: z.boolean(),
    }),
  ),
  totalProducts: z.number(),
});

export const getProductDetailsOutputSchema = z.object({
  _view: z.literal("get_product_details"),
  product: productSchema,
});

export const searchLocationsOutputSchema = z.object({
  _view: z.literal("search_locations"),
  locations: z.array(locationSchema),
});

export const getLocationDetailsOutputSchema = z.object({
  _view: z.literal("get_location_details"),
  location: locationSchema,
});

export const managePantryOutputSchema = z.object({
  _view: z.literal("manage_pantry"),
  items: z.array(pantryItemSchema),
  actionDetail: z.string().optional(),
});

export const manageShoppingListOutputSchema = z.object({
  _view: z.literal("manage_shopping_list"),
  items: z.array(shoppingListItemSchema),
  actionDetail: z.string().optional(),
});

export const searchRecipesOutputSchema = z.object({
  _view: z.literal("search_recipes_from_web"),
  recipes: z.array(recipeSchema),
  searchQuery: z.string(),
});

export const getWeeklyDealsOutputSchema = z.object({
  _view: z.literal("get_weekly_deals"),
  deals: z.array(dealSchema),
  validFrom: z.string().optional(),
  validTill: z.string().optional(),
  cache: z.looseObject({ state: z.enum(["miss", "fresh", "stale"]) }).optional(),
});

export const markOrderPlacedOutputSchema = z.object({
  _view: z.literal("mark_order_placed"),
  orderId: z.string(),
  items: z.array(
    z.looseObject({
      productId: z.string(),
      productName: z.string(),
      quantity: z.number(),
      price: z.number().optional(),
    }),
  ),
  totalItems: z.number(),
  estimatedTotal: z.number().optional(),
  placedAt: z.string(),
  locationId: z.string().optional(),
  notes: z.string().optional(),
});
