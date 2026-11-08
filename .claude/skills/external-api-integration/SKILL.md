---
name: external-api-integration
description: Procedures for RoadSalt's live data integrations, all through app/api server routes (Open-Meteo, NWS, IEM storm reports, TomTom incidents, agency plow feeds, Photon geocoding, Gemini). Covers request architecture, response validation, timeouts, error mapping, the persistent cache, rate limits, environment configuration, attribution and documentation. Use when adding, changing or debugging a live data request.
---

# External API integration (RoadSalt)

## Architecture (keep it)
```
Browser ──fetch──▶ /api/<name> (Next route handler, server) ──fetch──▶ provider
                     │ validate → cache success (PersistentCache) → JSON
                     └ on failure → { error } + 4xx/5xx + no-store
```
- Every provider goes through a server route. That keeps validation, caching, request identification and secrets server-side.
- Roads and environmental features are not fetched at all: they are read from the basemap's vector tiles (`tile-features.ts`). Overpass was removed on 2026-11-08.
- Route handler shape (follow `app/api/incidents/route.ts`):
  - a module-level `PersistentCache<T>("namespace", memoryEntries, ttlMs)` and a `pending` map for in-flight sharing,
  - `fetchX()`, which does the request, timeout and validation,
  - `GET()`, which serves the cache or awaits the shared `pending`, maps errors, and clears `pending` in `finally`.
- Before editing a route handler, check the route handler and caching guides in `node_modules/next/dist/docs/` (this Next.js version has `cacheComponents` enabled).

## Validation
- Treat `response.json()` as `unknown`. Narrow with `isRecord`/`finiteNumber`/`text` guards from `validation.ts`.
- Reject the whole response if required structure is missing, with a 502 and a clear message. Drop individual invalid items and clamp physically bounded values (probability 0–100, amounts ≥ 0).
- Never fill missing values with defaults that look real (no `?? 0` temperatures).

## Timeouts and errors
- `AbortSignal.timeout(...)` on every provider call. A timeout maps to 504.
- HTTP 429 → 429 ("temporarily rate-limited"). 5xx → 503. Other 4xx → 502 (our request bug; don't retry).
- Send an identifying `User-Agent` where the provider asks for one (NWS requires it).
- Open-Meteo free tier is for non-commercial use, about 10k calls/day. TomTom's free tier is about 2,500 requests/day, so its cache cell is ~1 km for 3 minutes.

## Gemini (`/api/advice`)
- POST with the road context (`AdviceContext`, validated by `parseAdviceContext`). It streams NDJSON lines (`text`, `sources`, `error`, `done`) from the Gemini Interactions API (`app/lib/advice.ts`).
- Google Search grounding first. On 429/400 (no grounding quota) it retries once without web search, and the answer says local news wasn't checked.
- The cache key is road + place + clock hour. `refresh: true` bypasses it (the Regenerate button).
- The scope rules are in `CLAUDE.md`: no numeric rates (also enforced by `redactRates`), never "icy" or "safe", show sources and Search Suggestions.

## Caching (`app/lib/cache-db.ts`)
- `PersistentCache`: an in-memory hot layer in front of Node's built-in SQLite (`node:sqlite`), stored at `.data/roadsalt.db` (gitignored). It caches successful results only and survives restarts. If SQLite can't open, it degrades to memory only.
- TTLs: weather 10 min, observations 5 min, NWS points 24 h, incidents 3 min, storm reports 10 min, plow status 2 min, geocoding 1 h, Gemini 1 h.
- `GET /api/cache` (development only; 404 in production) shows entries, size and hits per namespace. To reset, stop the server and delete `.data/`.
- Cached data keeps its original `updatedAt`, and the UI shows it.

## Environment configuration
- Server-only keys in `.env.local` (gitignored, and Claude cannot read it): `TOMTOM_API_KEY`, `GEMINI_API_KEY`, optional `GEMINI_MODEL`. Browser-visible by design: `NEXT_PUBLIC_MAPTILER_API_KEY`, `NEXT_PUBLIC_MAPTILER_STYLE_ID`. Document variables by name only in `programmer.md` and `.env.example`. Never use `NEXT_PUBLIC_` for secrets.

## Attribution
- OpenStreetMap data: "© OpenStreetMap contributors", ODbL, shown in the map attribution control.
- MapTiler/CARTO basemaps: attribution required.
- Open-Meteo: CC BY 4.0. NWS and IEM are public. TomTom and Gemini are named in the UI's data sources.
- Every API response includes a `source` field. Keep it and show it.

## Checking a route for real
With `npm run dev` running:
```bash
curl -sS -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/weather?lat=38.348&lon=-75.607"
curl -sS "http://localhost:3000/api/incidents?lat=38.348&lon=-75.607" | head -c 300
curl -sS http://localhost:3000/api/cache
```
Report the actual status, counts and `source`. A timeout or 429 is a real result. Report it as such; never treat it as a pass.

## Documentation
Any change to endpoints, parameters, cache times or limits must update `docs/DATA_SOURCES.md` and `CHANGELOG.md` (see `documentation-maintenance`).
