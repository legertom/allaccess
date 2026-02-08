import clubsData from "../data/clubs.sample.json";
import type { Club } from "./types";

export const clubs = clubsData as Club[];

export function getAmenityOptions(clubList: Club[]): string[] {
  const set = new Set<string>();
  for (const club of clubList) {
    for (const amenity of club.amenities) {
      set.add(amenity);
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}
