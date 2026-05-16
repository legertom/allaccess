import { describe, it, expect } from "vitest";
import {
  buildRegionIndex,
  clubMatchesLocation,
  clubCountry,
  clubRegionSlug
} from "../lib/regions";
import type { Club } from "../lib/types";

function club(partial: Partial<Club> & { id: string }): Club {
  return {
    slug: partial.id,
    name: partial.id,
    address: { line1: "", city: "", state: "", postalCode: "", ...partial.address },
    timezone: "America/New_York",
    amenities: [],
    hours: { club: { spans: [] }, amenities: {} },
    source: { url: "", lastFetchedAt: "" },
    ...partial
  };
}

describe("tolerant accessors (pre-national data has no country/region)", () => {
  it("falls back to US + state when fields are absent", () => {
    const c = club({ id: "a", address: { line1: "1", city: "New York", state: "NY", postalCode: "10001" } });
    expect(clubCountry(c)).toBe("US");
    expect(clubRegionSlug(c)).toBe("ny");
  });
  it("uses explicit national fields when present", () => {
    const c = club({
      id: "b",
      region: "los-angeles",
      regionLabel: "Los Angeles",
      address: { line1: "1", city: "WeHo", state: "CA", postalCode: "90069", country: "US" }
    });
    expect(clubCountry(c)).toBe("US");
    expect(clubRegionSlug(c)).toBe("los-angeles");
  });
});

describe("buildRegionIndex", () => {
  const clubs = [
    club({ id: "ny1", address: { line1: "1", city: "New York", state: "NY", postalCode: "1", country: "US" }, region: "new-york", regionLabel: "New York" }),
    club({ id: "ny2", address: { line1: "2", city: "Brooklyn", state: "NY", postalCode: "2", country: "US" }, region: "new-york", regionLabel: "New York" }),
    club({ id: "ldn", address: { line1: "3", city: "London", state: "", postalCode: "3", country: "GB" }, region: "london", regionLabel: "London" })
  ];
  const idx = buildRegionIndex(clubs);

  it("groups countries with labels", () => {
    expect(idx.countries).toEqual(
      expect.arrayContaining([
        { code: "US", label: "United States" },
        { code: "GB", label: "United Kingdom" }
      ])
    );
  });
  it("groups regions per country and cities per region", () => {
    expect(idx.regionsByCountry.US).toEqual([{ slug: "new-york", label: "New York" }]);
    expect(idx.citiesByCountryRegion["US::new-york"].sort()).toEqual(["Brooklyn", "New York"]);
    expect(idx.citiesByCountryRegion["GB::london"]).toEqual(["London"]);
  });
});

describe("clubMatchesLocation", () => {
  const c = club({
    id: "x",
    region: "los-angeles",
    regionLabel: "Los Angeles",
    address: { line1: "1", city: "Santa Monica", state: "CA", postalCode: "90401", country: "US" }
  });
  it("matches when filters align (and ignores empty filters)", () => {
    expect(clubMatchesLocation(c, {})).toBe(true);
    expect(clubMatchesLocation(c, { country: "US", region: "los-angeles", city: "Santa Monica" })).toBe(true);
  });
  it("rejects on any mismatch", () => {
    expect(clubMatchesLocation(c, { country: "GB" })).toBe(false);
    expect(clubMatchesLocation(c, { region: "new-york" })).toBe(false);
    expect(clubMatchesLocation(c, { city: "Venice" })).toBe(false);
  });
});
