import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildClubFromHtml } from "../scripts/scraper/club";
import { discoverClubUrls } from "../scripts/scraper/discover";

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

describe("buildClubFromHtml — Los Angeles (US, overnight pool)", () => {
  const club = buildClubFromHtml(
    "https://www.equinox.com/clubs/los-angeles/westside/westhollywood",
    fixture("club-losangeles.html")
  );

  it("derives identity, country, region from facility + URL", () => {
    expect(club).not.toBeNull();
    expect(club!.name).toBe("Equinox West Hollywood");
    expect(club!.address.city).toBe("West Hollywood");
    expect(club!.address.state).toBe("CA");
    expect(club!.address.country).toBe("US");
    expect(club!.region).toBe("los-angeles");
    expect(club!.regionLabel).toBe("Los Angeles");
    expect(club!.timezone).toBe("America/Los_Angeles");
    expect(club!.geo).toEqual({ lat: 34.0901, lng: -118.3859 });
    expect(club!.amenities).toEqual(expect.arrayContaining(["Pool", "Spa", "Pilates"]));
  });

  it("parses club hours into day spans", () => {
    expect(club!.hours.club.spans).toEqual(
      expect.arrayContaining([{ day: 1, open: "05:00", close: "23:00" }])
    );
  });

  it("normalizes the overnight pool span into two days", () => {
    const pool = club!.hours.amenities.pool;
    expect(pool).toBeTruthy();
    expect(pool.spans).toEqual(
      expect.arrayContaining([
        { day: 5, open: "22:00", close: "24:00" },
        { day: 6, open: "00:00", close: "02:00" }
      ])
    );
  });
});

describe("buildClubFromHtml — Toronto (CA via province)", () => {
  const club = buildClubFromHtml(
    "https://www.equinox.com/clubs/toronto/downtown/yorkville",
    fixture("club-toronto.html")
  );
  it("derives CA from the ON province and labels the region from the slug", () => {
    expect(club!.address.country).toBe("CA");
    expect(club!.region).toBe("toronto");
    expect(club!.regionLabel).toBe("Toronto");
    expect(club!.timezone).toBe("America/Toronto");
  });
});

describe("buildClubFromHtml — London (GB via timezone fallback)", () => {
  const club = buildClubFromHtml(
    "https://www.equinox.com/clubs/london/central/stjamess",
    fixture("club-london.html")
  );
  it("falls through to the timezone rule when no country/state present", () => {
    expect(club!.address.country).toBe("GB");
    expect(club!.region).toBe("london");
    expect(club!.regionLabel).toBe("London");
  });
});

describe("discoverClubUrls — national, mocked sitemap", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns every region's club-detail URL from the sitemap", async () => {
    const sitemap = fixture("sitemap.xml");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        status: 200,
        headers: { get: () => null },
        text: async () => sitemap
      }))
    );
    const urls = await discoverClubUrls();
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
