# Data model

## Club

- id: slug derived from URL.
- slug: URL-safe identifier.
- name: club name.
- address: line1, line2 (optional), city, state, postalCode.
- geo: lat/lng (optional if missing).
- timezone: "America/New_York".
- amenities: list of amenity labels as shown on the club page.
- hours:
  - club: hours set for the full club.
  - amenities: keyed by slugified amenity name (e.g. "pool", "spa").
- source:
  - url: club page.
  - lastFetchedAt: ISO timestamp when scraped.

## Hours representation

- Hours are stored as spans to make time math simple.
- Each span is a day-of-week integer (0=Sun) plus open/close in 24h HH:mm.
- Overnight spans (e.g. 10:00 PM - 2:00 AM) are normalized into two spans:
  - Day N: 22:00-24:00
  - Day N+1: 00:00-02:00

## Amenity hours

- The scraper collects any section heading that includes "Hours".
- "Club Hours" (or the first generic hours section) is used for the club.
- Additional hours sections ("Pool Hours", "Spa Hours") are stored under hours.amenities
  with a slugified key.

## Data files

- data/clubs.json is the scraper output.
- data/clubs.sample.json is a placeholder used for local UI development.
- data/club-urls.txt can be used to seed the scraper when discovery fails.
