import { describe, it, expect } from "vitest";
import { parseWallClock } from "../lib/time";
import {
  getHoursStatus,
  getHoursStatusForParts,
  parseHoursLines
} from "../lib/hours";
import type { HoursSpan } from "../lib/types";

// Mon-Fri 06:00-22:00; Fri also has a late overnight 22:00-02:00 block.
const WEEKDAY_SPANS: HoursSpan[] = parseHoursLines([
  "Monday 6:00 AM - 10:00 PM",
  "Tuesday 6:00 AM - 10:00 PM",
  "Wednesday 6:00 AM - 10:00 PM",
  "Thursday 6:00 AM - 10:00 PM",
  "Friday 6:00 AM - 10:00 PM",
  "Friday 10:00 PM - 2:00 AM"
]);

// Open 06:00-22:00 every day (weekday-independent — for tz/DST assertions).
const ALL_WEEK_SPANS: HoursSpan[] = parseHoursLines([
  "Sunday 6:00 AM - 10:00 PM",
  "Monday 6:00 AM - 10:00 PM",
  "Tuesday 6:00 AM - 10:00 PM",
  "Wednesday 6:00 AM - 10:00 PM",
  "Thursday 6:00 AM - 10:00 PM",
  "Friday 6:00 AM - 10:00 PM",
  "Saturday 6:00 AM - 10:00 PM"
]);

describe("parseWallClock", () => {
  it("derives weekday + minutes with no timezone (stable anchors)", () => {
    // 2021-01-01 is a well-known Friday; 1970-01-01 a Thursday.
    expect(parseWallClock("2021-01-01T20:00")).toEqual({ day: 5, minutes: 1200 });
    expect(parseWallClock("1970-01-01T00:30")).toEqual({ day: 4, minutes: 30 });
    expect(parseWallClock("2021-01-03T00:00")).toEqual({ day: 0, minutes: 0 }); // Sunday
  });
  it("rejects malformed input", () => {
    expect(parseWallClock("not-a-date")).toBeNull();
    expect(parseWallClock("2026-13-40T99:99")).toBeNull();
  });
});

describe("getHoursStatusForParts (pure wall-clock core)", () => {
  it("open mid-day", () => {
    expect(getHoursStatusForParts(WEEKDAY_SPANS, { day: 1, minutes: 12 * 60 }).status).toBe("open");
  });
  it("closing soon within window", () => {
    const r = getHoursStatusForParts(WEEKDAY_SPANS, { day: 1, minutes: 21 * 60 }, { closingSoonMinutes: 90 });
    expect(r.status).toBe("closing_soon");
    expect(r.minutesUntilClose).toBe(60);
  });
  it("opening soon within window", () => {
    const r = getHoursStatusForParts(WEEKDAY_SPANS, { day: 1, minutes: 5 * 60 + 30 }, { openingSoonMinutes: 60 });
    expect(r.status).toBe("opening_soon");
    expect(r.minutesUntilOpen).toBe(30);
  });
  it("closed when outside all spans", () => {
    expect(getHoursStatusForParts(WEEKDAY_SPANS, { day: 0, minutes: 3 * 60 }).status).toBe("closed");
  });
  it("overnight span carries into Saturday morning (day boundary)", () => {
    // Fri 22:00-02:00 normalizes to Fri 22:00-24:00 + Sat 00:00-02:00, so
    // Sat 01:00 is still served (open/closing-soon) and Sat 03:00 is closed.
    expect(getHoursStatusForParts(WEEKDAY_SPANS, { day: 6, minutes: 60 }).status).not.toBe(
      "closed"
    );
    expect(getHoursStatusForParts(WEEKDAY_SPANS, { day: 6, minutes: 3 * 60 }).status).toBe(
      "closed"
    );
  });
});

describe("the timezone bug fix: 'open at' is per-club-local and tz-independent", () => {
  // Club open Fri 06:00-22:00. "Open at 8 PM Friday" must be OPEN whether the
  // club is in NY, London, or LA — the wall clock is identical everywhere.
  // The OLD code converted 8 PM to a NY instant, so a London club was checked
  // at 01:00 (wrong). getHoursStatusForParts has no tz input by construction,
  // so it cannot regress that way.
  it("same status regardless of which club/tz it represents", () => {
    const wc = parseWallClock("2021-01-01T20:00")!; // a Friday, 20:00
    expect(getHoursStatusForParts(WEEKDAY_SPANS, wc).status).toBe("open");
  });
  it("Friday 05:30 is opening-soon, never bled into another weekday", () => {
    const morning = parseWallClock("2021-01-01T05:30")!;
    expect(
      getHoursStatusForParts(WEEKDAY_SPANS, morning, { openingSoonMinutes: 60 }).status
    ).toBe("opening_soon");
  });
});

describe("getHoursStatus (now mode) stays tz-correct, incl. DST", () => {
  // Disable the soon-windows so each assertion is strictly open vs closed.
  const HARD = { closingSoonMinutes: 0, openingSoonMinutes: 0 };

  it("the same instant resolves to different local hours per tz", () => {
    // 2026-06-15T10:00Z: NY=06:00 EDT (open), London=11:00 BST (open),
    // LA=03:00 PDT (closed).
    const i = new Date("2026-06-15T10:00:00Z");
    expect(getHoursStatus(ALL_WEEK_SPANS, i, "America/New_York", HARD).status).toBe("open");
    expect(getHoursStatus(ALL_WEEK_SPANS, i, "Europe/London", HARD).status).toBe("open");
    expect(getHoursStatus(ALL_WEEK_SPANS, i, "America/Los_Angeles", HARD).status).toBe("closed");
  });
  it("applies the DST offset (same UTC clock, EST vs EDT flips open/closed)", () => {
    // 10:30Z in NY: winter EST(-5)=05:30 -> closed; summer EDT(-4)=06:30 ->
    // open. Same wall clock, one-hour offset shift => the DST table is applied.
    expect(
      getHoursStatus(ALL_WEEK_SPANS, new Date("2026-01-15T10:30:00Z"), "America/New_York", HARD).status
    ).toBe("closed");
    expect(
      getHoursStatus(ALL_WEEK_SPANS, new Date("2026-07-15T10:30:00Z"), "America/New_York", HARD).status
    ).toBe("open");
  });
});
