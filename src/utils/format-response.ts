/**
 * Response formatting utilities for MCP tool responses: compact, non-markdown
 * summaries for storage-backed lists (pantry, equipment, orders, shopping
 * lists, preferred location), plus the markdown formatters below the banner
 * that render model-facing `content[0].text` for Kroger API responses.
 */

import type { components as LocationComponents } from "../services/kroger/location.js";
import type { components as ProductComponents } from "../services/kroger/product.js";
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
// reliable. `structuredContent` is untouched — the React views keep reading
// full data from there.
// ---------------------------------------------------------------------------

/** One markdown line summarizing a single product for search_products output. */
export function formatProductSearchLineMarkdown(product: Product): string {
  const item = product.items?.[0];
  const parts: string[] = [
    `upc=${product.upc ?? "unknown"}`,
    product.description || "Unknown product",
  ];

  if (product.brand) parts.push(product.brand);
  if (item?.size) parts.push(item.size);

  if (item?.price) {
    const { regular, promo } = item.price;
    if (promo != null && promo !== regular) {
      parts.push(`$${promo} (was $${regular})`);
    } else if (regular != null) {
      parts.push(`$${regular}`);
    }
  }

  const pickup = Boolean(item?.fulfillment?.curbside || item?.fulfillment?.instore);
  parts.push(`pickup: ${pickup ? "yes" : "no"}`);

  const aisle = product.aisleLocations?.[0]?.number;
  if (aisle) parts.push(`aisle: ${aisle}`);

  return `- ${parts.join(" | ")}`;
}

/** Markdown for search_products: one heading + product lines per search term. */
export function formatSearchProductsMarkdown(
  results: Array<{ term: string; products: Product[]; count: number; failed: boolean }>,
): string {
  const lines: string[] = [];

  for (const result of results) {
    lines.push(`## ${result.term}`);
    if (result.failed) {
      lines.push("Search failed for this term.");
    } else if (result.products.length === 0) {
      lines.push("No results.");
    } else {
      for (const product of result.products) {
        lines.push(formatProductSearchLineMarkdown(product));
      }
    }
  }

  lines.push("", "To buy items, pass the exact upc values above to create_shopping_list.");
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
export function formatStoreHoursMarkdown(location: Location): string {
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
};

/** One markdown line for a weekly deal: title, details, price, savings. */
export function formatWeeklyDealLineMarkdown(deal: WeeklyDealMarkdownItem): string {
  const parts: string[] = [deal.title];
  if (deal.details) parts.push(deal.details);
  if (deal.price) parts.push(deal.price);
  if (deal.savings) parts.push(deal.savings);
  return `- ${parts.join(" | ")}`;
}

/** Markdown for get_weekly_deals: header with validity window and deal count, then lines. */
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

  return [...lines, ...deals.map(formatWeeklyDealLineMarkdown)].join("\n");
}
