import * as cheerio from "cheerio";
import { BASE_URL } from "./util";

const US_STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC"
]);

const CA_PROVINCES = new Set([
  "AB","BC","MB","NB","NL","NS","NT","NU","ON","PE","QC","SK","YT"
]);

/**
 * A club detail page is `/clubs/{region}/{sub}/{club}` (>= 4 path segments).
 * No country/region is hard-coded — this is the national-scope replacement
 * for the old isNYCClubUrl gate.
 */
export function isClubDetailUrl(url: string): boolean {
  try {
    const segments = new URL(url, BASE_URL).pathname.split("/").filter(Boolean);
    return segments[0] === "clubs" && segments.length >= 4;
  } catch {
    return false;
  }
}

/** The region slug is path segment [1], e.g. /clubs/los-angeles/... -> "los-angeles". */
export function deriveRegionSlug(url: string): string | null {
  try {
    const segments = new URL(url, BASE_URL).pathname.split("/").filter(Boolean);
    if (segments[0] !== "clubs" || segments.length < 2) {
      return null;
    }
    return segments[1] || null;
  } catch {
    return null;
  }
}

export function extractSitemapLocs(xml: string): string[] {
  const $ = cheerio.load(xml, { xmlMode: true });
  const locs: string[] = [];
  $("loc").each((_, el) => {
    const text = $(el).text().trim();
    if (text) {
      locs.push(text);
    }
  });
  return locs;
}

/** National filter: any `/clubs/` URL whose shape is a club detail page. */
export function filterClubUrls(urls: string[]): string[] {
  return Array.from(
    new Set(urls.filter((url) => url.includes("/clubs/") && isClubDetailUrl(url)))
  );
}

type CountryInputs = {
  facilityCountry?: string | null;
  jsonLdCountry?: string | null;
  state?: string | null;
  timezone?: string | null;
};

function normalizeCountryToken(value?: string | null): string | null {
  if (!value) return null;
  const v = value.trim().toUpperCase();
  if (!v) return null;
  if (["US", "USA", "UNITED STATES", "UNITED STATES OF AMERICA"].includes(v)) return "US";
  if (["CA", "CAN", "CANADA"].includes(v)) return "CA";
  if (["GB", "UK", "UNITED KINGDOM", "GREAT BRITAIN", "ENGLAND"].includes(v)) return "GB";
  if (/^[A-Z]{2}$/.test(v)) return v;
  return null;
}

/**
 * Deterministic precedence (plan §5 1b):
 *  (1) facility country field, (2) JSON-LD addressCountry,
 *  (3) state ∈ US/CA sets, (4) timezone prefix. Returns null if it falls
 *  through so the caller can log the gap (never silently guess).
 */
export function deriveCountry(inputs: CountryInputs): string | null {
  const fromFacility = normalizeCountryToken(inputs.facilityCountry);
  if (fromFacility) return fromFacility;

  const fromJsonLd = normalizeCountryToken(inputs.jsonLdCountry);
  if (fromJsonLd) return fromJsonLd;

  const state = inputs.state?.trim().toUpperCase();
  if (state) {
    if (US_STATES.has(state)) return "US";
    if (CA_PROVINCES.has(state)) return "CA";
  }

  const tz = inputs.timezone?.trim();
  if (tz) {
    if (tz.startsWith("Europe/")) return "GB";
    if (tz === "America/Toronto" || tz === "America/Vancouver" || tz === "America/Edmonton" || tz === "America/Winnipeg") {
      return "CA";
    }
    if (tz.startsWith("America/") || tz.startsWith("US/") || tz.startsWith("Pacific/Honolulu")) {
      return "US";
    }
  }

  return null;
}
