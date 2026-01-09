import { productClient } from "../services/kroger/client.js";
import { formatProductList } from "../utils/format-response.js";
import type { ToolResponse } from "./cart-tools.js";

export interface SearchProductsInput {
  term?: string;
  locationId: string;
  productId?: string;
  start?: number;
  limit?: number;
}

export interface GetProductDetailsInput {
  productId: string;
  locationId?: string;
}

export async function searchProducts(
  input: SearchProductsInput,
): Promise<ToolResponse> {
  const { term, locationId, productId, start, limit } = input;

  // Validate that at least one search parameter is provided
  if (!term && !productId) {
    throw new Error(
      "At least one search parameter (term, productId, or brand) must be provided",
    );
  }

  // Build query parameters
  const queryParams: Record<string, string | number> = {};

  // Add required search parameters
  if (term) {
    queryParams["filter.term"] = term;
  }
  if (productId) {
    queryParams["filter.productId"] = productId;
  }

  // Add optional parameters
  if (locationId) {
    queryParams["filter.locationId"] = locationId;
  }
  queryParams["filter.fulfillment"] = "ais";
  if (start !== undefined) {
    queryParams["filter.start"] = start;
  }
  if (limit !== undefined) {
    queryParams["filter.limit"] = limit;
  } else {
    // Default limit to avoid too many results
    queryParams["filter.limit"] = 10;
  }

  // Make the API call to search for products
  const { data, error } = await productClient.GET("/v1/products", {
    params: {
      query: queryParams,
    },
  });

  if (error) {
    console.error("Error searching products:", error);
    throw new Error(`Failed to search products: ${JSON.stringify(error)}`);
  }

  // Format the response for display
  const products = data?.data || [];
  console.log(`Found ${products.length} products`);

  // Sort products: pickup in-stock first, then delivery-only, then out-of-stock last
  products.sort(
    (
      a: { items?: Array<{ fulfillment?: { curbside?: boolean; instore?: boolean } }> },
      b: { items?: Array<{ fulfillment?: { curbside?: boolean; instore?: boolean } }> },
    ) => {
      const aItem = a.items?.[0];
      const bItem = b.items?.[0];
      const aPickup = aItem?.fulfillment?.curbside || aItem?.fulfillment?.instore;
      const bPickup = bItem?.fulfillment?.curbside || bItem?.fulfillment?.instore;

      // Pickup available items come first
      if (aPickup && !bPickup) return -1;
      if (!aPickup && bPickup) return 1;
      return 0;
    },
  );

  if (products.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: "No products found matching your search criteria.",
        },
      ],
    };
  }

  // Return a successful response with formatted products
  const formattedProducts = formatProductList(products);

  return {
    content: [
      {
        type: "text",
        text: `Found ${products.length} product(s):\n\n${formattedProducts}`,
      },
    ],
  };
}

export async function getProductDetails(
  input: GetProductDetailsInput,
): Promise<ToolResponse> {
  const { productId, locationId } = input;

  // Build query parameters
  const queryParams: Record<string, string> = {};

  if (locationId) {
    queryParams["filter.locationId"] = locationId;
  }

  // Make the API call to get product details
  const { data, error } = await productClient.GET("/v1/products/{id}", {
    params: {
      path: { id: productId },
      query: queryParams,
    },
  });

  if (error) {
    console.error("Error getting product details:", error);
    throw new Error(`Failed to get product details: ${JSON.stringify(error)}`);
  }

  const product = data.data;
  if (!product) {
    throw new Error(`No information found for product ID: ${productId}`);
  }

  console.log(`Retrieved details for product: ${product.description}`);

  // Return successful response with formatted product
  const formattedProduct = formatProductList([product]);

  return {
    content: [
      {
        type: "text",
        text: `Product Details:\n\n${formattedProduct}`,
      },
    ],
  };
}
