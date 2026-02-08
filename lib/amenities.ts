import type { Club } from "./types";

export function slugifyAmenity(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function buildAmenityKeys(amenity: string): string[] {
  const normalized = amenity.toLowerCase();
  const keys = new Set<string>();
  if (normalized.includes("pool")) {
    keys.add("pool");
  }
  if (normalized.includes("spa")) {
    keys.add("spa");
  }
  if (normalized.includes("kids")) {
    keys.add("kids_club");
  }
  keys.add(slugifyAmenity(amenity));
  return Array.from(keys);
}

export function getHoursForClub(club: Club, amenity?: string) {
  return getHoursSetForClub(club, amenity).spans;
}

export function clubHasAmenity(club: Club, amenity?: string): boolean {
  if (!amenity) {
    return true;
  }
  const normalized = amenity.toLowerCase().trim();
  if (!normalized) {
    return true;
  }
  return club.amenities.some((item) => {
    const value = item.toLowerCase();
    return value === normalized || value.includes(normalized);
  });
}

export function getHoursSetForClub(club: Club, amenity?: string) {
  if (!amenity) {
    return club.hours.club;
  }

  const keys = buildAmenityKeys(amenity);
  for (const key of keys) {
    const amenityHours = club.hours.amenities[key];
    if (amenityHours && amenityHours.spans.length) {
      return amenityHours;
    }
  }

  return club.hours.club;
}
