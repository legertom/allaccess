import { parseHoursLines } from "../../lib/hours";
import type { HoursSet } from "../../lib/types";
import { slugifyAmenity } from "./util";

export function buildHoursSet(lines: string[]): HoursSet {
  return {
    spans: parseHoursLines(lines),
    raw: lines
  };
}

export type ServiceHoursEntry = {
  days?: string;
  hours?: string;
};

export type ServiceHoursMap = Record<
  string,
  { startTime?: string; endTime?: string }[]
>;

export function parseServiceHoursList(entries?: ServiceHoursEntry[]): HoursSet {
  if (!entries || !entries.length) {
    return buildHoursSet([]);
  }
  const lines = entries
    .map((entry) => {
      const days = entry?.days?.trim();
      const hours = entry?.hours?.trim();
      if (!days || !hours) {
        return null;
      }
      return `${days} ${hours}`;
    })
    .filter((line): line is string => Boolean(line));
  return buildHoursSet(lines);
}

function normalizeServiceTime(value?: string): string | null {
  if (!value) {
    return null;
  }
  const parts = value.split(":");
  if (parts.length < 2) {
    return null;
  }
  return `${parts[0].padStart(2, "0")}:${parts[1].padStart(2, "0")}`;
}

export function parseServiceHoursMap(map?: ServiceHoursMap): HoursSet {
  if (!map) {
    return buildHoursSet([]);
  }
  const lines: string[] = [];
  for (const [day, ranges] of Object.entries(map)) {
    if (!ranges || !ranges.length) {
      continue;
    }
    for (const range of ranges) {
      const start = normalizeServiceTime(range.startTime);
      const end = normalizeServiceTime(range.endTime);
      if (!start || !end) {
        continue;
      }
      lines.push(`${day} ${start} - ${end}`);
    }
  }
  return buildHoursSet(lines);
}

/** Section-heading fallback: turn "Pool Hours"/"Spa Hours" sections into amenity hours. */
export function extractAmenityHoursFromSections(
  hoursSections: Record<string, string[]>,
  clubLines: string[]
): Record<string, HoursSet> {
  const amenityHours: Record<string, HoursSet> = {};
  for (const [key, lines] of Object.entries(hoursSections)) {
    if (lines === clubLines) {
      continue;
    }
    if (!key.includes("hour")) {
      continue;
    }
    const label = key.replace(/-?hours?$/, "");
    if (!label || label === "club") {
      continue;
    }
    amenityHours[slugifyAmenity(label)] = buildHoursSet(lines);
  }
  return amenityHours;
}
