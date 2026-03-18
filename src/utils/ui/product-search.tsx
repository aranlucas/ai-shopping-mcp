import type { components as ProductComponents } from "../../services/kroger/product.js";
import {
  Badge,
  FulfillmentTags,
  PriceDisplay,
  ProductActions,
} from "./shared.js";
import { Shell } from "./shell.js";

type Product = ProductComponents["schemas"]["products.productModel"];

function ProductCard({ product }: { product: Product }) {
  const name = product.description || "Unknown Product";
  const brand = product.brand;
  const upc = product.upc;
  const size = product.items?.[0]?.size;
  const aisle =
    product.aisleLocations?.[0]?.description ||
    (product.aisleLocations?.[0]?.number
      ? `Aisle ${product.aisleLocations[0].number}`
      : undefined);

  return (
    <div className="card">
      <div className="product-name">{name}</div>
      {brand && <div className="product-brand">{brand}</div>}
      {size && <div className="product-size">{size}</div>}
      <div style={{ marginTop: 8 }}>
        <PriceDisplay product={product} />
      </div>
      <FulfillmentTags product={product} />
      {aisle && (
        <div className="meta-item" style={{ marginTop: 4 }}>
          {aisle}
        </div>
      )}
      {upc && (
        <div className="meta-item" style={{ marginTop: 2 }}>
          UPC: {upc}
        </div>
      )}
      <ProductActions upc={upc} name={name} />
    </div>
  );
}

export function ProductSearchResults({
  results,
  totalProducts,
}: {
  results: Array<{ term: string; products: Product[]; failed: boolean }>;
  totalProducts: number;
}) {
  return (
    <Shell>
      <div className="header">Product Search Results</div>
      <div className="subheader">
        {results.length} search term(s), {totalProducts} total products
      </div>
      {results.map((result) => {
        if (result.failed) {
          return (
            <div key={result.term} className="card">
              <div className="meta-item">
                Search failed for &ldquo;{result.term}&rdquo;
              </div>
            </div>
          );
        }
        if (result.products.length === 0) {
          return (
            <div key={result.term} style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>
                {result.term} <Badge variant="gray">0 items</Badge>
              </div>
              <div className="meta-item">No products found.</div>
            </div>
          );
        }
        return (
          <div key={result.term} style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>
              {result.term}{" "}
              <Badge variant="blue">{result.products.length} items</Badge>
            </div>
            <div className="grid grid-2">
              {result.products.map((product) => (
                <ProductCard
                  key={product.upc ?? product.description}
                  product={product}
                />
              ))}
            </div>
          </div>
        );
      })}
    </Shell>
  );
}
