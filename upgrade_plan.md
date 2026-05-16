# Equinox Sundial — Upgrade Plan

**Status:** All conditions resolved — pending final sign-off on this reconciled revision (CTO confirmations 2026-05-16 at end) · **Audience:** Staff/senior engineers
**Decisions:** §8.1, §8.2 ACCEPTED; C1/C2 confirmed (CTO, 2026-05-16). Launch-gate owners/dates assigned (§9). No open questions.

This document is written to be verifiable. Where it makes a claim about current
behavior, it quotes the code and the file:line so you can check it. Where a
number is unknown until we run code, it says so and specifies how we'll measure
it instead of guessing.

---

## 1. Thesis

Three changes, in dependency order:

1. **De-scope the NYC hard-coding** in the scraper and data model so we cover the
   full public Equinox footprint (US/CA/UK).
2. **Fix one real correctness bug**: the "Open at <time>" path interprets the
   picked wall-clock time as US Eastern for *every* club (§3). This is latent
   today (single timezone) and becomes wrong the instant a second timezone
   exists.
3. **Rebuild the UI as a map-first surface** and add four features.

The leverage point: the hours/status engine (`lib/hours.ts`) is already
wall-clock-pure and timezone-parameterized (§2). The multi-region work is
scraper + data model + UI + a thin time adapter — **not** a rewrite of the
status logic. §2 proves this rather than asserting it.

---

## 2. Why the hours engine does not need rewriting (evidence)

`getHoursStatus(spans, date, timeZone, opts)` (`lib/hours.ts:245`) derives the
local day/minute via `getZonedParts` (`lib/time.ts:44`):

```ts
export function getZonedParts(date: Date, timeZone: string) {
  const zoned = toZonedTime(date, timeZone);             // date-fns-tz
  return { day: zoned.getDay(), minutes: zoned.getHours() * 60 + zoned.getMinutes() };
}
```

`toZonedTime(date, tz)` returns a `Date` whose **system-local accessors**
(`getDay/getHours/getMinutes`) yield the wall clock in `tz`. So the derived
`{day, minutes}` is correct **independent of the server's TZ**, and DST is
handled by date-fns-tz's offset table. This is the documented date-fns-tz
pattern; it is not relying on `process.env.TZ`.

Everything downstream of that derivation in `getHoursStatus` (`lib/hours.ts:257-311`)
is pure integer arithmetic on `day` (0–6) and `minutes` (0–1439), including the
next-day rollover for overnight spans (`(day + 1) % 7`, lines 276-281, 299-304).
There is **no `Date` math inside the status computation** — only the single
`getZonedParts` call at the boundary.

**Consequence:** to support "open at a wall-clock time, evaluated per-club-local"
we do not touch the arithmetic. We add one adapter that supplies `{day, minutes}`
directly instead of via `(date, tz)`. See §3.3.

---

## 3. The timezone bug, precisely

### 3.1 Two independent code paths

The "Open at" feature exists in two places that do **not** share code:

- **UI path** — `app/page.tsx:172`:
  ```ts
  const queryDate = useMemo(() => {
    if (mode === "now") return new Date();
    return parseNYCDateTime(dateTimeValue) ?? new Date();   // <-- always NYC
  }, [mode, dateTimeValue]);
  // ...
  const status = getHoursStatus(spans, queryDate, club.timezone, {...}); // page.tsx:184
  ```
- **API path** — `app/api/open/route.ts:39` → `parseAtParam` → `parseNYCDateTime`
  (`lib/time.ts:31`). **Note:** `app/page.tsx` never calls `/api/open` (it fetches
  `/api/clubs` and computes status client-side). `/api/open` is a public endpoint
  with an independent copy of the same defect. Both must be fixed; they are
  unrelated edits.

### 3.2 What actually goes wrong

`parseNYCDateTime` (`lib/time.ts:31`):

```ts
const parsed = parse(value, "yyyy-MM-dd'T'HH:mm", new Date()); // wall-clock fields
return fromZonedTime(parsed, NYC_TIMEZONE);                     // "those fields ARE NYC time"
```

So the picker string `2026-05-15T20:00` becomes **the absolute instant that is
8:00 PM in New York**. `getHoursStatus` then re-derives the wall clock of that
instant **in each club's own tz**. For a London club that instant is **01:00 the
next day**, so we evaluate the wrong day and time. "Now" mode is fine
(`new Date()` is a true instant; per-club tz derivation is correct). The bug is
**strictly the "at" path**.

### 3.3 The fix (and why it's small)

Decision in §8.1 is to interpret the picked time as **each club's local
wall-clock** ("show clubs open at 8 PM *their* time"). Under that semantic the
picker value is not an instant at all — it is a floating `(dayOfWeek, minutes)`.
Given §2, the fix is an adapter, not a rewrite:

- `lib/time.ts`: add `parseWallClock(value: string): { day: number; minutes: number } | null`
  (calendar-parse the `datetime-local` string; derive `day`/`minutes` with no tz
  conversion). Keep `parseNYCDateTime` only if any caller still needs an instant;
  otherwise delete it (it is currently the *source* of the bug).
- `lib/hours.ts`: extract the body of `getHoursStatus` below the `getZonedParts`
  call into `getHoursStatusForParts(spans, {day, minutes}, opts)`. Then:
  - `getHoursStatus(spans, date, tz, opts)` = `getHoursStatusForParts(spans, getZonedParts(date, tz), opts)` (unchanged behavior for "now").
  - "At" mode calls `getHoursStatusForParts(spans, parseWallClock(value), opts)` directly — same wall clock for every club, no tz hop.
- `app/api/open/route.ts`: same — for `at` mode, evaluate against `parseWallClock`;
  for "now" keep `new Date()` + `club.timezone`.

This is ~1 new pure function + 1 mechanical extraction + 2 call-site edits. The
status arithmetic and its tests are untouched. **CTO execution guidance:** keep
`lib/hours.ts` pure and small — `getHoursStatusForParts` takes `{day, minutes}`
and spans and nothing else; no URL parsing, region logic, or UI labels may leak
into it. **Alternative semantic** (single reference zone) is rejected in §8.1
with rationale.

---

## 4. Current state (what we're changing, with file:line)

| Concern | Location | Current behavior |
|---|---|---|
| NYC URL gate | `scripts/scrape-equinox.ts:61` `isNYCClubUrl` | Requires path `clubs/new-york/{uptown\|midtown\|downtown\|brooklyn}/…`. |
| City narrowing | `scrape-equinox.ts:9` `CITY_SLUGS`, `:496` `filterClubUrls` | Discovery filtered to NY slug variants. |
| Nested-sitemap cap | `scrape-equinox.ts:520` `.slice(0, 10)` | Only first 10 nested sitemaps fetched — fine for NY, **insufficient nationally**. |
| Region fallback page | `scrape-equinox.ts:537` `/clubs/new-york` | Hard-coded region landing page for the NextData fallback. |
| Data model | `lib/types.ts:17-43` | `Address` has no `country`; `Club` has no metro/region. `timezone` exists but is only ever `"America/New_York"` in current data. |
| Time parse | `lib/time.ts:31` `parseNYCDateTime` | §3 — forces NYC. |
| API open | `app/api/open/route.ts` | §3 — forces NYC; **unused by the UI**. |
| UI | `app/page.tsx` | 453-line single `"use client"` component; fetches `/api/clubs`, computes status client-side; map is a 540px box below a full-viewport hero (`:343`). |
| Map markers | `components/ClubMap.tsx:139` | Plain `CircleMarker` per club, **no clustering**. 35 Manhattan pins already overlap; national scale is unusable. |
| Dead code | `lib/clubs.ts` | Static-imports `clubs.sample.json`; not used by the page (page uses the API). |
| Tests / CI | `package.json` | **No test runner, no CI config in repo.** Any "add tests" item implies first adding the harness (see §7). |
| Data scale | `data/clubs.json` | 35 clubs; cities = {New York, Brooklyn}; state = NY only; all have geo. |

**Total club count nationally is unknown** and is deliberately *not* asserted
here. The current scraper cannot enumerate it (it filters to NYC before
counting). §5 Phase 1 includes a read-only spike whose first deliverable is the
real number and the real region-slug taxonomy.

---

## 5. Plan

Phases are independently shippable. **0 → 1 → 2 → 3 → 4.** Phase 0's
verification harness (non-interactive build/lint/test) is the hard prerequisite
for internal Phase 1b/2 (CTO condition 1); Phase 0's security upgrade gates
**public rollout**, not internal coding (CTO 2026-05-16). Phases 1 and 2 then
parallelize across two engineers; the `Club` type (§6) is the only contract
between them and must be frozen first.

### Phase 0 — Repeatable verification & dependency posture (hard prerequisite)

Pulled forward from the old Phase 5 per **CTO condition 1**. Rationale:
lint/test/security must be a repeatable gate *before* code change begins, not
retrofitted.

- **Non-interactive build/lint/test.** `npm run build` already passes after
  install (CTO-verified). `next lint` currently prompts to create an ESLint
  config interactively (CTO-verified) — commit an ESLint config + the eslint
  dependency so `npm run lint` runs non-interactively in CI. Stand up **vitest**
  (ESM-native; matches `"type":"module"`; none today) with an `npm test` script.
  Add a CI workflow (none in repo) running typecheck + lint + test.
- **Dependency security — CTO condition 2 / Answer 2 (gates public rollout).**
  `npm audit --omit=dev` reports 3 production vulns: 1 moderate + 2 high; `next`
  is the direct high-severity driver, `undici` transitive (CTO-verified).
  Separately, `react`/`react-dom` are 18.x but `@types/react` is 19.x — a major
  mismatch. **Mandatory: upgrade. The accepted-risk fallback is NOT an
  implementation path (CTO Answer 2 / Confirmation 2026-05-16).** Move `next`
  to a release with no known high/moderate prod advisories and re-align `react`,
  `react-dom`, `@types/react` to matching majors; verify with
  `npm audit --omit=dev` clean of high/moderate **and** a green build. Use the
  official Next upgrade guide + codemods — do not pin a version from memory. If
  the safe path requires a *major* Next upgrade with meaningful migration, split
  it into a separately-tracked **Security Framework Upgrade** workstream that
  stays a public-rollout blocker; internal/staging coding continues meanwhile.
- **Cleanup.** Delete dead `lib/clubs.ts`.

**Gate — split per CTO confirmation (2026-05-16):**
- *Blocks internal Phase 1b/2 (hard prerequisite):* `npm run build`,
  `npm run lint`, `npm test` green and non-interactive in CI — verification
  harness only.
- *Blocks public rollout, not internal coding:* `npm audit --omit=dev` clean of
  high/moderate via the mandatory Next/security upgrade. No accepted-risk path.

**Effort:** ~2–3 d (CTO-revised; §11).

### Phase 1 — National data (scraper + model)

**1a. Enumeration spike (read-only, ~0.5 day) — do this before estimating the rest.**
Run the existing sitemap walk with the NY filters removed, **log only** (no
writes): emit every `/clubs/*` URL, the distinct path[1] region slugs, and a
count. Output: (i) real total club count, (ii) the actual region-slug → country
taxonomy (we do not have this from memory and must not hard-code a guessed map),
(iii) confirmation the static-fetch approach still works at non-NYC URLs (see the
blocking risk in §9).

**1a is a HARD GATE (CTO condition 4).** If the spike finds anti-bot blocking,
materially different CA/UK markup, or a region taxonomy that cannot be derived
cleanly, **stop and re-estimate before any UI scope (Phase 2) is committed** —
the variance is not absorbed silently.

**Pre-signoff boundary (CTO Confirmation C1, 2026-05-16).** Allowed before the
2026-05-20 legal signoff: generalized scraper code written and tested against
the existing 35-club dataset, saved HTML fixtures, mocked sitemap inputs, and a
*narrow* read-only Phase 1a — sitemap enumeration plus **minimal** spot checks
to prove non-NYC detail pages still expose server-side data, using the existing
polite fetch posture. **Gated until 2026-05-20:** bulk live national detail
scraping — the first full run that crawls non-NYC detail pages at scale, writes
a national `data/clubs.json`, or feeds a public/staging national dataset. If
more than minimal spot checks are needed before that date, **stop and ask the
CTO.**

**1b. Generalize discovery & extraction (~2–3 days, sized after 1a).**

> **Gated action (CTO C1):** code + fixture/mock testing proceed pre-signoff;
> the first *bulk live national scrape run* waits for the 2026-05-20 ToS/robots
> signoff (§9 legal row).

- Replace `isNYCClubUrl` with `isClubDetailUrl`: validate path shape only —
  `segments[0] === "clubs" && segments.length >= 4` (the depth logic already
  exists at `scrape-equinox.ts:62-72`; we drop the `new-york` + segment-set
  checks, keep the shape check).
- Remove the `CITY_SLUGS` narrowing in `filterClubUrls` (`:496`) and the
  `isNYCClubUrl` post-filters (`:515`, `:531`, `:560`).
- Remove/raise the nested-sitemap `.slice(0, 10)` cap (`:520`); paginate all
  club/location sitemaps. Keep the 1.2s throttle (`REQUEST_DELAY_MS`) and ETag
  cache — they make re-runs cheap.
- Replace the `/clubs/new-york` NextData fallback (`:537`) with the region set
  discovered in 1a (or `/clubs`).
- **Country/region derivation precedence** (deterministic, with the taxonomy
  from 1a): (1) facility JSON country field if present; else (2) region-slug →
  country map built from 1a; else (3) timezone prefix (`Europe/London`→GB;
  `America/*` disambiguated by `address.state` against US-state vs CA-province
  lists). Log any club that falls through to (3) so gaps are visible.
- **Split the scraper by responsibility (CTO execution guidance).** It is
  already 683 lines; as part of generalization separate it into discovery,
  fetch/cache, extraction, normalization, validation, and write modules so the
  national logic is unit-testable in isolation (feeds the Phase 5 fixtures).

**1c. Validation & migration safety (~0.5 day).**
The scraper rewrites the whole file (`scrape-equinox.ts:676`
`fs.writeFile(OUTPUT_PATH, …)`), so there is **no in-place migration** — one
successful national scrape fully replaces `data/clubs.json`. The only unsafe
window is "new code + old file." Mitigation: deploy code **after** a successful
scrape produces a file with the new fields, or make the new `Club` fields
optional and derive defaults in `lib/data.ts` on read. Add a post-scrape summary
(counts by country/region, # skipped + reason) to cron logs.

**Exit criteria:** every discovered club URL that returns a club page yields a
record with non-empty hours **and** geo, OR is logged as skipped with a reason;
the discovered-vs-emitted-vs-skipped reconciliation is printed. (We deliberately
do **not** claim "95% of all clubs" — there is no external oracle for the
denominator; the verifiable invariant is the reconciliation.)

### Phase 2 — Map-first UI (largest phase)

- Decompose `app/page.tsx` into `<MapCanvas>`, `<ControlRail>`, `<ResultsSheet>`,
  `<ClubRow>` + hooks `useClubData / useClubStatus / useUrlState / useGeolocation`.
  `page.tsx` becomes an orchestrator. Net LOC roughly flat; testable units.
- New CSS system in `app/globals.css`: dark neutral base, **one functional
  status hue scale**, system/grotesque type, density over decoration. Remove the
  hero, gradient glows, Cormorant serif, `fadeUp`, and the duplicated stat block
  (`page.tsx:235` vs `:319` render the same numbers twice).
- Full-bleed `MapContainer`; floating `ControlRail`; collapsible bottom
  `ResultsSheet`; two-way row↔marker selection (fly-to + popup).
- **Clustering** (mandatory at national scale; react-leaflet ships none).
  **CTO execution guidance: prefer `supercluster` if the Leaflet cluster-plugin
  wrapper compatibility becomes noisy** — the map must not depend on fragile
  React/Leaflet wrapper behavior. `react-leaflet-cluster` is acceptable only if
  its compatibility with react-leaflet 4.2.1 / Leaflet 1.9 is validated and
  pinned in-phase; otherwise default to `supercluster` + a custom layer.
- A11y: keyboard nav for the results list, ARIA on switcher/segmented controls,
  focus management on row→marker selection, honor `prefers-reduced-motion`.

**Exit criteria:** no landing chrome; all national markers usable via clustering
at country zoom; row↔marker sync verified; keyboard-only operable.

### Phase 3 — Location switcher + timezone fix

- `lib/regions.ts` (new): build country → region → city indexes from the
  dataset for a cascading switcher; default selection **NYC**.
- Apply §3.3 (the adapter + call-site edits). Add unit tests covering: a club in
  each country at a DST boundary; "open at" producing identical wall-clock
  evaluation across two timezones; overnight span at the day boundary.
- Switcher state owned by the URL (Phase 4) — single source of truth.

**Exit criteria:** selecting London shows London clubs evaluated at London local
time; the DST/overnight fixture tests are green.

### Phase 4 — Features

| Feature | Approach | Touch points |
|---|---|---|
| Near me + smart sort | `navigator.geolocation` (graceful denial path); `lib/geo.ts` haversine; sort = distance \| soonest-to-close \| name. | `useGeolocation`, `ResultsSheet`, `lib/geo.ts` |
| Search + shareable links | Type-ahead (client filter over loaded set). **URL is the single source of truth**: `?country=&region=&city=&at=&amenity=&q=&sort=` via `useUrlState`; backs the Phase 3 switcher; refresh- and link-safe. | `useUrlState`, `ControlRail`, `page.tsx` |
| Favorites + live countdown | `localStorage` star list → pinned strip; a 60s interval re-invokes the status hook so "closes in 41m" decrements (note: drives a re-render every 60s only for visible rows). | `useFavorites`, `useClubStatus`, `ResultsSheet` |
| Amenity status chips | Use already-scraped `club.hours.amenities` (pool/spa/kids; mapped in `lib/amenities.ts:getHoursSetForClub`). Chips filter **and** recolor markers by that amenity's open/closed state, replacing the lone `<select>` (`page.tsx:285`). | `ControlRail`, `ClubMap`, `lib/amenities.ts` |

**Re-scope rule (CTO condition 6).** If the schedule slips, MVP = near-me,
search, shareable URL state, and amenity status chips. **Favorites + live
countdown are the first deferred items** (the row stays for design intent but is
cut first). The URL is the **sole** source of truth for country, region, city,
amenity, search, sort, and `at` — no mirrored component state that can diverge
from a shared link (CTO execution guidance).

### Phase 5 — Test coverage & fixtures (harness now lives in Phase 0)

With the runner/CI standing from Phase 0: unit-test `lib/hours.ts` (DST,
overnight, all-day, opening/closing-soon boundaries), `lib/geo.ts`, and the
region index; add a scraper extraction test against 3–4 saved real-HTML fixtures
(one per country + an overnight case). This is depth on top of the Phase 0 gate,
not the gate itself.

---

## 6. Data model change (`lib/types.ts`) — additive, derived at scrape

```ts
type Address = {
  line1: string; line2?: string; city: string; state: string; postalCode: string;
  country: string;          // NEW — "US" | "CA" | "GB" (ISO-3166-1 alpha-2)
};
type Club = {
  // …existing…
  region: string;           // NEW — metro slug from path[1], e.g. "los-angeles"
  regionLabel: string;      // NEW — display label, from the 1a taxonomy
  // timezone: already present; becomes load-bearing (was always America/New_York)
};
```

`country/region/regionLabel` are optional **only during the migration window**
(so the pre-national `clubs.json` still deserializes). **CTO condition 5:** the
shipped national artifact MUST have all three required and populated for every
emitted club; the optional window closes — and the type is tightened to required
— when the national file becomes the deployed artifact at the end of Phase 1. A
club that cannot populate all three is **skipped + logged** (counted in the
Phase 1 reconciliation), never emitted with blanks.

---

## 7. Honest gaps in the current repo (so estimates aren't fiction)

- **No test framework, no CI; lint is interactive.** vitest + a CI workflow
  must be stood up first, and `next lint` currently prompts interactively so it
  is not yet a usable gate (CTO-verified). **Now Phase 0** (was Phase 5) per CTO
  condition 1 — it gates Phase 1b/2.
- **Production dependency vulns (CTO-verified).** `npm audit --omit=dev`: 1
  moderate + 2 high; `next` direct driver, `undici` transitive. Plus a `react`
  18 / `@types/react` 19 major mismatch. Resolved in Phase 0 before public
  rollout (CTO condition 2).
- **`/api/open` is dead-ish.** Public endpoint, not used by the UI. Worth keeping
  + fixing for API consumers, but its tz fix does **not** affect the UI path.
- **Effort numbers are coarse and pre-spike.** They assume: familiarity with
  Next.js App Router + Leaflet; no Equinox anti-bot defenses (see §9); the §8
  decisions are taken as recommended. Re-baseline after Phase 1a.

---

## 8. Decisions required (correctness-affecting)

**8.1 — "Open at <time>" semantic.** Recommend **per-club-local wall clock**
(the picked time means "8 PM in that club's city"). Rationale: it's the only
semantic that's meaningful while browsing across regions, and §3.3 shows it's the
*smaller* change (no instant construction, no tz hop). The alternative — one
fixed reference zone — is the current behavior, is the bug, and is confusing
nationally. **Status: ACCEPTED by CTO** — explicitly endorsed §3.3 as the right
design.

**8.2 — Coverage for v1.** Recommend the full public footprint (US+CA+UK) since
Phase 1a enumerates it in one pass and the marginal scrape cost is throttle-time,
not engineering. Alternative: US-only first if 1a reveals CA/UK markup diverges
materially. **Status: ACCEPTED — full footprint, contingent on the Phase 1a hard
gate** (CTO conditions 2/4).

---

## 9. Risks (engineering-real, not generic)

| Risk | Why it's the real one | Contingency |
|---|---|---|
| **Equinox blocks/changes at scale** — current scraper is plain `fetch` + custom UA, no JS rendering. It works today because club data is server-rendered in `__NEXT_DATA__` (35-club success is the evidence). Nationally we hit more endpoints/sitemaps; anti-bot (Cloudflare) or a move to client-only data would break the static approach. | This is the single biggest delivery risk and Phase 1a exists to surface it **before** committing Phase 1b effort. | If blocked: headless fetch (Playwright) for detail pages, lower rate, longer cron. Materially changes Phase 1 effort — flagged, not absorbed silently. |
| Region→country taxonomy guessed wrong | We do **not** know Equinox's region slugs from memory. | 1a derives it from real sitemap data before any code depends on it; precedence rule (§5 1b) has a logged fallback. |
| Map perf with hundreds of markers | Plain markers already overlap at 35. | Clustering is a Phase-2 hard requirement; supercluster contingency named. |
| react-leaflet-cluster ↔ react-leaflet 4.2.1 compat | Library version coupling is historically fragile. | Validate + pin during Phase 2; supercluster fallback path. |
| DST / overnight edge cases | The math is wall-clock-pure (§2) but "at"-mode wiring is new. | Fixture tests enumerated in Phase 3 exit criteria. |
| Holiday hours | Equinox holiday overrides aren't in the scraped standing hours. | Out of scope; label the UI "standard hours — holidays may vary." |
| **Legal/robots — LAUNCH GATE (resolved)** | National scraping changes the risk profile even though the scraper stays polite (throttle/ETag/contact UA). | **OWNER: CTO · EXECUTION: eng lead · TARGET: 2026-05-20.** Gates bulk live national scraping + public rollout (CTO Answer 1 / C1). Ambiguity → counsel. |
| **Dependency security — gate (resolved)** | 3 prod vulns (1 moderate / 2 high); `next` direct driver. | Mandatory Next/security upgrade (CTO Answer 2); **no accepted-risk fallback.** Gates **public rollout**, not internal coding. Major-upgrade case → separately-tracked *Security Framework Upgrade* workstream, still a public-rollout blocker. |
| **Headless pivot re-triggers legal (CTO C2)** | A headless approach changes the posture a static-fetch signoff assumed. | If 1a forces headless: written rec (cost, rate limits, caching, failure modes, alternatives) → **counsel/legal re-review before implementation**; CTO approval alone insufficient. |

---

## 10. Verifiable success criteria

- **Coverage:** scraper prints discovered-vs-emitted-vs-skipped-with-reason;
  reconciliation accounts for 100% of discovered URLs. (Not "95% of all clubs" —
  no oracle for the denominator.)
- **Correctness:** the §3 bug is gone, proven by tests where one wall-clock "at"
  query yields identical day/minute evaluation across ≥2 timezones, plus DST and
  overnight boundary cases.
- **No regressions in "now" mode:** existing NYC behavior unchanged (covered by
  the same test suite, NY fixtures).
- **UI:** no hero/landing chrome; map usable at country zoom via clustering;
  keyboard-operable; a shared URL deterministically reproduces the view.
- **Maintainability:** `page.tsx` decomposed; `lib/hours.ts`/`geo`/region under
  test in CI (CI newly added).

---

## 11. Coarse effort (re-baseline after 1a)

| Phase | 1 eng | Notes |
|---|---|---|
| 0 | 2–3 d | Hard prerequisite: non-interactive lint/test/CI + Next/security upgrade (CTO conditions 1–2). |
| 1a spike | 0.5 d | Hard gate; first code to run; re-estimate triggers in §5. |
| 1b–1c | 2–3.5 d | Sized by 1a (taxonomy size, blocking?). |
| 2 | 5–8 d | Largest; clustering + decomposition + CSS system. |
| 3 | 2–3 d | Adapter is small (§3.3); cost is switcher + tests. |
| 4 | 4–6 d | Four features; favorites/countdown cut first if slipping (§5). |
| 5 | 2–3 d | Test-coverage depth on top of the Phase 0 gate. |
| **Total** | **~18–28 d** | CTO-revised from ~16–25 d; added time buys repeatable verification + safer rollout. 2 eng (data ∥ UI) ≈ 2.5–3.5 wk; excludes legal review + design QA. |

Estimates are pre-spike and will move if §9's blocking risk materializes.

**Critical path to bulk national scraping:** the **2026-05-20 legal/robots
signoff — not Phase 0 —** gates the first live national scrape (CTO C1).
Pre-signoff, Phase 0 + Phase 1b code + the read-only Phase 1a spike run in
parallel. Two-engineer parallelism is **not** day-1: Eng B's Phase 2
implementation is gated on Eng A's Phase 0 verification harness and the post-1a
`Club`-contract freeze.

---

## CTO RESPONSE

I reviewed the plan against the current app implementation and I approve the direction with conditions. This is a strong staff-level plan: it names the real correctness bug, avoids guessing the national club count, preserves the status engine instead of rewriting it, and puts the enumeration spike before global rollout. The biggest improvement is §3.3: treating "Open at" as a floating wall-clock value and extracting `getHoursStatusForParts` is the right design.

### Verified current state

- `data/clubs.json` currently has 35 clubs: 31 New York, 4 Brooklyn; all NY; all have geo and club-hour spans.
- `npm run build` passes after installing dependencies.
- `npm run lint` is not a usable gate yet because Next prompts to create an ESLint config interactively.
- `npm audit --omit=dev` reports 3 production vulnerabilities: 1 moderate and 2 high. `next` is the direct high-severity dependency driver; `undici` is transitive.
- The app findings in §4 are accurate: NYC scraper filtering, NYC time parsing, unclustered map markers, no test runner/CI, dead-ish `/api/open`, and a large client-side `page.tsx`.

### Required amendments before execution

1. Add an explicit Phase 0. Do not bury lint/test/security setup in Phase 5. Before Phase 1b or Phase 2 starts, `npm run build`, `npm run lint`, and `npm test` need to be non-interactive and green.
2. Resolve the dependency security posture before public rollout. Either upgrade to a safe Next line or document an accepted risk with owner and expiration. My preference is to upgrade, then verify React and `@types/react` version alignment.
3. Make legal/robots review a named launch gate with an owner and date. National scraping changes the risk profile even if the scraper remains polite.
4. Treat Phase 1a as a hard gate. If the enumeration spike finds anti-bot blocking, materially different CA/UK markup, or a taxonomy that cannot be derived cleanly, re-estimate before committing UI scope.
5. Keep `country`, `region`, and `regionLabel` optional only during migration. The shipped national artifact should have them required and populated for every emitted club.
6. Re-scope Phase 4 if schedule slips. Near-me, search, shareable URL state, and amenity status chips are MVP. Favorites and live countdown are useful but should be the first deferred items.

### Execution guidance

- Keep `lib/hours.ts` pure and small. The extraction to `getHoursStatusForParts` is acceptable; do not let URL parsing, region logic, or UI labels leak into it.
- Split the scraper by responsibility as it grows: discovery, fetch/cache, extraction, normalization, validation, and write. The current single file is already 683 lines.
- Prefer `supercluster` if Leaflet cluster plugin compatibility becomes noisy. The marker count will be modest, but the map should not depend on fragile React/Leaflet wrapper behavior.
- URL state must be the source of truth for country, region, city, amenity, search, sort, and `at`. Avoid mirrored component state that can diverge from shared links.
- The redesign should be a working command surface, not a prettier landing page. Remove the hero, duplicate stat block, decorative gradients, and serif display treatment as planned.

With Phase 0 made explicit, I would revise the one-engineer estimate from ~16-25 days to ~18-28 days. The added time is not overhead; it buys repeatable verification, a cleaner dependency posture, and safer national rollout.

---

## REVISIONS APPLIED (per CTO RESPONSE — 2026-05-15)

The plan body above has been amended to satisfy every condition. Audit trace:

| CTO item | Where applied |
|---|---|
| 1 — explicit Phase 0; build/lint/test non-interactive & green before 1b/2 | New **§5 Phase 0** (hard prerequisite) + §5 sequencing line; §7; §11 row. |
| 2 — resolve dependency security before public rollout | §5 Phase 0 (Next upgrade + react/@types realign + audit gate); §9 security-gate row; §7. |
| 3 — legal/robots = named launch gate w/ owner+date | §9 **Legal/robots — NAMED LAUNCH GATE** row (owner/date placeholders). |
| 4 — Phase 1a a hard gate w/ re-estimate triggers | §5 Phase 1a "HARD GATE" paragraph; §8.2; §11 note. |
| 5 — country/region/regionLabel required in shipped artifact | §6 rewritten; §5 Phase 1c skip-not-blank rule. |
| 6 — re-scope Phase 4 if schedule slips | §5 Phase 4 "Re-scope rule" (favorites/countdown deferred first). |
| Exec — keep `lib/hours.ts` pure/small | §3.3 CTO-guidance line. |
| Exec — split scraper by responsibility | §5 Phase 1b new bullet. |
| Exec — prefer `supercluster` if wrapper noisy | §5 Phase 2 clustering bullet (now supercluster-first). |
| Exec — URL state single source of truth | §5 Phase 4 re-scope paragraph. |
| Exec — command surface, not a prettier landing page | Already §1/§4/§5 Phase 2 — unchanged. |
| Estimate → ~18–28 d (1 eng) | §11 total + new Phase 0 row. |
| §8.1 / §8.2 accepted | Marked **ACCEPTED** in §8; header status updated. |

**Outstanding — RESOLVED (CTO Answers + Confirmation, 2026-05-16):** legal gate
owner = CTO, execution = eng lead, target 2026-05-20; security upgrade mandatory
with **no** accepted-risk path; Phase 1b code-vs-execution boundary fixed per
C1. No open items — see **CTO CONFIRMATION — 2026-05-16** at end.

---

## OPEN — CLOSED (superseded 2026-05-16)

All five items here were answered in **CTO ANSWERS — 2026-05-16**, with the two
follow-ups closed in **CTO CONFIRMATION — 2026-05-16**. Kept as an audit trail;
**no open items remain.** Pointers: (1) legal owner/date → §9 + CTO Answer 1.
(2) Next-upgrade scope → §5 Phase 0 + CTO Answer 2. (3) resourcing → §11 + CTO
Answer 3. (4) public-rollout definition → §5/§11 + CTO Answer 4. (5) Phase 1a
escalation → §5 / §9 headless row + CTO Answer 5 / C2.

---

## CTO ANSWERS — 2026-05-16

These are the decisions for the five open items above. Treat this section as the
current authority unless superseded by a later CTO note.

1. **Legal/robots owner and date.**
   Owner: CTO. Execution owner: plan owner/engineering lead. Target date:
   **2026-05-20**. Engineering may run the read-only Phase 1a enumeration spike
   before signoff, but **Phase 1b national scraping and any public national
   rollout are blocked** until ToS / `robots.txt` review is complete. If review
   is ambiguous, escalate to counsel rather than making an engineering call.

2. **Next upgrade scope and mandatory status.**
   The upgrade path is mandatory. Do not use the accepted-risk fallback for the
   current high-severity production advisories. Phase 0 should first try to
   absorb the Next/security upgrade inside its 2-3 day budget. If the safe path
   requires a major Next upgrade with meaningful migration work, split it into a
   separately tracked **Security Framework Upgrade** workstream, but keep it a
   blocker for public rollout. Internal/staging work may continue while that
   workstream is active if it remains non-public.

3. **Resourcing.**
   Staff for the two-engineer path if available: Engineer A owns Phase 0,
   scraper/data model, validation, and fixtures; Engineer B starts UI planning
   and Phase 2 implementation once the `Club` contract is frozen after Phase 1a.
   If only one engineer is available, use the revised **18-28 engineering-day**
   estimate and do not promise the 2.5-3.5 week timeline.

4. **Public rollout vs. internal/staging.**
   Public rollout means any unauthenticated, externally accessible production
   experience or indexed public URL using national scraped data. Internal/staging
   means local, preview, or authenticated/staff-only access. Phases 1-4 may
   proceed in internal/staging before legal signoff, but public rollout requires:
   legal/robots signoff, dependency security gate cleared, Phase 1 reconciliation
   clean, and the timezone tests passing.

5. **Escalation authority after Phase 1a.**
   CTO is the approver for continuing if Phase 1a trips the hard gate. Default
   decision rule: if static fetch works and taxonomy is clean, proceed to Phase
   1b; if CA/UK differ materially, continue US-first and re-estimate CA/UK; if
   anti-bot blocking requires headless scraping, stop and bring a short written
   recommendation covering cost, legal posture, throttle/caching design, and
   alternatives before implementation.

---

## NEEDS CTO CONFIRMATION — 2026-05-16 (last items before sign-off)

Two yes/no confirmations remain. Both come from tensions **inside the answers
above**, so only the CTO can resolve them. Each is pre-answered with the reading
engineering will implement unless amended — a "confirmed" reply is sufficient.

**C1 — Phase 1b: code vs. live execution boundary.**
Answer 1 blocks *"Phase 1b national scraping"* until the 2026-05-20 legal/robots
review; Answer 4 allows *"Phases 1–4 in internal/staging before signoff."* Phase
1b ⊂ Phases 1–4, so these conflict unless the *work* is split from the *act*.
Proposed reading to confirm: **generalized scraper code may be written and
tested against the existing 35-club dataset + saved HTML fixtures before legal
signoff; the first *live national scrape run against equinox.com* is the gated
action and waits for the 2026-05-20 ToS/robots review.**
If amended (no Phase 1b work pre-signoff): legal — not Phase 0 — becomes the
critical path to Phase 1b and the timeline shifts.
→ **Confirm / Amend:** ⟨ ⟩

**C2 — Does a headless-scraping pivot re-trigger legal?**
Answer 5 routes an anti-bot/headless pivot to a written CTO recommendation. A
headless approach changes the legal posture that a static-fetch signoff was
predicated on.
Proposed reading to confirm: **if Phase 1a forces headless scraping, the written
recommendation goes to counsel for legal re-review — not CTO sign-off alone —
because the 2026-05-20 signoff assumes polite static fetch.**
→ **Confirm / Amend:** ⟨ ⟩

**What happens on your reply:** engineering (1) reconciles the three internal
inconsistencies from the review — split the Phase 0 gate so the security/audit
gate blocks *public rollout*, not internal Phase 1b/2; delete the now-prohibited
accepted-risk fallback (Answer 2); fill the resolved owner/date placeholders from
Answers 1–3 and supersede the stale "Outstanding"/§OPEN blocks — and (2) puts
legal on the §11 critical path to Phase 1b. Then we request sign-off. The
read-only Phase 1a enumeration spike is already authorized pre-signoff by Answer
1 and can begin in parallel.

---

## CTO CONFIRMATION — 2026-05-16

Confirmed, with one boundary clarification on C1.

**C1 — Confirmed with clarification.** Generalized scraper code may be written
and tested before legal signoff using the existing 35-club dataset, saved HTML
fixtures, mocked sitemap inputs, and limited read-only Phase 1a enumeration.
The Phase 1a exception is intentionally narrow: sitemap enumeration and minimal
spot checks needed to prove non-NYC detail pages still expose usable server-side
data are allowed pre-signoff, using the existing polite fetch posture.

The gated action is **bulk live national detail scraping**: the first full
national scrape run that crawls non-NYC club detail pages at scale, writes a
national `data/clubs.json`, or feeds a public/staging national dataset waits for
the 2026-05-20 ToS/robots review. If engineering needs more than minimal spot
checks before that date, stop and ask.

**C2 — Confirmed.** A headless-scraping pivot re-triggers legal review. CTO
approval alone is not sufficient because headless scraping changes the posture
from polite static fetch to browser automation. If Phase 1a shows headless is
required, engineering must bring a short written recommendation covering cost,
rate limits, caching, failure modes, and alternatives; that recommendation goes
to counsel/legal review before implementation.

**Proceeding instruction.** Reconcile the stale "Outstanding" and `OPEN` blocks,
remove the accepted-risk fallback as an implementation path, split the Phase 0
gate so security blocks public rollout rather than internal coding, and then
bring back the cleaned plan for final sign-off. The read-only Phase 1a spike can
start in parallel under the boundary above.

---

## CTO FINAL SIGN-OFF — 2026-05-16

Full sign-off granted. Engineering is authorized to execute the approved plan
end-to-end without phase-by-phase CTO check-ins, subject to the gates below.

**Execution authority.** Proceed autonomously through implementation, local
verification, build/lint/test setup, scraper refactor, UI work, and deployment
preparation. Escalate only if Phase 1a trips the hard gate, legal posture
changes, or the security framework upgrade becomes materially larger than the
Phase 0 budget.

**Push and release target.** Target `main` as the release branch because the
goal is to get the live site updated. Use the least-branchy path allowed by repo
rules:

- If direct push to `main` is allowed, push the finished verified work directly
  to `main`.
- If `main` is protected, use exactly one short-lived working branch, open one
  PR into `main`, and merge it as soon as required checks pass. Do not create a
  stack of branches or phase PRs unless a protection rule forces it.

**National-data activation gate.** This sign-off does **not** authorize public
national-data activation yet. Until the 2026-05-20 legal/robots review and the
security-for-public-rollout gate are cleared, delivery is verified on NYC data,
saved fixtures, mocked sitemap inputs, and the limited read-only Phase 1a
enumeration boundary already approved. No bulk live national detail scrape, no
national `data/clubs.json` activation, and no public national rollout before
those gates are complete.

**Go.**

---

## CTO CLARIFICATION — LEGAL GATE CLEARED — 2026-05-16

Correction: there is no known legal issue. The earlier legal/robots language was
a conservative blocker inferred from the plan's open-gate wording, not from an
identified legal problem. The business owner has confirmed the legal gate is
cleared.

Engineering is now authorized to run the national scrape as part of the approved
implementation, using the existing polite-fetch posture: throttling, ETag/cache
reuse, identifiable contact User-Agent, and validation/reconciliation logging.
National `data/clubs.json` may be generated and used for verification.

Remaining release gate: clear the security-for-public-rollout dependency gate or
document the resolved upgrade path before pushing the live production release.
If the scrape requires a materially different posture, such as headless browser
automation because static fetch is blocked, stop and escalate before switching
approach.

**Updated instruction: Go, including national scrape under polite static fetch.**
