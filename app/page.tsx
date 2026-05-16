"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { clubHasAmenity, getHoursForClub } from "../lib/amenities";
import {
  getHoursStatus,
  getHoursStatusForParts,
  type HoursStatus,
  type HoursStatusResult
} from "../lib/hours";
import { parseWallClock } from "../lib/time";
import { buildRegionIndex, clubMatchesLocation } from "../lib/regions";
import { haversineKm } from "../lib/geo";
import type { Club } from "../lib/types";
import { useUrlState } from "../hooks/useUrlState";
import { useFavorites } from "../hooks/useFavorites";
import { useGeolocation } from "../hooks/useGeolocation";
import ControlRail from "../components/ControlRail";
import ResultsSheet, { type Row } from "../components/ResultsSheet";
import type { MappedClub } from "../components/ClubMap";

const ClubMap = dynamic(() => import("../components/ClubMap"), { ssr: false });

const CLOSING_SOON = 90;
const OPENING_SOON = 60;

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

  const amenities = useMemo(() => {
    const set = new Set<string>();
    clubs.forEach((c) => c.amenities.forEach((a) => a.trim() && set.add(a)));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
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

    const computed = clubs
      .filter((c) => clubMatchesLocation(c, state))
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
        const distanceKm =
          geo.coords && club.geo ? haversineKm(geo.coords, club.geo) : undefined;
        return { club, status: status.status, detail: detailOf(status), distanceKm };
      });

    const rank: Record<HoursStatus, number> = {
      open: 0,
      closing_soon: 1,
      opening_soon: 2,
      closed: 3
    };
    computed.sort((a, b) => {
      if (state.sort === "distance" && a.distanceKm !== undefined && b.distanceKm !== undefined) {
        return a.distanceKm - b.distanceKm;
      }
      if (state.sort === "closing") {
        if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
      }
      return a.club.name.localeCompare(b.club.name);
    });
    return computed;
  }, [clubs, state, wallClock, geo.coords, tick]);

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
    () => rows.map((r) => ({ club: r.club, status: r.status, detail: r.detail })),
    [rows]
  );

  return (
    <main className="app">
      <ClubMap clubs={mapped} selectedId={selectedId} onSelect={setSelectedId} />
      <ControlRail
        state={state}
        onChange={update}
        regionIndex={regionIndex}
        amenities={amenities}
        onNearMe={geo.request}
        geoStatus={geo.status}
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
