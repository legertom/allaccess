import { parse } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

export const NYC_TIMEZONE = "America/New_York";

export function normalizeTimeZone(value?: string): string {
  if (!value) {
    return NYC_TIMEZONE;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return NYC_TIMEZONE;
  }

  const aliases = new Set([
    "Eastern Standard Time",
    "Eastern Daylight Time",
    "EST",
    "EDT",
    "US/Eastern"
  ]);

  if (aliases.has(trimmed)) {
    return NYC_TIMEZONE;
  }

  return trimmed;
}

export function parseNYCDateTime(value: string): Date | null {
  if (!value) {
    return null;
  }

  const parsed = parse(value, "yyyy-MM-dd'T'HH:mm", new Date());
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return fromZonedTime(parsed, NYC_TIMEZONE);
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

export function getNYCParts(date: Date): { day: number; minutes: number } {
  return getZonedParts(date, NYC_TIMEZONE);
}
