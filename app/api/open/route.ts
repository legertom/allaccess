import { NextResponse } from "next/server";
import { clubHasAmenity, getHoursForClub } from "../../../lib/amenities";
import { isOpenAt } from "../../../lib/hours";
import { parseNYCDateTime } from "../../../lib/time";
import { loadClubs } from "../../../lib/data";

function parseAtParam(value: string | null): Date {
  if (!value) {
    return new Date();
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return new Date();
  }

  const normalized = trimmed.replace(" ", "T");

  if (/Z$|[+-]\d{2}:?\d{2}$/.test(normalized)) {
    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  const local = parseNYCDateTime(normalized);
  if (local) {
    return local;
  }

  const fallback = new Date(normalized);
  return Number.isNaN(fallback.getTime()) ? new Date() : fallback;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const atParam = searchParams.get("at");
  const amenity = searchParams.get("amenity") ?? "";
  const queryDate = parseAtParam(atParam);

  const clubs = await loadClubs();
  const filtered = clubs.filter((club) => {
    if (!clubHasAmenity(club, amenity || undefined)) {
      return false;
    }

    const spans = getHoursForClub(club, amenity || undefined);
    return isOpenAt(spans, queryDate, club.timezone);
  });

  return NextResponse.json({
    count: filtered.length,
    at: queryDate.toISOString(),
    amenity: amenity || null,
    clubs: filtered
  });
}
