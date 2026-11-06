import type { LocationData } from "../shared/types.js";

export function locationToMapsUrl(location: LocationData): string | null {
  const address = location.address;

  if (!address?.addressLine1) {
    return null;
  }

  const parts = [address.addressLine1, address.city, address.state, address.zipCode]
    .filter(Boolean)
    .join(", ");

  return `https://maps.google.com/?q=${encodeURIComponent(parts)}`;
}
