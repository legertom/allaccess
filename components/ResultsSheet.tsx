"use client";

import { useState } from "react";
import type { Club } from "../lib/types";
import type { HoursStatus } from "../lib/hours";
import { formatDistance } from "../lib/geo";

export type Row = {
  club: Club;
  status: HoursStatus;
  detail: string;
  distanceKm?: number;
  hours: string;
  features: string[];
};

const STATUS_LABEL: Record<HoursStatus, string> = {
  open: "Open",
  closing_soon: "Closing",
  opening_soon: "Opening",
  closed: "Closed"
};

type Props = {
  rows: Row[];
  counts: { open: number; closing_soon: number; opening_soon: number };
  selectedId: string | null;
  onSelect: (id: string) => void;
  isFavorite: (id: string) => boolean;
  toggleFavorite: (id: string) => void;
  loading: boolean;
};

export default function ResultsSheet({
  rows,
  counts,
  selectedId,
  onSelect,
  isFavorite,
  toggleFavorite,
  loading
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const favRows = rows.filter((r) => isFavorite(r.club.id));

  return (
    <section className={`sheet${collapsed ? " collapsed" : ""}`} aria-label="Results">
      <div className="sheetHead">
        <div className="counts">
          <span>
            <b>{loading ? "…" : rows.length}</b> shown
          </span>
          <span className="s-open">
            <b>{counts.open}</b> open
          </span>
          <span className="s-closing_soon">
            <b>{counts.closing_soon}</b> closing
          </span>
          <span className="s-opening_soon">
            <b>{counts.opening_soon}</b> opening
          </span>
        </div>
        <button
          type="button"
          className="sheetToggle"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed ? "Show list" : "Hide list"}
        </button>
      </div>

      {favRows.length > 0 && (
        <div className="favStrip" aria-label="Favorites">
          {favRows.map((r) => (
            <button
              key={`fav-${r.club.id}`}
              type="button"
              className="favPill"
              onClick={() => onSelect(r.club.id)}
            >
              <span className={`dot s-${r.status}`} />
              {r.club.name}
            </button>
          ))}
        </div>
      )}

      <div className="list">
        {loading && <div className="empty">Loading clubs…</div>}
        {!loading && rows.length === 0 && (
          <div className="empty">No clubs match this view.</div>
        )}
        {!loading &&
          rows.map((r) => (
            <div
              key={r.club.id}
              className={`row${selectedId === r.club.id ? " active" : ""}`}
            >
              <span className={`dot s-${r.status}`} />
              <button
                type="button"
                style={{ all: "unset", cursor: "pointer" }}
                onClick={() => onSelect(r.club.id)}
                aria-label={`Show ${r.club.name} on map`}
              >
                <div className="rowName">{r.club.name}</div>
                <div className="rowMeta">
                  {r.club.address.city}
                  {r.club.address.state ? `, ${r.club.address.state}` : ""}
                  {r.distanceKm !== undefined ? ` · ${formatDistance(r.distanceKm)}` : ""}
                </div>
              </button>
              <div className="rowRight">
                <span className={`rowStatus s-${r.status}`}>
                  {STATUS_LABEL[r.status]}
                </span>
                <span style={{ color: "var(--muted)" }}>{r.detail}</span>
                <button
                  type="button"
                  className={`star${isFavorite(r.club.id) ? " on" : ""}`}
                  aria-label={isFavorite(r.club.id) ? "Unfavorite" : "Favorite"}
                  aria-pressed={isFavorite(r.club.id)}
                  onClick={() => toggleFavorite(r.club.id)}
                >
                  {isFavorite(r.club.id) ? "★" : "☆"}
                </button>
              </div>
            </div>
          ))}
      </div>
    </section>
  );
}
