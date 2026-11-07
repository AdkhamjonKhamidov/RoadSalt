# RoadSalt Project Handover

**Updated:** 2026-11-07
**Implementation status:** The real-data milestone is implemented and verified in a browser against live services:
- location search,
- location-scoped roads, environmental features, weather and observations,
- road selection and details,
- loading, error and empty states.

Overpass detail data (OSM way IDs, unnamed and service roads) is implemented, but no successful live Overpass load has been seen yet: the public instances were at capacity throughout testing.

## Project overview

RoadSalt is a lightweight, map-centred winter road **awareness** demo for road-maintenance staff, environmental stakeholders and demo audiences. Users search any place (the default is 1101 Camden Ave, Salisbury, MD 21801), see real OpenStreetMap roads and mapped environmental features, and see local weather (model, measured and forecast). They can then select a road to review its OSM attributes, nearby mapped features and local weather. It never prescribes salt use or claims a road is icy.

Design: navy `#112D4E`, blue `#3F72AF`, pale blue `#DBE2EF`, off-white `#F9F7F7`, Georgia. Restrained and institutional; the map stays central.

## Current implementation status

| Area | Status |
|---|---|
| Location search | **Implemented, browser-verified.** `LocationSearch` combobox → `/api/geocode` → Photon. Verified: city (Baltimore, Annapolis), ZIP (21801), address, landmark (route-level); keyboard ↑/↓/Enter; live status text; duplicate suppression. |
| Location-scoped data | **Implemented, browser-verified.** Selecting a place flies the map there and reloads roads, features, Open-Meteo weather and the NWS station. A rapid second selection fully replaced the first (no stale overwrite). |
| Roads and features (tiles) | **Implemented, verified.** Read from the basemap vector tiles after each map move: about 293 roads in Salisbury, 533 in Baltimore. Named roads only, no OSM IDs. |
| Roads and features (Overpass) | **Implemented, not yet seen live.** Parallel instances, backoff, a 25 s deadline and a per-location cache. When it succeeds it replaces the tile data (way IDs, tags, unnamed and service roads). The "unavailable / Retry" state is verified. |
| Road selection and details | **Implemented, browser-verified.** South Salisbury Boulevard (Primary) and East Baltimore Street (Secondary). Shows attributes, nearby mapped features and local weather in separate sections. Unnamed roads are labelled by class or ref. |
| Open-Meteo weather | **Implemented, verified.** Current conditions (temperature, feels-like, humidity, wind, precipitation, code) and a 24 h forecast in the location's time zone. |
| NWS observations and alerts | **Implemented, verified.** Nearest station per location (KSBY Salisbury, KDMH Baltimore, KNAK Annapolis). Non-US locations get a clear 404 message. |
| Basemap | MapTiler when `NEXT_PUBLIC_MAPTILER_API_KEY` is set (currently in use), otherwise CARTO. |
| Environmental assessment | Approximate planar distance from the whole loaded road to mapped features; High ≤ 50 m, Moderate ≤ 250 m, Low, Unknown. Not proof of pollution. |
| Tests | `npm test`: 38 tests (Node built-in runner) covering parsers (geocoding, Overpass, Open-Meteo, NWS, storm reports, plow feeds), units, malformed input, proximity and per-road sensitivity, validation and cache. |
| Road map styling | **Implemented, browser-verified.** Dark basemap by default (Light optional); bold roads with casings; "Color roads by" road type, nearby water/wetland/farmland, or agency plow status. Three road accent colours only. |
| Local reporting | **Implemented, verified.** NWS alerts plus NWS Local Storm Reports (72 h, ~50 mi, US-wide via IEM) in a "Local reports" panel and as map points. Agency plow status from the `PLOW_FEEDS` registry (St. Mary's County MD); stale status shown gray as outdated. |
| Units | **Implemented, verified.** °F/mph/in/ft by default; °F/°C switch, remembered per browser. |
| Mobile | **Implemented, verified at 375 px.** Map ~62 % of height; map key and secondary panels collapsed; no horizontal scroll. |
| Forests | **Implemented.** New environmental kind (tiles + Overpass); listed but excluded from the sensitivity level. |
| Road conditions view (default) | **Implemented; partly verified.** Green / orange / red / gray road colours, closure and hazard overlay, status banner and per-road condition card. Closures need `TOMTOM_API_KEY` (not yet set, so the live TomTom response is unverified). Area caution comes from NWS winter road alerts or forecast freezing precipitation. Light theme is the default. |
| Elevation, terrain, risk scoring | Not implemented (out of scope). |

Checks on 2026-11-07, all passing: `npm run lint`, `npx tsc --noEmit`, `npm test` (38/38) and `npm run build`. The mobile layout was verified at 375 px.

## Technical architecture

- **Stack:** Next.js 16.4.5 App Router, React 19.3, TypeScript 5, Tailwind 4, MapLibre GL 6.16; npm. No new dependencies were added.
- **UI:**
  - `RoadSaltDashboard` owns `location` state. Each location-scoped request is tagged with a location key, aborted when the location changes, and ignored if its key no longer matches, so older results can't overwrite newer ones.
  - Map data is Overpass when it's ready for the current location, otherwise the tile data.
  - `LocationSearch` is the search box. `MapCanvas` takes a `focus` prop for fly-to and the marker, plus `onTileData`.
- **Services and parsers (`app/lib/`):** `validation`, `geocoding`, `geojson` (Overpass query and normalizer), `overpass` (fetch strategy), `tile-features`, `open-meteo`, `nws`, `proximity`, `weather`, `data-types`, `demo-config`.
- **Routes:**
  - `/api/geocode` (Photon proxy, 1 h cache)
  - `/api/weather?lat&lon` (10 min cache per point)
  - `/api/observations?lat&lon` (NWS; station cache 24 h, data 5 min)
  - `/api/map-data?lat&lon` (server Overpass; not used by the UI)
  - All validate input and output and return `{ error }` with a meaningful status on failure.
- **Configuration:** No keys required. `NEXT_PUBLIC_MAPTILER_API_KEY` and `NEXT_PUBLIC_MAPTILER_STYLE_ID` are optional; the developer maintains `.env.example` and `.env.local`, because Claude is denied `.env.*` access.

See `docs/DATA_SOURCES.md` for endpoints, queries, parsing rules, caching, limits and attribution, and `programmer.md` for the file guide and manual test steps.

## Important decisions and limitations

- **Geocoder:** Photon, not Nominatim, because Nominatim's policy forbids autocomplete.
- **Overpass from the browser:** approved 2026-11-07. Public instances are frequently at capacity: HTTP 502 "request queue is full", or queued requests that never answer. That was the cause of all earlier "timeouts", not the network or the code.
- **Tile data first:** it guarantees roads always appear. Its limits are no OSM IDs, no unnamed or service roads, merged tile pieces, and coverage of the loaded area only.
- **Proximity:** measured along the whole loaded length of a named road, so long roads often show "touching or crossing" water.
- **Cultural protections excluded:** historic districts are not environmental features (`protect_class` 21–29; tile `protected_area` excluded).
- **Data integrity:**
  - Weather attention and environmental sensitivity stay separate.
  - Air temperature never confirms ice. Proximity never proves pollution, and absence never means safe.
  - No salt rates, optimization, inventory, scheduling, auth, AI chat or ML.
- **`README.md`:** still has a screenshot placeholder.

## Claude Code development environment

- `CLAUDE.md` holds the project rules and imports `AGENTS.md`.
- `.claude/settings.json` sets conservative permissions. `.env*` reads, favicon edits, force-push, hard reset, `git clean`, deploy and publish are denied.
- `.claude/skills/` has 8 skills, `.claude/agents/` has 7 agents, and there are 4 commands: `/project-status`, `/verify-project`, `/review-changes`, `/update-handover`.
- `.claude/launch.json` has two entries:
  - `roadsalt-dev` (`npm run dev`) starts a new dev server.
  - `roadsalt-attach` attaches to an already-running server on port 3000.
- Next.js 16 allows only one `next dev` per project. On 2026-11-07 an older server (PID 15652) was still running, so `roadsalt-dev` could not start until it was stopped.

## Exact next development step

0. Add `TOMTOM_API_KEY` to `.env.local` (and a blank line to `.env.example`), restart, and verify closures and hazards render. Check the response parser against real data.
1. Verify a successful Overpass load. Reload when the public instances are quieter, or press Retry. Confirm that the status changes to "OSM detail (Overpass)", that unnamed and service roads become selectable, and that the OSM way ID and tags appear in road details.
2. Register more official agency plow-status feeds (see "Adding a local plow-status feed" in `programmer.md`) and check the plow-status view during an active storm, when status is fresh.
3. Only after that, and only on explicit request: the next milestone (road risk highlighting).

## Instructions for the next session

1. Read this file. `CLAUDE.md` loads automatically; run `/project-status`.
2. Trust the code over the docs. Do not rebuild completed features or redesign.
3. Keep changes incremental. Run `/verify-project` (lint, tsc, test, build) and document changes in `CHANGELOG.md`.
4. Branch `main`, remote `origin` = `https://github.com/AdkhamjonKhamidov/RoadSalt.git`. Check `git status` first. Don't touch the favicon.
5. Read `node_modules/next/dist/docs/` before using Next.js APIs (see `AGENTS.md`).
6. Don't load-test public Overpass, Photon or NWS instances; a couple of verification loads is enough.
