# RoadSalt Project Handover

**Updated:** 2026-11-08
**Status:** Feature-complete hackathon build, pushed to `main`. All checks pass: `npm run lint`, `npx tsc --noEmit`, `npm test` (43), `npm run test:ui` (14 Playwright tests with screenshots) and `npm run build`.

## Project overview

RoadSalt is a GIS-style map for winter road maintenance and environmental planning. For any US place it shows live road closures and hazards, winter weather, and runoff exposure for every 100 m of road (distance to mapped water, wetland and farmland). Selecting a road gives its reported condition, a segment-by-segment exposure strip, nearby features and a Gemini treatment approach for review. It never gives application rates. The default location is 1101 Camden Ave, Salisbury, MD 21801.

Hackathon tracks: **Sustainability & Climate Technology** (less salt runoff into Eastern Shore water) and **Public Systems & Infrastructure** (road-maintenance planning).

## Current implementation

| Area | Status |
|---|---|
| Layout and design | **Done, screenshot-verified** at 1440, 900 and 375 px. Navy header with favicon, Georgia wordmark, location and search; full-height map with one control panel; flat information panel with Georgia section headings and data tables. Next.js dev indicator hidden. |
| Location search | **Done.** Photon via `/api/geocode`; keyboard, debounce, cancellation. |
| Roads and features | **Done.** Read from the basemap's OSM vector tiles (`tile-features.ts`). Overpass was removed on 2026-11-08: its public instances never answered, and tiles cover everything the app uses. |
| Road conditions view (default) | **Done, verified live.** TomTom closures (red) and hazards (amber) drawn on the affected stretches, area caution from NWS winter alerts or forecast freezing precipitation; other roads quiet slate ("No reported problems"). |
| 100 m runoff segments | **Done, verified.** `segments.ts`; the proximity view colours every 100 m piece; the selected road shows a strip, counts and exposed stretches. |
| Gemini treatment approach | **Done, verified live** (first text ~0.6 s, full ~1.3 s). Search grounding is refused on the current key (quota 429), so answers fall back to RoadSalt data only and say so. Enable billing on the AI Studio project for local-news grounding. |
| Cache database | **Done.** `PersistentCache` on `node:sqlite`, `.data/roadsalt.db`; every route; survives restarts. `/api/cache` stats in development only. |
| Weather, NWS, storm reports, plow status | **Done.** Open-Meteo current + 24 h forecast table; nearest NWS observation and alerts; IEM storm reports; St. Mary's County plow feed (stale > 48 h shown outdated). |
| Units, basemap, layers | **Done.** °F/°C (remembered), light/dark basemap (dark needs MapTiler), roads and environmental layer toggles. |
| README | **Done.** Purpose, problem, features, tracks, setup, sources, limitations, demo screenshot. |

## Technical architecture

- **Stack:** Next.js 16.4.5 App Router, React 19.3, TypeScript 5, Tailwind 4, MapLibre GL 6.16; npm; Node ≥ 22.18. Dev dependency: `@playwright/test`. No runtime dependencies were added (SQLite is Node's built-in).
- **Files:** see the `roadsalt-context` skill for the file map, and `docs/DATA_SOURCES.md` for every provider, endpoint, cache time and limit.
- **Configuration** (`.env.local`, never committed, never read by Claude): optional `NEXT_PUBLIC_MAPTILER_API_KEY`, `TOMTOM_API_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL`.

## Important decisions

- **Overpass removed** (2026-11-08, user request).
- **Gemini scope** (2026-11-07, user approved): treatment *strategy* per road, labelled AI-generated, no numeric rates, sources and Search Suggestions shown. See `CLAUDE.md`.
- **Database scope** (2026-11-08, user request): only the local SQLite response cache.
- **Design** (2026-11-07): "municipal engineering meets environmental research"; the identity palette and Georgia restored after a brief generic redesign.
- **Map layer order:** overlays go above the last basemap geometry layer. MapTiler styles put a label layer before roads, which once hid every overlay.

## Next steps (only if the user asks)

1. Enable billing on the Gemini project to get Search-grounded local news in suggestions.
2. Register more official agency plow-status feeds (see `programmer.md`).
3. Retake the README screenshot without the dev badge, if wanted.

## Instructions for the next session

1. Read this file; `CLAUDE.md` loads automatically. Trust the code over the docs.
2. Keep changes incremental; run lint, `tsc`, `npm test`, `npm run test:ui` (look at the screenshots) and `npm run build`; record changes in `CHANGELOG.md`.
3. Branch `main`, remote `origin` = `https://github.com/AdkhamjonKhamidov/RoadSalt.git`. Check `git status` first. Don't touch the favicon.
4. Read `node_modules/next/dist/docs/` before using Next.js APIs (see `AGENTS.md`).
5. Next.js allows one `next dev` per project. If port 3000 is taken, an earlier dev server is still running.
