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
| `app/components/RoadSaltDashboard.tsx` | `"use client"`. Fetches `/api/map-data` and `/api/weather` (AbortController, `refreshKey` for retry). Runtime-parses responses (`parseMapData`, `parseWeatherData`). Owns `selectedRoad` and `visibleKinds` state. Renders the weather bar, forecast strip, `MapStatus`, details panel, and formatting helpers. |
| `app/components/MapCanvas.tsx` | `"use client"`. Owns the MapLibre map: CARTO Positron style, location marker/popup, navigation and reset controls, sources `roadsalt-roads` and `roadsalt-environment`, environment layers, `roadsalt-road-network`, `roadsalt-selected-road`. Layers are inserted below the first label layer. Data updates use `setData`. Click → `onRoadSelect`. A ResizeObserver handles resizing. Listeners, marker and map are removed on cleanup. |
| `app/components/map-config.ts` | Re-exports map settings from `demo-config`. |
| `app/lib/demo-config.ts` | `DEMO_LOCATION`, `DEMO_CENTER` `[lon, lat]`, `INITIAL_ZOOM` 14, `SEARCH_RADIUS_METERS` 3000, `ENVIRONMENTAL_THRESHOLDS_METERS` {high: 50, moderate: 250}, `BASEMAP_STYLE_URL`. |
| `app/lib/data-types.ts` | `RoadProperties`, `EnvironmentalKind` (waterway, water, wetland, farmland, protected) and labels, `MapData`, `WeatherHour`, `WeatherData`. |
| `app/lib/geojson.ts` | `overpassQuery()` and `overpassToGeoJSON()`. Handles validation, tag classification (`classifyEnvironment`), relation ring stitching, and dropping malformed geometry. |
| `app/lib/proximity.ts` | `assessEnvironmentalSensitivity(road, features)`. Uses a local planar distance approximation and returns a level (High/Moderate/Low/Unknown), the nearest distance, and features within 250 m. |
| `app/lib/weather.ts` | `classifyWeatherAttention` (Low/Moderate/Elevated/Insufficient data), `describeWeatherCode`, `describePrecipitation`, `forecastHours` (every 3rd hour, 8 entries). |
| `app/api/map-data/route.ts` | Overpass POST to overpass-api.de with kumi.systems fallback on 429/5xx, a 15 s timeout, and a 15 min success cache. |
| `app/api/weather/route.ts` | Open-Meteo forecast GET with a 15 s timeout, 10 min success cache, and the next 24 hours from the current hour, in `America/New_York`. |
| `app/globals.css` | Palette CSS variables, Georgia, map/legend/toolbar/forecast/indicator classes. One `@media (max-width: 480px)` block. |
| `scripts/copy-maplibre-worker.mjs` | `postinstall`: copies the MapLibre worker to `public/assets/` (gitignored). |
| `next.config.ts` | `cacheComponents: true`, `partialPrefetching: true`, Tailwind turbopack loader. |

## Data flow
Browser → `RoadSaltDashboard` → same-origin `/api/map-data` and `/api/weather` → providers. MapData GeoJSON → `MapCanvas` props → MapLibre sources. Road click → `selectedRoad` → `assessEnvironmentalSensitivity` + `classifyWeatherAttention` → details panel.

## Environment
No env vars and no API keys. Requires internet for CARTO, Overpass and Open-Meteo. Dev server at `http://localhost:3000` (`npm run dev`).

## Tooling
npm. Scripts: `dev`, `build`, `start`, `lint` (ESLint 9 flat config with next core-web-vitals and typescript). Type check with `npx tsc --noEmit`. **There is no test runner and no `test` script.**

## Development priorities
Core milestone, all implemented in source: real nearby roads and environmental features via Overpass, display on the map, current weather and a 24 h forecast via Open-Meteo, road selection, a compact details panel, and clear failure states. **Remaining work is end-to-end verification against a successful live Overpass response**, plus fixing only what that exposes.

Next potential milestone, **only when the user explicitly requests it:** road risk highlighting. This would flag roads near mapped features combined with relevant weather, and explain on selection why a road was flagged.

Out of scope: salt optimization, elevation, inventory, crew scheduling, auth, AI chat, ML, databases.
