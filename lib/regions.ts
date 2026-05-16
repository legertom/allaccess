import type { Club } from "./types";

const COUNTRY_LABELS: Record<string, string> = {
  US: "United States",
  CA: "Canada",
  GB: "United Kingdom"
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Tolerant accessors: the live (pre-national) dataset has no country/region
// fields, so we fall back to state/city. When the national artifact lands,
// the real fields take precedence automatically.
export function clubCountry(club: Club): string {
  return club.address.country ?? "US";
}

export function clubRegionSlug(club: Club): string {
  if (club.region) return club.region;
  return slugify(club.regionLabel ?? club.address.state ?? club.address.city ?? "region");
}

export function clubRegionLabel(club: Club): string {
  return club.regionLabel ?? club.address.state ?? club.address.city ?? "Region";
}

export function countryLabel(code: string): string {
  return COUNTRY_LABELS[code] ?? code;
}

export type RegionOption = { slug: string; label: string };

export type RegionIndex = {
  countries: { code: string; label: string }[];
  regionsByCountry: Record<string, RegionOption[]>;
  citiesByCountryRegion: Record<string, string[]>; // key `${country}::${slug}`
};

export function buildRegionIndex(clubs: Club[]): RegionIndex {
  const countries = new Map<string, true>();
  const regions = new Map<string, Map<string, string>>(); // country -> slug -> label
  const cities = new Map<string, Set<string>>(); // `${country}::${slug}` -> cities

  for (const club of clubs) {
    const country = clubCountry(club);
    const slug = clubRegionSlug(club);
    const label = clubRegionLabel(club);
    countries.set(country, true);
    if (!regions.has(country)) regions.set(country, new Map());
    regions.get(country)!.set(slug, label);
    const key = `${country}::${slug}`;
    if (!cities.has(key)) cities.set(key, new Set());
    if (club.address.city) cities.get(key)!.add(club.address.city);
  }

  const sortStr = (a: string, b: string) => a.localeCompare(b);

  return {
    countries: Array.from(countries.keys())
      .sort(sortStr)
      .map((code) => ({ code, label: countryLabel(code) })),
    regionsByCountry: Object.fromEntries(
      Array.from(regions.entries()).map(([country, m]) => [
        country,
        Array.from(m.entries())
          .map(([slug, label]) => ({ slug, label }))
          .sort((a, b) => sortStr(a.label, b.label))
      ])
    ),
    citiesByCountryRegion: Object.fromEntries(
      Array.from(cities.entries()).map(([key, set]) => [
        key,
        Array.from(set).sort(sortStr)
      ])
    )
  };
}

export type LocationFilter = {
  country?: string;
  region?: string; // slug
  city?: string;
};

export function clubMatchesLocation(club: Club, loc: LocationFilter): boolean {
  if (loc.country && clubCountry(club) !== loc.country) return false;
  if (loc.region && clubRegionSlug(club) !== loc.region) return false;
  if (loc.city && club.address.city !== loc.city) return false;
  return true;
}
