import * as cheerio from "cheerio";
import type { Club, HoursSet } from "../../lib/types";
import { fetchWithCache } from "./http";
import { slugify, titleCaseSlug, toIanaTimeZone } from "./util";
import { deriveCountry, deriveRegionSlug } from "./urls";
import {
  buildHoursSet,
  extractAmenityHoursFromSections,
  parseServiceHoursList,
  parseServiceHoursMap,
  type ServiceHoursEntry
} from "./normalizeHours";
import {
  extractAddress,
  extractAddressFromFacility,
  extractAmenities,
  extractAmenitiesFromFacility,
  extractClubDetailUrlsFromNextData,
  extractCountryFromFacility,
  extractGeo,
  extractGeoFromFacility,
  extractJsonLd,
  extractJsonLdCountry,
  extractNextDataFacility,
  extractSections,
  extractText,
  findHoursSections,
  pickClubHours
} from "./extract";

export { extractClubDetailUrlsFromNextData };

function deriveRegionLabel(url: string, facility: any): string {
  const fromFacility =
    facility?.regionName ?? facility?.region ?? facility?.market ?? facility?.marketName;
  if (typeof fromFacility === "string" && fromFacility.trim()) {
    return fromFacility.trim();
  }
  const slug = deriveRegionSlug(url);
  return slug ? titleCaseSlug(slug) : "";
}

/**
 * Pure: HTML -> Club (no network). This is the unit-tested core.
 * Returns null if the page has no usable address.
 */
export function buildClubFromHtml(url: string, html: string): Club | null {
  const slug = slugify(new URL(url).pathname.split("/").filter(Boolean).pop() ?? "club");
  const $ = cheerio.load(html);
  const jsonLd = extractJsonLd($);
  const facility = extractNextDataFacility(html);

  const name = facility?.name ?? extractText($, ["h1", "meta[property='og:title']"]);
  const address = extractAddressFromFacility(facility) ?? extractAddress(jsonLd, $);
  if (!address) {
    return null;
  }

  const geo = extractGeoFromFacility(facility) ?? extractGeo(jsonLd, $);
  const sections = extractSections($);
  let amenities = extractAmenitiesFromFacility(facility);
  if (!amenities.length) {
    amenities = extractAmenities(sections);
  }

  let clubHours = buildHoursSet([]);
  const amenityHours: Record<string, HoursSet> = {};

  if (facility) {
    const facilityServiceHours = Array.isArray(facility.facilityServiceHours)
      ? facility.facilityServiceHours
      : [];
    const clubService = facilityServiceHours.find(
      (entry: any) => entry?.serviceType?.toLowerCase?.() === "club"
    );
    if (clubService?.hours) {
      clubHours = parseServiceHoursMap(clubService.hours);
    }

    if (!clubHours.spans.length && facility.serviceHours) {
      clubHours = parseServiceHoursList(facility.serviceHours);
    }

    for (const entry of facilityServiceHours) {
      const label = entry?.serviceType;
      if (!label || label.toLowerCase() === "club") {
        continue;
      }
      if (entry?.hours) {
        amenityHours[slugify(label).replace(/-/g, "_")] = parseServiceHoursMap(entry.hours);
      }
    }

    const listSources: Array<{ key: string; entries?: ServiceHoursEntry[] }> = [
      { key: "spa", entries: facility.spaServiceHours },
      { key: "kids_club", entries: facility.kidsClubServiceHours },
      { key: "shop", entries: facility.shopServiceHours },
      { key: "sales", entries: facility.salesServiceHours }
    ];
    for (const source of listSources) {
      if (!source.entries || !source.entries.length) {
        continue;
      }
      if (!amenityHours[source.key] || !amenityHours[source.key].spans.length) {
        amenityHours[source.key] = parseServiceHoursList(source.entries);
      }
    }
  }

  if (!clubHours.spans.length) {
    const hoursSections = findHoursSections(sections);
    const clubLines = pickClubHours(hoursSections);
    clubHours = buildHoursSet(clubLines);
    Object.assign(amenityHours, extractAmenityHoursFromSections(hoursSections, clubLines));
  }

  const timezone = toIanaTimeZone(facility?.timeZone);
  const country =
    deriveCountry({
      facilityCountry: extractCountryFromFacility(facility),
      jsonLdCountry: extractJsonLdCountry(jsonLd),
      state: address.state,
      timezone
    }) ?? undefined;
  const region = deriveRegionSlug(url) ?? undefined;
  const regionLabel = deriveRegionLabel(url, facility) || undefined;

  return {
    id: slug,
    slug,
    name: name || slug,
    address: { ...address, ...(country ? { country } : {}) },
    geo,
    region,
    regionLabel,
    timezone,
    amenities,
    hours: { club: clubHours, amenities: amenityHours },
    source: { url, lastFetchedAt: new Date().toISOString() }
  };
}

export async function scrapeClub(url: string): Promise<Club | null> {
  const cacheKey = slugify(new URL(url).pathname.split("/").filter(Boolean).pop() ?? "club");
  const html = await fetchWithCache(url, cacheKey);
  return buildClubFromHtml(url, html);
}
