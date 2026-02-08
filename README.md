# Equinox Sundial

NYC Equinox hours scraper + Next.js viewer (open now / open at a time).

## Quick start

1) Install dependencies

```
npm install
```

2) Run the scraper (polite mode, cached)

```
# Optional: set a contact for polite scraping
# export SCRAPER_CONTACT="you@example.com"
#
# Optional: seed URLs to avoid discovery misses
# echo "https://www.equinox.com/clubs/sample" > data/club-urls.txt

npm run scrape
```

3) Run the app

```
npm run dev
```

## Notes

- The app reads `data/clubs.json` if present, otherwise it falls back to `data/clubs.sample.json`.
- The scraper throttles to one request every ~1.2s and uses ETag caching when available.
- The scraper limits output to NYC boroughs (uptown/midtown/downtown/brooklyn).

## API

- `GET /api/clubs` returns the full club list.
- `GET /api/open?at=2026-02-07T10:30&amenity=Pool` returns clubs open at the specified NYC local time.

## Railway deployment

- Add a persistent volume and mount it (example mount: `/data`).
- Set `DATA_DIR=/data` so both the scraper and API read/write the same file.
- Add a cron job to run `npm run scrape` (weekly is usually enough).
- Set `SCRAPER_CONTACT` to your support email for polite scraping.
- If discovery fails, add URLs to `data/club-urls.txt` (one per line).
- Amenity hours are captured when sections like "Pool Hours" appear on the page.
