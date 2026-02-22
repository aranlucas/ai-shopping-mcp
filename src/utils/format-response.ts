/**
 * Response formatting utilities for MCP tool responses
 * Provides human-readable formatting for products, locations, and other data
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
type AisleLocation =
  ProductComponents["schemas"]["products.productAisleLocationModel"];
type Department =
  LocationComponents["schemas"]["locations.departmentAtLocation"];

/**
 * Format a product for display with pricing and availability
 */
export function formatProduct(product: Product): string {
  const lines: string[] = [];

  // Product name and description
  lines.push(`**${product.description}**`);
  if (product.brand) {
    lines.push(`Brand: ${product.brand}`);
  }

  // Pricing information
  if (product.items && product.items.length > 0) {
    const item = product.items[0];
    if (item.price) {
      const regular = item.price.regular;
      const promo = item.price.promo;

      if (promo && promo !== regular) {
        lines.push(`Price: ~~$${regular}~~ **$${promo}** (Sale!)`);
      } else {
        lines.push(`Price: $${regular}`);
      }
    }

    // Size information
    if (item.size) {
      lines.push(`Size: ${item.size}`);
    }

    // Fulfillment availability
    if (item.fulfillment) {
      const fulfillment: string[] = [];
      if (item.fulfillment.curbside) fulfillment.push("Curbside");
      if (item.fulfillment.delivery) fulfillment.push("Delivery");
      if (item.fulfillment.instore) fulfillment.push("In-Store");
      if (item.fulfillment.shiptohome) fulfillment.push("Ship to Home");
      if (fulfillment.length > 0) {
        lines.push(`Available for: ${fulfillment.join(", ")}`);
      }
    }
  }

  // Product ID (UPC)
  if (product.upc) {
    lines.push(`UPC: ${product.upc}`);
  }

  // Category/Aisle information
  if (product.categories && product.categories.length > 0) {
    lines.push(`Category: ${product.categories.join(" > ")}`);
  }

  if (product.aisleLocations && product.aisleLocations.length > 0) {
    const aisles = product.aisleLocations
      .map((loc: AisleLocation) => `${loc.description} (${loc.number})`)
      .join(", ");
    lines.push(`Aisle: ${aisles}`);
  }

  return lines.join("\n");
}

/**
 * Format multiple products as a markdown list
 */
export function formatProductList(products: Product[]): string {
  if (products.length === 0) {
    return "No products found.";
  }

  const formatted = products.map((product, index) => {
    const productText = formatProduct(product);
    return `${index + 1}. ${productText.replace(/\n/g, "\n   ")}`;
  });

  return formatted.join("\n\n");
}

/**
 * Format product with focus on available options/variants
 * Shows each product once with its size/price options listed compactly
 */
export function formatProductWithOptions(product: Product): string {
  const lines: string[] = [];

  // Product header: name and brand
  const header = product.brand
    ? `**${product.description}** (${product.brand})`
    : `**${product.description}**`;
  lines.push(header);

  // Show all available size/price options
  if (product.items && product.items.length > 0) {
    lines.push("Options:");

    for (const item of product.items) {
      const optionParts: string[] = [];

      // Size
      if (item.size) {
        optionParts.push(item.size);
      }

      // Price
      if (item.price) {
        const regular = item.price.regular;
        const promo = item.price.promo;

        if (promo && promo !== regular) {
          optionParts.push(`~~$${regular}~~ **$${promo}**`);
        } else {
          optionParts.push(`$${regular}`);
        }
      }

      // Fulfillment status (compact)
      if (item.fulfillment) {
        const available: string[] = [];
        if (item.fulfillment.curbside) available.push("Pickup");
        if (item.fulfillment.delivery) available.push("Delivery");
        if (item.fulfillment.instore) available.push("In-Store");

        if (available.length > 0) {
          optionParts.push(`[${available.join("/")}]`);
        } else {
          optionParts.push("[Out of Stock]");
        }
      }

      // Stock level
      if (item.inventory?.stockLevel) {
        const stock = item.inventory.stockLevel;
        if (stock === "LOW") {
          optionParts.push("⚠️ Low Stock");
        } else if (stock === "TEMPORARILY_OUT_OF_STOCK") {
          optionParts.push("❌ Out");
        }
      }

      lines.push(`  • ${optionParts.join(" - ")}`);
    }
  }

  // UPC for adding to cart
  if (product.upc) {
    lines.push(`UPC: ${product.upc}`);
  }

  // Aisle location (if available)
  if (product.aisleLocations && product.aisleLocations.length > 0) {
    const aisle = product.aisleLocations[0];
    lines.push(`Location: ${aisle.description || `Aisle ${aisle.number}`}`);
  }

  return lines.join("\n");
}

/**
 * Format multiple products with options focus (for bulk search)
 */
export function formatProductListWithOptions(products: Product[]): string {
  if (products.length === 0) {
    return "No products found.";
  }

  const formatted = products.map((product, index) => {
    const productText = formatProductWithOptions(product);
    return `${index + 1}. ${productText.replace(/\n/g, "\n   ")}`;
  });

  return formatted.join("\n\n");
}

/**
 * COMPACT: Token-efficient product formatting
 * Reduces tokens by 60-70% while maintaining readability
 * Format: Name (Brand) | size1 $price [P/D/S], size2 $price [P/D] | UPC | Aisle
 */
export function formatProductCompact(product: Product): string {
  const parts: string[] = [];

  // Name and brand
  const name = product.brand
    ? `${product.description} (${product.brand})`
    : product.description || "Unknown";
  parts.push(name);

  // Options (size, price, fulfillment)
  if (product.items && product.items.length > 0) {
    const options = product.items
      .map((item) => {
        const opts: string[] = [];

        if (item.size) opts.push(item.size);

        if (item.price) {
          const regular = item.price.regular;
          const promo = item.price.promo;
          opts.push(promo && promo !== regular ? `$${promo}` : `$${regular}`);
        }

        // Fulfillment: P=Pickup, D=Delivery, S=InStore
        if (item.fulfillment) {
          const f: string[] = [];
          if (item.fulfillment.curbside) f.push("P");
          if (item.fulfillment.delivery) f.push("D");
          if (item.fulfillment.instore) f.push("S");

          if (f.length > 0) {
            opts.push(`[${f.join("/")}]`);
          } else {
            opts.push("[OOS]"); // Out of stock
          }
        }

        // Stock warning
        if (item.inventory?.stockLevel === "LOW") {
          opts.push("⚠️");
        } else if (item.inventory?.stockLevel === "TEMPORARILY_OUT_OF_STOCK") {
          opts.push("❌");
        }

        return opts.join(" ");
      })
      .join(", ");

    if (options) parts.push(options);
  }

  // UPC
  if (product.upc) parts.push(product.upc);

  // Aisle
  if (product.aisleLocations && product.aisleLocations.length > 0) {
    const aisle = product.aisleLocations[0];
    parts.push(aisle.description || `A${aisle.number}`);
  }

  return parts.join(" | ");
}

/**
 * COMPACT: Format multiple products efficiently
 */
export function formatProductListCompact(products: Product[]): string {
  if (products.length === 0) return "No products found.";

  return products
    .map((product, index) => `${index + 1}. ${formatProductCompact(product)}`)
    .join("\n");
}

/**
 * Format a location for display with address and hours
 */
export function formatLocation(location: Location): string {
  const lines: string[] = [];

  // Store name and chain
  if (location.name) {
    lines.push(`**${location.name}**`);
  }
  if (location.chain) {
    lines.push(`Chain: ${location.chain}`);
  }

  // Address
  if (location.address) {
    const addr = location.address;
    const addressLines = [addr.addressLine1, addr.addressLine2]
      .filter(Boolean)
      .join(", ");
    lines.push(`Address: ${addressLines}`);
    lines.push(`${addr.city}, ${addr.state} ${addr.zipCode}`);
  }

  // Phone number
  if (location.phone) {
    lines.push(`Phone: ${location.phone}`);
  }

  // Location ID
  if (location.locationId) {
    lines.push(`Location ID: ${location.locationId}`);
  }

  // Hours
  if (location.hours) {
    lines.push("\n**Hours:**");
    if (location.hours.timezone) {
      lines.push(`Timezone: ${location.hours.timezone}`);
    }
  }

  // Departments
  if (location.departments && location.departments.length > 0) {
    lines.push("\n**Departments:**");
    location.departments.forEach((dept: Department) => {
      if (dept.name) {
        let deptLine = `- ${dept.name}`;
        if (dept.phone) {
          deptLine += ` (${dept.phone})`;
        }
        lines.push(deptLine);
      }
    });
  }

  return lines.join("\n");
}

/**
 * Format multiple locations as a numbered list
 */
export function formatLocationList(locations: Location[]): string {
  if (locations.length === 0) {
    return "No locations found.";
  }

  const formatted = locations.map((location, index) => {
    const locationText = formatLocation(location);
    return `${index + 1}. ${locationText.replace(/\n/g, "\n   ")}`;
  });

  return formatted.join("\n\n");
}

/**
 * COMPACT: Token-efficient location formatting
 * Format: Name | Address, City ST ZIP | ID | Phone
 */
export function formatLocationCompact(location: Location): string {
  const parts: string[] = [];

  // Name and chain
  const name = location.chain
    ? `${location.name} (${location.chain})`
    : location.name || "Unknown";
  parts.push(name);

  // Address
  if (location.address) {
    const addr = location.address;
    const addressParts = [
      addr.addressLine1,
      addr.city,
      addr.state,
      addr.zipCode,
    ]
      .filter(Boolean)
      .join(" ");
    if (addressParts) parts.push(addressParts);
  }

  // Location ID
  if (location.locationId) parts.push(`ID:${location.locationId}`);

  // Phone
  if (location.phone) parts.push(location.phone);

  return parts.join(" | ");
}

/**
 * COMPACT: Format multiple locations efficiently
 */
export function formatLocationListCompact(locations: Location[]): string {
  if (locations.length === 0) return "No locations found.";

  return locations
    .map(
      (location, index) => `${index + 1}. ${formatLocationCompact(location)}`,
    )
    .join("\n");
}

/**
 * Format weekly deals for display
 */
export interface WeeklyDeal {
  product: string;
  details?: string;
  price: string;
  savings?: string | null;
  loyalty?: string;
  department?: string;
  validFrom?: string;
  validTill?: string;
  disclaimer?: string;
}

export function formatWeeklyDeal(deal: WeeklyDeal): string {
  const lines: string[] = [];

  lines.push(`**${deal.product}**`);

  if (deal.details) {
    lines.push(deal.details);
  }

  const priceLine = [deal.price];
  if (deal.savings) {
    priceLine.push(`(${deal.savings})`);
  }
  lines.push(priceLine.join(" "));

  if (deal.loyalty) {
    lines.push(`Loyalty: ${deal.loyalty}`);
  }

  if (deal.department) {
    lines.push(`Department: ${deal.department}`);
  }

  if (deal.validFrom && deal.validTill) {
    lines.push(`Valid: ${deal.validFrom} - ${deal.validTill}`);
  }

  if (deal.disclaimer) {
    lines.push(`*${deal.disclaimer}*`);
  }

  return lines.join("\n");
}

/**
 * Format multiple weekly deals as a numbered list
 */
export function formatWeeklyDealsList(deals: WeeklyDeal[]): string {
  if (deals.length === 0) {
    return "No weekly deals found.";
  }

  const formatted = deals.map((deal, index) => {
    const dealText = formatWeeklyDeal(deal);
    return `${index + 1}. ${dealText.replace(/\n/g, "\n   ")}`;
  });

  return formatted.join("\n\n");
}

/**
 * COMPACT: Token-efficient weekly deal formatting
 * Format: Name | details | $price (savings) | Loyalty | Dept
 * When suppressRepeats is provided, already-seen department/loyalty values are omitted.
 */
export function formatWeeklyDealCompact(
  deal: WeeklyDeal,
  suppressRepeats?: { seenDepts: Set<string>; seenLoyalty: Set<string> },
): string {
  const parts: string[] = [];

  parts.push(deal.product);

  if (deal.details) parts.push(deal.details);

  const priceParts: string[] = [deal.price];
  if (deal.savings) priceParts.push(`(${deal.savings})`);
  parts.push(priceParts.join(" "));

  if (deal.loyalty) {
    if (!suppressRepeats || !suppressRepeats.seenLoyalty.has(deal.loyalty)) {
      parts.push(deal.loyalty);
    }
  }

  if (deal.department) {
    if (!suppressRepeats || !suppressRepeats.seenDepts.has(deal.department)) {
      parts.push(deal.department);
    }
  }

  return parts.join(" | ");
}

const COMPACT_THRESHOLD = 50;

/**
 * COMPACT: Format multiple weekly deals efficiently.
 * First 50 deals show full info. After 50, already-seen departments and
 * loyalty tags are suppressed to save tokens. A department summary is
 * appended at the end when deals exceed the threshold.
 */
export function formatWeeklyDealsListCompact(deals: WeeklyDeal[]): string {
  if (deals.length === 0) return "No weekly deals found.";

  const seenDepts = new Set<string>();
  const seenLoyalty = new Set<string>();
  const deptCounts = new Map<string, number>();

  const lines = deals.map((deal, index) => {
    // Track department counts for the summary
    if (deal.department) {
      deptCounts.set(
        deal.department,
        (deptCounts.get(deal.department) || 0) + 1,
      );
    }

    const suppress =
      index >= COMPACT_THRESHOLD ? { seenDepts, seenLoyalty } : undefined;
    const line = `${index + 1}. ${formatWeeklyDealCompact(deal, suppress)}`;

    // Record values AFTER formatting so the first occurrence still prints
    if (deal.department) seenDepts.add(deal.department);
    if (deal.loyalty) seenLoyalty.add(deal.loyalty);

    return line;
  });

  // Append a department breakdown when we suppressed repeats
  if (deals.length > COMPACT_THRESHOLD && deptCounts.size > 0) {
    const summary = [...deptCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([dept, count]) => `${dept}(${count})`)
      .join(", ");
    lines.push("", `Dept breakdown: ${summary}`);
  }

  return lines.join("\n");
}

/**
 * Format pantry item for display
 */
export function formatPantryItem(item: PantryItem): string {
  const lines: string[] = [];

  lines.push(`**${item.productName}**`);
  lines.push(`Quantity: ${item.quantity}`);
  lines.push(`Added: ${new Date(item.addedAt).toLocaleDateString()}`);

  if (item.expiresAt) {
    const expiryDate = new Date(item.expiresAt);
    const daysUntilExpiry = Math.floor(
      (expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
    );

    if (daysUntilExpiry < 0) {
      lines.push(`Expires: ${expiryDate.toLocaleDateString()} (Expired)`);
    } else if (daysUntilExpiry === 0) {
      lines.push(`Expires: Today`);
    } else if (daysUntilExpiry <= 3) {
      lines.push(
        `Expires: ${expiryDate.toLocaleDateString()} (${daysUntilExpiry} days)`,
      );
    } else {
      lines.push(`Expires: ${expiryDate.toLocaleDateString()}`);
    }
  }

  return lines.join("\n");
}

export function formatPantryList(items: PantryItem[]): string {
  if (items.length === 0) {
    return "Your pantry is empty.";
  }

  const formatted = items.map((item, index) => {
    const itemText = formatPantryItem(item);
    return `${index + 1}. ${itemText.replace(/\n/g, "\n   ")}`;
  });

  return formatted.join("\n\n");
}

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
    const daysUntil = Math.floor(
      (expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
    );

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

  return items
    .map((item, index) => `${index + 1}. ${formatPantryItemCompact(item)}`)
    .join("\n");
}

/**
 * Format order record for display
 */
export function formatOrderRecord(order: OrderRecord): string {
  const lines: string[] = [];

  lines.push(`**Order #${order.orderId}**`);
  lines.push(`Placed: ${new Date(order.placedAt).toLocaleString()}`);
  lines.push(`Total Items: ${order.totalItems}`);

  if (order.estimatedTotal) {
    lines.push(`Estimated Total: $${order.estimatedTotal.toFixed(2)}`);
  }

  if (order.locationId) {
    lines.push(`Location: ${order.locationId}`);
  }

  if (order.notes) {
    lines.push(`Notes: ${order.notes}`);
  }

  // Format items
  lines.push("\nItems:");
  order.items.forEach((item) => {
    const priceStr = item.price ? ` - $${item.price.toFixed(2)}` : "";
    lines.push(`  - ${item.productName} (${item.quantity})${priceStr}`);
  });

  return lines.join("\n");
}

export function formatOrderHistory(orders: OrderRecord[]): string {
  if (orders.length === 0) {
    return "No order history found.";
  }

  const formatted = orders.map((order, index) => {
    const orderText = formatOrderRecord(order);
    return `${index + 1}. ${orderText.replace(/\n/g, "\n   ")}`;
  });

  return formatted.join("\n\n");
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
 * Format equipment item for display
 */
export function formatEquipmentItem(item: EquipmentItem): string {
  const lines: string[] = [];

  lines.push(`**${item.equipmentName}**`);

  if (item.category) {
    lines.push(`Category: ${item.category}`);
  }

  lines.push(`Added: ${new Date(item.addedAt).toLocaleDateString()}`);

  return lines.join("\n");
}

export function formatEquipmentList(items: EquipmentItem[]): string {
  if (items.length === 0) {
    return "Your equipment list is empty.";
  }

  const formatted = items.map((item, index) => {
    const itemText = formatEquipmentItem(item);
    return `${index + 1}. ${itemText.replace(/\n/g, "\n   ")}`;
  });

  return formatted.join("\n\n");
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

  return items
    .map((item, index) => `${index + 1}. ${formatEquipmentItemCompact(item)}`)
    .join("\n");
}

/**
 * Format preferred location for display
 */
export function formatPreferredLocation(location: PreferredLocation): string {
  const lines: string[] = [];

  lines.push(`**${location.locationName}**`);
  lines.push(`Chain: ${location.chain}`);
  lines.push(`Address: ${location.address}`);
  lines.push(`Location ID: ${location.locationId}`);
  lines.push(`Set: ${new Date(location.setAt).toLocaleDateString()}`);

  return lines.join("\n");
}

/**
 * COMPACT: Token-efficient preferred location formatting
 */
export function formatPreferredLocationCompact(
  location: PreferredLocation,
): string {
  return `${location.locationName} (${location.chain}) | ${location.address} | ${location.locationId}`;
}

/**
 * Format shopping list item for display
 */
export function formatShoppingListItem(item: ShoppingListItem): string {
  const lines: string[] = [];

  const checkbox = item.checked ? "[x]" : "[ ]";
  lines.push(`${checkbox} **${item.productName}**`);
  lines.push(`Quantity: ${item.quantity}`);

  if (item.upc) {
    lines.push(`UPC: ${item.upc}`);
  }

  if (item.notes) {
    lines.push(`Notes: ${item.notes}`);
  }

  lines.push(`Added: ${new Date(item.addedAt).toLocaleDateString()}`);

  return lines.join("\n");
}

export function formatShoppingList(items: ShoppingListItem[]): string {
  if (items.length === 0) {
    return "Your shopping list is empty.";
  }

  const unchecked = items.filter((i) => !i.checked);
  const checked = items.filter((i) => i.checked);

  const sections: string[] = [];

  if (unchecked.length > 0) {
    const formatted = unchecked.map((item, index) => {
      const itemText = formatShoppingListItem(item);
      return `${index + 1}. ${itemText.replace(/\n/g, "\n   ")}`;
    });
    sections.push(formatted.join("\n\n"));
  }

  if (checked.length > 0) {
    const formatted = checked.map((item, index) => {
      const itemText = formatShoppingListItem(item);
      return `${unchecked.length + index + 1}. ${itemText.replace(/\n/g, "\n   ")}`;
    });
    sections.push(`**Already in cart:**\n${formatted.join("\n\n")}`);
  }

  return sections.join("\n\n");
}

/**
 * COMPACT: Token-efficient shopping list item formatting
 * Format: [x]/[ ] Name x qty | UPC | Notes
 */
export function formatShoppingListItemCompact(item: ShoppingListItem): string {
  const parts: string[] = [];

  const checkbox = item.checked ? "[x]" : "[ ]";
  parts.push(`${checkbox} ${item.productName} x${item.quantity}`);

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
    .map(
      (item, index) => `${index + 1}. ${formatShoppingListItemCompact(item)}`,
    )
    .join("\n");
}
