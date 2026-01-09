import type { Coupon, CouponsResponse } from "../services/kroger/weekly-deals.js";
import {
  formatWeeklyDealsList,
  type WeeklyDeal,
} from "../utils/format-response.js";
import type { ToolResponse } from "./cart-tools.js";

export interface GetCouponsInput {
  locationId: string;
  facilityId: string;
  filterWeeklyDeals?: boolean;
}

export async function getCoupons(input: GetCouponsInput): Promise<ToolResponse> {
  const { locationId, facilityId, filterWeeklyDeals } = input;

  try {
    console.log(
      "Fetching coupons for location:",
      locationId,
      "facility:",
      facilityId,
    );

    // Build request matching the exact working browser request
    const headers = new Headers();

    // x-laf-object with location details - using exact structure from working request
    const xLafObject = [
      {
        modality: {
          type: "PICKUP",
          handoffLocation: {
            storeId: locationId,
            facilityId: facilityId,
          },
          handoffAddress: {
            address: {
              addressLines: ["1401 Broadway"],
              cityTown: "Seattle",
              name: "Harvard Market",
              postalCode: "98122",
              stateProvince: "WA",
              residential: false,
              countryCode: "US",
            },
            location: {
              lat: 47.6137629,
              lng: -122.3211541,
            },
          },
        },
        sources: [
          {
            storeId: locationId,
            facilityId: facilityId,
          },
        ],
        assortmentKeys: ["edec10f5-2d40-4941-a280-2a405a537dcb"],
        listingKeys: [locationId],
      },
      {
        modality: {
          type: "IN_STORE",
          handoffLocation: {
            storeId: locationId,
            facilityId: facilityId,
          },
          handoffAddress: {
            address: {
              addressLines: ["1401 Broadway"],
              cityTown: "Seattle",
              name: "Harvard Market",
              postalCode: "98122",
              stateProvince: "WA",
              residential: false,
              countryCode: "US",
            },
            location: {
              lat: 47.6137629,
              lng: -122.3211541,
            },
          },
        },
        sources: [
          {
            storeId: locationId,
            facilityId: facilityId,
          },
        ],
        assortmentKeys: ["41352481-ccbf-41a3-9c25-37ef5bd7ff9f"],
        listingKeys: [locationId],
      },
      {
        modality: {
          type: "DELIVERY",
          handoffAddress: {
            address: {
              postalCode: "98122",
              stateProvince: "WA",
              countryCode: "US",
              county: "King County",
            },
            location: {
              lat: 47.61154175,
              lng: -122.31268311,
            },
          },
        },
        sources: [
          {
            storeId: locationId,
            facilityId: facilityId,
          },
          {
            storeId: "70500887",
            facilityId: "16715",
          },
        ],
        assortmentKeys: ["fc64173a-28f6-4d21-8da5-1c6b1f3238d1"],
        listingKeys: [locationId, "70500887"],
      },
    ];

    // Set headers exactly as in the working browser request
    headers.set("accept", "application/json, text/plain, */*");
    headers.set("accept-language", "en-US,en;q=0.9,es;q=0.8");
    headers.set("device-memory", "8");
    headers.set("priority", "u=1, i");
    headers.set(
      "sec-ch-ua",
      '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
    );
    headers.set("sec-ch-ua-mobile", "?0");
    headers.set("sec-ch-ua-platform", '"Windows"');
    headers.set("sec-fetch-dest", "empty");
    headers.set("sec-fetch-mode", "cors");
    headers.set("sec-fetch-site", "same-origin");
    headers.set(
      "x-ab-test",
      '[{"testVersion":"B","testID":"76503b","testOrigin":"f4"},{"testVersion":"B","testID":"76503b","testOrigin":"f4"}]',
    );
    headers.set(
      "x-call-origin",
      '{"page":"coupons","component":"ALL_COUPONS"}',
    );
    headers.set("x-facility-id", facilityId);
    headers.set("x-kroger-channel", "WEB");
    headers.set("x-laf-object", JSON.stringify(xLafObject));
    headers.set("x-modality", `{"type":"PICKUP","locationId":"${locationId}"}`);
    headers.set("x-modality-type", "PICKUP");

    console.log("Request headers set");

    // Build URL exactly as in working request
    const couponsUrl = new URL(
      "https://www.qfc.com/atlas/v1/savings-coupons/v1/coupons",
    );
    couponsUrl.searchParams.append("projections", "coupons.compact");
    couponsUrl.searchParams.append("filter.status", "unclipped");
    couponsUrl.searchParams.append("filter.status", "active");
    couponsUrl.searchParams.append("page.size", "24");
    couponsUrl.searchParams.append("page.offset", "0");

    console.log("Fetching coupons from:", couponsUrl.toString());

    const response = await fetch(couponsUrl.toString(), {
      method: "GET",
      headers,
    });

    console.log("Response status:", response.status, response.statusText);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Error response status:", response.status);
      console.error("Error response body:", errorText.substring(0, 500));
      throw new Error(
        `Failed to fetch coupons: ${response.status} ${response.statusText}`,
      );
    }

    const responseText = await response.text();
    console.log("Response body length:", responseText.length);

    const couponsData: CouponsResponse = JSON.parse(responseText);
    const coupons = couponsData.data.coupons;

    console.log(`Found ${coupons.length} total coupons`);

    if (coupons.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No coupons found for this location at this time.",
          },
        ],
      };
    }

    // Optionally filter for Weekly Digital Deals (WDD) and Expiring For You (EFY)
    const displayCoupons = filterWeeklyDeals
      ? coupons.filter((coupon: Coupon) =>
          coupon.specialSavings?.some(
            (saving: { name: string }) => saving.name === "WDD" || saving.name === "EFY",
          ),
        )
      : coupons;

    console.log(
      `Displaying ${displayCoupons.length} coupons${filterWeeklyDeals ? " (filtered for WDD/EFY)" : ""}`,
    );

    if (displayCoupons.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: filterWeeklyDeals
              ? "No weekly digital deals found at this time. Check back later for new deals!"
              : "No coupons found for this location at this time.",
          },
        ],
      };
    }

    // Format coupons for display
    const formattedDeals: WeeklyDeal[] = displayCoupons
      .slice(0, 25)
      .map((coupon: Coupon) => ({
        product: coupon.displayDescription || coupon.shortDescription,
        details: coupon.brand,
        price: `Save $${coupon.value.toFixed(2)}`,
        savings: coupon.categories.join(", "),
        loyalty: `Use up to ${coupon.redemptionsAllowed}x`,
        department: coupon.categories[0] || "General",
        validFrom: new Date(coupon.displayStartDate).toLocaleDateString(),
        validTill: new Date(coupon.displayEndDate).toLocaleDateString(),
        disclaimer: coupon.requirementDescription,
      }));

    // Format the deals list
    const formattedDealsList = formatWeeklyDealsList(formattedDeals);

    // Get date range from first coupon
    const dateRange =
      displayCoupons.length > 0
        ? `Valid: ${new Date(displayCoupons[0].displayStartDate).toLocaleDateString()} - ${new Date(displayCoupons[0].displayEndDate).toLocaleDateString()}`
        : "";

    const title = filterWeeklyDeals ? "Weekly Digital Deals" : "Available Coupons";

    // Return successful response
    return {
      content: [
        {
          type: "text",
          text: `Found ${displayCoupons.length} ${filterWeeklyDeals ? "weekly deal coupons" : "coupons"} (showing ${Math.min(25, displayCoupons.length)}):\n\n**${title}**\n${dateRange}\n\n${formattedDealsList}`,
        },
      ],
    };
  } catch (error) {
    console.error("Error fetching coupons:", error);
    console.error("Error details:", {
      name: error instanceof Error ? error.name : "Unknown",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : "No stack trace",
    });
    return {
      content: [
        {
          type: "text",
          text: `Failed to fetch coupons: ${error instanceof Error ? error.message : "Unknown error"}`,
        },
      ],
    };
  }
}
