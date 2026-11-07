# Changelog

## 2026-11-07 — Stage 3: Live map and weather data

### What changed
- Added a server-cached OpenStreetMap Overpass route scoped to the configurable 3 km Salisbury demo radius.
- Converted validated road ways and environmental ways/relations to GeoJSON, including mapped names and road classifications.
- Added selectable OSM road overlays, environmental feature styling, a layer visibility menu, and a details panel with approximate nearest-feature proximity.
- Added a server-cached Open-Meteo route for current conditions and the next 24 forecast hours.
- Added local weather summaries and cautious weather-attention indicators, explicitly distinguishing air and pavement temperature.
- Updated the developer/data-source documentation to distinguish active integrations from planned elevation work.

### Why it changed
- Stage 3 connects the map to real local OSM geometry and forecast data while keeping limitations visible and avoiding fabricated features or treatment advice.

### Files created or modified
- Created `app/lib/demo-config.ts`, `app/lib/data-types.ts`, `app/lib/geojson.ts`, `app/lib/proximity.ts`, `app/lib/weather.ts`, `app/api/map-data/route.ts`, `app/api/weather/route.ts`, and `app/components/RoadSaltDashboard.tsx`.
- Modified `app/components/MapCanvas.tsx`, `app/components/map-config.ts`, `app/page.tsx`, `app/globals.css`, `README.md`, `programmer.md`, and `docs/DATA_SOURCES.md`.
- Updated this changelog.

### API or data-source changes
- Overpass requests nearby tagged roads, waterways, water, wetlands, agriculture, and protected/nature features. Successful results are cached in server memory for 15 minutes; a secondary public endpoint is tried on rate limiting or service errors.
- Open-Meteo returns current temperature/precipitation/weather code and hourly temperature/probability/precipitation/snowfall for 24 hours. Successful results are cached for 10 minutes.
- No keys, environment variables, or new package dependencies are required.

### Tests and checks
- `npm run lint` passed.
- `npx tsc --noEmit` passed.
- `npm run build` passed.
- Targeted OSM conversion checks passed for road/environment feature conversion, malformed geometry rejection, and the 3 km query radius.
- Local browser checks confirmed the interactive MapLibre map, Salisbury marker, visible attribution, live Open-Meteo conditions and 24-hour forecast, and environmental layer controls.
- The Overpass route returned a retryable timeout after 15 seconds because the primary public service was unavailable from the development environment; no road or environmental data was fabricated.

### Known limitations
- Public Overpass instances were unreachable from the development environment during implementation checks; the app reports this as a retryable API error and does not fabricate map features. The request now stops after a single timeout instead of waiting on the backup as well. CARTO basemap remains independent.
- OSM coverage is incomplete; absence of a mapped feature is not evidence that an area is environmentally safe.
- Proximity uses a local planar calculation and demo thresholds, not engineering/survey distances. Weather categories do not represent pavement temperature or confirm ice.
- Open-Meteo Elevation remains out of scope for this stage.

## 2026-11-07 — Stage 2: Interactive map

### What changed
- Replaced the illustrative map with a responsive MapLibre GL JS map using the CARTO Positron basemap.
- Added the cached geocoded Salisbury demo coordinates, visible location marker and popup, navigation controls, reset control, and a map key that marks future layers as not yet available.
- Added a reusable GeoJSON map interface for future roads, environmental features, selected-road state, risk categories, and road-selection callbacks.
- Added a post-install copy of MapLibre's matching worker bundle so it loads correctly in Next.js/Turbopack.
- Removed sample weather and road-risk claims from the current interface.
- Configured the supplied PNG as the application icon and removed the starter favicon conflict.

### Why it changed
- Stage 2 requires a real interactive map while preserving the existing RoadSalt layout and avoiding invented risk or environmental data.

### Files created or modified
- Created `app/components/MapCanvas.tsx`, `app/components/map-config.ts`, and `scripts/copy-maplibre-worker.mjs`.
- Modified `.gitignore`, `eslint.config.mjs`, `app/page.tsx`, `app/layout.tsx`, `app/globals.css`, `programmer.md`, `README.md`, and `docs/DATA_SOURCES.md`.
- Configured the existing `public/assets/favicon.png` through Next.js metadata.
- Removed the generated `app/favicon.ico` and unused illustrative map graphic so they do not conflict with the supplied icon or suggest static map data.
- Updated `package.json` and `package-lock.json` with MapLibre GL JS and its worker copy script.

### Map provider and attribution
- MapLibre GL JS renders the CARTO Positron style at `https://basemaps.cartocdn.com/gl/positron-gl-style/style.json`.
- The style's visible attribution identifies OpenStreetMap contributors and CARTO.
- No API key is required. CARTO's public endpoint is for demos/development, not unrestricted production use; follow provider terms and rate limits.

### Configuration required
- None for this stage. The demo address and cached Nominatim coordinates are in `app/components/map-config.ts`.

### Tests and checks
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`
- Local browser checks: CARTO style and vector tiles returned HTTP 200; navigation, wheel zoom, double-click zoom, drag pan, reset, marker/popup, attribution, and a narrow viewport were verified.
- The worker bundle and supplied favicon returned HTTP 200 from the local app.

### Known limitations
- This stage has no selectable RoadSalt road geometry, environmental overlays, live weather, or road-attention data. Basemap road lines are not presented as selected roads.

## 2026-11-07

### What changed
- Initialized a new Next.js App Router project for the RoadSalt demo.
- Built the first-stage interface to reflect the required institutional visual style.
- Added the public README and developer handover documentation.
- Added a dedicated data-sources reference file.

### Why it changed
- The project needed a clean, maintainable starting point and a visible design direction before connecting live data.
- The design must match the requested minimal, trustworthy, weather-focused information hierarchy.

### Files created or modified
- `app/layout.tsx`
- `app/page.tsx`
- `app/globals.css`
- `README.md`
- `programmer.md`
- `docs/DATA_SOURCES.md`

### API or data-source changes
- No live external APIs were connected in this stage.

### Checks performed
- `npm run build`

### Known limitations
- This is a visual and structural foundation only; it does not yet load real road or weather data.
