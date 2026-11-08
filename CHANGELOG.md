# Changelog

## 2026-11-08 — Overpass removed, cache database, 100 m runoff segments

### What changed
- **Removed Overpass** (`overpass.ts`, `geojson.ts`, `/api/map-data`, its tests and UI states) and other unused code: the hidden "Road type" view, `map-config.ts`, `formatLength`, OSM id/tag fields that tiles never provide, and Next.js starter SVGs. Roads and features now come only from the basemap's vector tiles, which the app always used in practice.
- **Persistent cache database:** `PersistentCache` (`app/lib/cache-db.ts`) on Node's built-in `node:sqlite` (no new runtime dependency), `.data/roadsalt.db`, gitignored. It replaces every in-memory route cache (weather, observations, NWS points, incidents, storm reports, plow status, geocoding, Gemini). An in-memory hot layer sits in front, and the cache survives server restarts. `GET /api/cache` shows entries, size and hits per namespace. `@types/node` is now v24 to match the runtime, and `engines.node` is `>=22.18`.
- **100 m road segments:** `app/lib/segments.ts` splits each road into 100 m pieces and rates each one by its own distance to mapped water, wetland, farmland or protected areas (forests excluded, same 50/250 m thresholds). The Environmental proximity view colours the map per segment, and the selected road shows as a navy halo under its segment colours. The panel shows a segment strip, counts per level and the exposed stretches with the nearest feature. Gemini receives the stretches and targets them.
- **Gemini:** the key check now accepts newer AI Studio keys (dots), with a clearer "not set" vs "malformed" message. If Search grounding is refused (429 quota, as on this key), the route retries once without web search and the answer says local news wasn't checked. Verified live: first text in about 0.6 s, full answer in about 1.3 s, no rates.
- Tests: 5 segment unit tests and an updated advice test (43 total). The UI suite (14) adds a cache-database check and the per-segment proximity view.

## 2026-11-07 — Gemini treatment approach per road

### What changed
- **New "Treatment approach" block** under the selected road. `POST /api/advice` sends the road's real context to Gemini (`gemini-3.5-flash-lite` by default, Interactions API, Google Search grounding for current local news): name and class, reported condition and incidents (TomTom/NWS), nearby mapped features with distances (OSM), the current and 24-hour forecast summary (Open-Meteo), the NWS observation, alerts and winter storm reports. Gemini returns a short strategy: Assessment, Suggested approach, Environmental care, Watch for.
- **Responsiveness:** the answer streams into the panel as it's written (NDJSON from the route), the request is aborted when another road is selected, and finished answers are cached per road per hour (instant on repeat clicks; "Regenerate" bypasses the cache).
- **Guardrails:** no numeric application rates (system instruction plus `redactRates`), no "icy" or "safe" claims, labelled AI-generated and for review, web sources listed, and Google's Search Suggestions shown in a sandboxed iframe as the grounding Terms require.
- **Config:** server-only `GEMINI_API_KEY`, optional `GEMINI_MODEL`. Without a key the block says it isn't connected.
- 7 new unit tests (`tests/advice.test.ts`); the road-selection UI test now checks the block.

### Why it changed
- The user asked for an AI-suggested treatment approach on each clicked street, built on live weather, local news and real data. It fits both hackathon tracks: Sustainability (less salt runoff into Eastern Shore waterways) and Public Systems (road maintenance planning).
- **Not yet verified live:** no `GEMINI_API_KEY` was set during development. The streamed event shape is parsed defensively because Google's docs don't confirm where citations appear in the stream.

## 2026-11-07 — GIS-style redesign on the RoadSalt identity

### What changed
- **Audit first.** Screenshots at 1440, 900 and 375 px showed stacked rounded cards, a lost identity (stock blue, system font), marketing copy, all-green roads, map controls in four corners, and a °F/°C toggle orphaned on tablet.
- **Identity restored:** navy, blue, pale blue and off-white with Georgia for the wordmark, headings, place and road names. Dense UI uses a plain sans-serif. Radius is 3 px, and only map controls have shadows.
- **Layout:** a thin navy header (favicon, wordmark, current location, search, units), a full-height map with a status bar, and a 380 px information panel. The panel has flat sections: selected location (address, coordinates, NWS station, time zone), selected road, nearby environmental features (a feature table, or counts in the loaded area), current weather (model and NWS observation), a 24-hour forecast table, alerts and local reports, and data sources with retrieval times and Overpass status/Retry.
- **Map:** one control panel holds the road display (Road conditions / Environmental proximity / Plow status), basemap, legend (including mapped feature types) and layers. New: a **Roads** visibility toggle. Recenter sits under the zoom buttons. "No reported problems" roads are now a quiet slate instead of green. Caution and closed are amber and brick red, and the selected road is navy.
- **Fixed:** the workspace used `flex: 1` (a `0%` basis) inside a container with only a min-height, so it grew to the panel's content height. The map was about 1650 px tall in a 900 px window, with the marker and attribution below the fold.
- Removed the intro card, the stat tiles and the "Is it passable?" / "Where does its salt go?" copy.

### Why it changed
- The user asked for a professional environmental and municipal GIS look on the existing identity, with no generic AI-dashboard patterns.

## 2026-11-07 — Simpler, clearer interface; map layer fixes; browser UI tests

### What changed
- **Redesign for clarity:** a tagline under the name says what RoadSalt is. Before a road is selected, the side panel explains the problem and gives three steps. Selecting a road gives two plain verdicts: "Is it passable?" (TomTom/NWS) and "Where does its salt go?" (mapped water, wetland and farmland nearby). Raw OSM attributes, feature lists and caveats moved behind "More about this road".
- **At a glance:** three tiles for Roads, Weather and Freeze risk. The forecast, weather details and local reports are collapsed sections. The data-source status and Overpass Retry moved to the panel footer.
- **Map:** fills the screen height. A view switch ("Road conditions" / "Salt-sensitive areas" / "Plow status" when a feed exists) and the condition summary float on the map. The "Road type" view was removed from the UI, and the key shows only rows for the current view.
- **Look:** system sans-serif font, white cards, soft shadows and rounded corners replace Georgia and the strict border style (the user lifted those restrictions).
- **Bug fix: roads hidden under the basemap.** Overlays were inserted below the style's first label layer. In MapTiler's style that layer (`water_name`) comes before buildings and roads, so RoadSalt's roads, selection highlight and incident lines were drawn underneath. Overlays now go above the last basemap geometry layer.
- **Bug fix: overlays missing after switching Light/Dark.** `isStyleLoaded()` can still be false at `style.load`, so `updateOverlays` returned early until some other prop changed. The load handlers now pass `styleReady`.
- **Playwright UI tests** (`npm run test:ui`, `e2e/`): 14 tests plus 1 opt-in live Overpass test (`RUN_OVERPASS=1`), with screenshots saved to `e2e/screenshots/`. They block public Overpass by default. New dev dependency: `@playwright/test` (approved by the user).

### Why it changed
- The user asked for full UI testing with screenshots, then for a much simpler interface that makes the project's purpose obvious.
## 2026-11-07 — Simpler, clearer interface; map layer fixes; browser UI tests

### What changed
- **Redesign for clarity:** a tagline under the name says what RoadSalt is. Before a road is selected, the side panel explains the problem and gives three steps. Selecting a road gives two plain verdicts: "Is it passable?" (TomTom/NWS) and "Where does its salt go?" (mapped water, wetland and farmland nearby). Raw OSM attributes, feature lists and caveats moved behind "More about this road".
- **At a glance:** three tiles for Roads, Weather and Freeze risk. The forecast, weather details and local reports are collapsed sections. The data-source status and Overpass Retry moved to the panel footer.
- **Map:** fills the screen height. A view switch ("Road conditions" / "Salt-sensitive areas" / "Plow status" when a feed exists) and the condition summary float on the map. The "Road type" view was removed from the UI, and the key shows only rows for the current view.
- **Look:** system sans-serif font, white cards, soft shadows and rounded corners replace Georgia and the strict border style (the user lifted those restrictions).
- **Bug fix: roads hidden under the basemap.** Overlays were inserted below the style's first label layer. In MapTiler's style that layer (`water_name`) comes before buildings and roads, so RoadSalt's roads, selection highlight and incident lines were drawn underneath. Overlays now go above the last basemap geometry layer.
- **Bug fix: overlays missing after switching Light/Dark.** `isStyleLoaded()` can still be false at `style.load`, so `updateOverlays` returned early until some other prop changed. The load handlers now pass `styleReady`.
- **Playwright UI tests** (`npm run test:ui`, `e2e/`): 14 tests plus 1 opt-in live Overpass test (`RUN_OVERPASS=1`), with screenshots saved to `e2e/screenshots/`. They block public Overpass by default. New dev dependency: `@playwright/test` (approved by the user).

### Why it changed
- The user asked for full UI testing with screenshots, then for a much simpler interface that makes the project's purpose obvious.
## 2026-11-07 — Road conditions view (default), light theme default

### What changed
- **New default view, "Road conditions":** roads are coloured `#B7D894` (no reported problems), `#F1A344` (use caution) or `#E00000` (closed), or gray when no condition data is available. Closures and hazards are drawn along the affected stretch with a white outline, and clicking one shows what, where and until when.
- **Status banner above the map:** one plain sentence on what is going on, for example "Use caution on all roads — Winter Storm Warning in effect", "1 closure and 2 hazards reported nearby", "No closures or hazards reported nearby", or "Closure and hazard reports are not connected".
- **Road details:** a "Current condition" card for the selected road, with the reason (the closure or hazard on that road, or the area-wide cause).
- **Live closures and hazards** come from the TomTom Traffic Incidents API through `/api/incidents`, with a server-only `TOMTOM_API_KEY`. Without a key, the route reports "not configured" and roads are never coloured green.
- **Area-wide caution** comes from NWS winter road alerts or forecast freezing precipitation. Freeze Warnings and Frost Advisories (crop alerts), wind chill and cold alerts are excluded after a live check showed they would wrongly flag every road.
- **Light basemap is the default**; dark is one click away. In the conditions view on the light map, roads get a darker outline so the pale green stays readable.

### Why it changed
- The user asked for a visual product where it's easy to see what is happening on the roads, with green, orange and red condition colours and a light default.

### Files created or modified
- Created: `app/lib/road-conditions.ts`, `app/lib/traffic-incidents.ts`, `app/api/incidents/route.ts`, `tests/road-conditions.test.ts`.
- Modified:
  - `app/components/MapCanvas.tsx`, `app/components/RoadSaltDashboard.tsx`
  - `app/lib/data-types.ts`, `app/lib/demo-config.ts`, `app/lib/proximity.ts` (exports `minimumDistance`)
  - `app/globals.css`
  - `CLAUDE.md`, `programmer.md`, `docs/DATA_SOURCES.md`, `PROJECT_HANDOVER.md`, and this changelog

### API or data-source changes
- New: TomTom Traffic Incidents API v5 (needs `TOMTOM_API_KEY`).

### Tests and checks
- `npm run lint`, `npx tsc --noEmit`, `npm test` (38/38) and `npm run build` passed.
- Browser: the light theme and conditions view are the defaults. With no key, the banner reads "Closure and hazard reports are not connected", and roads are gray with outlines.
- Not verified: a live TomTom response (no key yet), and the orange and red colours on real data (no winter road alert or closure source was active during testing).

## 2026-11-07 — Nationwide road map styled after county snow-route maps

### What changed
- **Look and feel** (using the St. Mary's County MD Public Snow Removal Map as a visual guide):
  - A dark basemap (MapTiler `dataviz-dark`) is now the default, with a Dark/Light switch.
  - Roads are bold, with casings, and wider for major classes.
  - Roads use only three contrasting accents (red-orange, amber, teal) plus white or navy for local roads; the interface palette is unchanged.
- **"Color roads by":**
  - Road type: amber for highways and primary roads, teal for secondary and tertiary, white or navy for local roads.
  - Nearby water, wetland and farmland: computed for every loaded road by `roadSensitivityLevels()`.
  - Agency plow status, where a feed exists.
- **Local reporting:**
  - NWS Local Storm Reports (last 72 h, within about 50 mi; US-wide) through `/api/storm-reports`, listed in a "Local reports" panel and shown as map points.
  - NWS alerts in the same panel.
  - A registry of verified agency plow-status feeds (`app/lib/plow-feeds.ts`, starting with St. Mary's County) through `/api/plow-status`. Status older than 48 h is drawn gray and labelled outdated.
- **Forests:** a new environmental feature type (tiles `landcover` wood/forest; OSM `natural=wood` and `landuse=forest`). Forests are listed but don't set the sensitivity level.
- **Units:** °F is the default, with a °F/°C switch remembered per browser. Wind is in mph, precipitation in inches and distances in ft/mi, or metric when °C is chosen (`app/lib/units.ts`).
- **Mobile:**
  - The map takes 62 % of the screen height, and the map key starts collapsed.
  - Report, conditions and forecast panels collapse to one-line summaries.
  - Road tags and long remarks are hidden, and the toolbar is smaller.
- **NWS refactor:** a shared server helper (`app/lib/nws-server.ts`) handles the cached point lookup of forecast office and nearest station. The observation "older than 2 hours" flag is now computed on the server.

### Why it changed
- The user asked for a snow-route-style map that works anywhere in the US: clearer roads, local reporting, farmland and other features, °F by default and a simpler mobile view.
- No national plow-status dataset exists, so the app colors roads by data that exists nationwide and adds agency plow status only where an agency publishes it.

### Files created or modified
- Created:
  - `app/lib/units.ts`, `app/lib/storm-reports.ts`, `app/lib/plow-feeds.ts`, `app/lib/nws-server.ts`
  - `app/api/storm-reports/route.ts`, `app/api/plow-status/route.ts`
  - `tests/local-reporting.test.ts`
- Modified:
  - `app/components/MapCanvas.tsx` (rewritten), `app/components/RoadSaltDashboard.tsx` (rewritten)
  - `app/lib/data-types.ts`, `app/lib/demo-config.ts`, `app/lib/geojson.ts`, `app/lib/tile-features.ts`, `app/lib/proximity.ts`, `app/lib/nws.ts`
  - `app/api/observations/route.ts`, `app/globals.css`
  - `CLAUDE.md`, `programmer.md`, `docs/DATA_SOURCES.md`, `PROJECT_HANDOVER.md`, and this changelog

### API or data-source changes
- New: the Iowa Environmental Mesonet LSR GeoJSON endpoint and the St. Mary's County ArcGIS FeatureServer.
- New: MapTiler `dataviz-dark` style.
- Overpass now also requests `natural=wood` and `landuse=forest`.

### Tests and checks
- `npm run lint`, `npx tsc --noEmit`, `npm test` (32/32) and `npm run build` passed.
- Routes, live:
  - Storm reports: Salisbury (AKQ, 0 reports), Minneapolis (MPX, 0) and Martinsdale, MT (BYZ, 4 real reports). London → 404 message.
  - Plow status: Leonardtown → St. Mary's feed (572 segments); Salisbury → none.
  - Observations: St. Mary's → K2W6 St Marys County Airport.
- Browser:
  - The dark map shows bold amber, teal and white roads in Salisbury, and °F is the default (51 °F; the °C switch shows 10 °C and is remembered).
  - In Leonardtown, the plow-status option is enabled and the county routes show gray as outdated (last county update March 2, 2026).
  - At 375 px there's no horizontal scroll, the map key and panels start collapsed, and the map dominates the screen.
- Not verified: an active winter storm (no winter reports or fresh plow status existed during testing) and a successful Overpass load.

## 2026-11-07 — Location search, location-scoped real data, parsing layer, tests

### What changed
- **Location search:** a new `LocationSearch` combobox calls `/api/geocode`, which proxies Photon (OpenStreetMap).
  - Typing is debounced by 350 ms, with a 3-character minimum, and superseded requests are cancelled.
  - It has loading, empty and error states, keyboard support (↑/↓, Enter, Escape) and a clear button.
  - Results show name, locality, region and country, and carry Photon attribution.
- **Selected location drives everything:** the map flies there with a zoom chosen by place type. Roads, features, Open-Meteo weather and the NWS station all follow it. Requests are tagged with the location and aborted on change, so older results can't overwrite newer ones. The default stays 1101 Camden Ave and is never replaced by browser geolocation.
- **Two road and feature sources:**
  - Basemap vector tiles (`app/lib/tile-features.ts`) give immediate named roads and mapped features.
  - Overpass gives detail: OSM way IDs, tags, unnamed and service roads. When Overpass succeeds, its data replaces the tile data for that location.
- **Parsing layer:** new `validation.ts`, `geocoding.ts`, `open-meteo.ts` and `nws.ts`, plus an extended `geojson.ts`. The changes:
  - **Overpass:** roads keep `osmId`, `ref` and whitelisted `tags`, and features get a `subtype`. Classes added: motorway, trunk, living_street and service; driveways and parking aisles are excluded. Duplicate elements are removed. Cultural protections (historic districts) are no longer classed as environmental.
  - **Open-Meteo:** adds apparent temperature, humidity and wind, plus `timezone=auto`. Missing optional values stay null.
  - **Shared rules:** malformed data is dropped, never repaired.
- **Routes are now location-aware:** `/api/weather`, `/api/observations` (nearest NWS station via `/points`) and `/api/map-data` take `lat`/`lon`. Each has validation, a per-point cache and request sharing.
- **UI:**
  - Separate sections for road attributes, nearby mapped features and local weather. Unnamed roads are labelled by class or ref.
  - Current conditions (model), observed now (NWS) and the forecast are clearly separated.
  - Roads are drawn in navy and the selected road in bold blue.
- **Tests:** `npm test` runs 26 tests with Node's built-in runner (`tests/`), with no new dependencies.
- **`.claude/launch.json`:** added `roadsalt-attach` to attach to a running dev server.

### Why it changed
- To deliver the real-data milestone: search any place and explore its real roads, features and weather reliably, even while public Overpass instances are overloaded.

### Files created or modified
- Created:
  - `app/components/LocationSearch.tsx`
  - `app/api/geocode/route.ts`
  - `app/lib/validation.ts`, `app/lib/geocoding.ts`, `app/lib/open-meteo.ts`, `app/lib/nws.ts`, `app/lib/tile-features.ts`
  - `app/api/observations/route.ts`
  - `tests/register.mjs` and four `tests/*.test.ts`
- Modified:
  - `app/components/RoadSaltDashboard.tsx` (rewritten), `app/components/MapCanvas.tsx`
  - `app/lib/data-types.ts`, `app/lib/demo-config.ts`, `app/lib/geojson.ts`, `app/lib/overpass.ts`
  - `app/api/weather/route.ts`, `app/api/map-data/route.ts`
  - `app/globals.css`, `package.json` (`test` script), `.claude/launch.json`
  - `programmer.md`, `docs/DATA_SOURCES.md`, `PROJECT_HANDOVER.md`, `CLAUDE.md`, the `roadsalt-context` and `testing-and-verification` skills, and this changelog

### API or data-source changes
- New: Photon geocoding, and NWS (observations and alerts) for any US point.
- Open-Meteo now receives the selected point with `timezone=auto`.
- The Overpass query box is now ±2 km (was ±3 km) because service roads are included.
- No keys are required.

### Tests and checks
- `npm run lint`, `npx tsc --noEmit`, `npm test` (26/26) and `npm run build` passed.
- Route checks against live services: geocode (Baltimore, 21801, Camden Ave), weather (Baltimore), observations (Baltimore → KDMH), London → NWS 404 message, invalid coordinates → 400, short query → 400.
- Browser checks (in-app browser, live data):
  - Default Salisbury: 293 tile roads, weather and KSBY.
  - Search "Baltimore": suggestions, keyboard selection, map fly-to, 533 roads, weather and KDMH.
  - Selecting East Baltimore Street filled the details panel.
  - Rapid Annapolis → airport selection kept only the newest location.
  - ZIP "21801" suggestions worked.
  - The "Detailed OSM data unavailable / Retry" state appeared because Overpass was at capacity.
- Not verified: a successful Overpass load (public instances were overloaded) and the mobile layout with the new header.

## 2026-11-07 — Load OSM data in the browser, with backoff

### What changed
- New `app/lib/overpass.ts` with `fetchOverpassMapData()`, shared by browser and server. It queries overpass-api.de, overpass.kumi.systems and overpass.private.coffee in parallel and keeps the first valid answer. Busy instances (429/5xx) are retried with exponential backoff within one 25-second deadline. A "servers are busy" message is reported in preference to a bare timeout.
- `RoadSaltDashboard` now loads OSM data directly in the browser via `loadMapDataInBrowser()`, with a 15-minute `sessionStorage` cache that Retry bypasses. `parseMapData` moved into `overpass.ts`.
- `/api/map-data` now uses the shared function. It is kept but not called by the UI.
- Updated `CLAUDE.md` and the `roadsalt-context` and `external-api-integration` skills to record the approved browser-direct exception.

### Why it changed
- The server path kept timing out. A browser check then showed the actual cause: overpass-api.de returned HTTP 502 "server is currently at capacity… request queue is full" and asked for exponential backoff. The user approved loading map data from the browser.

### Files created or modified
- Created `app/lib/overpass.ts`.
- Modified `app/components/RoadSaltDashboard.tsx`, `app/api/map-data/route.ts`, `CLAUDE.md`, `.claude/skills/roadsalt-context/SKILL.md`, `.claude/skills/external-api-integration/SKILL.md`, `programmer.md`, `docs/DATA_SOURCES.md`, `PROJECT_HANDOVER.md`, and this changelog.

### API or data-source changes
- Overpass is called from the browser (CORS). A third public instance was added. No API keys are involved.

### Tests and checks
- `npm run lint`, `npx tsc --noEmit` and `npm run build` passed.
- In-app browser: overpass-api.de answered 502 "at capacity" once. On the final load, all three instances queued without answering within 25 seconds, and the UI showed the timeout message with Retry and no sample data.
- Not verified: a successful live load, road selection and the details panel with real features, because the public instances were overloaded during testing.

## 2026-11-07 — Lighter Overpass query

### What changed
- `overpassQuery` now uses one global `[bbox:…]` (new `boundingBox()` helper, ±3 km) instead of 17 per-statement `around` circle filters. Way and relation statements are combined with `wr[...]`, and output uses `out geom qt`.
- Service roads (`highway=service`) are no longer queried or converted. Road classes are defined once as `ROAD_CLASSES`.

### Why it changed
- The `/api/map-data` route was timing out. A bbox filter is much cheaper for Overpass, and service roads dominated the response size.

### Files created or modified
- Modified `app/lib/geojson.ts`, `app/api/map-data/route.ts`, `docs/DATA_SOURCES.md`, `PROJECT_HANDOVER.md`, `.claude/skills/mapping-and-geospatial-data/SKILL.md`, and this changelog.

### API or data-source changes
- The search area is now an approximately 6 × 6 km box rather than a 3 km circle. Service roads are excluded.

- `app/api/map-data/route.ts` now queries both Overpass instances in parallel under one 25-second deadline and keeps the first valid response. Previously a timeout on the first instance failed the request without trying the second. It also logs each instance's failure reason (`[map-data] …`). The server-side query timeout was raised to 20 seconds.

### Tests and checks
- `npm run lint` and `npx tsc --noEmit` passed.
- Live check: `/api/map-data` returned HTTP 504 after 25 seconds, and the log showed no response from either instance. Direct Node checks on the machine: TCP and TLS to both Overpass hosts succeed in about 0.25 seconds, but even `/api/status` gets no HTTP response, while Open-Meteo answers normally. The query code is not the cause (see `PROJECT_HANDOVER.md`). Live road data is still unverified.

## 2026-11-07 — Optional MapTiler basemap configuration

### What changed
- `app/lib/demo-config.ts` now selects the basemap from `NEXT_PUBLIC_MAPTILER_API_KEY` and `NEXT_PUBLIC_MAPTILER_STYLE_ID`. A blank or invalid key keeps the existing keyless CARTO Positron style. It also exports `BASEMAP_PROVIDER`.
- The map's basemap error message names the MapTiler key when MapTiler is the active provider.
- Added a blank `.env.local` (gitignored). `.gitignore` now un-ignores `.env.example` so a template can be committed.

### Why it changed
- To allow a keyed basemap provider without breaking the keyless demo.

### Files created or modified
- Modified `app/lib/demo-config.ts`, `app/components/map-config.ts`, `app/components/MapCanvas.tsx`, `.gitignore`, `programmer.md`, `docs/DATA_SOURCES.md`, and this changelog.

### API or data-source changes
- Optional MapTiler style endpoint. No change to Overpass or Open-Meteo.

### Tests and checks
- `npm run lint`, `npx tsc --noEmit` and `npm run build` passed.
- Browser check with a blank key: the map requested only CARTO hosts, the basemap rendered, and live weather displayed.
- Not verified: rendering with a real MapTiler key (no key available).

## 2026-11-07 — Claude Code development environment

### What changed
- Added root `CLAUDE.md` with project rules. It imports `AGENTS.md` so the Next.js version warning stays in context.
- Added `.claude/settings.json` (conservative permissions), 8 project skills, 7 subagents, 4 slash commands (`/project-status`, `/verify-project`, `/review-changes`, `/update-handover`), and `.claude/launch.json` for the dev server.
- Ignored `.claude/settings.local.json` in `.gitignore`.
- Recorded the Claude Code setup in `PROJECT_HANDOVER.md`.
- Corrected documentation drift found during the audit:
  - `programmer.md` no longer mentions terrain estimates and now describes `app/page.tsx` as a thin entry.
  - `docs/DATA_SOURCES.md` no longer claims paths are queried, and it now notes that `landcover=wetland` is not requested.

### Why it changed
- Future sessions can start from documented architecture, data-integrity rules and verification workflows instead of rediscovering the codebase.
- No hooks were added. The required checks are fast to run explicitly via `/verify-project`, and favicon protection is handled by a permission deny rule, which is simpler and safer than a hook.
- No MCP servers were added. The built-in browser pane in the Claude desktop app covers UI verification.

### Files created or modified
- Created `CLAUDE.md`, `.claude/settings.json`, `.claude/launch.json`, `.claude/agents/*.md`, `.claude/skills/*/SKILL.md`, `.claude/commands/*.md`.
- Modified `PROJECT_HANDOVER.md`, `programmer.md`, `docs/DATA_SOURCES.md`, `.gitignore`, and this changelog.

### API or data-source changes
- None. No application code changed.

### Tests and checks
- JSON validity and agent/skill/command frontmatter checked with a script. Application lint/type/build were not affected by this change.

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
