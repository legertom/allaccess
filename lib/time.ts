import { toZonedTime } from "date-fns-tz";

export const NYC_TIMEZONE = "America/New_York";

// Runtime safety net: data should already be IANA (the scraper maps it), but
// tolerate display names / abbreviations so status math never silently runs
// on an invalid tz (date-fns-tz treats unknown zones as UTC).
const TZ_ALIASES: Record<string, string> = {
  "eastern standard time": "America/New_York",
  "eastern daylight time": "America/New_York",
  "eastern time": "America/New_York",
  est: "America/New_York",
  edt: "America/New_York",
  "us/eastern": "America/New_York",
  "central standard time": "America/Chicago",
  "central daylight time": "America/Chicago",
  cst: "America/Chicago",
  cdt: "America/Chicago",
  "mountain standard time": "America/Denver",
  "mountain daylight time": "America/Denver",
  mst: "America/Denver",
  mdt: "America/Denver",
  "pacific standard time": "America/Los_Angeles",
  "pacific daylight time": "America/Los_Angeles",
  pst: "America/Los_Angeles",
  pdt: "America/Los_Angeles",
  "us/pacific": "America/Los_Angeles"
};

export function normalizeTimeZone(value?: string): string {
  if (!value) {
    return NYC_TIMEZONE;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return NYC_TIMEZONE;
  }

  if (trimmed.includes("/") && !TZ_ALIASES[trimmed.toLowerCase()]) {
    return trimmed; // already IANA
  }

  return TZ_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}

/**
 * Parse a `datetime-local` value ("yyyy-MM-ddTHH:mm") into a FLOATING wall
 * clock (day-of-week + minutes), with no timezone conversion. This replaces
 * parseNYCDateTime, which forced the input to US Eastern and was the source
 * of the cross-timezone "Open at" bug (plan §3). Weekday is computed from a
 * UTC date so it is DST- and local-tz-independent.
 */
export function parseWallClock(value: string): { day: number; minutes: number } | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) {
    return null;
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const dayOfMonth = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  if (month < 1 || month > 12 || dayOfMonth < 1 || dayOfMonth > 31) {
    return null;
  }
  if (hour > 23 || minute > 59) {
    return null;
  }
  const day = new Date(Date.UTC(year, month - 1, dayOfMonth)).getUTCDay();
  return { day, minutes: hour * 60 + minute };
}

export function getZonedParts(
  date: Date,
  timeZone: string
): { day: number; minutes: number } {
  const zoned = toZonedTime(date, timeZone);
  return {
    day: zoned.getDay(),
    minutes: zoned.getHours() * 60 + zoned.getMinutes()
  };
}
