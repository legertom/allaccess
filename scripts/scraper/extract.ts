import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { slugify } from "./util";

export function extractJsonLd($: cheerio.CheerioAPI): any[] {
  const nodes: any[] = [];
  $("script[type='application/ld+json']").each((_, el) => {
    const raw = $(el).text();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        nodes.push(...parsed);
      } else {
        nodes.push(parsed);
      }
    } catch {
      return;
    }
  });
  return nodes;
}

export function extractAddress(jsonLdNodes: any[], $: cheerio.CheerioAPI) {
  for (const node of jsonLdNodes) {
    const address = node?.address;
    if (address?.addressLocality && address?.streetAddress) {
      return {
        line1: address.streetAddress,
        city: address.addressLocality,
        state: address.addressRegion ?? "",
        postalCode: address.postalCode ?? ""
      };
    }
  }

  const addressText = $("address").first().text().trim();
  if (addressText) {
    const parts = addressText.split(",").map((part) => part.trim());
    if (parts.length >= 2) {
      const [line1, city, stateZip] = parts;
      const stateZipParts = (stateZip ?? "").trim().split(/\s+/);
      return {
        line1,
        city: city ?? "",
        state: stateZipParts[0] ?? "",
        postalCode: stateZipParts[1] ?? ""
      };
    }
  }

  return null;
}

export function extractJsonLdCountry(jsonLdNodes: any[]): string | null {
  for (const node of jsonLdNodes) {
    const c = node?.address?.addressCountry;
    if (typeof c === "string" && c.trim()) return c.trim();
    if (c && typeof c === "object" && typeof c.name === "string") return c.name.trim();
  }
  return null;
}

export function extractGeo(jsonLdNodes: any[], $: cheerio.CheerioAPI) {
  for (const node of jsonLdNodes) {
    const geo = node?.geo;
    if (geo?.latitude && geo?.longitude) {
      return { lat: Number(geo.latitude), lng: Number(geo.longitude) };
    }
  }

  const lat = $("meta[property='place:location:latitude']").attr("content");
  const lng = $("meta[property='place:location:longitude']").attr("content");
  if (lat && lng) {
    return { lat: Number(lat), lng: Number(lng) };
  }

  return undefined;
}

export function extractText($: cheerio.CheerioAPI, selectors: string[]): string {
  for (const selector of selectors) {
    const text = $(selector).first().text().trim();
    if (text) {
      return text;
    }
  }
  return "";
}

function collectSectionLines($: cheerio.CheerioAPI, heading: Element): string[] {
  const lines: string[] = [];
  const section = $(heading).nextUntil("h1, h2, h3, h4, h5");
  if (!section.length) {
    return lines;
  }

  section.each((_, el) => {
    const text = $(el).text();
    if (!text) return;
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => lines.push(line));
  });

  return Array.from(new Set(lines));
}

export function extractSections($: cheerio.CheerioAPI): Record<string, string[]> {
  const sections: Record<string, string[]> = {};
  $("h1, h2, h3, h4, h5").each((_, el) => {
    const title = $(el).text().trim();
    if (!title) return;
    const key = slugify(title);
    const lines = collectSectionLines($, el);
    if (lines.length) {
      sections[key] = lines;
    }
  });
  return sections;
}

export function extractAmenities(sections: Record<string, string[]>): string[] {
  const amenitySectionKey = Object.keys(sections).find((key) => key.includes("amenit"));
  if (!amenitySectionKey) {
    return [];
  }
  return sections[amenitySectionKey]
    .map((line) => line.replace(/^[-*]\s*/, ""))
    .filter(Boolean);
}

export function findHoursSections(
  sections: Record<string, string[]>
): Record<string, string[]> {
  const hoursSections: Record<string, string[]> = {};
  for (const [key, lines] of Object.entries(sections)) {
    if (key.includes("hour")) {
      hoursSections[key] = lines;
    }
  }
  return hoursSections;
}

export function pickClubHours(hoursSections: Record<string, string[]>): string[] {
  const clubKey = Object.keys(hoursSections).find((key) => key.includes("club"));
  if (clubKey) {
    return hoursSections[clubKey];
  }
  const genericKey = Object.keys(hoursSections).find(
    (key) => key === "hours" || key.endsWith("hours")
  );
  if (genericKey) {
    return hoursSections[genericKey];
  }
  const firstKey = Object.keys(hoursSections)[0];
  return firstKey ? hoursSections[firstKey] : [];
}

export function extractAmenitiesFromFacility(facility: any): string[] {
  if (!facility) {
    return [];
  }
  const collectTitles = (items?: any[]): string[] => {
    if (!items || !Array.isArray(items)) {
      return [];
    }
    return items
      .map((item) => (typeof item === "string" ? item : item?.title))
      .filter((title): title is string => Boolean(title))
      .map((title) => title.trim())
      .filter(Boolean);
  };

  const titles = [
    ...collectTitles(facility.facilityAmenities),
    ...collectTitles(facility.facilityFeaturedAmenities),
    ...collectTitles(facility.featuredAmenities),
    ...collectTitles(facility.amenities)
  ];

  return Array.from(new Set(titles));
}

export function extractAddressFromFacility(facility: any) {
  const contact =
    facility?.contactInformation ?? facility?.facilityContact ?? facility?.salesOfficeAddress ?? null;
  if (!contact?.address) {
    return null;
  }
  return {
    line1: contact.address,
    city: contact.city ?? "",
    state: contact.state ?? "",
    postalCode: contact.zip ?? ""
  };
}

export function extractCountryFromFacility(facility: any): string | null {
  const contact =
    facility?.contactInformation ?? facility?.facilityContact ?? facility?.salesOfficeAddress ?? null;
  const c = contact?.country ?? facility?.country ?? null;
  return typeof c === "string" && c.trim() ? c.trim() : null;
}

export function extractGeoFromFacility(facility: any) {
  const contact = facility?.contactInformation ?? facility?.facilityContact ?? null;
  const lat = contact?.latitude ?? facility?.latitude;
  const lng = contact?.longitude ?? facility?.longitude;
  if (!lat || !lng) {
    return undefined;
  }
  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (Number.isNaN(latNum) || Number.isNaN(lngNum)) {
    return undefined;
  }
  return { lat: latNum, lng: lngNum };
}

export function extractNextDataFacility(html: string): any | null {
  const $ = cheerio.load(html);
  const raw = $("#__NEXT_DATA__").text();
  if (!raw) {
    return null;
  }
  try {
    const data = JSON.parse(raw);
    return data?.props?.pageProps?.facility ?? null;
  } catch {
    return null;
  }
}

export function extractClubDetailUrlsFromNextData(html: string): string[] {
  const $ = cheerio.load(html);
  const raw = $("#__NEXT_DATA__").text();
  if (!raw) {
    return [];
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }

  const urls = new Set<string>();
  const visit = (node: unknown) => {
    if (!node) {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node === "object") {
      const record = node as Record<string, unknown>;
      const urlValue =
        (record.clubDetailPageURL as string | undefined) ??
        (record.clubDetailPageUrl as string | undefined);
      if (urlValue && typeof urlValue === "string") {
        urls.add(urlValue);
      }
      Object.values(record).forEach(visit);
    }
  };
  visit(data);
  return Array.from(urls);
}
