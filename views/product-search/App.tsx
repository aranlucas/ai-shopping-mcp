import { useApp } from "@modelcontextprotocol/ext-apps/react";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Badge,
  FulfillmentTags,
  PriceDisplay,
  ProductActions,
} from "../shared/components.js";
import type {
  ProductData,
  ProductSearchResultsContent,
} from "../shared/types.js";

function ProductCard({
  product,
  onAddToCart,
  onAddToList,
}: {
  product: ProductData;
  onAddToCart: (upc: string, qty: number) => void;
  onAddToList: (name: string, upc: string) => void;
}) {
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
      <ProductActions
        upc={upc}
        name={name}
        onAddToCart={onAddToCart}
        onAddToList={onAddToList}
      />
    </div>
  );
}

function ProductSearchView() {
  const [data, setData] = useState<ProductSearchResultsContent | null>(null);

  const { app, isConnected, error } = useApp({
    appInfo: { name: "product-search", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (appInstance) => {
      appInstance.ontoolresult = (result) => {
        const content = result.structuredContent as
          | ProductSearchResultsContent
          | undefined;
        if (content?.results) {
          setData(content);
        }
      };
      appInstance.onerror = console.error;
    },
  });

  if (error) {
    return <div className="empty-state">Error: {error.message}</div>;
  }
  if (!isConnected || !data) {
    return <div id="loading">Loading...</div>;
  }

  const { results, totalProducts } = data;

  const handleAddToCart = (upc: string, qty: number) => {
    app?.callServerTool({
      name: "add_to_cart",
      arguments: { upc, quantity: qty },
    });
  };

  const handleAddToList = (name: string, upc: string) => {
    app?.callServerTool({
      name: "manage_shopping_list",
      arguments: {
        action: "add",
        items: [{ productName: name, upc, quantity: 1 }],
      },
    });
  };

  return (
    <>
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
                  onAddToCart={handleAddToCart}
                  onAddToList={handleAddToList}
                />
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

createRoot(document.getElementById("root")!).render(<ProductSearchView />);
