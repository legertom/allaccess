import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import { parseHoursLines } from "../lib/hours";
import type { Club, HoursSet } from "../lib/types";

const BASE_URL = process.env.BASE_URL ?? "https://www.equinox.com";
const CITY_SLUGS = (process.env.CITY_SLUGS ?? "newyork,nyc,new-york,ny")
  .split(",")
  .map((slug) => slug.trim())
  .filter(Boolean);
const NYC_REGION_SEGMENTS = new Set(["uptown", "midtown", "downtown", "brooklyn"]);

const DATA_DIR = path.resolve(process.env.DATA_DIR ?? "data");
const CACHE_DIR = path.join(DATA_DIR, "cache");
const OUTPUT_PATH = path.join(DATA_DIR, "clubs.json");
const URL_SEED_PATH = path.join(DATA_DIR, "club-urls.txt");
const REQUEST_DELAY_MS = Number(process.env.REQUEST_DELAY_MS ?? "1200");

const SCRAPER_CONTACT = process.env.SCRAPER_CONTACT ?? "ops@example.com";
const USER_AGENT =
  process.env.SCRAPER_USER_AGENT ??
  `EquinoxHoursScraper/1.0 (+contact: ${SCRAPER_CONTACT}; respectful fetch)`;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function slugifyAmenity(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function readSeedUrls(): Promise<string[] | null> {
  try {
    const content = await fs.readFile(URL_SEED_PATH, "utf8");
    const urls = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
    return urls.length ? urls : null;
  } catch (error) {
    return null;
  }
}

function isNYCClubUrl(url: string): boolean {
  try {
    const path = new URL(url, BASE_URL).pathname.split("/").filter(Boolean);
    // /clubs/new-york/{segment}/{club}
    if (path.length < 4 || path[0] !== "clubs") {
      return false;
    }
    if (path[1] !== "new-york") {
      return false;
    }
    return NYC_REGION_SEGMENTS.has(path[2]);
  } catch (error) {
    return false;
  }
}

async function fetchText(url: string, etag?: string): Promise<{ status: number; text: string; etag?: string }> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xml;q=0.9,*/*;q=0.8",
      ...(etag ? { "If-None-Match": etag } : {})
    }
  });

  const status = response.status;
  const newEtag = response.headers.get("etag") ?? undefined;
  const text = status === 304 ? "" : await response.text();
  return { status, text, etag: newEtag };
}

async function fetchWithCache(url: string, cacheKey: string): Promise<string> {
  await ensureDir(CACHE_DIR);
  const cacheMetaPath = path.join(CACHE_DIR, `${cacheKey}.json`);
  const cacheHtmlPath = path.join(CACHE_DIR, `${cacheKey}.html`);

  let cachedEtag: string | undefined;
  try {
    const meta = JSON.parse(await fs.readFile(cacheMetaPath, "utf8")) as { etag?: string };
    cachedEtag = meta.etag;
  } catch (error) {
    cachedEtag = undefined;
  }

  const { status, text, etag } = await fetchText(url, cachedEtag);

  if (status === 304) {
    return fs.readFile(cacheHtmlPath, "utf8");
  }

  await fs.writeFile(cacheHtmlPath, text, "utf8");
  await fs.writeFile(cacheMetaPath, JSON.stringify({ etag }, null, 2), "utf8");
  return text;
}

function extractJsonLd($: cheerio.CheerioAPI): any[] {
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
    } catch (error) {
      return;
    }
  });
  return nodes;
}

function extractAddress(jsonLdNodes: any[], $: cheerio.CheerioAPI) {
  for (const node of jsonLdNodes) {
    const address = node?.address;
    if (address?.addressLocality && address?.streetAddress) {
      return {
        line1: address.streetAddress,
        city: address.addressLocality,
        state: address.addressRegion ?? "NY",
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
        city: city ?? "New York",
        state: stateZipParts[0] ?? "NY",
        postalCode: stateZipParts[1] ?? ""
      };
    }
  }

  return null;
}

function extractGeo(jsonLdNodes: any[], $: cheerio.CheerioAPI) {
  for (const node of jsonLdNodes) {
    const geo = node?.geo;
    if (geo?.latitude && geo?.longitude) {
      return {
        lat: Number(geo.latitude),
        lng: Number(geo.longitude)
      };
    }
  }

  const lat = $("meta[property='place:location:latitude']").attr("content");
  const lng = $("meta[property='place:location:longitude']").attr("content");
  if (lat && lng) {
    return { lat: Number(lat), lng: Number(lng) };
  }

  return undefined;
}

function extractText($: cheerio.CheerioAPI, selectors: string[]): string {
  for (const selector of selectors) {
    const text = $(selector).first().text().trim();
    if (text) {
      return text;
    }
  }
  return "";
}

function collectSectionLines($: cheerio.CheerioAPI, heading: cheerio.Element): string[] {
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

function extractSections($: cheerio.CheerioAPI) {
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

function extractAmenities(sections: Record<string, string[]>): string[] {
  const amenitySectionKey = Object.keys(sections).find((key) => key.includes("amenit"));
  if (!amenitySectionKey) {
    return [];
  }

  return sections[amenitySectionKey]
    .map((line) => line.replace(/^[-*]\s*/, ""))
    .filter(Boolean);
}

function findHoursSections(sections: Record<string, string[]>) {
  const hoursSections: Record<string, string[]> = {};

  for (const [key, lines] of Object.entries(sections)) {
    if (key.includes("hour")) {
      hoursSections[key] = lines;
    }
  }

  return hoursSections;
}

function pickClubHours(hoursSections: Record<string, string[]>): string[] {
  const clubKey = Object.keys(hoursSections).find((key) => key.includes("club"));
  if (clubKey) {
    return hoursSections[clubKey];
  }

  const genericKey = Object.keys(hoursSections).find((key) => key === "hours" || key.endsWith("hours"));
  if (genericKey) {
    return hoursSections[genericKey];
  }

  const firstKey = Object.keys(hoursSections)[0];
  return firstKey ? hoursSections[firstKey] : [];
}

function buildHoursSet(lines: string[]): HoursSet {
  return {
    spans: parseHoursLines(lines),
    raw: lines
  };
}

function extractAmenityHours(hoursSections: Record<string, string[]>, clubLines: string[]): Record<string, HoursSet> {
  const amenityHours: Record<string, HoursSet> = {};

  for (const [key, lines] of Object.entries(hoursSections)) {
    if (lines === clubLines) {
      continue;
    }

    if (!key.includes("hour")) {
      continue;
    }

    const label = key.replace(/-?hours?$/, "");
    if (!label || label === "club") {
      continue;
    }

    const amenityKey = slugifyAmenity(label);
    amenityHours[amenityKey] = buildHoursSet(lines);
  }

  return amenityHours;
}

type ServiceHoursEntry = {
  days?: string;
  hours?: string;
};

type ServiceHoursMap = Record<
  string,
  {
    startTime?: string;
    endTime?: string;
  }[]
>;

function parseServiceHoursList(entries?: ServiceHoursEntry[]): HoursSet {
  if (!entries || !entries.length) {
    return buildHoursSet([]);
  }

  const lines = entries
    .map((entry) => {
      const days = entry?.days?.trim();
      const hours = entry?.hours?.trim();
      if (!days || !hours) {
        return null;
      }
      return `${days} ${hours}`;
    })
    .filter((line): line is string => Boolean(line));

  return buildHoursSet(lines);
}

function normalizeServiceTime(value?: string): string | null {
  if (!value) {
    return null;
  }
  const parts = value.split(":");
  if (parts.length < 2) {
    return null;
  }
  return `${parts[0].padStart(2, "0")}:${parts[1].padStart(2, "0")}`;
}

function parseServiceHoursMap(map?: ServiceHoursMap): HoursSet {
  if (!map) {
    return buildHoursSet([]);
  }

  const lines: string[] = [];
  for (const [day, ranges] of Object.entries(map)) {
    if (!ranges || !ranges.length) {
      continue;
    }
    for (const range of ranges) {
      const start = normalizeServiceTime(range.startTime);
      const end = normalizeServiceTime(range.endTime);
      if (!start || !end) {
        continue;
      }
      lines.push(`${day} ${start} - ${end}`);
    }
  }

  return buildHoursSet(lines);
}

function extractAmenitiesFromFacility(facility: any): string[] {
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

function extractAddressFromFacility(facility: any) {
  const contact =
    facility?.contactInformation ?? facility?.facilityContact ?? facility?.salesOfficeAddress ?? null;
  if (!contact?.address) {
    return null;
  }

  return {
    line1: contact.address,
    city: contact.city ?? "New York",
    state: contact.state ?? "NY",
    postalCode: contact.zip ?? ""
  };
}

function extractGeoFromFacility(facility: any) {
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

function extractNextDataFacility(html: string): any | null {
  const $ = cheerio.load(html);
  const raw = $("#__NEXT_DATA__").text();
  if (!raw) {
    return null;
  }

  try {
    const data = JSON.parse(raw);
    return data?.props?.pageProps?.facility ?? null;
  } catch (error) {
    return null;
  }
}

function extractClubDetailUrlsFromNextData(html: string): string[] {
  const $ = cheerio.load(html);
  const raw = $("#__NEXT_DATA__").text();
  if (!raw) {
    return [];
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (error) {
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

async function discoverClubUrls(): Promise<string[]> {
  const seeded = await readSeedUrls();
  if (seeded) {
    return seeded.filter(isNYCClubUrl);
  }

  const extractLocs = (xml: string): string[] => {
    const $ = cheerio.load(xml, { xmlMode: true });
    const locs: string[] = [];
    $("loc").each((_, el) => {
      const text = $(el).text().trim();
      if (text) {
        locs.push(text);
      }
    });
    return locs;
  };

  const filterClubUrls = (urls: string[]) => {
    return urls
      .filter((url) => url.includes("/clubs/"))
      .filter((url) =>
        CITY_SLUGS.some(
          (slug) =>
            url.toLowerCase().includes(`/clubs/${slug}`) ||
            url.toLowerCase().includes(`/${slug}/`)
        )
      );
  };

  const sitemapUrl = `${BASE_URL}/sitemap.xml`;
  try {
    const { text } = await fetchText(sitemapUrl);
    const locs = extractLocs(text);
    const urls = filterClubUrls(locs);

    if (urls.length) {
      return Array.from(new Set(urls)).filter(isNYCClubUrl);
    }

    const sitemapLocs = locs.filter((loc) => /sitemap/i.test(loc));
    const candidates = sitemapLocs.filter((loc) => /club|location/i.test(loc));
    const toFetch = (candidates.length ? candidates : sitemapLocs.slice(0, 10)).slice(0, 10);

    const discovered: string[] = [];
    for (const sitemap of toFetch) {
      const { text: subText } = await fetchText(sitemap);
      const subLocs = extractLocs(subText);
      discovered.push(...filterClubUrls(subLocs));
      await sleep(REQUEST_DELAY_MS);
    }

    if (discovered.length) {
      return Array.from(new Set(discovered)).filter(isNYCClubUrl);
    }
  } catch (error) {
    // fallthrough
  }

  const regionUrl = `${BASE_URL}/clubs/new-york`;
  const { text } = await fetchText(regionUrl);
  const nextUrls = extractClubDetailUrlsFromNextData(text);
  if (nextUrls.length) {
    return nextUrls
      .map((url) => (url.startsWith("http") ? url : `${BASE_URL}${url}`))
      .filter(isNYCClubUrl);
  }

  const $ = cheerio.load(text);
  const urls = new Set<string>();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    if (!href.includes("/clubs/")) return;

    const absolute = href.startsWith("http") ? href : `${BASE_URL}${href}`;
    if (CITY_SLUGS.some((slug) => absolute.toLowerCase().includes(`/${slug}/`))) {
      urls.add(absolute);
    }
  });

  return Array.from(urls).filter(isNYCClubUrl);
}

async function scrapeClub(url: string): Promise<Club | null> {
  const slug = slugify(new URL(url).pathname.split("/").filter(Boolean).pop() ?? "club");
  const html = await fetchWithCache(url, slug);
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
        amenityHours[slugifyAmenity(label)] = parseServiceHoursMap(entry.hours);
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
    Object.assign(amenityHours, extractAmenityHours(hoursSections, clubLines));
  }

  return {
    id: slug,
    slug,
    name: name || slug,
    address,
    geo,
    timezone: facility?.timeZone ?? "America/New_York",
    amenities,
    hours: {
      club: clubHours,
      amenities: amenityHours
    },
    source: {
      url,
      lastFetchedAt: new Date().toISOString()
    }
  };
}

async function run() {
  await ensureDir(DATA_DIR);
  const clubUrls = await discoverClubUrls();
  if (!clubUrls.length) {
    throw new Error("No club URLs found. Add URLs to data/club-urls.txt to proceed.");
  }

  const clubs: Club[] = [];

  for (const url of clubUrls) {
    console.log(`Scraping ${url}`);
    try {
      const club = await scrapeClub(url);
      if (club) {
        clubs.push(club);
      }
    } catch (error) {
      console.error(`Failed to scrape ${url}`, error);
    }

    await sleep(REQUEST_DELAY_MS);
  }

  await fs.writeFile(OUTPUT_PATH, JSON.stringify(clubs, null, 2), "utf8");
  console.log(`Saved ${clubs.length} clubs to ${OUTPUT_PATH}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
