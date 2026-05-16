import { NextResponse } from "next/server";
import { clubHasAmenity, getHoursForClub } from "../../../lib/amenities";
import { isOpenAt, isOpenAtParts } from "../../../lib/hours";
import { parseWallClock } from "../../../lib/time";
import { loadClubs } from "../../../lib/data";

/**
 * `at` is a floating wall clock ("yyyy-MM-ddTHH:mm") evaluated in EACH club's
 * own local time ("open at 8pm their time") — the per-club-local semantic
 * (plan §8.1). No `at` => "now" (a real instant in each club's tz).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const atParam = searchParams.get("at")?.trim();
  const amenity = searchParams.get("amenity") ?? "";

  const wallClock = atParam ? parseWallClock(atParam.replace(" ", "T")) : null;
  const now = new Date();

  const clubs = await loadClubs();
  const filtered = clubs.filter((club) => {
    if (!clubHasAmenity(club, amenity || undefined)) {
      return false;
    }
    const spans = getHoursForClub(club, amenity || undefined);
    return wallClock
      ? isOpenAtParts(spans, wallClock)
      : isOpenAt(spans, now, club.timezone);
  });

  return NextResponse.json({
    count: filtered.length,
    mode: wallClock ? "at" : "now",
    at: wallClock ? atParam : now.toISOString(),
    amenity: amenity || null,
    clubs: filtered
  });
}
