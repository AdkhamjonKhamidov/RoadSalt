# Changelog

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
