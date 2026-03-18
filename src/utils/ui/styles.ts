/** Shared CSS styles for MCP UI components */

export const BASE_STYLES = `
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #1a1a2e;
  background: #f8f9fa;
  padding: 16px;
  line-height: 1.5;
}
.header { font-size: 18px; font-weight: 700; margin-bottom: 12px; color: #1a1a2e; }
.subheader { font-size: 13px; color: #6b7280; margin-bottom: 16px; }
.badge {
  display: inline-block; padding: 2px 8px; border-radius: 12px;
  font-size: 11px; font-weight: 600; text-transform: uppercase;
}
.badge-green { background: #dcfce7; color: #166534; }
.badge-red { background: #fef2f2; color: #991b1b; }
.badge-yellow { background: #fefce8; color: #854d0e; }
.badge-blue { background: #eff6ff; color: #1e40af; }
.badge-gray { background: #f3f4f6; color: #4b5563; }
.card {
  background: white; border-radius: 10px; padding: 14px; margin-bottom: 10px;
  border: 1px solid #e5e7eb; transition: box-shadow 0.15s;
}
.card:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
.grid { display: grid; gap: 10px; }
.grid-2 { grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
.price { font-size: 18px; font-weight: 700; color: #059669; }
.price-original {
  text-decoration: line-through; color: #9ca3af; font-size: 13px; margin-left: 6px;
}
.sale-badge {
  background: #ef4444; color: white; padding: 2px 6px; border-radius: 4px;
  font-size: 11px; font-weight: 700; margin-left: 6px;
}
.btn {
  display: inline-flex; align-items: center; gap: 4px; padding: 6px 12px;
  border-radius: 6px; font-size: 12px; font-weight: 600; border: none;
  cursor: pointer; transition: background 0.15s;
}
.btn-primary { background: #2563eb; color: white; }
.btn-primary:hover { background: #1d4ed8; }
.btn-secondary { background: #f3f4f6; color: #374151; border: 1px solid #d1d5db; }
.btn-secondary:hover { background: #e5e7eb; }
.meta-row {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 6px;
}
.meta-item { font-size: 12px; color: #6b7280; }
.divider { border-top: 1px solid #e5e7eb; margin: 8px 0; }
.empty-state { text-align: center; padding: 32px 16px; color: #9ca3af; }
.product-name { font-weight: 600; font-size: 14px; margin-bottom: 2px; }
.product-brand { font-size: 12px; color: #6b7280; }
.product-size { font-size: 12px; color: #6b7280; margin-top: 2px; }
.fulfillment-tags { display: flex; gap: 4px; margin-top: 6px; flex-wrap: wrap; }
.tag {
  padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 600;
}
.tag-pickup { background: #dbeafe; color: #1e40af; }
.tag-delivery { background: #fce7f3; color: #9d174d; }
.tag-instore { background: #d1fae5; color: #065f46; }
.tag-oos { background: #fef2f2; color: #991b1b; }
.detail-section { margin-top: 16px; }
.detail-label {
  font-size: 12px; font-weight: 600; color: #6b7280;
  text-transform: uppercase; margin-bottom: 4px;
}
`;

/**
 * Client-side action script for MCP UI iframes.
 * Uses the same wire format as @mcp-ui/server's postUIActionResult / uiActionResultToolCall:
 *   postMessage({ type: 'tool', payload: { toolName, params } }, '*')
 */
export const ACTION_SCRIPT = `
function postUIActionResult(result) {
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(result, '*');
    }
  } catch (e) { console.warn('postUIActionResult failed:', e); }
}
function toolCall(toolName, params) {
  postUIActionResult({ type: 'tool', payload: { toolName: toolName, params: params } });
}
function addToCart(upc, quantity) {
  toolCall('add_to_cart', { items: [{ upc: upc, quantity: quantity || 1, modality: 'PICKUP' }] });
}
function addToShoppingList(productName, upc) {
  toolCall('manage_shopping_list', { action: 'add', items: [{ productName: productName, upc: upc || undefined, quantity: 1 }] });
}
function searchProducts(term) {
  toolCall('search_products', { terms: [term] });
}
`;
