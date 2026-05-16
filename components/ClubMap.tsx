"use client";

import { useEffect, useMemo, useReducer, useRef } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup, Tooltip, useMap } from "react-leaflet";
import Supercluster from "supercluster";
import type { Club } from "../lib/types";
import type { HoursStatus } from "../lib/hours";

export type MappedClub = {
  club: Club;
  status: HoursStatus;
  detail: string;
};

const STATUS_COLOR: Record<HoursStatus, string> = {
  open: "#34d399",
  closing_soon: "#fbbf24",
  opening_soon: "#38bdf8",
  closed: "#6b7280"
};

const DEFAULT_CENTER: [number, number] = [40.758, -73.985];

type Props = {
  clubs: MappedClub[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
};

type PointProps = { clubId: string; status: HoursStatus; idx: number };

function ClusterLayer({ clubs, selectedId, onSelect }: Props) {
  const map = useMap();
  const [version, bump] = useReducer((v: number) => v + 1, 0);

  // Recompute clusters on viewport change AND once the map is ready. Without
  // the initial bump + invalidateSize, markers don't paint until the user
  // pans (the container is sized after mount in a full-bleed layout).
  useEffect(() => {
    const onChange = () => bump();
    map.on("moveend zoomend resize", onChange);
    map.whenReady(() => {
      map.invalidateSize();
      onChange();
    });
    return () => {
      map.off("moveend zoomend resize", onChange);
    };
  }, [map]);

  const points = useMemo(
    () =>
      clubs
        .filter((m) => m.club.geo)
        .map<GeoJSON.Feature<GeoJSON.Point, PointProps>>((m, idx) => ({
          type: "Feature",
          properties: { clubId: m.club.id, status: m.status, idx },
          geometry: { type: "Point", coordinates: [m.club.geo!.lng, m.club.geo!.lat] }
        })),
    [clubs]
  );

  const index = useMemo(() => {
    const sc = new Supercluster<PointProps>({ radius: 64, maxZoom: 16 });
    sc.load(points);
    return sc;
  }, [points]);

  const clusters = useMemo(() => {
    const b = map.getBounds();
    const bbox: [number, number, number, number] = [
      b.getWest(),
      b.getSouth(),
      b.getEast(),
      b.getNorth()
    ];
    return index.getClusters(bbox, Math.round(map.getZoom()));
    // version forces recompute on pan/zoom
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, map, version]);

  const byId = useMemo(() => {
    const m = new Map<string, MappedClub>();
    clubs.forEach((c) => m.set(c.club.id, c));
    return m;
  }, [clubs]);

  return (
    <>
      {clusters.map((feature) => {
        const [lng, lat] = feature.geometry.coordinates;
        const props = feature.properties as Supercluster.ClusterProperties & PointProps;

        if (props.cluster) {
          const count = props.point_count;
          const size = 26 + Math.min(22, Math.log2(count + 1) * 6);
          return (
            <CircleMarker
              key={`c-${props.cluster_id}`}
              center={[lat, lng]}
              radius={size / 2}
              pathOptions={{
                color: "rgba(255,255,255,0.35)",
                fillColor: "#14171c",
                fillOpacity: 0.92,
                weight: 1
              }}
              eventHandlers={{
                click: () => {
                  const z = Math.min(index.getClusterExpansionZoom(props.cluster_id), 16);
                  map.flyTo([lat, lng], z, { duration: 0.4 });
                }
              }}
            >
              <Tooltip direction="top" offset={[0, -2]} opacity={1}>
                {count} clubs
              </Tooltip>
            </CircleMarker>
          );
        }

        const mapped = byId.get(props.clubId);
        if (!mapped) return null;
        const color = STATUS_COLOR[props.status];
        const selected = selectedId === props.clubId;
        return (
          <CircleMarker
            key={props.clubId}
            center={[lat, lng]}
            radius={selected ? 11 : 7}
            pathOptions={{
              color: selected ? "#ffffff" : color,
              fillColor: color,
              fillOpacity: 0.95,
              weight: selected ? 3 : 2
            }}
            eventHandlers={{ click: () => onSelect(props.clubId) }}
          >
            <Tooltip direction="top" offset={[0, -4]} opacity={1}>
              {mapped.club.name}
            </Tooltip>
            <Popup>
              <div className="popup">
                <div className="popupName">{mapped.club.name}</div>
                <div className="popupMeta">
                  {mapped.club.address.line1}, {mapped.club.address.city}
                </div>
                <div className="popupMeta" style={{ color }}>
                  {mapped.detail}
                </div>
                <a href={mapped.club.source.url} target="_blank" rel="noreferrer">
                  View on Equinox →
                </a>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </>
  );
}

function FlyToSelected({ clubs, selectedId }: { clubs: MappedClub[]; selectedId: string | null }) {
  const map = useMap();
  const prev = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedId || selectedId === prev.current) return;
    prev.current = selectedId;
    const target = clubs.find((m) => m.club.id === selectedId);
    if (target?.club.geo) {
      map.flyTo([target.club.geo.lat, target.club.geo.lng], Math.max(map.getZoom(), 13), {
        duration: 0.5
      });
    }
  }, [selectedId, clubs, map]);
  return null;
}

export default function ClubMap({ clubs, selectedId, onSelect }: Props) {
  const center = useMemo<[number, number]>(() => {
    const withGeo = clubs.find((m) => m.club.geo);
    return withGeo?.club.geo ? [withGeo.club.geo.lat, withGeo.club.geo.lng] : DEFAULT_CENTER;
  }, [clubs]);

  return (
    <MapContainer center={center} zoom={12} className="mapCanvas" scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      />
      <ClusterLayer clubs={clubs} selectedId={selectedId} onSelect={onSelect} />
      <FlyToSelected clubs={clubs} selectedId={selectedId} />
    </MapContainer>
  );
}
