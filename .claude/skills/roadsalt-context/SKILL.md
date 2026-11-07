---
name: roadsalt-context
description: Core RoadSalt project knowledge. Covers architecture, file map, data flow, design system, data sources, thresholds, key decisions, restrictions and current priorities. Use at the start of any RoadSalt implementation, planning or review task, or when you need to know where something lives without re-scanning the codebase.
---

# RoadSalt context

Rules (data integrity, scope, design) are in `CLAUDE.md` and are not repeated here. This skill is the architecture reference. **Current status, verified vs. unverified items and the next step are in `PROJECT_HANDOVER.md`. Read it first.** If the handover and the code disagree, trust the code and record the discrepancy.

## Purpose in one line
A map-centred demo showing real OSM roads near 1101 Camden Ave, Salisbury, MD, with nearby mapped environmental features and Open-Meteo weather, to support cautious, human judgment about road salt. It is not a treatment engine.

## File map

| File | Role |
|---|---|
| `app/page.tsx` | Thin entry that renders `RoadSaltDashboard`. |
| `app/layout.tsx` | Metadata (title, favicon `/assets/favicon.png`), body colors. |
| `app/components/RoadSaltDashboard.tsx` | `"use client"`. Owns the selected `Location`. Each request (Overpass, `/api/weather`, `/api/observations`) is tagged with a location key and aborted on change. Uses Overpass data when ready for the current location, otherwise tile data from `MapCanvas.onTileData`. Renders the road details, current conditions, NWS observation and forecast panels. |
| `app/components/LocationSearch.tsx` | Search combobox → `/api/geocode` (350 ms debounce, 3-character minimum, cancellation, keyboard). |
| `app/components/MapCanvas.tsx` | `"use client"`. Owns the MapLibre map: CARTO Positron style, location marker/popup, navigation and reset controls, sources `roadsalt-roads` and `roadsalt-environment`, environment layers, `roadsalt-road-network`, `roadsalt-selected-road`. Layers are inserted below the first label layer. Data updates use `setData`. Click → `onRoadSelect`. A ResizeObserver handles resizing. Listeners, marker and map are removed on cleanup. |
| `app/components/map-config.ts` | Re-exports map settings from `demo-config`. |
| `app/lib/demo-config.ts` | `DEMO_LOCATION`, `DEMO_CENTER` `[lon, lat]`, `INITIAL_ZOOM` 14, `DEFAULT_LOCATION`, `SEARCH_RADIUS_METERS` 2000, `ENVIRONMENTAL_THRESHOLDS_METERS` {high: 50, moderate: 250}, `BASEMAP_STYLE_URL`. |
| `app/lib/data-types.ts` | `RoadProperties`, `EnvironmentalKind` (waterway, water, wetland, farmland, protected) and labels, `MapData`, `WeatherHour`, `WeatherData`. |
| `app/lib/geojson.ts` | `overpassQuery()` and `overpassToGeoJSON()`. Handles validation, tag classification (`classifyEnvironment`), relation ring stitching, and dropping malformed geometry. |
| `app/lib/proximity.ts` | `assessEnvironmentalSensitivity(road, features)`. Uses a local planar distance approximation and returns a level (High/Moderate/Low/Unknown), the nearest distance, and features within 250 m. |
| `app/lib/weather.ts` | `classifyWeatherAttention` (Low/Moderate/Elevated/Insufficient data), `describeWeatherCode`, `describePrecipitation`, `forecastHours` (every 3rd hour, 8 entries). |
| `app/lib/overpass.ts` | `fetchOverpassMapData()` POSTs to overpass-api.de, kumi.systems and private.coffee in parallel and returns the first valid answer. Busy instances (429/5xx) are retried with 2 s, 4 s, 8 s… backoff, all within one 25 s deadline, and a busy message is reported in preference to a bare timeout. `loadMapDataInBrowser()` adds a 15-minute `sessionStorage` cache. `parseMapData()` is also here. |
| `app/api/map-data/route.ts` | Server alternative using the same `fetchOverpassMapData()` (with a User-Agent and a 15-minute in-memory cache). It is **not called by the UI** at present. |
| `app/api/weather/route.ts` | Open-Meteo forecast GET with a 15 s timeout, 10 min success cache, and the next 24 hours from the current hour, in `America/New_York`. |
| `app/globals.css` | Palette CSS variables, Georgia, map/legend/toolbar/forecast/indicator classes. One `@media (max-width: 480px)` block. |
| `scripts/copy-maplibre-worker.mjs` | `postinstall`: copies the MapLibre worker to `public/assets/` (gitignored). |
| `next.config.ts` | `cacheComponents: true`, `partialPrefetching: true`, Tailwind turbopack loader. |

## Data flow
Browser → `RoadSaltDashboard` → Overpass directly (`loadMapDataInBrowser`) and same-origin `/api/weather` → Open-Meteo. Public Overpass instances are often at capacity: expect 502 "request queue is full" or queued requests that never answer, and the resulting busy/timeout message with Retry. MapData GeoJSON → `MapCanvas` props → MapLibre sources. Road click → `selectedRoad` → `assessEnvironmentalSensitivity` + `classifyWeatherAttention` → details panel.

## Environment
No keys required. `NEXT_PUBLIC_MAPTILER_API_KEY` is optional (it switches the basemap to MapTiler). Requires internet for the basemap, Photon, Overpass, Open-Meteo and NWS. Dev server at `http://localhost:3000`.

## Tooling
npm. Scripts: `dev`, `build`, `start`, `lint`, `test` (Node built-in runner over `tests/*.test.ts`). Type check with `npx tsc --noEmit`. Other modules: `validation`, `geocoding`, `open-meteo`, `nws` and `tile-features` in `app/lib/`, and the `/api/geocode` and `/api/observations` routes. See `docs/DATA_SOURCES.md`.

## Development priorities
Core milestone, all implemented in source: real nearby roads and environmental features via Overpass, display on the map, current weather and a 24 h forecast via Open-Meteo, road selection, a compact details panel, and clear failure states. **Remaining work is end-to-end verification against a successful live Overpass response**, plus fixing only what that exposes.

Next potential milestone, **only when the user explicitly requests it:** road risk highlighting. This would flag roads near mapped features combined with relevant weather, and explain on selection why a road was flagged.

Out of scope: salt optimization, elevation, inventory, crew scheduling, auth, AI chat, ML, databases.
