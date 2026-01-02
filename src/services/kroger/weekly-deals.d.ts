export interface Circular {
  id: string;
  eventId: string;
  eventName: string;
  eventStartDate: string;
  eventEndDate: string;
  divisionCode: string;
  divisionName: string;
  week: string;
  previewCircular: boolean;
  timezone: string;
  circularType: string;
  tags: string[];
  description: string;
  locationId: string;
}

export interface CircularsResponse {
  data: Circular[];
}

// QFC Coupons API Types (from HAR file analysis)
export interface Coupon {
  id: string;
  title: string;
  value: number;
  shortDescription: string;
  displayDescription: string;
  brand: string;
  categories: string[];
  displayStartDate: string;
  displayEndDate: string;
  expirationDate: string;
  requirementDescription: string;
  requirementQuantity: number;
  redemptionsAllowed: number;
  modalities: string[];
  specialSavings: Array<{
    name: string;
    displayName: string;
    description?: string;
    displayOrder: number;
    startDate?: string;
    endDate?: string;
  }>;
  imageUrl?: string;
  status: string;
  enabled: string;
  addedToCard: boolean;
  canBeAddedToCard: boolean;
  totalDownloads: number;
  type: string;
}

export interface CouponsResponse {
  data: {
    coupons: Coupon[];
  };
}

export interface WeeklyDeal {
  id: string;
  adId: string;
  circularId: string;
  mainlineCopy: string;
  underlineCopy: string;
  description: string | null;
  validFrom: string;
  validTill: string;
  salePrice: number | null;
  retailPrice: number;
  saveAmount: number | null;
  quantity: number;
  buyQuantity: number;
  getQuantity: number;
  pricingTemplate: string;
  minPrice: number | null;
  maxPrice: number | null;
  uom: string;
  percentOff: number | null;
  limit: number;
  spendAmount: number | null;
  percentAmount: number | null;
  offStd: number;
  saveStd: number;
  savePercent: number | null;
  loyaltyIndicator: string;
  disclaimer: string;
  event: string;
  type: string;
  rank: number;
  andUp: string;
  departments: Array<{
    department: string;
    departmentCode: number;
  }>;
  images: Array<{
    name: string;
    url: string;
    isMontageImage: boolean;
    isMobileImage: boolean;
  }>;
  shoppable: boolean;
  tag: string[];
  miscellaneousText: string | null;
  price: number | null;
  savings: number | null;
  specialPrice: number | null;
  limitOrQuantity: string | null;
  isVendor: boolean | null;
  pricing: unknown[];
}

export interface WeeklyDealsResponse {
  data: {
    shoppableWeeklyDeals: {
      divisionCode: string;
      storeId: string;
      events: Array<{
        description: string;
        disclaimer: string;
        eventType: string;
        title: string;
      }>;
      timezone: string;
      ads: WeeklyDeal[];
    };
  };
  meta: {
    shoppableWeeklyDeals: Record<string, unknown>;
  };
}
