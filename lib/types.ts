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
  timezone: string;
  amenities: string[];
  hours: ClubHours;
  source: {
    url: string;
    lastFetchedAt: string;
  };
};
