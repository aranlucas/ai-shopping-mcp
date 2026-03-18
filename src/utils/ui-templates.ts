/**
 * HTML UI templates for MCP UI integration.
 * Each function generates self-contained HTML with embedded CSS for rendering
 * rich interactive UIs in MCP-UI-compatible clients.
 */

import type { components as LocationComponents } from "../services/kroger/location.js";
import type { components as ProductComponents } from "../services/kroger/product.js";
import type { PantryItem, ShoppingListItem } from "./user-storage.js";

type Product = ProductComponents["schemas"]["products.productModel"];
type ProductItem = ProductComponents["schemas"]["products.productItemModel"];
type Location = LocationComponents["schemas"]["locations.location"];

// Shared base styles
const BASE_STYLES = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: #1a1a2e;
    background: #f8f9fa;
    padding: 16px;
    line-height: 1.5;
  }
  .header {
    font-size: 18px;
    font-weight: 700;
    margin-bottom: 12px;
    color: #1a1a2e;
  }
  .subheader {
    font-size: 13px;
    color: #6b7280;
    margin-bottom: 16px;
  }
  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
  }
  .badge-green { background: #dcfce7; color: #166534; }
  .badge-red { background: #fef2f2; color: #991b1b; }
  .badge-yellow { background: #fefce8; color: #854d0e; }
  .badge-blue { background: #eff6ff; color: #1e40af; }
  .badge-gray { background: #f3f4f6; color: #4b5563; }
  .card {
    background: white;
    border-radius: 10px;
    padding: 14px;
    margin-bottom: 10px;
    border: 1px solid #e5e7eb;
    transition: box-shadow 0.15s;
  }
  .card:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
  .grid { display: grid; gap: 10px; }
  .grid-2 { grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
  .price { font-size: 18px; font-weight: 700; color: #059669; }
  .price-original {
    text-decoration: line-through;
    color: #9ca3af;
    font-size: 13px;
    margin-left: 6px;
  }
  .sale-badge {
    background: #ef4444;
    color: white;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 700;
    margin-left: 6px;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    border: none;
    cursor: pointer;
    transition: background 0.15s;
  }
  .btn-primary { background: #2563eb; color: white; }
  .btn-primary:hover { background: #1d4ed8; }
  .btn-secondary { background: #f3f4f6; color: #374151; border: 1px solid #d1d5db; }
  .btn-secondary:hover { background: #e5e7eb; }
  .meta-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 6px;
  }
  .meta-item {
    font-size: 12px;
    color: #6b7280;
  }
  .divider { border-top: 1px solid #e5e7eb; margin: 8px 0; }
  .empty-state {
    text-align: center;
    padding: 32px 16px;
    color: #9ca3af;
  }
  .product-name {
    font-weight: 600;
    font-size: 14px;
    margin-bottom: 2px;
  }
  .product-brand {
    font-size: 12px;
    color: #6b7280;
  }
  .product-size {
    font-size: 12px;
    color: #6b7280;
    margin-top: 2px;
  }
  .fulfillment-tags {
    display: flex;
    gap: 4px;
    margin-top: 6px;
    flex-wrap: wrap;
  }
  .tag {
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
  }
  .tag-pickup { background: #dbeafe; color: #1e40af; }
  .tag-delivery { background: #fce7f3; color: #9d174d; }
  .tag-instore { background: #d1fae5; color: #065f46; }
  .tag-oos { background: #fef2f2; color: #991b1b; }
`;

const ACTION_SCRIPT = `
<script>
function postAction(result) {
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'ui-action-result',
        ...result
      }, '*');
    }
  } catch (e) {
    console.warn('postAction failed:', e);
  }
}
function addToCart(upc, quantity) {
  postAction({
    type: 'tool',
    payload: {
      toolName: 'add_to_cart',
      params: { items: [{ upc, quantity: quantity || 1, modality: 'PICKUP' }] }
    }
  });
}
function addToShoppingList(productName, upc) {
  postAction({
    type: 'tool',
    payload: {
      toolName: 'manage_shopping_list',
      params: {
        action: 'add',
        items: [{ productName, upc: upc || undefined, quantity: 1 }]
      }
    }
  });
}
function searchProducts(term) {
  postAction({
    type: 'tool',
    payload: {
      toolName: 'search_products',
      params: { terms: [term] }
    }
  });
}
</script>
`;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getProductPrice(product: Product): {
  regular?: number;
  promo?: number;
  hasPromo: boolean;
} {
  const item = product.items?.[0];
  if (!item?.price) return { hasPromo: false };
  const regular = item.price.regular;
  const promo = item.price.promo;
  return {
    regular,
    promo,
    hasPromo: !!(promo && promo !== regular),
  };
}

function getProductFulfillment(product: Product): string[] {
  const item = product.items?.[0];
  if (!item?.fulfillment) return [];
  const tags: string[] = [];
  if (item.fulfillment.curbside) tags.push("Pickup");
  if (item.fulfillment.delivery) tags.push("Delivery");
  if (item.fulfillment.instore) tags.push("In-Store");
  return tags;
}

function renderProductCard(product: Product): string {
  const name = escapeHtml(product.description || "Unknown Product");
  const brand = product.brand ? escapeHtml(product.brand) : "";
  const upc = product.upc || "";
  const size = product.items?.[0]?.size || "";
  const pricing = getProductPrice(product);
  const fulfillment = getProductFulfillment(product);

  const priceHtml = pricing.regular
    ? pricing.hasPromo
      ? `<span class="price">$${pricing.promo}</span><span class="price-original">$${pricing.regular}</span><span class="sale-badge">SALE</span>`
      : `<span class="price">$${pricing.regular}</span>`
    : `<span class="meta-item">Price unavailable</span>`;

  const fulfillmentHtml =
    fulfillment.length > 0
      ? fulfillment
          .map((f) => {
            const cls =
              f === "Pickup"
                ? "tag-pickup"
                : f === "Delivery"
                  ? "tag-delivery"
                  : "tag-instore";
            return `<span class="tag ${cls}">${f}</span>`;
          })
          .join("")
      : `<span class="tag tag-oos">Out of Stock</span>`;

  const aisle =
    product.aisleLocations?.[0]?.description ||
    (product.aisleLocations?.[0]?.number
      ? `Aisle ${product.aisleLocations[0].number}`
      : "");

  const buttonsHtml = upc
    ? `<div style="display:flex;gap:6px;margin-top:8px;">
        <button class="btn btn-primary" onclick="addToCart('${escapeHtml(upc)}', 1)">Add to Cart</button>
        <button class="btn btn-secondary" onclick="addToShoppingList('${escapeHtml(name)}', '${escapeHtml(upc)}')">+ List</button>
      </div>`
    : "";

  return `
    <div class="card">
      <div class="product-name">${name}</div>
      ${brand ? `<div class="product-brand">${brand}</div>` : ""}
      ${size ? `<div class="product-size">${escapeHtml(size)}</div>` : ""}
      <div style="margin-top:8px;">${priceHtml}</div>
      <div class="fulfillment-tags">${fulfillmentHtml}</div>
      ${aisle ? `<div class="meta-item" style="margin-top:4px;">${escapeHtml(aisle)}</div>` : ""}
      ${upc ? `<div class="meta-item" style="margin-top:2px;">UPC: ${escapeHtml(upc)}</div>` : ""}
      ${buttonsHtml}
    </div>
  `;
}

/**
 * Generate HTML for product search results
 */
export function productSearchResultsHtml(
  results: Array<{ term: string; products: Product[]; failed: boolean }>,
  totalProducts: number,
): string {
  const sections = results
    .map((result) => {
      if (result.failed) {
        return `<div class="card"><div class="meta-item">Search failed for "${escapeHtml(result.term)}"</div></div>`;
      }
      if (result.products.length === 0) {
        return `<div style="margin-bottom:16px;"><div style="font-weight:600;margin-bottom:8px;">${escapeHtml(result.term)} <span class="badge badge-gray">0 items</span></div><div class="meta-item">No products found.</div></div>`;
      }
      const cards = result.products.map(renderProductCard).join("");
      return `
        <div style="margin-bottom:16px;">
          <div style="font-weight:600;margin-bottom:8px;">${escapeHtml(result.term)} <span class="badge badge-blue">${result.products.length} items</span></div>
          <div class="grid grid-2">${cards}</div>
        </div>
      `;
    })
    .join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${BASE_STYLES}</style></head><body>
    <div class="header">Product Search Results</div>
    <div class="subheader">${results.length} search term(s), ${totalProducts} total products</div>
    ${sections}
    ${ACTION_SCRIPT}
  </body></html>`;
}

/**
 * Generate HTML for a single product detail
 */
export function productDetailHtml(product: Product): string {
  const name = escapeHtml(product.description || "Unknown Product");
  const brand = product.brand ? escapeHtml(product.brand) : "";
  const upc = product.upc || "";
  const pricing = getProductPrice(product);
  const fulfillment = getProductFulfillment(product);

  const priceHtml = pricing.regular
    ? pricing.hasPromo
      ? `<span class="price" style="font-size:24px;">$${pricing.promo}</span><span class="price-original" style="font-size:16px;">$${pricing.regular}</span><span class="sale-badge">SALE</span>`
      : `<span class="price" style="font-size:24px;">$${pricing.regular}</span>`
    : "";

  const itemsHtml = (product.items || [])
    .map((item: ProductItem) => {
      const parts: string[] = [];
      if (item.size) parts.push(escapeHtml(item.size));
      if (item.price?.regular) parts.push(`$${item.price.regular}`);
      if (item.inventory?.stockLevel) {
        const level = item.inventory.stockLevel;
        if (level === "LOW")
          parts.push('<span class="badge badge-yellow">Low Stock</span>');
        else if (level === "TEMPORARILY_OUT_OF_STOCK")
          parts.push('<span class="badge badge-red">Out of Stock</span>');
        else parts.push('<span class="badge badge-green">In Stock</span>');
      }
      return `<div class="meta-row">${parts.join(" &middot; ")}</div>`;
    })
    .join("");

  const categoriesHtml =
    product.categories && product.categories.length > 0
      ? `<div class="meta-row">${product.categories.map((c) => `<span class="badge badge-gray">${escapeHtml(c || "")}</span>`).join("")}</div>`
      : "";

  const aislesHtml =
    product.aisleLocations && product.aisleLocations.length > 0
      ? product.aisleLocations
          .map(
            (loc) =>
              `<div class="meta-item">${escapeHtml(loc.description || "")} ${loc.number ? `(${escapeHtml(loc.number)})` : ""}</div>`,
          )
          .join("")
      : "";

  const fulfillmentHtml = fulfillment
    .map((f) => {
      const cls =
        f === "Pickup"
          ? "tag-pickup"
          : f === "Delivery"
            ? "tag-delivery"
            : "tag-instore";
      return `<span class="tag ${cls}">${f}</span>`;
    })
    .join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${BASE_STYLES}
    .detail-header { margin-bottom: 16px; }
    .detail-section { margin-top: 16px; }
    .detail-label { font-size: 12px; font-weight: 600; color: #6b7280; text-transform: uppercase; margin-bottom: 4px; }
  </style></head><body>
    <div class="card" style="border: none; box-shadow: 0 1px 4px rgba(0,0,0,0.06);">
      <div class="detail-header">
        <div style="font-size:20px;font-weight:700;">${name}</div>
        ${brand ? `<div style="font-size:14px;color:#6b7280;margin-top:2px;">${brand}</div>` : ""}
      </div>
      <div>${priceHtml}</div>
      <div class="fulfillment-tags" style="margin-top:10px;">${fulfillmentHtml}</div>
      ${
        upc
          ? `
      <div style="display:flex;gap:8px;margin-top:12px;">
        <button class="btn btn-primary" onclick="addToCart('${escapeHtml(upc)}', 1)">Add to Cart</button>
        <button class="btn btn-secondary" onclick="addToShoppingList('${escapeHtml(name)}', '${escapeHtml(upc)}')">+ Shopping List</button>
      </div>`
          : ""
      }
      ${itemsHtml ? `<div class="detail-section"><div class="detail-label">Options</div>${itemsHtml}</div>` : ""}
      ${categoriesHtml ? `<div class="detail-section"><div class="detail-label">Category</div>${categoriesHtml}</div>` : ""}
      ${aislesHtml ? `<div class="detail-section"><div class="detail-label">Aisle Location</div>${aislesHtml}</div>` : ""}
      ${upc ? `<div class="detail-section"><div class="detail-label">UPC</div><div class="meta-item">${escapeHtml(upc)}</div></div>` : ""}
    </div>
    ${ACTION_SCRIPT}
  </body></html>`;
}

/**
 * Generate HTML for shopping list
 */
export function shoppingListHtml(
  items: ShoppingListItem[],
  _action: string,
  actionDetail?: string,
): string {
  if (items.length === 0) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${BASE_STYLES}</style></head><body>
      <div class="header">Shopping List</div>
      <div class="empty-state">
        <div style="font-size:32px;margin-bottom:8px;">&#128722;</div>
        <div>Your shopping list is empty</div>
      </div>
    </body></html>`;
  }

  const unchecked = items.filter((i) => !i.checked);
  const checked = items.filter((i) => i.checked);
  const withUpc = unchecked.filter((i) => i.upc);
  const withoutUpc = unchecked.filter((i) => !i.upc);

  const renderItem = (item: ShoppingListItem) => {
    const checkedClass = item.checked
      ? 'style="opacity:0.5;text-decoration:line-through;"'
      : "";
    const upcBadge = item.upc
      ? '<span class="badge badge-green">UPC</span>'
      : '<span class="badge badge-yellow">Needs UPC</span>';
    return `
      <div class="card" ${checkedClass}>
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div>
            <div class="product-name">${item.checked ? "&#9745;" : "&#9744;"} ${escapeHtml(item.productName)}</div>
            <div class="meta-row">
              <span class="meta-item">Qty: ${item.quantity}</span>
              ${upcBadge}
              ${item.upc ? `<span class="meta-item">UPC: ${escapeHtml(item.upc)}</span>` : ""}
            </div>
            ${item.notes ? `<div class="meta-item" style="margin-top:4px;font-style:italic;">${escapeHtml(item.notes)}</div>` : ""}
          </div>
          ${!item.checked ? `<button class="btn btn-secondary" onclick="postAction({type:'tool',payload:{toolName:'manage_shopping_list',params:{action:'remove',productName:'${escapeHtml(item.productName)}'}}})">&#10005;</button>` : ""}
        </div>
      </div>
    `;
  };

  const uncheckedHtml = unchecked.map(renderItem).join("");
  const checkedHtml =
    checked.length > 0
      ? `<div style="margin-top:16px;"><div style="font-weight:600;color:#6b7280;margin-bottom:8px;">In Cart (${checked.length})</div>${checked.map(renderItem).join("")}</div>`
      : "";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${BASE_STYLES}
    .summary-bar { display:flex; gap:12px; margin-bottom:16px; flex-wrap:wrap; }
  </style></head><body>
    <div class="header">Shopping List</div>
    ${actionDetail ? `<div class="subheader">${escapeHtml(actionDetail)}</div>` : ""}
    <div class="summary-bar">
      <span class="badge badge-blue">${unchecked.length} to buy</span>
      <span class="badge badge-green">${withUpc.length} ready for checkout</span>
      ${withoutUpc.length > 0 ? `<span class="badge badge-yellow">${withoutUpc.length} need UPC</span>` : ""}
      ${checked.length > 0 ? `<span class="badge badge-gray">${checked.length} in cart</span>` : ""}
    </div>
    ${uncheckedHtml}
    ${checkedHtml}
    ${ACTION_SCRIPT}
  </body></html>`;
}

/**
 * Generate HTML for weekly deals
 */
export function weeklyDealsHtml(
  deals: Array<{
    title: string;
    details?: string;
    price?: string;
    savings?: string | null;
    validFrom?: string;
    validTill?: string;
  }>,
  validFrom?: string,
  validTill?: string,
): string {
  if (deals.length === 0) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${BASE_STYLES}</style></head><body>
      <div class="header">Weekly Deals</div>
      <div class="empty-state">No deals available this week.</div>
    </body></html>`;
  }

  const dealCards = deals
    .map(
      (deal) => `
      <div class="card">
        <div class="product-name">${escapeHtml(deal.title)}</div>
        ${deal.details ? `<div class="product-size">${escapeHtml(deal.details)}</div>` : ""}
        <div style="margin-top:6px;">
          <span class="price">${escapeHtml(deal.price || "See ad")}</span>
          ${deal.savings ? `<span class="sale-badge">${escapeHtml(deal.savings)}</span>` : ""}
        </div>
        <div style="margin-top:8px;">
          <button class="btn btn-secondary" onclick="searchProducts('${escapeHtml(deal.title.replace(/'/g, "\\'"))}')">Search Product</button>
        </div>
      </div>
    `,
    )
    .join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${BASE_STYLES}</style></head><body>
    <div class="header">Weekly Deals <span class="badge badge-green">${deals.length} deals</span></div>
    ${validFrom && validTill ? `<div class="subheader">Valid: ${escapeHtml(validFrom)} - ${escapeHtml(validTill)}</div>` : ""}
    <div class="grid grid-2">${dealCards}</div>
    ${ACTION_SCRIPT}
  </body></html>`;
}

/**
 * Generate HTML for recipe search results
 */
export function recipeResultsHtml(
  recipes: Array<{
    title: string;
    description?: string;
    cuisine?: string;
    difficulty?: string;
    totalTime?: number;
    cookTime?: number;
    servings?: string;
    slug: string;
    ingredients?: Array<{
      quantity?: string;
      unit?: string;
      name: string;
      notes?: string;
    }>;
    instructions?: Array<{
      stepNumber: number;
      instruction: string;
    }>;
  }>,
  searchQuery: string,
): string {
  if (recipes.length === 0) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${BASE_STYLES}</style></head><body>
      <div class="header">Recipe Search</div>
      <div class="empty-state">No recipes found for "${escapeHtml(searchQuery)}"</div>
    </body></html>`;
  }

  const recipeCards = recipes
    .map(
      (recipe) => `
      <div class="card">
        <div style="font-size:16px;font-weight:700;margin-bottom:4px;">${escapeHtml(recipe.title)}</div>
        ${recipe.description ? `<div class="meta-item">${escapeHtml(recipe.description)}</div>` : ""}
        <div class="meta-row" style="margin-top:6px;">
          ${recipe.cuisine ? `<span class="badge badge-blue">${escapeHtml(recipe.cuisine)}</span>` : ""}
          ${recipe.difficulty ? `<span class="badge badge-gray">${escapeHtml(recipe.difficulty)}</span>` : ""}
          ${recipe.totalTime ? `<span class="meta-item">${recipe.totalTime}min</span>` : recipe.cookTime ? `<span class="meta-item">${recipe.cookTime}min cook</span>` : ""}
          ${recipe.servings ? `<span class="meta-item">${escapeHtml(recipe.servings)}</span>` : ""}
        </div>
        ${
          recipe.ingredients && recipe.ingredients.length > 0
            ? `<div class="divider"></div>
               <div style="font-size:12px;font-weight:600;margin-bottom:4px;">Ingredients (${recipe.ingredients.length})</div>
               <div style="font-size:12px;color:#4b5563;">
                 ${recipe.ingredients
                   .map((ing) => {
                     const amount = [ing.quantity, ing.unit]
                       .filter(Boolean)
                       .join(" ");
                     const notes = ing.notes
                       ? ` (${escapeHtml(ing.notes)})`
                       : "";
                     return `<div style="margin:2px 0;">&#8226; ${amount ? `${escapeHtml(amount)} ` : ""}${escapeHtml(ing.name)}${notes}</div>`;
                   })
                   .join("")}
               </div>`
            : ""
        }
        ${
          recipe.instructions && recipe.instructions.length > 0
            ? `<div class="divider"></div>
               <details>
                 <summary style="font-size:12px;font-weight:600;cursor:pointer;margin-bottom:4px;">Instructions (${recipe.instructions.length} steps)</summary>
                 <div style="font-size:12px;color:#4b5563;margin-top:4px;">
                   ${recipe.instructions
                     .map(
                       (step) =>
                         `<div style="margin:4px 0;"><strong>${step.stepNumber}.</strong> ${escapeHtml(step.instruction)}</div>`,
                     )
                     .join("")}
                 </div>
               </details>`
            : ""
        }
        <div style="margin-top:8px;display:flex;gap:6px;">
          <a href="https://janella-cookbook.vercel.app/recipe/${escapeHtml(recipe.slug)}" target="_blank" class="btn btn-secondary" style="text-decoration:none;">View Recipe</a>
        </div>
      </div>
    `,
    )
    .join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${BASE_STYLES}</style></head><body>
    <div class="header">Recipes for "${escapeHtml(searchQuery)}" <span class="badge badge-blue">${recipes.length} found</span></div>
    <div class="grid grid-2">${recipeCards}</div>
    ${ACTION_SCRIPT}
  </body></html>`;
}

/**
 * Generate HTML for store location results
 */
export function locationResultsHtml(locations: Location[]): string {
  if (locations.length === 0) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${BASE_STYLES}</style></head><body>
      <div class="header">Store Locations</div>
      <div class="empty-state">No locations found.</div>
    </body></html>`;
  }

  const locationCards = locations
    .map(
      (loc) => `
      <div class="card">
        <div class="product-name">${escapeHtml(loc.name || "Unknown Store")}</div>
        ${loc.chain ? `<span class="badge badge-blue">${escapeHtml(loc.chain)}</span>` : ""}
        ${
          loc.address
            ? `<div class="meta-item" style="margin-top:6px;">
                ${escapeHtml(loc.address.addressLine1 || "")}<br>
                ${escapeHtml(loc.address.city || "")}, ${escapeHtml(loc.address.state || "")} ${escapeHtml(loc.address.zipCode || "")}
              </div>`
            : ""
        }
        ${loc.phone ? `<div class="meta-item" style="margin-top:2px;">${escapeHtml(loc.phone)}</div>` : ""}
        <div class="meta-item" style="margin-top:2px;">ID: ${escapeHtml(loc.locationId || "")}</div>
        <div style="margin-top:8px;">
          <button class="btn btn-primary" onclick="postAction({type:'tool',payload:{toolName:'set_preferred_location',params:{locationId:'${escapeHtml(loc.locationId || "")}'}}})">Set as Preferred</button>
          <button class="btn btn-secondary" onclick="postAction({type:'tool',payload:{toolName:'get_location_details',params:{locationId:'${escapeHtml(loc.locationId || "")}'}}})">Details</button>
        </div>
      </div>
    `,
    )
    .join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${BASE_STYLES}</style></head><body>
    <div class="header">Store Locations <span class="badge badge-blue">${locations.length} found</span></div>
    <div class="grid grid-2">${locationCards}</div>
    ${ACTION_SCRIPT}
  </body></html>`;
}

/**
 * Generate HTML for a single location detail
 */
export function locationDetailHtml(location: Location): string {
  const name = escapeHtml(location.name || "Unknown Store");
  const chain = location.chain ? escapeHtml(location.chain) : "";

  const departmentsHtml =
    location.departments && location.departments.length > 0
      ? `<div class="detail-section">
          <div class="detail-label">Departments</div>
          <div style="display:flex;flex-wrap:wrap;gap:4px;">
            ${location.departments
              .filter((d) => d.name)
              .map(
                (d) =>
                  `<span class="badge badge-gray">${escapeHtml(d.name || "")}${d.phone ? ` (${escapeHtml(d.phone)})` : ""}</span>`,
              )
              .join("")}
          </div>
        </div>`
      : "";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${BASE_STYLES}
    .detail-section { margin-top: 16px; }
    .detail-label { font-size: 12px; font-weight: 600; color: #6b7280; text-transform: uppercase; margin-bottom: 4px; }
  </style></head><body>
    <div class="card" style="border:none;box-shadow:0 1px 4px rgba(0,0,0,0.06);">
      <div style="font-size:20px;font-weight:700;">${name}</div>
      ${chain ? `<span class="badge badge-blue" style="margin-top:4px;">${chain}</span>` : ""}
      ${
        location.address
          ? `<div class="detail-section">
              <div class="detail-label">Address</div>
              <div class="meta-item">
                ${escapeHtml(location.address.addressLine1 || "")}<br>
                ${escapeHtml(location.address.city || "")}, ${escapeHtml(location.address.state || "")} ${escapeHtml(location.address.zipCode || "")}
              </div>
            </div>`
          : ""
      }
      ${location.phone ? `<div class="detail-section"><div class="detail-label">Phone</div><div class="meta-item">${escapeHtml(location.phone)}</div></div>` : ""}
      <div class="detail-section"><div class="detail-label">Location ID</div><div class="meta-item">${escapeHtml(location.locationId || "")}</div></div>
      ${departmentsHtml}
      <div style="margin-top:16px;">
        <button class="btn btn-primary" onclick="postAction({type:'tool',payload:{toolName:'set_preferred_location',params:{locationId:'${escapeHtml(location.locationId || "")}'}}})">Set as Preferred Store</button>
      </div>
    </div>
    ${ACTION_SCRIPT}
  </body></html>`;
}

/**
 * Generate HTML for pantry inventory
 */
export function pantryListHtml(
  items: PantryItem[],
  actionDetail?: string,
): string {
  if (items.length === 0) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${BASE_STYLES}</style></head><body>
      <div class="header">Pantry</div>
      <div class="empty-state">Your pantry is empty.</div>
    </body></html>`;
  }

  const now = Date.now();
  const itemCards = items
    .map((item) => {
      let expiryHtml = "";
      if (item.expiresAt) {
        const expiryDate = new Date(item.expiresAt);
        const daysUntil = Math.floor(
          (expiryDate.getTime() - now) / (1000 * 60 * 60 * 24),
        );
        if (daysUntil < 0)
          expiryHtml = '<span class="badge badge-red">Expired</span>';
        else if (daysUntil === 0)
          expiryHtml = '<span class="badge badge-red">Expires Today</span>';
        else if (daysUntil <= 3)
          expiryHtml = `<span class="badge badge-yellow">Expires in ${daysUntil}d</span>`;
        else
          expiryHtml = `<span class="meta-item">Exp: ${expiryDate.toLocaleDateString()}</span>`;
      }
      return `
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;">
            <div>
              <div class="product-name">${escapeHtml(item.productName)}</div>
              <div class="meta-row">
                <span class="meta-item">Qty: ${item.quantity}</span>
                ${expiryHtml}
              </div>
            </div>
            <button class="btn btn-secondary" onclick="postAction({type:'tool',payload:{toolName:'manage_pantry',params:{action:'remove',productName:'${escapeHtml(item.productName)}'}}})">&#10005;</button>
          </div>
        </div>
      `;
    })
    .join("");

  const expiring = items.filter((i) => {
    if (!i.expiresAt) return false;
    const d = Math.floor(
      (new Date(i.expiresAt).getTime() - now) / (1000 * 60 * 60 * 24),
    );
    return d >= 0 && d <= 3;
  });

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${BASE_STYLES}</style></head><body>
    <div class="header">Pantry <span class="badge badge-blue">${items.length} items</span></div>
    ${actionDetail ? `<div class="subheader">${escapeHtml(actionDetail)}</div>` : ""}
    ${expiring.length > 0 ? `<div style="margin-bottom:12px;"><span class="badge badge-yellow">${expiring.length} item(s) expiring soon</span></div>` : ""}
    ${itemCards}
    ${ACTION_SCRIPT}
  </body></html>`;
}
