import { getZonedParts, NYC_TIMEZONE, normalizeTimeZone } from "./time";
import type { HoursSpan } from "./types";

const DAY_REGEX = /(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)/gi;

const DAY_MAP: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  weds: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6
};

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

function normalizeDash(text: string): string {
  return text.replace(/[–—]/g, "-");
}

function toMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) {
    return 0;
  }
  return h * 60 + m;
}

export function parseTimeTo24h(value: string): string | null {
  const cleaned = value
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/\./g, "");

  const match = cleaned.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/i);
  if (!match) {
    return null;
  }

  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3];

  if (minute < 0 || minute > 59) {
    return null;
  }

  if (meridiem) {
    if (hour < 1 || hour > 12) {
      return null;
    }
    if (meridiem === "am") {
      hour = hour === 12 ? 0 : hour;
    } else {
      hour = hour === 12 ? 12 : hour + 12;
    }
  } else if (hour < 0 || hour > 24) {
    return null;
  }

  if (hour === 24 && minute !== 0) {
    return null;
  }

  return `${pad(hour)}:${pad(minute)}`;
}

function expandDayRange(start: number, end: number): number[] {
  const days: number[] = [];
  let current = start;
  for (let i = 0; i < 7; i += 1) {
    days.push(current);
    if (current === end) {
      break;
    }
    current = (current + 1) % 7;
  }
  return days;
}

function parseDaysPart(text: string): number[] {
  const normalized = normalizeDash(text.toLowerCase()).trim();
  if (!normalized) {
    return [];
  }

  if (normalized.includes("daily") || normalized.includes("every day") || normalized.includes("everyday")) {
    return [0, 1, 2, 3, 4, 5, 6];
  }

  const rangeMatch = normalized.match(
    /(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)\s*(?:-|to)\s*(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)/
  );

  if (rangeMatch) {
    const start = DAY_MAP[rangeMatch[1]];
    const end = DAY_MAP[rangeMatch[2]];
    if (start !== undefined && end !== undefined) {
      return expandDayRange(start, end);
    }
  }

  const matches = normalized.match(DAY_REGEX) || [];
  const days = matches
    .map((token) => DAY_MAP[token])
    .filter((day) => day !== undefined);

  return Array.from(new Set(days));
}

function parseTimeRange(text: string): { open: string; close: string } | null {
  const normalized = normalizeDash(text);
  if (/24\s*hours?/i.test(normalized) || /open\s*24/i.test(normalized)) {
    return { open: "00:00", close: "24:00" };
  }

  const match = normalized.match(
    /(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*[-]\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i
  );

  if (!match) {
    return null;
  }

  const open = parseTimeTo24h(match[1]);
  const close = parseTimeTo24h(match[2]);
  if (!open || !close) {
    return null;
  }

  return { open, close };
}

function normalizeSpan(span: HoursSpan): HoursSpan[] {
  const openMinutes = toMinutes(span.open);
  const closeMinutes = toMinutes(span.close);

  if (openMinutes === closeMinutes) {
    return [];
  }

  if (openMinutes < closeMinutes) {
    return [span];
  }

  return [
    { day: span.day, open: span.open, close: "24:00" },
    { day: (span.day + 1) % 7, open: "00:00", close: span.close }
  ];
}

export function parseHoursLines(lines: string[]): HoursSpan[] {
  const spans: HoursSpan[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    if (/closed/i.test(line)) {
      continue;
    }

    const timeRange = parseTimeRange(line);
    if (!timeRange) {
      continue;
    }

    const timeIndex = normalizeDash(line).search(/\d/);
    const daysPart = timeIndex > 0 ? line.slice(0, timeIndex) : line;
    const days = parseDaysPart(daysPart);

    if (days.length === 0) {
      continue;
    }

    for (const day of days) {
      spans.push({ day, open: timeRange.open, close: timeRange.close });
    }
  }

  return spans.flatMap((span) => normalizeSpan(span));
}

export function isOpenAt(
  spans: HoursSpan[],
  date: Date,
  timeZone: string = NYC_TIMEZONE
): boolean {
  if (!spans.length) {
    return false;
  }

  const { day, minutes } = getZonedParts(date, normalizeTimeZone(timeZone));
  return spans.some((span) => {
    if (span.day !== day) {
      return false;
    }
    return minutes >= toMinutes(span.open) && minutes < toMinutes(span.close);
  });
}

export function getSpansForDate(
  spans: HoursSpan[],
  date: Date,
  timeZone: string = NYC_TIMEZONE
): HoursSpan[] {
  if (!spans.length) {
    return [];
  }
  const { day } = getZonedParts(date, normalizeTimeZone(timeZone));
  return spans
    .filter((span) => span.day === day)
    .sort((a, b) => toMinutes(a.open) - toMinutes(b.open));
}

export type HoursStatus = "open" | "closing_soon" | "opening_soon" | "closed";

export type HoursStatusResult = {
  status: HoursStatus;
  minutesUntilClose?: number;
  minutesUntilOpen?: number;
};

type HoursStatusOptions = {
  closingSoonMinutes?: number;
  openingSoonMinutes?: number;
};

export function getHoursStatus(
  spans: HoursSpan[],
  date: Date,
  timeZone: string = NYC_TIMEZONE,
  options: HoursStatusOptions = {}
): HoursStatusResult {
  if (!spans.length) {
    return { status: "closed" };
  }

  const closingSoonMinutes = options.closingSoonMinutes ?? 90;
  const openingSoonMinutes = options.openingSoonMinutes ?? 60;
  const { day, minutes } = getZonedParts(date, normalizeTimeZone(timeZone));
  const daySpans = spans.filter((span) => span.day === day);

  let openSpan: HoursSpan | undefined;
  for (const span of daySpans) {
    const openMinutes = toMinutes(span.open);
    const closeMinutes = toMinutes(span.close);
    if (minutes >= openMinutes && minutes < closeMinutes) {
      openSpan = span;
      break;
    }
  }

  if (openSpan) {
    const openAllDay = openSpan.open === "00:00" && openSpan.close === "24:00";
    let minutesUntilClose: number | undefined;
    if (!openAllDay) {
      minutesUntilClose = toMinutes(openSpan.close) - minutes;
      if (openSpan.close === "24:00") {
        const nextDay = (day + 1) % 7;
        const nextDaySpans = spans.filter((span) => span.day === nextDay);
        const midnightSpan = nextDaySpans.find((span) => span.open === "00:00");
        if (midnightSpan) {
          minutesUntilClose = 24 * 60 - minutes + toMinutes(midnightSpan.close);
        }
      }
    }
    if (!openAllDay && minutesUntilClose !== undefined && minutesUntilClose <= closingSoonMinutes) {
      return { status: "closing_soon", minutesUntilClose };
    }
    return { status: "open", minutesUntilClose };
  }

  const nextOpenToday = daySpans
    .map((span) => toMinutes(span.open))
    .filter((openMinutes) => openMinutes > minutes)
    .sort((a, b) => a - b)[0];

  let minutesUntilOpen: number | undefined;
  if (nextOpenToday !== undefined) {
    minutesUntilOpen = nextOpenToday - minutes;
  } else {
    const nextDay = (day + 1) % 7;
    const nextDaySpans = spans.filter((span) => span.day === nextDay);
    if (nextDaySpans.length) {
      const nextOpen = Math.min(...nextDaySpans.map((span) => toMinutes(span.open)));
      minutesUntilOpen = 24 * 60 - minutes + nextOpen;
    }
  }

  if (minutesUntilOpen !== undefined && minutesUntilOpen <= openingSoonMinutes) {
    return { status: "opening_soon", minutesUntilOpen };
  }

  return { status: "closed", minutesUntilOpen };
}
