import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  deriveCountry,
  deriveRegionSlug,
  extractSitemapLocs,
  filterClubUrls,
  isClubDetailUrl
} from "../scripts/scraper/urls";

const sitemap = readFileSync(new URL("./fixtures/sitemap.xml", import.meta.url), "utf8");

describe("isClubDetailUrl (national, de-NYC)", () => {
  it("accepts any region's club-detail-shaped URL", () => {
    expect(isClubDetailUrl("https://www.equinox.com/clubs/los-angeles/westside/westhollywood")).toBe(true);
    expect(isClubDetailUrl("https://www.equinox.com/clubs/new-york/uptown/columbuscircle")).toBe(true);
    expect(isClubDetailUrl("https://www.equinox.com/clubs/london/central/stjamess")).toBe(true);
  });

  it("rejects landing/index/non-club URLs", () => {
    expect(isClubDetailUrl("https://www.equinox.com/clubs")).toBe(false);
    expect(isClubDetailUrl("https://www.equinox.com/clubs/chicago")).toBe(false);
    expect(isClubDetailUrl("https://www.equinox.com/about")).toBe(false);
    expect(isClubDetailUrl("not a url")).toBe(false);
  });
});

describe("deriveRegionSlug", () => {
  it("returns path segment [1]", () => {
    expect(deriveRegionSlug("https://www.equinox.com/clubs/los-angeles/westside/wh")).toBe("los-angeles");
    expect(deriveRegionSlug("https://www.equinox.com/clubs/new-york/uptown/cc")).toBe("new-york");
  });
  it("returns null when absent", () => {
    expect(deriveRegionSlug("https://www.equinox.com/about")).toBeNull();
  });
});

describe("filterClubUrls over a national sitemap", () => {
  it("keeps only club-detail URLs across all regions", () => {
    const urls = filterClubUrls(extractSitemapLocs(sitemap));
    expect(urls.sort()).toEqual(
      [
        "https://www.equinox.com/clubs/london/central/stjamess",
        "https://www.equinox.com/clubs/los-angeles/westside/westhollywood",
        "https://www.equinox.com/clubs/new-york/uptown/columbuscircle",
        "https://www.equinox.com/clubs/toronto/downtown/yorkville"
      ].sort()
    );
  });
});

describe("deriveCountry precedence", () => {
  it("(1) facility country wins", () => {
    expect(deriveCountry({ facilityCountry: "United States", state: "ON" })).toBe("US");
  });
  it("(2) JSON-LD country when no facility country", () => {
    expect(deriveCountry({ jsonLdCountry: "GB", state: "NY" })).toBe("GB");
  });
  it("(3) US state vs CA province", () => {
    expect(deriveCountry({ state: "CA" })).toBe("US"); // California
    expect(deriveCountry({ state: "ON" })).toBe("CA"); // Ontario
  });
  it("(4) timezone fallback", () => {
    expect(deriveCountry({ timezone: "Europe/London" })).toBe("GB");
    expect(deriveCountry({ timezone: "America/Toronto" })).toBe("CA");
    expect(deriveCountry({ timezone: "America/Chicago" })).toBe("US");
  });
  it("returns null instead of guessing when nothing resolves", () => {
    expect(deriveCountry({})).toBeNull();
    expect(deriveCountry({ state: "ZZ" })).toBeNull();
  });
});
