/**
 * Response formatting utilities for MCP tool responses
 * Provides human-readable formatting for products, locations, and other data
 */

import type { components as LocationComponents } from "../services/kroger/location.js";
import type { components as ProductComponents } from "../services/kroger/product.js";

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
 * Format pantry item for display
 */
export interface PantryItemDisplay {
  productId: string;
  productName: string;
  quantity: number;
  addedAt: string;
  expiresAt?: string;
}

export function formatPantryItem(item: PantryItemDisplay): string {
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

  lines.push(`Product ID: ${item.productId}`);

  return lines.join("\n");
}

export function formatPantryList(items: PantryItemDisplay[]): string {
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
 * Format order record for display
 */
export interface OrderRecordDisplay {
  orderId: string;
  items: Array<{
    productId: string;
    productName: string;
    quantity: number;
    price?: number;
  }>;
  totalItems: number;
  estimatedTotal?: number;
  placedAt: string;
  locationId?: string;
  notes?: string;
}

export function formatOrderRecord(order: OrderRecordDisplay): string {
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

export function formatOrderHistory(orders: OrderRecordDisplay[]): string {
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
 * Format preferred location for display
 */
export interface PreferredLocationDisplay {
  locationId: string;
  locationName: string;
  address: string;
  chain: string;
  setAt: string;
}

export function formatPreferredLocation(
  location: PreferredLocationDisplay,
): string {
  const lines: string[] = [];

  lines.push(`**${location.locationName}**`);
  lines.push(`Chain: ${location.chain}`);
  lines.push(`Address: ${location.address}`);
  lines.push(`Location ID: ${location.locationId}`);
  lines.push(`Set: ${new Date(location.setAt).toLocaleDateString()}`);

  return lines.join("\n");
}
