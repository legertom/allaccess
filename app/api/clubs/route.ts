import { NextResponse } from "next/server";
import { loadClubs } from "../../../lib/data";

export async function GET() {
  const clubs = await loadClubs();
  return NextResponse.json(clubs);
}
