import fs from "node:fs/promises";
import type { Club } from "../../lib/types";
import { discoverClubUrls } from "./discover";
import { scrapeClub } from "./club";
import { DATA_DIR, OUTPUT_PATH, REQUEST_DELAY_MS, sleep } from "./util";

type SkipReason =
  | "no-club-page"
  | "missing-hours"
  | "missing-geo"
  | "missing-country"
  | "missing-region"
  | "error";

/**
 * The shipped national artifact must have country/region/regionLabel for every
 * emitted club (CTO condition 5): a club that cannot populate them is skipped +
 * logged (counted in the reconciliation), never emitted with blanks.
 */
function disqualify(club: Club): SkipReason | null {
  if (!club.hours.club.spans.length) return "missing-hours";
  if (!club.geo) return "missing-geo";
  if (!club.address.country) return "missing-country";
  if (!club.region || !club.regionLabel) return "missing-region";
  return null;
}

export async function run(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });

  const clubUrls = await discoverClubUrls();
  if (!clubUrls.length) {
    throw new Error("No club URLs found. Add URLs to data/club-urls.txt to proceed.");
  }

  const clubs: Club[] = [];
  const skipped: Record<SkipReason, number> = {
    "no-club-page": 0,
    "missing-hours": 0,
    "missing-geo": 0,
    "missing-country": 0,
    "missing-region": 0,
    error: 0
  };

  for (const url of clubUrls) {
    console.log(`Scraping ${url}`);
    try {
      const club = await scrapeClub(url);
      if (!club) {
        skipped["no-club-page"] += 1;
      } else {
        const reason = disqualify(club);
        if (reason) {
          skipped[reason] += 1;
          console.warn(`  skipped (${reason}): ${url}`);
        } else {
          clubs.push(club);
        }
      }
    } catch (error) {
      skipped.error += 1;
      console.error(`Failed to scrape ${url}`, error);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  await fs.writeFile(OUTPUT_PATH, JSON.stringify(clubs, null, 2), "utf8");

  // Reconciliation: discovered vs emitted vs skipped-with-reason (plan §10).
  const byCountry: Record<string, number> = {};
  const byRegion: Record<string, number> = {};
  for (const c of clubs) {
    const country = c.address.country ?? "??";
    byCountry[country] = (byCountry[country] ?? 0) + 1;
    const region = c.regionLabel ?? c.region ?? "??";
    byRegion[region] = (byRegion[region] ?? 0) + 1;
  }
  const totalSkipped = Object.values(skipped).reduce((a, b) => a + b, 0);

  console.log("\n=== Scrape reconciliation ===");
  console.log(`discovered: ${clubUrls.length}`);
  console.log(`emitted:    ${clubs.length}`);
  console.log(`skipped:    ${totalSkipped} ${JSON.stringify(skipped)}`);
  console.log(`by country: ${JSON.stringify(byCountry)}`);
  console.log(`by region:  ${JSON.stringify(byRegion)}`);
  if (clubUrls.length !== clubs.length + totalSkipped) {
    console.warn("reconciliation mismatch — investigate");
  }
  console.log(`Saved ${clubs.length} clubs to ${OUTPUT_PATH}`);
}
