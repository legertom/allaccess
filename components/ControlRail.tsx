"use client";

import type { ViewState } from "../hooks/useUrlState";
import type { RegionIndex } from "../lib/regions";
import { looksLikeZip } from "../lib/zip";

type Props = {
  state: ViewState;
  onChange: (patch: Partial<ViewState>) => void;
  regionIndex: RegionIndex;
  amenities: string[];
  onNearMe: () => void;
  geoStatus: string;
  homeZip: string;
  onHomeZip: (zip: string) => void;
};

export default function ControlRail({
  state,
  onChange,
  regionIndex,
  amenities,
  onNearMe,
  geoStatus,
  homeZip,
  onHomeZip
}: Props) {
  const regions = state.country ? regionIndex.regionsByCountry[state.country] ?? [] : [];
  const cities = state.region
    ? regionIndex.citiesByCountryRegion[`${state.country}::${state.region}`] ?? []
    : [];

  // One search box accepts free text OR a ZIP/postal code. A ZIP switches to
  // proximity ("clubs near 90069"); text filters by name/neighborhood.
  const searchValue = state.zip || state.q;
  const onSearch = (value: string) => {
    if (looksLikeZip(value)) {
      onChange({ zip: value.trim(), q: "" });
    } else {
      onChange({ q: value, zip: "" });
    }
  };

  return (
    <div className="rail" role="search">
      <span className="brand">Equinox Sundial</span>

      <select
        aria-label="Country"
        value={state.country}
        onChange={(e) => onChange({ country: e.target.value, region: "", city: "" })}
      >
        <option value="">All countries</option>
        {regionIndex.countries.map((c) => (
          <option key={c.code} value={c.code}>
            {c.label}
          </option>
        ))}
      </select>

      <select
        aria-label="Region"
        value={state.region}
        disabled={!state.country}
        onChange={(e) => onChange({ region: e.target.value, city: "" })}
      >
        <option value="">All regions</option>
        {regions.map((r) => (
          <option key={r.slug} value={r.slug}>
            {r.label}
          </option>
        ))}
      </select>

      <select
        aria-label="City"
        value={state.city}
        disabled={!state.region}
        onChange={(e) => onChange({ city: e.target.value })}
      >
        <option value="">All cities</option>
        {cities.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      <input
        type="search"
        aria-label="Search clubs or ZIP"
        placeholder="Search club, neighborhood, or ZIP"
        value={searchValue}
        onChange={(e) => onSearch(e.target.value)}
      />

      <label className="homeZip" title="Default location when nothing else is set">
        <span aria-hidden="true">⌂</span>
        <input
          aria-label="Home ZIP code"
          inputMode="numeric"
          placeholder="Home ZIP"
          defaultValue={homeZip}
          onBlur={(e) => onHomeZip(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onHomeZip((e.target as HTMLInputElement).value);
          }}
        />
      </label>

      <div className="seg" role="group" aria-label="Time mode">
        <button
          type="button"
          aria-pressed={state.mode === "now"}
          onClick={() => onChange({ mode: "now" })}
        >
          Now
        </button>
        <button
          type="button"
          aria-pressed={state.mode === "at"}
          onClick={() => onChange({ mode: "at" })}
        >
          At
        </button>
      </div>

      {state.mode === "at" && (
        <input
          type="datetime-local"
          aria-label="Open at (local club time)"
          value={state.at}
          onChange={(e) => onChange({ at: e.target.value })}
        />
      )}

      <div className="seg" role="group" aria-label="Sort">
        <button
          type="button"
          aria-pressed={state.sort === "default" || state.sort === "distance"}
          onClick={() => onChange({ sort: "default" })}
        >
          Nearest
        </button>
        <button
          type="button"
          aria-pressed={state.sort === "closing"}
          onClick={() => onChange({ sort: "closing" })}
        >
          Closing
        </button>
        <button
          type="button"
          aria-pressed={state.sort === "name"}
          onClick={() => onChange({ sort: "name" })}
        >
          A–Z
        </button>
      </div>

      <button
        type="button"
        className="chip"
        onClick={() => {
          onChange({ sort: "distance" });
          onNearMe();
        }}
      >
        {geoStatus === "denied" ? "Near me (blocked)" : "◎ Near me"}
      </button>

      <div className="chips" aria-label="Amenity filter">
        {amenities.map((a) => {
          const active = state.amenity === a;
          return (
            <button
              key={a}
              type="button"
              className="chip"
              aria-pressed={active}
              onClick={() => onChange({ amenity: active ? "" : a })}
            >
              {a}
            </button>
          );
        })}
      </div>
    </div>
  );
}
