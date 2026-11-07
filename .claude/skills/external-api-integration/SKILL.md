---
name: external-api-integration
description: Procedures for RoadSalt's server-side API integrations (Overpass in app/api/map-data, Open-Meteo in app/api/weather). Covers request architecture, response validation, timeouts, endpoint fallback, caching, rate limits, environment configuration, attribution and documentation. Use when adding, changing or debugging a live data request.
---

# External API integration (RoadSalt)

## Architecture (keep it)
```
Browser ──fetch──▶ /api/<name> (Next route handler, server) ──fetch──▶ provider
                     │ validate → cache success → JSON
                     └ on failure → { error } + 4xx/5xx + no-store
```
- The client never calls providers directly. That keeps validation, caching, request identification and any future secrets server-side.
- Route handler shape (follow `app/api/weather/route.ts`):
  - module-level `cached` (`{ expiresAt, data }`) and `pending` promise,
  - a typed `ProviderError(message, status)`,
  - `fetchX()`, which does the request, timeout and validation,
  - `GET()`, which serves the cache or awaits the shared `pending`, maps errors, and clears `pending` in `finally`.
- Before editing a route handler, check the route handler and caching guides in `node_modules/next/dist/docs/` (this Next.js version has `cacheComponents` enabled).

## Validation
- Treat `response.json()` as `unknown`. Narrow with `isRecord`/`finiteNumber`-style guards.
- Reject the whole response if required structure is missing, with a 502 and a clear message. Drop individual invalid items and clamp physically bounded values (probability 0–100, amounts ≥ 0).
- Never fill missing values with defaults that look real (no `?? 0` temperatures).
- Overpass can return HTTP 200 with a `remark` (timeout or memory error). That is treated as a failure.

## Timeouts, fallback and rate limits
- `AbortSignal.timeout(15_000)`. Map `TimeoutError` → 504.
- HTTP 429 → 429 ("temporarily rate-limited"). 5xx → 503. Other 4xx → 502 (it is our request bug; don't retry).
- Overpass falls back to the secondary endpoint only on 429/503-class failures, not after a timeout (to avoid doubling the wait).
- Send an identifying `User-Agent` (`RoadSalt/0.1 (...)`), as Overpass etiquette asks.
- Open-Meteo free tier is for non-commercial use, about 10k calls/day. Overpass public instances are shared, so keep to a single bounded query.

## Caching
- In-process memory, success only: Overpass 15 min, Open-Meteo 10 min. It is per server process and not shared or persistent. That is acceptable for the demo; do not add Redis, KV or a database.
- The response `Cache-Control` on success is `public, max-age=300, stale-while-revalidate=600`. On failure it is `no-store`.
- Cached data still carries the original `updatedAt`. The UI shows it.

## Environment configuration
- No keys today. If one is ever approved: server-only `process.env.X` in a route handler, declared in `.env.local` (gitignored, and Claude cannot read it), documented by variable name only in `programmer.md`. Never use `NEXT_PUBLIC_` for secrets.

## Attribution
- OpenStreetMap data: "© OpenStreetMap contributors", ODbL, shown in the map attribution control.
- CARTO basemap: attribution required. The public style is for development and demos.
- Open-Meteo: CC BY 4.0. Credit "Weather data by Open-Meteo.com".
- Every API response includes a `source` field. Keep it and show it.

## Checking a route for real
With `npm run dev` running:
```bash
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/weather
curl -sS http://localhost:3000/api/map-data | head -c 400
```
Report the actual status, feature or hour counts, and `source`. A timeout or 429 is a real result. Report it as such; never treat it as a pass.

## Documentation
Any change to endpoints, parameters, cache times, fallback or limits must update `docs/DATA_SOURCES.md` and `CHANGELOG.md` (see `documentation-maintenance`).
