"use client";

import { useMemo } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup, Tooltip } from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";
import type { Club } from "../lib/types";
import { getHoursSetForClub } from "../lib/amenities";
import { getHoursStatus, getSpansForDate, type HoursStatus, type HoursStatusResult } from "../lib/hours";
import { normalizeTimeZone } from "../lib/time";

const DEFAULT_CENTER: [number, number] = [40.758, -73.985];

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

const STATUS_COLORS: Record<HoursStatus, string> = {
  open: "#d6b46b",
  closing_soon: "#ff9a62",
  opening_soon: "#5fd3c4",
  closed: "#6a6a6a"
};

type ClubMapProps = {
  clubs: Club[];
  referenceDate: Date;
  isLive?: boolean;
  amenity?: string;
  closingSoonMinutes?: number;
  openingSoonMinutes?: number;
};

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
  const openLabel = formatMinutes(open);
  const closeLabel = close === "24:00" ? "12:00 AM" : formatMinutes(close);
  return `${openLabel} - ${closeLabel}`;
}

function formatWeekday(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long"
  }).format(date);
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

export default function ClubMap({
  clubs,
  referenceDate,
  isLive = true,
  amenity,
  closingSoonMinutes = 90,
  openingSoonMinutes = 60
}: ClubMapProps) {
  const points = useMemo(
    () =>
      clubs
        .filter((club) => club.geo)
        .map((club) => ({
          club,
          position: [club.geo!.lat, club.geo!.lng] as [number, number]
        })),
    [clubs]
  );

  const bounds = useMemo<LatLngBoundsExpression | undefined>(() => {
    if (points.length < 2) {
      return undefined;
    }
    return points.map((point) => point.position) as LatLngBoundsExpression;
  }, [points]);

  const center = points.length ? points[0].position : DEFAULT_CENTER;

  return (
    <div className="mapContainer">
      <MapContainer
        center={center}
        zoom={12}
        scrollWheelZoom
        bounds={bounds}
        boundsOptions={{ padding: [30, 30] }}
        className="mapCanvas"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />
        {points.map((point) => {
          const timeZone = normalizeTimeZone(point.club.timezone);
          const hoursSet = getHoursSetForClub(point.club, amenity);
          const daySpans = getSpansForDate(hoursSet.spans, referenceDate, timeZone);
          const weekday = formatWeekday(referenceDate, timeZone);
          const spanLabels =
            daySpans.length === 1 && daySpans[0].open === "00:00" && daySpans[0].close === "24:00"
              ? ["Open 24 hours"]
              : daySpans.map((span) => formatSpan(span.open, span.close));

          const status = getHoursStatus(hoursSet.spans, referenceDate, timeZone, {
            closingSoonMinutes,
            openingSoonMinutes
          });
          const statusLabel = STATUS_LABELS[status.status];
          const statusClass = STATUS_CLASS[status.status];
          const statusDetail = formatStatusDetail(status, isLive);
          const markerColor = STATUS_COLORS[status.status] ?? STATUS_COLORS.closed;

          return (
            <CircleMarker
              key={point.club.id}
              center={point.position}
              radius={8}
              pathOptions={{
                color: markerColor,
                fillColor: markerColor,
                fillOpacity: 0.92,
                weight: 2
              }}
            >
              <Tooltip direction="top" offset={[0, -6]} opacity={1} className="mapTooltip">
                <div className="tooltipTitle">{point.club.name}</div>
                <div className={`tooltipStatus ${statusClass}`}>{statusLabel}</div>
              </Tooltip>
              <Popup className="mapPopup">
                <div className="popupHeader">
                  <div className="popupTitle">{point.club.name}</div>
                  <div className={`statusPill ${statusClass}`}>
                    <span className={`statusDot ${statusClass}`} />
                    {statusLabel}
                  </div>
                </div>
                <div className="small">{point.club.address.line1}</div>
                <div className="small">
                  {point.club.address.city}, {point.club.address.state} {point.club.address.postalCode}
                </div>
                <div className="statusDetail">{statusDetail}</div>
                <div className="small">Hours for {weekday}</div>
                <div className="hours">
                  {spanLabels.length ? (
                    spanLabels.map((label) => <span key={`${point.club.id}-${label}`}>{label}</span>)
                  ) : (
                    <span>Hours unavailable</span>
                  )}
                </div>
                <a className="link" href={point.club.source.url} target="_blank" rel="noreferrer">
                  View on Equinox
                </a>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}
