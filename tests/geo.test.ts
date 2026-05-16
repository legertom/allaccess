import { describe, it, expect } from "vitest";
import { haversineKm, formatDistance } from "../lib/geo";

describe("haversineKm", () => {
  it("is ~0 for the same point", () => {
    expect(haversineKm({ lat: 40.75, lng: -73.98 }, { lat: 40.75, lng: -73.98 })).toBeCloseTo(0, 5);
  });
  it("matches the known NYC<->LA great-circle distance (~3935 km)", () => {
    const nyc = { lat: 40.7128, lng: -74.006 };
    const la = { lat: 34.0522, lng: -118.2437 };
    const d = haversineKm(nyc, la);
    expect(d).toBeGreaterThan(3900);
    expect(d).toBeLessThan(3970);
  });
  it("is symmetric", () => {
    const a = { lat: 51.5072, lng: -0.1276 };
    const b = { lat: 40.7128, lng: -74.006 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 6);
  });
});

describe("formatDistance", () => {
  it("uses meters under 1 km", () => {
    expect(formatDistance(0.4)).toBe("400 m");
  });
  it("one decimal under 10 km", () => {
    expect(formatDistance(3.27)).toBe("3.3 km");
  });
  it("rounds to whole km past 10", () => {
    expect(formatDistance(42.6)).toBe("43 km");
  });
});
