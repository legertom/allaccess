"use client";

import { useCallback, useSyncExternalStore } from "react";

const KEY = "equinox-sundial:favorites";
const EMPTY: ReadonlySet<string> = new Set();

const listeners = new Set<() => void>();
let snapshot: ReadonlySet<string> | null = null;

function read(): ReadonlySet<string> {
  try {
    const raw = window.localStorage.getItem(KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
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

function getSnapshot(): ReadonlySet<string> {
  if (snapshot === null) {
    snapshot = read();
  }
  return snapshot;
}

function getServerSnapshot(): ReadonlySet<string> {
  return EMPTY;
}

function toggleFavorite(id: string) {
  const next = new Set(getSnapshot());
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  snapshot = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify([...next]));
  } catch {
    /* ignore unavailable storage */
  }
  listeners.forEach((l) => l());
}

export function useFavorites(): {
  isFavorite: (id: string) => boolean;
  toggle: (id: string) => void;
} {
  const favorites = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const isFavorite = useCallback((id: string) => favorites.has(id), [favorites]);
  return { isFavorite, toggle: toggleFavorite };
}
