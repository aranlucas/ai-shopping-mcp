import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { locationClient } from "../services/kroger/client";

export function registerLocationTools(server: McpServer) {
  // Search locations tool
  server.tool(
    "search_locations",
    "Searches for Kroger store locations based on various filter criteria. Use this tool when the user needs to find nearby Kroger stores or specific store locations. Locations can be searched by zip code, latitude/longitude coordinates, radius, chain name, or department availability.",
    {
      zipCodeNear: z
        .string()
        .length(5, { message: "Zip code must be exactly 5 digits" })
        .default("98122"),
      limit: z.number().min(1).max(200).optional().default(1),
      chain: z.string().optional().default("QFC"),
    },
    async (args, extras) => {
      console.error("Received arguments:", extras);
      try {
        const { zipCodeNear, limit, chain } = args;
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
          headers: {
            Authorization: `Bearer ${process.env.KROGER_USER_TOKEN}`,
          },
        });

        if (error) {
          console.error("Error searching locations:", error);
          throw new Error(
            `Failed to search locations: ${JSON.stringify(error)}`,
          );
        }

        // Format the response for display
        const locations = data?.data || [];
        console.log(`Found ${locations.length} locations`);

        // Format as text to avoid json content type issues
        const locationsText = locations
          .map((location, index) => {
            return `
                Location ${index + 1}: ${location.name} (ID: ${
                  location.locationId
                })
                Address: ${
                  location.address
                    ? `${location.address.addressLine1}, ${location.address.city}, ${location.address.state} ${location.address.zipCode}`
                    : "Address not available"
                }
                `.trim();
          })
          .join("\n\n");

        // Return a successful response
        return {
          content: [
            {
              type: "text",
              text: `Found ${locations.length} location(s):\n\n${locationsText}`,
            },
          ],
        };
      } catch (error) {
        console.error("Error in search-locations tool:", error);
        throw error;
      }
    },
  );

  // Get location details tool
  server.tool(
    "get_location_details",
    "Retrieves detailed information about a specific Kroger store location using its location ID. Use this tool when the user needs comprehensive information about a particular store, including address, hours, departments, and geolocation.",
    {
      locationId: z.string().length(8, {
        message: "Location ID must be exactly 8 characters long",
      }),
    },
    async (args, extras) => {
      try {
        const { locationId } = args;

        // Make the API call to get location details
        const { data, error } = await locationClient.GET(
          "/v1/locations/{locationId}",
          {
            params: { path: { locationId } },
            headers: {
              Authorization: `Bearer ${process.env.KROGER_USER_TOKEN}`,
            },
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
          throw new Error(
            `No information found for location ID: ${locationId}`,
          );
        }

        console.log(`Retrieved details for location: ${location.name}`);

        // Format departments if available
        let departmentsText = "No departments information available";
        if (location.departments && location.departments.length > 0) {
          departmentsText = `Departments (${location.departments.length}):\n`;
          for (const dept of location.departments) {
            departmentsText += `- ${dept.name} (ID: ${dept.departmentId})`;
            if (dept.phone) departmentsText += `, Phone: ${dept.phone}`;
            departmentsText += "\n";
          }
        }

        // Create a formatted text response with all details
        const detailsText = `
            Location: ${location.name} (ID: ${location.locationId})
            Chain: ${location.chain || "N/A"}
            Phone: ${location.phone || "N/A"}
            Division: ${location.divisionNumber || "N/A"}, Store: ${
              location.storeNumber || "N/A"
            }
            `.trim();

        // Return successful response
        return {
          content: [
            {
              type: "text",
              text: detailsText,
            },
          ],
        };
      } catch (error) {
        console.error("Error in get-location-details tool:", error);
        throw error;
      }
    },
  );
}
