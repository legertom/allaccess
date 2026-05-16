import fs from "node:fs/promises";
import * as cheerio from "cheerio";
import { fetchText } from "./http";
import { extractClubDetailUrlsFromNextData } from "./extract";
import {
  extractSitemapLocs,
  filterClubUrls,
  isClubDetailUrl
} from "./urls";
import {
  BASE_URL,
  REQUEST_DELAY_MS,
  URL_SEED_PATH,
  sleep
} from "./util";

async function readSeedUrls(): Promise<string[] | null> {
  try {
    const content = await fs.readFile(URL_SEED_PATH, "utf8");
    const urls = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
    return urls.length ? urls : null;
  } catch {
    return null;
  }
}

/**
 * National discovery. The old NYC narrowing (CITY_SLUGS, isNYCClubUrl,
 * /clubs/new-york landing, 10-sitemap cap) is removed: we walk the full
 * sitemap and accept any club-detail-shaped URL.
 */
export async function discoverClubUrls(): Promise<string[]> {
  const seeded = await readSeedUrls();
  if (seeded) {
    return seeded.filter(isClubDetailUrl);
  }

  const sitemapUrl = `${BASE_URL}/sitemap.xml`;
  try {
    const { text } = await fetchText(sitemapUrl);
    const locs = extractSitemapLocs(text);
    const direct = filterClubUrls(locs);
    if (direct.length) {
      return direct;
    }

    // Sitemap index: walk every nested sitemap that could carry club/location
    // URLs (no 10-entry cap — national scope).
    const nested = locs.filter((loc) => /sitemap/i.test(loc));
    const preferred = nested.filter((loc) => /club|location/i.test(loc));
    const toFetch = preferred.length ? preferred : nested;

    const discovered: string[] = [];
    for (const sitemap of toFetch) {
      const { text: subText } = await fetchText(sitemap);
      discovered.push(...filterClubUrls(extractSitemapLocs(subText)));
      await sleep(REQUEST_DELAY_MS);
    }
    if (discovered.length) {
      return Array.from(new Set(discovered));
    }
  } catch {
    // fall through to the page-based discovery below
  }

  // Fallback: the global /clubs landing page exposes detail URLs in __NEXT_DATA__.
  const { text } = await fetchText(`${BASE_URL}/clubs`);
  const nextUrls = extractClubDetailUrlsFromNextData(text);
  if (nextUrls.length) {
    return nextUrls
      .map((url) => (url.startsWith("http") ? url : `${BASE_URL}${url}`))
      .filter(isClubDetailUrl);
  }

  const $ = cheerio.load(text);
  const urls = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href || !href.includes("/clubs/")) return;
    const absolute = href.startsWith("http") ? href : `${BASE_URL}${href}`;
    if (isClubDetailUrl(absolute)) {
      urls.add(absolute);
    }
  });
  return Array.from(urls);
}
