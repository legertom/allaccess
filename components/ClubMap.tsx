"use client";

import { useEffect, useMemo, useReducer, useRef } from "react";
import { MapContainer, TileLayer, CircleMarker, Marker, Popup, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
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
  center?: { lat: number; lng: number };
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
    // Only cluster when zoomed out (maxZoom 11): at metro zoom the user sees
    // individual clubs. minPoints 4 keeps pairs/triples as separate pins.
    // map/reduce aggregates how many clubs in a cluster are open.
    const sc = new Supercluster<PointProps, { open: number }>({
      radius: 56,
      maxZoom: 11,
      minPoints: 4,
      map: (p) => ({ open: p.status === "open" ? 1 : 0 }),
      reduce: (acc, p) => {
        acc.open += p.open;
      }
    });
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
          const openCount = (feature.properties as { open?: number }).open ?? 0;
          const size = Math.round(32 + Math.min(26, Math.log2(count + 1) * 7));
          const ring = openCount > 0 ? "#34d399" : "rgba(255,255,255,0.28)";
          const icon = L.divIcon({
            className: "clusterWrap",
            iconSize: [size, size],
            html: `<div class="clusterIcon" style="width:${size}px;height:${size}px;border-color:${ring};${
              openCount > 0 ? "box-shadow:0 0 0 4px rgba(52,211,153,0.18);" : ""
            }">${count}</div>`
          });
          return (
            <Marker
              key={`c-${props.cluster_id}`}
              position={[lat, lng]}
              icon={icon}
              eventHandlers={{
                click: () => {
                  const z = Math.min(index.getClusterExpansionZoom(props.cluster_id), 14);
                  map.flyTo([lat, lng], z, { duration: 0.4 });
                }
              }}
            >
              <Tooltip direction="top" offset={[0, -size / 2]} opacity={1}>
                {count} clubs{openCount > 0 ? ` · ${openCount} open` : ""}
              </Tooltip>
            </Marker>
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

function RecenterOnOrigin({ center }: { center?: { lat: number; lng: number } }) {
  const map = useMap();
  const prev = useRef<string | null>(null);
  useEffect(() => {
    if (!center) return;
    const key = `${center.lat.toFixed(4)},${center.lng.toFixed(4)}`;
    if (prev.current === key) return;
    const first = prev.current === null;
    prev.current = key;
    if (first) return; // MapContainer already opens here
    map.flyTo([center.lat, center.lng], Math.max(map.getZoom(), 12), { duration: 0.5 });
  }, [center, map]);
  return null;
}

export default function ClubMap({ clubs, selectedId, onSelect, center }: Props) {
  const initialCenter = useMemo<[number, number]>(() => {
    if (center) return [center.lat, center.lng];
    const withGeo = clubs.find((m) => m.club.geo);
    return withGeo?.club.geo ? [withGeo.club.geo.lat, withGeo.club.geo.lng] : DEFAULT_CENTER;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // initial only — RecenterOnOrigin handles subsequent origin changes

  return (
    <MapContainer center={initialCenter} zoom={12} className="mapCanvas" scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      />
      <ClusterLayer clubs={clubs} selectedId={selectedId} onSelect={onSelect} />
      <FlyToSelected clubs={clubs} selectedId={selectedId} />
      <RecenterOnOrigin center={center} />
    </MapContainer>
  );
}
