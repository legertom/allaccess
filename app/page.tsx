"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { clubHasAmenity, getHoursForClub } from "../lib/amenities";
import {
  getHoursStatus,
  getHoursStatusForParts,
  getSpansForDate,
  getSpansForDay,
  type HoursStatus,
  type HoursStatusResult
} from "../lib/hours";
import { parseWallClock } from "../lib/time";
import { buildRegionIndex, clubMatchesLocation } from "../lib/regions";
import { haversineKm } from "../lib/geo";
import { resolveZip, clubsNear, DEFAULT_HOME } from "../lib/zip";
import type { Club, GeoPoint, HoursSpan } from "../lib/types";
import { useUrlState } from "../hooks/useUrlState";
import { useFavorites } from "../hooks/useFavorites";
import { useGeolocation } from "../hooks/useGeolocation";
import { useHomeZip } from "../hooks/useHomeZip";
import ControlRail from "../components/ControlRail";
import ResultsSheet, { type Row } from "../components/ResultsSheet";
import type { MappedClub } from "../components/ClubMap";

const ClubMap = dynamic(() => import("../components/ClubMap"), { ssr: false });

const CLOSING_SOON = 90;
const OPENING_SOON = 60;

// The water features the user cares about (substring catches naming variants
// like "Eucalyptus Steam Rooms", "Co-Ed Sauna", "Indoor 25-Meter ... Pool").
const WATER_FEATURES: { label: string; match: string }[] = [
  { label: "Pool", match: "pool" },
  { label: "Jacuzzi", match: "jacuzzi" },
  { label: "Steam Room", match: "steam" },
  { label: "Sauna", match: "sauna" }
];

function formatClock(value: string): string {
  const [hs, ms = "00"] = value.split(":");
  let h = Number(hs);
  if (h === 24) h = 0;
  const meridiem = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${ms.padStart(2, "0")} ${meridiem}`;
}

function formatDayHours(spans: HoursSpan[]): string {
  if (!spans.length) return "Closed";
  if (spans.length === 1 && spans[0].open === "00:00" && spans[0].close === "24:00") {
    return "Open 24 hours";
  }
  return spans
    .slice()
    .sort((a, b) => a.open.localeCompare(b.open))
    .map((s) => `${formatClock(s.open)} – ${formatClock(s.close)}`)
    .join(" · ");
}

function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r}m`;
  if (r === 0) return `${h}h`;
  return `${h}h ${r}m`;
}

function detailOf(s: HoursStatusResult): string {
  switch (s.status) {
    case "closing_soon":
      return s.minutesUntilClose !== undefined
        ? `Closes in ${formatDuration(s.minutesUntilClose)}`
        : "Closing soon";
    case "opening_soon":
      return s.minutesUntilOpen !== undefined
        ? `Opens in ${formatDuration(s.minutesUntilOpen)}`
        : "Opening soon";
    case "open":
      return "Open";
    default:
      return s.minutesUntilOpen !== undefined
        ? `Opens in ${formatDuration(s.minutesUntilOpen)}`
        : "Closed";
  }
}

export default function Home() {
  const [clubs, setClubs] = useState<Club[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const [state, update] = useUrlState();
  const { isFavorite, toggle } = useFavorites();
  const geo = useGeolocation();
  const [homeZip, setHomeZip] = useHomeZip();

  // Relevance origin precedence: live geolocation > searched ZIP >
  // persisted home ZIP > hard default (10003). Always defined, so the map
  // opens somewhere sensible and distances/sort are always meaningful.
  const origin = useMemo<GeoPoint>(() => {
    if (geo.coords) return geo.coords;
    const searched = state.zip ? resolveZip(state.zip, clubs) : null;
    if (searched) return searched;
    return resolveZip(homeZip, clubs) ?? DEFAULT_HOME;
  }, [geo.coords, state.zip, homeZip, clubs]);

  const hasExplicitLocation = !!(state.country || state.region || state.city);

  useEffect(() => {
    fetch("/api/clubs", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: Club[]) => setClubs(d))
      .catch(() => setClubs([]))
      .finally(() => setLoading(false));
  }, []);

  // Live countdown: re-derive status every 60s in "now" mode.
  useEffect(() => {
    if (state.mode !== "now") return;
    const id = window.setInterval(() => setTick((t) => t + 1), 60000);
    return () => window.clearInterval(id);
  }, [state.mode]);

  const regionIndex = useMemo(() => buildRegionIndex(clubs), [clubs]);

  // Curated, hours-backed amenity chips (plan §4): Pool/Spa/Kids Club have
  // their own scraped hours via lib/amenities, so selecting one filters AND
  // recolors markers by that amenity's open/closed state. (Not the ~95 raw
  // amenity strings — that was unusable.)
  const amenities = useMemo(() => {
    // Show a chip only if some in-data club actually has that water feature.
    return WATER_FEATURES.filter((c) =>
      clubs.some(
        (club) =>
          club.hours.amenities[c.match]?.spans.length ||
          club.amenities.some((a) => a.toLowerCase().includes(c.match))
      )
    ).map((c) => c.label);
  }, [clubs]);

  const wallClock = useMemo(
    () => (state.mode === "at" && state.at ? parseWallClock(state.at) : null),
    [state.mode, state.at]
  );

  const rows = useMemo<Row[]>(() => {
    // tick participates so the live countdown recomputes.
    void tick;
    const q = state.q.trim().toLowerCase();
    const now = new Date();

    // Default scope is "near the origin" so a NYC user never sees LA clubs
    // by default. An explicit country/region/city filter (or a national
    // "all" via the switcher) overrides proximity for deliberate browsing.
    const inScope = hasExplicitLocation
      ? clubs.filter((c) => clubMatchesLocation(c, state))
      : clubsNear(clubs, origin);

    const computed = inScope
      .filter((c) => clubHasAmenity(c, state.amenity || undefined))
      .filter((c) => {
        if (!q) return true;
        return (
          c.name.toLowerCase().includes(q) ||
          c.address.city.toLowerCase().includes(q) ||
          (c.regionLabel ?? "").toLowerCase().includes(q)
        );
      })
      .map<Row>((club) => {
        const spans = getHoursForClub(club, state.amenity || undefined);
        const status: HoursStatusResult = wallClock
          ? getHoursStatusForParts(spans, wallClock, {
              closingSoonMinutes: CLOSING_SOON,
              openingSoonMinutes: OPENING_SOON
            })
          : getHoursStatus(spans, now, club.timezone, {
              closingSoonMinutes: CLOSING_SOON,
              openingSoonMinutes: OPENING_SOON
            });
        const distanceKm = club.geo ? haversineKm(origin, club.geo) : undefined;
        const daySpans = wallClock
          ? getSpansForDay(spans, wallClock.day)
          : getSpansForDate(spans, now, club.timezone);
        const features = WATER_FEATURES.filter((w) =>
          club.amenities.some((a) => a.toLowerCase().includes(w.match))
        ).map((w) => w.label);
        return {
          club,
          status: status.status,
          detail: detailOf(status),
          distanceKm,
          hours: formatDayHours(daySpans),
          features
        };
      });

    const rank: Record<HoursStatus, number> = {
      open: 0,
      closing_soon: 1,
      opening_soon: 2,
      closed: 3
    };
    const byDistance = (a: Row, b: Row) =>
      (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity);
    computed.sort((a, b) => {
      if (state.sort === "closing") {
        if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
        return byDistance(a, b);
      }
      if (state.sort === "name") return a.club.name.localeCompare(b.club.name);
      // "default" and "distance": nearest to the origin first (relevance).
      return byDistance(a, b);
    });
    return computed;
  }, [clubs, state, wallClock, origin, hasExplicitLocation, tick]);

  const counts = useMemo(
    () =>
      rows.reduce(
        (acc, r) => {
          if (r.status === "open") acc.open += 1;
          else if (r.status === "closing_soon") acc.closing_soon += 1;
          else if (r.status === "opening_soon") acc.opening_soon += 1;
          return acc;
        },
        { open: 0, closing_soon: 0, opening_soon: 0 }
      ),
    [rows]
  );

  const mapped = useMemo<MappedClub[]>(
    () =>
      rows.map((r) => ({
        club: r.club,
        status: r.status,
        detail: r.detail,
        hours: r.hours,
        features: r.features
      })),
    [rows]
  );

  return (
    <main className="app">
      <ClubMap
        clubs={mapped}
        selectedId={selectedId}
        onSelect={setSelectedId}
        center={origin}
      />
      <ControlRail
        state={state}
        onChange={update}
        regionIndex={regionIndex}
        amenities={amenities}
        onNearMe={geo.request}
        geoStatus={geo.status}
        homeZip={homeZip}
        onHomeZip={setHomeZip}
      />
      <ResultsSheet
        rows={rows}
        counts={counts}
        selectedId={selectedId}
        onSelect={setSelectedId}
        isFavorite={isFavorite}
        toggleFavorite={toggle}
        loading={loading}
      />
    </main>
  );
}
