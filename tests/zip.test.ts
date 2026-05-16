import { describe, it, expect } from "vitest";
import {
  looksLikeZip,
  resolveZip,
  clubsNear,
  DEFAULT_HOME,
  DEFAULT_HOME_ZIP
} from "../lib/zip";
import type { Club } from "../lib/types";

function club(id: string, zip: string, lat: number, lng: number): Club {
  return {
    id,
    slug: id,
    name: id,
    address: { line1: "", city: "", state: "", postalCode: zip, country: "US" },
    geo: { lat, lng },
    timezone: "America/New_York",
    amenities: [],
    hours: { club: { spans: [] }, amenities: {} },
    source: { url: "", lastFetchedAt: "" }
  };
}

const CLUBS = [
  club("ny-cc", "10019", 40.7686, -73.9826), // Columbus Circle
  club("ny-fi", "10004", 40.7045, -74.0123), // Financial District
  club("la-wh", "90069", 34.0901, -118.3859) // West Hollywood
];

describe("looksLikeZip", () => {
  it("accepts US ZIP and CA postal codes", () => {
    expect(looksLikeZip("10003")).toBe(true);
    expect(looksLikeZip("M5R 3L2")).toBe(true);
    expect(looksLikeZip("M5R3L2")).toBe(true);
  });
  it("rejects free text and partials", () => {
    expect(looksLikeZip("Columbus")).toBe(false);
    expect(looksLikeZip("100")).toBe(false);
  });
});

describe("resolveZip (offline, club-derived)", () => {
  it("returns the hard-coded centroid for the default ZIP", () => {
    expect(resolveZip(DEFAULT_HOME_ZIP, [])).toEqual(DEFAULT_HOME);
  });
  it("matches an exact club postal code", () => {
    expect(resolveZip("90069", CLUBS)).toEqual({ lat: 34.0901, lng: -118.3859 });
  });
  it("averages clubs sharing the 3-char prefix when no exact match", () => {
    // 100xx -> average of the two NYC clubs (10019, 10004), not the LA one.
    const r = resolveZip("10011", CLUBS)!;
    expect(r.lat).toBeCloseTo((40.7686 + 40.7045) / 2, 4);
    expect(r.lng).toBeCloseTo((-73.9826 + -74.0123) / 2, 4);
  });
  it("returns null for a ZIP far from every club", () => {
    expect(resolveZip("99999", CLUBS)).toBeNull();
  });
});

describe("clubsNear", () => {
  it("keeps only clubs within the radius of the origin (NYC excludes LA)", () => {
    const near = clubsNear(CLUBS, { lat: 40.7322, lng: -73.9893 }, 80);
    const ids = near.map((c) => c.id).sort();
    expect(ids).toEqual(["ny-cc", "ny-fi"]);
  });
  it("a wide radius includes everything", () => {
    expect(clubsNear(CLUBS, DEFAULT_HOME, 5000)).toHaveLength(3);
  });
});
