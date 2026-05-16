import type { Club, GeoPoint } from "./types";
import { haversineKm } from "./geo";

// Hard default so the map always opens on NYC (10003, Union Square / East
// Village) with zero data or network dependency.
export const DEFAULT_HOME_ZIP = "10003";
export const DEFAULT_HOME: GeoPoint = { lat: 40.7322, lng: -73.9893 };

// Clubs within this radius of the origin are "nearby" — keeps a NYC user from
// seeing LA clubs by default. ~80 km covers a metro incl. its suburbs (the NY
// data includes Long Island / Westchester).
export const NEARBY_RADIUS_KM = 80;

const BUILTIN: Record<string, GeoPoint> = {
  "10003": DEFAULT_HOME
};

// US 5-digit ZIP or Canadian postal code ("M5R 3L2" / "M5R3L2").
export function looksLikeZip(value: string): boolean {
  const v = value.trim();
  return /^\d{5}$/.test(v) || /^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/.test(v);
}

function normalize(zip: string): string {
  return zip.trim().toUpperCase().replace(/\s+/g, "");
}

/**
 * Synchronous, offline ZIP -> coordinates:
 *  1. built-in centroid (the hard default 10003),
 *  2. exact postal-code match among the clubs we already have,
 *  3. same 3-char prefix average (nearest sortation area / ZIP3).
 * Returns null only for a ZIP far from every Equinox — in which case there
 * are no nearby clubs to show anyway, so precise geocoding adds nothing.
 */
export function resolveZip(zip: string, clubs: Club[]): GeoPoint | null {
  const key = normalize(zip);
  if (!key) return null;
  if (BUILTIN[key]) return BUILTIN[key];

  const withGeo = clubs.filter((c) => c.geo && c.address.postalCode);
  const exact = withGeo.find((c) => normalize(c.address.postalCode) === key);
  if (exact?.geo) return exact.geo;

  const prefix = key.slice(0, 3);
  const prefixed = withGeo.filter((c) => normalize(c.address.postalCode).startsWith(prefix));
  if (prefixed.length) {
    const lat = prefixed.reduce((s, c) => s + c.geo!.lat, 0) / prefixed.length;
    const lng = prefixed.reduce((s, c) => s + c.geo!.lng, 0) / prefixed.length;
    return { lat, lng };
  }
  return null;
}

export function clubsNear(
  clubs: Club[],
  origin: GeoPoint,
  radiusKm = NEARBY_RADIUS_KM
): Club[] {
  return clubs.filter((c) => c.geo && haversineKm(origin, c.geo) <= radiusKm);
}
