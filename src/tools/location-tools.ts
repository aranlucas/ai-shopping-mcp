import { locationClient } from "../services/kroger/client.js";
import {
  formatLocation,
  formatLocationList,
  formatPreferredLocation,
} from "../utils/format-response.js";
import {
  createUserStorage,
  type PreferredLocation,
} from "../utils/user-storage.js";
import type { ToolResponse } from "./cart-tools.js";

export interface SearchLocationsInput {
  zipCodeNear: string;
  limit?: number;
  chain?: string;
}

export interface GetLocationDetailsInput {
  locationId: string;
}

export interface SetPreferredLocationInput {
  locationId: string;
}

export async function searchLocations(
  input: SearchLocationsInput,
): Promise<ToolResponse> {
  const { zipCodeNear, limit, chain } = input;

  // Build query parameters
  const queryParams: Record<string, string | number> = {};

  // Add coordinates parameters (must use one of these)
  if (zipCodeNear) {
    queryParams["filter.zipCode.near"] = zipCodeNear;
  }

  if (limit !== undefined) {
    queryParams["filter.limit"] = limit;
  }
  if (chain) {
    queryParams["filter.chain"] = chain;
  }

  console.log("Query parameters for location search:", queryParams);
  // Make the API call to search for locations
  const { data, error } = await locationClient.GET("/v1/locations", {
    params: {
      query: queryParams,
    },
  });

  if (error) {
    console.error("Error searching locations:", error);
    throw new Error(`Failed to search locations: ${JSON.stringify(error)}`);
  }

  // Format the response for display
  const locations = data?.data || [];
  console.log(`Found ${locations.length} locations`);

  // Return a successful response with formatted text
  const formattedLocations = formatLocationList(locations);

  return {
    content: [
      {
        type: "text",
        text: `Found ${locations.length} location(s):\n\n${formattedLocations}`,
      },
    ],
  };
}

export async function getLocationDetails(
  input: GetLocationDetailsInput,
): Promise<ToolResponse> {
  const { locationId } = input;

  // Make the API call to get location details
  const { data, error } = await locationClient.GET(
    "/v1/locations/{locationId}",
    {
      params: { path: { locationId } },
    },
  );

  if (error) {
    console.error("Error getting location details:", error);
    throw new Error(
      `Failed to get location details: ${JSON.stringify(error)}`,
    );
  }

  const location = data?.data;
  if (!location) {
    throw new Error(`No information found for location ID: ${locationId}`);
  }

  console.log(`Retrieved details for location: ${location.name}`);

  // Return successful response with formatted text
  const formattedLocation = formatLocation(location);

  return {
    content: [
      {
        type: "text",
        text: `Location Details:\n\n${formattedLocation}`,
      },
    ],
  };
}

export async function setPreferredLocation(
  input: SetPreferredLocationInput,
  userId: string,
  kvNamespace: KVNamespace,
): Promise<ToolResponse> {
  const { locationId } = input;

  if (!userId) {
    throw new Error("User not authenticated");
  }

  // Get location details to store complete information
  const { data, error } = await locationClient.GET("/v1/locations/{locationId}", {
    params: { path: { locationId } },
  });

  if (error || !data?.data) {
    throw new Error(`Failed to get location details: ${JSON.stringify(error)}`);
  }

  const location = data.data;
  const storage = createUserStorage(kvNamespace);

  const preferredLocation: PreferredLocation = {
    locationId: location.locationId || "",
    locationName: location.name || "",
    address: `${location.address?.addressLine1 || ""}, ${location.address?.city || ""}, ${location.address?.state || ""} ${location.address?.zipCode || ""}`.trim(),
    chain: location.chain || "",
    setAt: new Date().toISOString(),
  };

  await storage.preferredLocation.set(userId, preferredLocation);

  const formatted = formatPreferredLocation(preferredLocation);

  return {
    content: [
      {
        type: "text",
        text: `Preferred location set successfully:\n\n${formatted}`,
      },
    ],
  };
}

export async function getPreferredLocation(
  userId: string,
  kvNamespace: KVNamespace,
): Promise<ToolResponse> {
  if (!userId) {
    throw new Error("User not authenticated");
  }

  const storage = createUserStorage(kvNamespace);
  const location = await storage.preferredLocation.get(userId);

  if (!location) {
    return {
      content: [
        {
          type: "text",
          text: "No preferred location set. Use set_preferred_location to save your favorite store.",
        },
      ],
    };
  }

  const formatted = formatPreferredLocation(location);

  return {
    content: [
      {
        type: "text",
        text: `Your preferred location:\n\n${formatted}`,
      },
    ],
  };
}
