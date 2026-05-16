"use client";

import { useCallback, useState } from "react";
import type { GeoPoint } from "../lib/types";

type GeoStatus = "idle" | "prompting" | "granted" | "denied" | "unavailable";

export function useGeolocation(): {
  coords: GeoPoint | null;
  status: GeoStatus;
  request: () => void;
} {
  const [coords, setCoords] = useState<GeoPoint | null>(null);
  const [status, setStatus] = useState<GeoStatus>("idle");

  const request = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("unavailable");
      return;
    }
    setStatus("prompting");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setStatus("granted");
      },
      () => setStatus("denied"),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  }, []);

  return { coords, status, request };
}
