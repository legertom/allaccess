export type HoursSpan = {
  day: number; // 0=Sun, 6=Sat
  open: string; // HH:mm
  close: string; // HH:mm (24:00 allowed)
};

export type HoursSet = {
  spans: HoursSpan[];
  raw?: string[];
};

export type ClubHours = {
  club: HoursSet;
  amenities: Record<string, HoursSet>;
};

export type Address = {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  // Optional only during the NYC->national migration window. The shipped
  // national artifact requires this for every emitted club (CTO condition 5).
  country?: string; // ISO-3166-1 alpha-2: "US" | "CA" | "GB"
};

export type GeoPoint = {
  lat: number;
  lng: number;
};

export type Club = {
  id: string;
  slug: string;
  name: string;
  address: Address;
  geo?: GeoPoint;
  // Optional only during migration; required in the national artifact.
  region?: string; // metro slug from the club URL path, e.g. "los-angeles"
  regionLabel?: string; // display label, e.g. "Los Angeles"
  timezone: string;
  amenities: string[];
  hours: ClubHours;
  source: {
    url: string;
    lastFetchedAt: string;
  };
};
