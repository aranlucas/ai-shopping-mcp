/**
 * Response formatting utilities for MCP tool responses: compact, non-markdown
 * summaries for storage-backed lists (pantry, equipment, orders, shopping
 * lists, preferred location), plus the markdown formatters below the banner
 * that render model-facing `content[0].text` for Kroger API responses.
 */

import type { components as LocationComponents } from "../services/kroger/location.js";
import type { components as ProductComponents } from "../services/kroger/product.js";
import type {
  CatalogProduct,
  CatalogProvider,
  CatalogSearchResult,
} from "../services/catalog/types.js";
import type {
  EquipmentItem,
  OrderRecord,
  PantryItem,
  PreferredLocation,
  ShoppingListItem,
} from "./user-storage.js";

type Product = ProductComponents["schemas"]["products.productModel"];
type Location = LocationComponents["schemas"]["locations.location"];

/**
 * COMPACT: Token-efficient pantry item formatting
 * Format: Name x qty | Exp: date
 */
export function formatPantryItemCompact(item: PantryItem): string {
  const parts: string[] = [];

  // Name and quantity
  parts.push(`${item.productName} x${item.quantity}`);

  // Expiry with urgency indicator
  if (item.expiresAt) {
    const expiryDate = new Date(item.expiresAt);
    const daysUntil = Math.floor((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

    if (daysUntil < 0) {
      parts.push("❌EXPIRED");
    } else if (daysUntil === 0) {
      parts.push("⚠️TODAY");
    } else if (daysUntil <= 3) {
      parts.push(`⚠️${daysUntil}d`);
    } else {
      parts.push(`${expiryDate.toLocaleDateString()}`);
    }
  }

  return parts.join(" | ");
}

/**
 * COMPACT: Format pantry list efficiently
 */
export function formatPantryListCompact(items: PantryItem[]): string {
  if (items.length === 0) return "Pantry empty.";

  return items.map((item, index) => `${index + 1}. ${formatPantryItemCompact(item)}`).join("\n");
}

/**
 * COMPACT: Token-efficient order record formatting
 * Format: OrderID | Date | N items $total | Location
 */
export function formatOrderRecordCompact(order: OrderRecord): string {
  const parts: string[] = [];

  // Order ID (shortened)
  const shortId = order.orderId.split("-").pop() || order.orderId;
  parts.push(`#${shortId}`);

  // Date
  const date = new Date(order.placedAt).toLocaleDateString();
  parts.push(date);

  // Items and total
  const itemsSummary = `${order.totalItems} items${order.estimatedTotal ? ` $${order.estimatedTotal.toFixed(2)}` : ""}`;
  parts.push(itemsSummary);

  // Location
  if (order.locationId) parts.push(order.locationId);

  return parts.join(" | ");
}

/**
 * COMPACT: Format order history efficiently
 */
export function formatOrderHistoryCompact(orders: OrderRecord[]): string {
  if (orders.length === 0) return "No orders.";

  return orders
    .map((order, index) => `${index + 1}. ${formatOrderRecordCompact(order)}`)
    .join("\n");
}

/**
 * COMPACT: Token-efficient equipment item formatting
 * Format: Name | Category
 */
export function formatEquipmentItemCompact(item: EquipmentItem): string {
  const parts: string[] = [];

  // Name
  parts.push(item.equipmentName);

  // Category
  if (item.category) {
    parts.push(item.category);
  }

  return parts.join(" | ");
}

/**
 * COMPACT: Format equipment list efficiently
 */
export function formatEquipmentListCompact(items: EquipmentItem[]): string {
  if (items.length === 0) return "Equipment list empty.";

  return items.map((item, index) => `${index + 1}. ${formatEquipmentItemCompact(item)}`).join("\n");
}

/**
 * COMPACT: Token-efficient preferred location formatting
 */
export function formatPreferredLocationCompact(location: PreferredLocation): string {
  return `${location.locationName} (${location.chain}) | ${location.address} | ${location.locationId}`;
}

/**
 * COMPACT: Token-efficient shopping list item formatting
 * Format: Name x qty | UPC | Notes
 */
export function formatShoppingListItemCompact(item: ShoppingListItem): string {
  const parts: string[] = [];

  parts.push(`${item.productName} x${item.quantity}`);

  if (item.upc) {
    parts.push(item.upc);
  }

  if (item.notes) {
    parts.push(item.notes);
  }

  return parts.join(" | ");
}

/**
 * COMPACT: Format shopping list efficiently
 */
export function formatShoppingListCompact(items: ShoppingListItem[]): string {
  if (items.length === 0) return "Shopping list empty.";

  return items
    .map((item, index) => `${index + 1}. ${formatShoppingListItemCompact(item)}`)
    .join("\n");
}

// ---------------------------------------------------------------------------
// MARKDOWN: model-facing formatters for small-model reliability.
//
// These replace TOON in `content[0].text` for tools whose output an LLM must
// parse and act on directly (e.g., copying a upc into another tool call).
// TOON is unfamiliar to small models; plain markdown lines with explicit
// `key=value` labels for the fields the model must transcribe are more
// reliable. `structuredContent` is separately projected to the fields used by
// the React views because some hosts also expose it to the model.
// ---------------------------------------------------------------------------

/**
 * One catalog line, in the shared vocabulary.
 *
 * The identifier is labeled with its provider (`kroger upc=`, `trader_joes
 * sku=`) rather than a bare `upc=`, because the two are not interchangeable and
 * a model that confuses them will send a Trader Joe's SKU to a cart tool.
 */
export function formatCatalogProductLine(
  product: CatalogProduct,
  provider: CatalogProvider,
  options: { includeLocation?: boolean } = {},
): string {
  const idLabel = provider.capabilities.cart ? "upc" : "sku";
  const parts: string[] = [`${provider.id} ${idLabel}=${product.id || "unknown"}`, product.name];

  if (product.brand) parts.push(product.brand);
  if (product.size) parts.push(product.size);

  if (product.price !== undefined) {
    parts.push(
      product.regularPrice !== undefined
        ? `$${product.price} (was $${product.regularPrice})`
        : `$${product.price}`,
    );
  }

  if (provider.capabilities.cart) parts.push(`pickup: ${product.pickup ? "yes" : "no"}`);
  if (!product.available) parts.push("out of stock");

  const aisle = product.aisle;
  if (options.includeLocation && aisle) {
    const description = aisle.description?.trim();
    const number = aisle.number?.trim();
    const locationLabel =
      description && number && !description.split(/\s+/).includes(number)
        ? `${description} ${number}`
        : (description ?? number);
    if (locationLabel) parts.push(`location: ${locationLabel}`);
    if (aisle.sequenceNumber) parts.push(`route sequence: ${aisle.sequenceNumber}`);
    if (aisle.bayNumber) parts.push(`bay: ${aisle.bayNumber}`);
    if (aisle.side) parts.push(`side: ${aisle.side}`);
    if (aisle.shelfNumber) parts.push(`shelf: ${aisle.shelfNumber}`);
    if (aisle.shelfPositionInBay) parts.push(`shelf position: ${aisle.shelfPositionInBay}`);
  }

  return `- ${parts.join(" | ")}`;
}

/**
 * Markdown for search_products: one heading per search term, then one block per
 * provider that was searched.
 *
 * The closing lines name which providers can reach a cart and which cannot,
 * because that is the one difference between them a model must act on.
 */
export function formatCatalogSearchMarkdown(
  results: CatalogSearchResult[],
  providers: CatalogProvider[],
  options: { includeLocation?: boolean } = {},
): string {
  const terms = [...new Set(results.map((result) => result.term))];
  const lines: string[] = [];

  for (const term of terms) {
    lines.push(`## ${term}`);
    for (const provider of providers) {
      const result = results.find(
        (candidate) => candidate.term === term && candidate.provider === provider.id,
      );
      if (!result) continue;
      if (result.failed) {
        lines.push(`- ${provider.label} search failed for this term.`);
      } else if (result.products.length === 0) {
        lines.push(`- No ${provider.label} results.`);
      } else {
        for (const product of result.products) {
          lines.push(formatCatalogProductLine(product, provider, options));
        }
      }
    }
  }

  const cartable = providers.filter((provider) => provider.capabilities.cart);
  const listOnly = providers.filter((provider) => !provider.capabilities.cart);
  lines.push("");
  if (cartable.length > 0) {
    lines.push("To buy items, pass the exact upc values above to create_shopping_list.");
  }
  for (const provider of listOnly) {
    lines.push(
      `${provider.label} has no cart: add those to a list by productName, and never send their ids to a cart tool.`,
    );
  }
  return lines.join("\n");
}

/** Markdown key/value lines for get_product: no images. */
export function formatProductDetailMarkdown(product: Product): string {
  const lines: string[] = [
    `upc: ${product.upc ?? "unknown"}`,
    `description: ${product.description ?? "unknown"}`,
  ];

  if (product.brand) lines.push(`brand: ${product.brand}`);

  if (product.items && product.items.length > 0) {
    lines.push("variants:");
    for (const item of product.items) {
      const parts: string[] = [];
      if (item.size) parts.push(item.size);

      if (item.price) {
        const { regular, promo } = item.price;
        parts.push(
          promo != null && promo !== regular ? `$${promo} (was $${regular})` : `$${regular ?? "?"}`,
        );
      }

      const pickup = Boolean(item.fulfillment?.curbside || item.fulfillment?.instore);
      parts.push(`pickup: ${pickup ? "yes" : "no"}`);
      if (item.inventory?.stockLevel) parts.push(`stock: ${item.inventory.stockLevel}`);

      lines.push(`- ${parts.join(" | ")}`);
    }
  }

  if (product.aisleLocations && product.aisleLocations.length > 0) {
    const aisle = product.aisleLocations[0];
    lines.push(`aisle: ${[aisle.description, aisle.number].filter(Boolean).join(" ")}`);
  }

  return lines.join("\n");
}

/** One markdown line for a store: storeId, name, address, phone. */
export function formatStoreLineMarkdown(location: Location): string {
  const parts: string[] = [
    `storeId=${location.locationId ?? "unknown"}`,
    location.name || "Unknown store",
  ];

  if (location.address) {
    const { addressLine1, city, state, zipCode } = location.address;
    const cityStateZip = [[city, state].filter(Boolean).join(" "), zipCode]
      .filter(Boolean)
      .join(" ");
    const full = [addressLine1, cityStateZip].filter(Boolean).join(", ");
    if (full) parts.push(full);
  }

  if (location.phone) parts.push(`phone ${location.phone}`);

  return `- ${parts.join(" | ")}`;
}

/** Markdown for search_stores: one line per store. */
export function formatStoreListMarkdown(stores: Location[]): string {
  if (stores.length === 0) return "No stores found.";
  return stores.map(formatStoreLineMarkdown).join("\n");
}

/** Markdown hours block for get_store. */
function formatStoreHoursMarkdown(location: Location): string {
  if (!location.hours) return "";

  const days = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ] as const;

  const lines = ["hours:"];
  for (const day of days) {
    const hours = location.hours[day];
    if (hours) lines.push(`- ${day}: ${hours.open ?? "?"}-${hours.close ?? "?"}`);
  }

  return lines.length > 1 ? lines.join("\n") : "";
}

/** Markdown for get_store: the store line plus hours. */
export function formatStoreDetailMarkdown(location: Location): string {
  const lines = [formatStoreLineMarkdown(location)];
  const hours = formatStoreHoursMarkdown(location);
  if (hours) lines.push(hours);
  return lines.join("\n");
}

/** Minimal shape formatWeeklyDealsMarkdown needs — matches QfcDealsApiResponse deal entries. */
export type WeeklyDealMarkdownItem = {
  title: string;
  details?: string;
  price?: string;
  savings?: string | null;
  category: string;
};

/** One markdown line for a weekly deal: title, details, price, savings. */
function formatWeeklyDealLineMarkdown(deal: WeeklyDealMarkdownItem): string {
  const parts: string[] = [deal.title];
  if (deal.details) parts.push(deal.details);
  if (deal.price) parts.push(deal.price);
  if (deal.savings) parts.push(deal.savings);
  return `- ${parts.join(" | ")}`;
}

/**
 * Markdown for get_weekly_deals: header with validity window and deal count,
 * then deals grouped under a plain `{category}:` label line per category
 * change (deals arrive pre-sorted by category — see formatWeeklyDealsToolResponse).
 * Deliberately not a markdown heading (`#`/`##`/`###`): a plain label line
 * costs fewer tokens and matches this file's existing `hours:`/`variants:`
 * label convention.
 */
export function formatWeeklyDealsMarkdown(
  deals: WeeklyDealMarkdownItem[],
  validFrom?: string,
  validTill?: string,
  warnings?: string[],
): string {
  const lines: string[] = [
    validFrom && validTill
      ? `Deals valid ${validFrom} to ${validTill}. dealCount: ${deals.length}`
      : `dealCount: ${deals.length}`,
  ];

  if (warnings && warnings.length > 0) {
    lines.push(`warnings: ${warnings.join("; ")}`);
  }

  if (deals.length === 0) return lines.join("\n");

  let lastCategory: string | undefined;
  for (const deal of deals) {
    if (deal.category !== lastCategory) {
      lines.push(`${deal.category}:`);
      lastCategory = deal.category;
    }
    lines.push(formatWeeklyDealLineMarkdown(deal));
  }

  return lines.join("\n");
}
