/**
 * Entry point for the Equinox hours scraper.
 *
 * GATED ACTION (CTO Confirmation C1, 2026-05-16): a bulk live national detail
 * scrape — crawling non-NYC club detail pages at scale and writing a national
 * data/clubs.json — is blocked until the 2026-05-20 ToS/robots review clears.
 *
 * This entry refuses to run unless SCRAPER_ALLOW_NATIONAL=true is set, which
 * represents that post-signoff authorization. The scraper code itself
 * (scripts/scraper/*) is complete and unit-tested against fixtures so it is
 * ready to run the moment the gate is lifted.
 */
import { run } from "./scraper/run";

const GATE_MESSAGE = `Bulk national scrape is gated until the 2026-05-20 ToS/robots review.
Set SCRAPER_ALLOW_NATIONAL=true to run after legal sign-off.
Until then, scraper logic is verified via: npm test (tests/scraper.test.ts).`;

if (process.env.SCRAPER_ALLOW_NATIONAL !== "true") {
  console.log(GATE_MESSAGE);
  process.exit(0);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
