"use client";

import { useCallback, useSyncExternalStore } from "react";

// The URL query string is the single source of truth for view state
// (country, region, city, mode, at, amenity, q, sort). No mirrored component
// state — a shared link reproduces the exact view (plan §5/§9). Implemented
// with useSyncExternalStore: the URL is an external store, which avoids both
// setState-in-effect and SSR/hydration mismatch.
export type ViewState = {
  country: string;
  region: string;
  city: string;
  mode: "now" | "at";
  at: string;
  amenity: string;
  q: string;
  zip: string; // active proximity ZIP (shareable: "clubs near 90069")
  sort: "default" | "distance" | "closing" | "name";
};

const DEFAULTS: ViewState = {
  country: "",
  region: "",
  city: "",
  mode: "now",
  at: "",
  amenity: "",
  q: "",
  zip: "",
  sort: "default"
};

function parse(search: string): ViewState {
  const p = new URLSearchParams(search);
  const mode = p.get("mode") === "at" ? "at" : "now";
  const sortParam = p.get("sort");
  const sort: ViewState["sort"] =
    sortParam === "distance" || sortParam === "closing" || sortParam === "name"
      ? sortParam
      : "default";
  return {
    country: p.get("country") ?? "",
    region: p.get("region") ?? "",
    city: p.get("city") ?? "",
    mode,
    at: p.get("at") ?? "",
    amenity: p.get("amenity") ?? "",
    q: p.get("q") ?? "",
    zip: p.get("zip") ?? "",
    sort
  };
}

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  window.addEventListener("popstate", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("popstate", cb);
  };
}

// Cache by search string so getSnapshot returns a stable reference when
// the URL is unchanged (required by useSyncExternalStore).
let cachedSearch: string | null = null;
let cachedState: ViewState = DEFAULTS;

function getSnapshot(): ViewState {
  const search = window.location.search;
  if (search !== cachedSearch) {
    cachedSearch = search;
    cachedState = parse(search);
  }
  return cachedState;
}

function getServerSnapshot(): ViewState {
  return DEFAULTS;
}

function writeUrl(state: ViewState) {
  const p = new URLSearchParams();
  (Object.keys(state) as (keyof ViewState)[]).forEach((k) => {
    const v = state[k];
    if (v && v !== DEFAULTS[k]) {
      p.set(k, v);
    }
  });
  const qs = p.toString();
  window.history.replaceState(
    null,
    "",
    qs ? `${window.location.pathname}?${qs}` : window.location.pathname
  );
  listeners.forEach((l) => l());
}

export function useUrlState(): [ViewState, (patch: Partial<ViewState>) => void] {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const update = useCallback(
    (patch: Partial<ViewState>) => {
      writeUrl({ ...getSnapshot(), ...patch });
    },
    []
  );

  return [state, update];
}
