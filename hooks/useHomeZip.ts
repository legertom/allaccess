"use client";

import { useCallback, useSyncExternalStore } from "react";
import { DEFAULT_HOME_ZIP } from "../lib/zip";

// Personal default (not shareable view-state, so localStorage not URL).
// Determines the map's opening location + relevance origin when the URL
// carries no explicit location/zip. Defaults to 10003.
const KEY = "equinox-sundial:home-zip";

const listeners = new Set<() => void>();
let snapshot: string | null = null;

function read(): string {
  try {
    return window.localStorage.getItem(KEY) || DEFAULT_HOME_ZIP;
  } catch {
    return DEFAULT_HOME_ZIP;
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      snapshot = read();
      cb();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): string {
  if (snapshot === null) snapshot = read();
  return snapshot;
}

function getServerSnapshot(): string {
  return DEFAULT_HOME_ZIP;
}

export function useHomeZip(): [string, (zip: string) => void] {
  const homeZip = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setHomeZip = useCallback((zip: string) => {
    const next = zip.trim() || DEFAULT_HOME_ZIP;
    snapshot = next;
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      /* ignore unavailable storage */
    }
    listeners.forEach((l) => l());
  }, []);
  return [homeZip, setHomeZip];
}
