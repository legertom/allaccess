"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { clubHasAmenity, getHoursForClub, getHoursSetForClub } from "../lib/amenities";
import { getHoursStatus, type HoursStatus, type HoursStatusResult } from "../lib/hours";
import { NYC_TIMEZONE, parseNYCDateTime } from "../lib/time";
import type { Club, HoursSpan } from "../lib/types";

const ClubMap = dynamic(() => import("../components/ClubMap"), { ssr: false });

const CLOSING_SOON_MINUTES = 90;
const OPENING_SOON_MINUTES = 60;

const STATUS_LABELS: Record<HoursStatus, string> = {
  open: "Open",
  closing_soon: "Closing soon",
  opening_soon: "Opening soon",
  closed: "Closed"
};

const STATUS_CLASS: Record<HoursStatus, string> = {
  open: "status-open",
  closing_soon: "status-closing",
  opening_soon: "status-opening",
  closed: "status-closed"
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const AMENITY_PREVIEW_COUNT = 8;

function formatNYCTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: NYC_TIMEZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function formatHoursLabel(amenity: string) {
  return amenity ? `${amenity} hours` : "Club hours";
}

function formatDuration(minutes: number): string {
  const rounded = Math.max(0, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const remaining = rounded % 60;
  if (hours === 0) {
    return `${remaining}m`;
  }
  if (remaining === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${remaining}m`;
}

function toMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) {
    return 0;
  }
  return h * 60 + m;
}

function formatMinutes(value: string): string {
  const [h, m] = value.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) {
    return value;
  }
  const hour = h % 24;
  const meridiem = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:${m.toString().padStart(2, "0")} ${meridiem}`;
}

function formatSpan(open: string, close: string): string {
  if (open === "00:00" && close === "24:00") {
    return "Open 24 hours";
  }
  const openLabel = formatMinutes(open);
  const closeLabel = close === "24:00" ? "12:00 AM" : formatMinutes(close);
  return `${openLabel} - ${closeLabel}`;
}

function buildHoursRows(spans: HoursSpan[]) {
  if (!spans.length) {
    return [];
  }
  const grouped: HoursSpan[][] = Array.from({ length: 7 }, () => []);
  for (const span of spans) {
    if (span.day >= 0 && span.day <= 6) {
      grouped[span.day].push(span);
    }
  }

  return DAY_ORDER.map((day) => {
    const daySpans = grouped[day].slice().sort((a, b) => toMinutes(a.open) - toMinutes(b.open));
    const hasAllDay = daySpans.some((span) => span.open === "00:00" && span.close === "24:00");
    const ranges = hasAllDay
      ? ["Open 24 hours"]
      : daySpans.length
        ? daySpans.map((span) => formatSpan(span.open, span.close))
        : ["Closed"];
    return { day, label: DAY_LABELS[day], ranges };
  });
}

function formatStatusDetail(status: HoursStatusResult, isLive: boolean): string {
  switch (status.status) {
    case "closing_soon":
      return status.minutesUntilClose !== undefined
        ? `Closes in ${formatDuration(status.minutesUntilClose)}`
        : "Closing soon";
    case "opening_soon":
      return status.minutesUntilOpen !== undefined
        ? `Opens in ${formatDuration(status.minutesUntilOpen)}`
        : "Opening soon";
    case "open":
      return isLive ? "Open now" : "Open at that time";
    default:
      return "Closed";
  }
}

type ClubRow = {
  club: Club;
  status: HoursStatusResult;
};

export default function Home() {
  const [clubData, setClubData] = useState<Club[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<"now" | "at">("now");
  const [dateTimeValue, setDateTimeValue] = useState("");
  const [amenity, setAmenity] = useState("");
  const [view, setView] = useState<"list" | "map">("map");

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const response = await fetch("/api/clubs", { cache: "no-store" });
        const data = (await response.json()) as Club[];
        setClubData(data);
      } catch (error) {
        setLoadError("Unable to load club data.");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const amenityOptions = useMemo(() => {
    const set = new Set<string>();
    for (const club of clubData) {
      for (const option of club.amenities) {
        set.add(option);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [clubData]);

  const isLiveMode = mode === "now";

  const queryDate = useMemo(() => {
    if (mode === "now") {
      return new Date();
    }
    return parseNYCDateTime(dateTimeValue) ?? new Date();
  }, [mode, dateTimeValue]);

  const clubRows = useMemo<ClubRow[]>(() => {
    return clubData
      .filter((club) => clubHasAmenity(club, amenity))
      .map((club) => {
        const spans = getHoursForClub(club, amenity || undefined);
        const status = getHoursStatus(spans, queryDate, club.timezone, {
          closingSoonMinutes: CLOSING_SOON_MINUTES,
          openingSoonMinutes: OPENING_SOON_MINUTES
        });
        return { club, status };
      })
      .filter(({ status }) => status.status !== "closed");
  }, [amenity, clubData, queryDate]);

  const mappable = useMemo(() => clubRows.filter((row) => row.club.geo), [clubRows]);
  const missingGeoCount = clubRows.length - mappable.length;

  const statusCounts = useMemo(() => {
    return clubRows.reduce(
      (counts, row) => {
        if (row.status.status === "open") {
          counts.open += 1;
        } else if (row.status.status === "closing_soon") {
          counts.closing_soon += 1;
        } else if (row.status.status === "opening_soon") {
          counts.opening_soon += 1;
        }
        return counts;
      },
      { open: 0, closing_soon: 0, opening_soon: 0 }
    );
  }, [clubRows]);

  const lastUpdated = useMemo(() => {
    if (!clubData.length) {
      return null;
    }
    const timestamps = clubData
      .map((club) => Date.parse(club.source.lastFetchedAt))
      .filter((value) => !Number.isNaN(value));
    if (!timestamps.length) {
      return null;
    }
    return new Date(Math.max(...timestamps));
  }, [clubData]);

  return (
    <main className="page">
      <section className="hero">
        <div className="heroCopy">
          <div className="eyebrow">Equinox NYC</div>
          <h1>Find the club that fits your hour.</h1>
          <p>
            Map-first, amenity-aware, and synced to NYC time. Track clubs that are
            open now, closing soon, or about to open.
          </p>
          <div className="heroStats">
            <div className="stat">
              <div className="statValue">{loading ? "..." : clubRows.length}</div>
              <div className="statLabel">Open or opening soon</div>
            </div>
            <div className="stat">
              <div className="statValue">{loading ? "..." : statusCounts.closing_soon}</div>
              <div className="statLabel">Closing within {CLOSING_SOON_MINUTES}m</div>
            </div>
            <div className="stat">
              <div className="statValue">{loading ? "..." : statusCounts.opening_soon}</div>
              <div className="statLabel">Opening within {OPENING_SOON_MINUTES}m</div>
            </div>
          </div>
        </div>

        <section className="card controlsCard">
          <div className="controlGroup">
            <label>Mode</label>
            <div className="segmented" role="group" aria-label="Mode">
              <button
                type="button"
                className={mode === "now" ? "active" : ""}
                onClick={() => setMode("now")}
              >
                Open now
              </button>
              <button
                type="button"
                className={mode === "at" ? "active" : ""}
                onClick={() => setMode("at")}
              >
                Open at
              </button>
            </div>
          </div>

          {mode === "at" && (
            <div className="controlGroup">
              <label>Date + time (NYC)</label>
              <input
                type="datetime-local"
                value={dateTimeValue}
                onChange={(event) => setDateTimeValue(event.target.value)}
              />
            </div>
          )}

          <div className="controlGroup">
            <label>Amenity filter</label>
            <select value={amenity} onChange={(event) => setAmenity(event.target.value)}>
              <option value="">Any amenity</option>
              {amenityOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>

          <div className="controlGroup">
            <label>View</label>
            <div className="segmented" role="group" aria-label="View">
              <button
                type="button"
                className={view === "map" ? "active" : ""}
                onClick={() => setView("map")}
              >
                Map
              </button>
              <button
                type="button"
                className={view === "list" ? "active" : ""}
                onClick={() => setView("list")}
              >
                List
              </button>
            </div>
          </div>

          <div className="controlNote">Times shown in NYC (ET). Opening soon = within 1 hour.</div>
        </section>
      </section>

      <section className="card statusCard">
        <div className="statusText">
          <div className="statusHeadline">
            {loading ? "Loading clubs..." : `${clubRows.length} clubs open or opening soon`}
          </div>
          <div className="statusSub">At {formatNYCTime(queryDate)} (NYC time)</div>
          {lastUpdated && (
            <div className="small">Last updated {formatNYCTime(lastUpdated)} (NYC time)</div>
          )}
          {loadError && <div className="small error">{loadError}</div>}
        </div>
        <div className="legend">
          <span className="legendItem">
            <span className="legendDot status-open" />Open
          </span>
          <span className="legendItem">
            <span className="legendDot status-closing" />Closing soon
          </span>
          <span className="legendItem">
            <span className="legendDot status-opening" />Opening soon
          </span>
        </div>
      </section>

      {view === "map" ? (
        <section className="card mapShell">
          <div className="mapHeader">
            <div>
              <div className="mapTitle">Map view</div>
              <div className="mapSub">
                {loading ? "Loading clubs..." : `${mappable.length} clubs mapped`}
              </div>
            </div>
          </div>
          <div className="mapFrame">
            {loading ? (
              <div className="mapMeta">Loading clubs...</div>
            ) : mappable.length ? (
                <ClubMap
                  clubs={mappable.map((row) => row.club)}
                  referenceDate={queryDate}
                  isLive={isLiveMode}
                  amenity={amenity || undefined}
                  closingSoonMinutes={CLOSING_SOON_MINUTES}
                  openingSoonMinutes={OPENING_SOON_MINUTES}
                />
            ) : (
              <div className="mapMeta">
                No clubs with coordinates are available for the current filter.
              </div>
            )}
          </div>
          {!!missingGeoCount && (
            <div className="mapMeta">
              {missingGeoCount} club{missingGeoCount === 1 ? "" : "s"} hidden (missing coordinates).
            </div>
          )}
        </section>
      ) : (
        <section className="list">
          {loading && <article className="card">Loading clubs...</article>}
          {!loading &&
            clubRows.map(({ club, status }) => {
              const hoursSet = getHoursSetForClub(club, amenity || undefined);
              const hoursRows = buildHoursRows(hoursSet.spans);
              const amenities = club.amenities.filter((item) => item.trim());
              const amenityPreview = amenities.slice(0, AMENITY_PREVIEW_COUNT);
              const amenityOverflow = amenities.length - amenityPreview.length;
              const statusClass = STATUS_CLASS[status.status];
              return (
                <article key={club.id} className="card club">
                  <div className="clubHeader">
                    <div>
                      <div className="clubName">{club.name}</div>
                      <div className="small">
                        {club.address.line1}, {club.address.city}, {club.address.state}{" "}
                        {club.address.postalCode}
                      </div>
                    </div>
                    <div className={`statusPill ${statusClass}`}>
                      <span className={`statusDot ${statusClass}`} />
                      {STATUS_LABELS[status.status]}
                    </div>
                  </div>
                  <div className="statusDetail">{formatStatusDetail(status, isLiveMode)}</div>
                  <div className="small">{formatHoursLabel(amenity)}</div>
                  <div className="hoursList">
                    {hoursRows.length ? (
                      hoursRows.map((row) => {
                        const isClosed = row.ranges.length === 1 && row.ranges[0] === "Closed";
                        return (
                          <div
                            key={`${club.id}-hours-${row.day}`}
                            className={`hoursRow${isClosed ? " hoursClosed" : ""}`}
                          >
                            <div className="hoursDay">{row.label}</div>
                            <div className="hoursTimes">{row.ranges.join(" / ")}</div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="small">Hours unavailable</div>
                    )}
                  </div>
                  <div className="amenities">
                    <div className="small">Amenities</div>
                    {amenities.length ? (
                      <div className="amenityPills" title={amenities.join(", ")}>
                        {amenityPreview.map((item) => (
                          <span key={`${club.id}-${item}`} className="amenityPill">
                            {item}
                          </span>
                        ))}
                        {amenityOverflow > 0 && (
                          <span className="amenityPill amenityMore">+{amenityOverflow} more</span>
                        )}
                      </div>
                    ) : (
                      <div className="small">None listed</div>
                    )}
                  </div>
                  <a className="link" href={club.source.url} target="_blank" rel="noreferrer">
                    Club page
                  </a>
                </article>
              );
            })}
          {!loading && !clubRows.length && (
            <article className="card">No clubs are open or opening soon for the current filter.</article>
          )}
        </section>
      )}
    </main>
  );
}
