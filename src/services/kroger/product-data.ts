import type { ProductData } from "../../app-results.js";
import type { components } from "./product.js";
import { normalizeKrogerPrice } from "./price.js";
type Product = components["schemas"]["products.productModel"];

function toAisle(
  product: Product,
): NonNullable<ProductData["aisle"]> | undefined {
  const location = product.aisleLocations?.[0];
  if (!location) return undefined;
  return {
    description: location.description,
    number: location.number,
    sequenceNumber: location.sequenceNumber,
    bayNumber: location.bayNumber,
    side: location.side,
    shelfNumber: location.shelfNumber,
    shelfPositionInBay: location.shelfPositionInBay,
  };
}

function toImageUrl(product: Product): string | undefined {
  const images = (product.images ?? []).map((image) => {
    const sizes = image.sizes?.filter((size) => size.url) ?? [];
    const url =
      sizes.find((size) => size.size === "thumbnail")?.url ??
      sizes.find((size) => size.size === "small")?.url ??
      sizes[0]?.url;
    return { default: image.default, perspective: image.perspective, url };
  });

  return (
    images.find((image) => image.default && image.url)?.url ??
    images.find((image) => image.perspective === "front" && image.url)?.url ??
    images.find((image) => image.url)?.url
  );
}

export function toProductData(
  product: Product,
  includeLocation = false,
  fallbackUpc?: string,
): ProductData {
  const item = product.items?.[0];
  const upc = product.upc?.trim() || fallbackUpc?.trim();
  if (!upc) throw new Error("Kroger product response is missing a UPC");

  return {
    upc,
    name: product.description ?? "Unknown product",
    brand: product.brand,
    ...normalizeKrogerPrice(item?.price),
    size: item?.size,
    category: product.categories?.[0],
    imageUrl: toImageUrl(product),
    ...(includeLocation ? { aisle: toAisle(product) } : {}),
    // Missing stock data is not evidence that a listed product is unavailable.
    available: item?.inventory?.stockLevel !== "TEMPORARILY_OUT_OF_STOCK",
    pickup: item?.fulfillment?.curbside === true,
  };
}
