import path from "node:path";

// NB: not `BASE_URL` — that name is reserved/overwritten by Vite/Vitest (set
// to "/"), which would break `new URL(url, BASE_URL)`.
export const BASE_URL = process.env.SCRAPER_BASE_URL ?? "https://www.equinox.com";

// Optional seed slugs only; discovery is NOT narrowed to these (national scope).
export const SEED_CITY_SLUGS = (process.env.CITY_SLUGS ?? "")
  .split(",")
  .map((slug) => slug.trim())
  .filter(Boolean);

export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? "data");
export const CACHE_DIR = path.join(DATA_DIR, "cache");
export const OUTPUT_PATH = path.join(DATA_DIR, "clubs.json");
export const URL_SEED_PATH = path.join(DATA_DIR, "club-urls.txt");
export const REQUEST_DELAY_MS = Number(process.env.REQUEST_DELAY_MS ?? "1200");

const SCRAPER_CONTACT = process.env.SCRAPER_CONTACT ?? "ops@example.com";
export const USER_AGENT =
  process.env.SCRAPER_USER_AGENT ??
  `EquinoxHoursScraper/1.0 (+contact: ${SCRAPER_CONTACT}; respectful fetch)`;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function slugifyAmenity(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function titleCaseSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
