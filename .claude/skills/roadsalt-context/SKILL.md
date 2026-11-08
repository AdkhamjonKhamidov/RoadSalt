---
name: roadsalt-context
description: Core RoadSalt project knowledge. Covers architecture, file map, data flow, design system, data sources, thresholds, key decisions, restrictions and current priorities. Use at the start of any RoadSalt implementation, planning or review task, or when you need to know where something lives without re-scanning the codebase.
---

# RoadSalt context

Rules (data integrity, scope, design) are in `CLAUDE.md` and are not repeated here. This skill is the architecture reference. **Current status and the next step are in `PROJECT_HANDOVER.md`. Read it first.** If the handover and the code disagree, trust the code and record the discrepancy.

## Purpose in one line
A GIS-style map for winter road maintenance: live road closures and hazards, winter weather, and runoff exposure for every 100 m of road (distance to mapped water, wetland and farmland), with a reviewable Gemini treatment approach per road. Built for a hackathon (Sustainability and Public Systems tracks). It never prescribes application rates.

## File map

| File | Role |
|---|---|
| `app/page.tsx` | Thin entry that renders `RoadSaltDashboard`. |
| `app/layout.tsx` | Metadata (title, description, favicon `/assets/favicon.png`). |
| `app/components/RoadSaltDashboard.tsx` | `"use client"`. Owns the selected `Location` and the location-scoped requests (weather, observations, storm reports, incidents, plow status), each tagged with a location key and aborted on change. Takes tile data from `MapCanvas.onTileData`, builds the view colouring (conditions, 100 m segments, plow), and renders the header and the information panel. |
| `app/components/MapCanvas.tsx` | `"use client"`. Owns the MapLibre map, sources and layers, the control panel (view slot, legend, layers incl. roads toggle), Recenter, selection, popups and cleanup. |
| `app/components/LocationSearch.tsx` | Search combobox → `/api/geocode` (350 ms debounce, 3-character minimum, cancellation, keyboard). |
| `app/components/RoadAdvice.tsx` | Streams the Gemini treatment approach for the selected road from `/api/advice`; sources, Search Suggestions iframe, Retry/Regenerate. |
| `app/lib/tile-features.ts` | Roads and environmental features read from the basemap's OpenMapTiles layers. |
| `app/lib/segments.ts` | 100 m road segmentation, per-segment exposure and stretch summaries. |
| `app/lib/proximity.ts` | Planar distances, `assessEnvironmentalSensitivity`, `prepareSensitiveParts`, `nearestSensitiveFeature`, `roadSensitivityLevels`. |
| `app/lib/road-conditions.ts` | Condition colours and labels, area caution, banner summary, per-road condition. |
| `app/lib/advice.ts` | Gemini context validation, prompt, request body, SSE parsing, `redactRates`. |
| `app/lib/cache-db.ts` | Server-only `PersistentCache` on `node:sqlite` (`.data/roadsalt.db`) and `cacheStats`. |
| `app/lib/` (others) | `validation`, `geocoding`, `open-meteo`, `nws`, `nws-server`, `storm-reports`, `traffic-incidents`, `plow-feeds`, `weather`, `units`, `data-types`, `demo-config` (location, zoom, `ROAD_SEGMENT_METERS` 100, thresholds 50/250 m, basemaps). |
| `app/api/*/route.ts` | `geocode`, `weather`, `observations`, `storm-reports`, `incidents`, `plow-status`, `advice` (POST, stream) and `cache` (dev-only stats). |
| `app/globals.css` | Design tokens (navy/blue/pale blue/off-white, Georgia + sans), shell, panel, map controls, segment strip, advice block. |
| `e2e/` | Playwright UI tests and screenshots (`npm run test:ui`). |
| `next.config.ts` | `devIndicators: false`, `cacheComponents`, `partialPrefetching`, Tailwind turbopack loader. |

## Data flow
Basemap tiles → `extractTileMapData` → `MapData` → dashboard → coloured roads (conditions or 100 m segments) → `MapCanvas` sources. Road click → `selectedRoad` → condition (`incidentsOnRoad` + area caution), `assessEnvironmentalSensitivity`, `segmentRoad` + `summarizeSegments` → panel → `AdviceContext` → `/api/advice` (Gemini) → streamed suggestion. Every server route caches successful results in `PersistentCache`.

## Environment
Works without keys. Optional: `NEXT_PUBLIC_MAPTILER_API_KEY` (MapTiler basemap, dark style), `TOMTOM_API_KEY` (closures/hazards), `GEMINI_API_KEY` and `GEMINI_MODEL` (treatment approach). Node ≥ 22.18. Dev server at `http://localhost:3000`.

## Tooling
npm scripts: `dev`, `build`, `start`, `lint`, `test` (Node's built-in runner over `tests/*.test.ts`), `test:ui` (Playwright). Type check with `npx tsc --noEmit`.

## Known limits
- Gemini Search grounding needs a billed Google AI Studio project. Without it, answers fall back to RoadSalt data only (labelled).
- Tile data has no OSM ids, tags, or unnamed/service roads.

Out of scope unless the user approves: application rates, salt optimization, elevation, inventory, crew scheduling, auth, general AI chat, ML, and databases beyond the SQLite response cache.
