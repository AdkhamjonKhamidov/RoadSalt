# RoadSalt developer guide

This project is a small Next.js demo for exploring local roads, forecast weather attention, and nearby mapped environmental sensitivity in Salisbury, Maryland.

## Install and run

1. Open a terminal in the project root.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the local development server:
   ```bash
   npm run dev
   ```
4. Open the local app in your browser. The default development URL is usually:
   ```text
   http://localhost:3000
   ```

## Files to review first

UI (client components):
- `app/page.tsx` — thin route entry that renders `RoadSaltDashboard`.
- `app/components/RoadSaltDashboard.tsx` — selected location, location-scoped data loading (each request tagged with the location key and aborted on change, so older results can't overwrite newer ones), roads and features from the basemap tiles, the 100 m segment breakdown, weather/observation/forecast panels, and road details.
- `app/components/LocationSearch.tsx` — accessible search combobox: 350 ms debounce, 3-character minimum, cancellation, loading/empty/error states, arrow keys, Enter and Escape.
- `app/components/MapCanvas.tsx` — MapLibre map, overlay layers, road selection (6 px click tolerance), flying to the selected location (`focus` prop), and tile extraction after each move.

Data services and parsing (`app/lib/`, framework-free):
- `data-types.ts` — normalized types: `Location`, `RoadProperties`, `EnvironmentalProperties`, `MapData`, `WeatherData`, `ObservationData`.
- `validation.ts` — runtime guards, `lat`/`lon` query validation, `ExpiringCache`.
- `geocoding.ts` — Photon URL, response parser, deduplication, zoom by place type.
- `segments.ts` — splits roads into 100 m pieces (`ROAD_SEGMENT_METERS`) and rates each piece's distance to mapped water, wetland, farmland or protected areas; merges exposed pieces into stretches.
- `cache-db.ts` — server-only persistent cache (`PersistentCache`) on Node's built-in `node:sqlite`, stored in `.data/roadsalt.db` (gitignored), with an in-memory hot layer. Falls back to memory if SQLite can't open.
- `advice.ts` — Gemini context validation, prompt, request body and stream parsing for the treatment approach.
- `tile-features.ts` — roads and features read from the loaded basemap vector tiles.
- `open-meteo.ts` — Open-Meteo URL and parser (optional values stay null).
- `nws.ts` — NWS station, observation and alert parsers.
- `proximity.ts` — approximate road-to-feature distance and sensitivity level; `roadSensitivityLevels()` colours all roads at once (bounding-box prefiltered; forests don't set the level).
- `storm-reports.ts` — NWS Local Storm Report URL, parser and distance filter.
- `plow-feeds.ts` — registry of verified agency plow-status feeds, status categories, parser and staleness.
- `nws-server.ts` — server-only NWS fetch helper and cached point lookup (forecast office and nearest station).
- `units.ts` — °F/°C and US/metric display conversion (data stays metric internally).
- `weather.ts` — weather code labels, precipitation wording, attention rule.
- `demo-config.ts` — default location, zoom, segment length (100 m), thresholds, basemap selection.

API routes (server):
- `app/api/geocode/route.ts` — `GET /api/geocode?q=…[&lat&lon]`, Photon proxy with a 1-hour cache.
- `app/api/weather/route.ts` — `GET /api/weather?lat&lon`, Open-Meteo with a 10-minute per-point cache.
- `app/api/observations/route.ts` — `GET /api/observations?lat&lon`, NWS nearest station plus alerts (US only).
- `app/api/advice/route.ts` — `POST /api/advice`, Gemini treatment approach for one road (NDJSON stream; falls back to no web search if Search grounding has no quota).
- `app/api/cache/route.ts` — `GET /api/cache`, entries, size and hits per cached route (no values).
- `app/api/storm-reports/route.ts` — `GET /api/storm-reports?lat&lon`, NWS Local Storm Reports (72 h, 80 km).
- `app/api/plow-status/route.ts` — `GET /api/plow-status?lat&lon`, registered agency plow feeds covering the point.

Tests: `tests/*.test.ts` (Node's built-in test runner; `tests/register.mjs` resolves extensionless imports).

Docs: `README.md` (public), `CHANGELOG.md`, `PROJECT_HANDOVER.md`, `docs/DATA_SOURCES.md` (endpoints, parsing, caching, limits, attribution).

## Checks

```bash
npm run lint
```
```bash
npx tsc --noEmit
```
```bash
npm test
```
```bash
npm run build
```

`npm test` needs Node 22.18 or newer (built-in TypeScript type stripping). It uses no extra packages. Tests use small synthetic fixtures shaped like real provider responses; these never reach the UI.

## Adding a local plow-status feed

1. Find the agency's public map. ArcGIS "Instant App" and web map pages expose their configuration at `https://www.arcgis.com/sharing/rest/content/items/<appid>/data?f=json`, and the web map's `operationalLayers[].url` is the FeatureServer layer.
2. Open `<layer>?f=json` and note the polyline fields: segment name, status, last-edit date (often `EditDate`) and optionally route, area and miles. Check the status domain values.
3. Get the extent: `<layer>/query?where=1=1&returnExtentOnly=true&outSR=4326&f=json`.
4. Add an entry to `PLOW_FEEDS` in `app/lib/plow-feeds.ts` with the agency name, layer URL, public map URL, extent and field mapping. If the agency's status words aren't recognized by `categorizePlowStatus`, extend it and add a test.
5. Run `npm test`, then search a place inside the extent and choose "Agency plow status".

Only add feeds from official agency sources, and keep their attribution.

## Testing location search and roads by hand

1. Run `npm run dev` and open the app. It starts at 1101 Camden Ave, Salisbury, MD. Roads appear within a few seconds, and the status line shows "OSM map tiles".
2. Type in the search box, for example `Baltimore`, `21801`, `1101 Camden Ave Salisbury` or `Lincoln Memorial`. Suggestions appear after a short pause. Use ↑/↓ and Enter, or click. Escape closes the list, and × clears it.
3. The map flies to the place. The title, weather, NWS station and roads all change to the new location.
4. Click a road. The panel shows its classification and reported condition, the 100 m runoff-exposure strip and stretches, nearby mapped features, and the Gemini treatment approach.
5. Switch to "Environmental proximity" to colour every road by 100 m segment.
6. A location outside the US (for example `London`) shows weather from Open-Meteo, and NWS reports that it covers US locations only.
7. The default view is **Road conditions**. Green means no reported problems, orange means use caution, red means closed, and gray means no condition data. The banner above the map says what is going on and why. Closures need `TOMTOM_API_KEY`.
8. Use "Color roads by" to switch between road type and nearby water, wetland and farmland (red ≤ 50 m, amber ≤ 250 m, teal farther). Search `Leonardtown, MD` and choose "Agency plow status" to see St. Mary's County routes (gray when the county's status is outdated).
9. Use °F/°C in the header; the choice is remembered in this browser. Use Dark/Light to switch the basemap.
10. On a phone-width window, the map key and the report, conditions and forecast panels start collapsed.

## Environment configuration

All variables are optional. With none set, the app runs on keyless public services: the CARTO basemap, Photon, Open-Meteo and the National Weather Service. Put local values in `.env.local`, which is gitignored. Restart `npm run dev` after changing it. `NEXT_PUBLIC_` values are inlined at build time, so rebuild after changing them for production.

| Variable | Purpose | Blank behavior |
|---|---|---|
| `NEXT_PUBLIC_MAPTILER_API_KEY` | MapTiler key for the basemap. It is browser-visible by design, so restrict it to your domains in the MapTiler dashboard. | Uses the CARTO Positron basemap. |
| `TOMTOM_API_KEY` | **Server-only** key for live road closures and hazards (TomTom Traffic Incidents). Create a free key at developer.tomtom.com. Never prefix it with `NEXT_PUBLIC_`. | Closure/hazard colours off; the banner says "not connected" and roads show weather caution only. |
| `GEMINI_API_KEY` | **Server-only** key for the per-road "Treatment approach" suggestion (Gemini Interactions API with Google Search grounding). Create one in Google AI Studio. Never prefix it with `NEXT_PUBLIC_`. Grounded search is billed per search after the free monthly allowance. | The suggestion block says "not connected"; everything else works. |
| `GEMINI_MODEL` | Optional Gemini model ID override. | `gemini-3.5-flash-lite` (fast, supports Search grounding) |
| `NEXT_PUBLIC_MAPTILER_STYLE_ID` | MapTiler map ID, such as `positron`, `dataviz` or `streets-v2`. Used only when a key is set. | `positron` |

The style selection lives in `app/lib/demo-config.ts` (`BASEMAP_PROVIDER`, `BASEMAP_STYLE_URL`). A key or style ID containing characters other than letters, digits, `_` and `-` is ignored, and the CARTO style is used. If MapTiler rejects the key, for example because it's invalid or the domain isn't allowed, the map shows a basemap error that names the variable. Open-Meteo, NWS and Photon need no keys.

## Map behavior and data sources

The map uses MapLibre GL JS in a client component. It loads CARTO Positron and its visible OSM/CARTO attribution, the demo marker, navigation controls, and selectable OSM GeoJSON roads. Environmental overlays are supplied as GeoJSON and can be toggled by type. Basemap roads are not selectable; only the separately queried OSM road geometry is.

The demo coordinates are cached in `app/lib/demo-config.ts` following a successful OpenStreetMap Nominatim lookup for:

```text
1101 Camden Ave, Salisbury, MD 21801
```

Changing the location:

1. Geocode the new address with OpenStreetMap Nominatim and check that the returned result matches the intended place.
2. Update `DEMO_LOCATION` and `DEMO_CENTER` in `app/lib/demo-config.ts`.
3. If geocoding is unavailable, use a clearly documented approximate coordinate for the same address area; do not silently substitute another city.

### Map tile provider

The configured style is `https://basemaps.cartocdn.com/gl/positron-gl-style/style.json`. It is currently available without an API key. Its style supplies OpenStreetMap and CARTO attribution, which MapLibre displays on the map. The map also requires an internet connection to fetch styles, fonts, sprites, and vector tiles. Roads and environmental features are read from the loaded vector tiles after each map move.

The MapLibre worker is served from `public/assets/maplibre-gl-worker.mjs`. The `postinstall` script copies the matching worker from the installed MapLibre package so the Next.js bundle can load it reliably. Reinstall dependencies after changing the MapLibre version; the worker is refreshed during installation.

To change providers, update `BASEMAP_STYLE_URL` in `app/lib/demo-config.ts` to a compatible MapLibre style URL and confirm that required attribution is present and visible. Follow provider terms, rate limits, and caching rules. CARTO's public endpoint is suitable for development and demos, not unrestricted production traffic.

Current integrations:

- OpenStreetMap data in the basemap's vector tiles for roads, waterways, wetlands, farmland, and environmental features.
- OpenStreetMap Nominatim for the one-time address lookup; the current result is cached in source and is not queried on each page load.
- Open-Meteo Forecast API for weather and precipitation values.
- Open-Meteo Elevation API is planned for a later stage.

`/api/weather` fetches current temperature, precipitation and WMO code plus 24 hourly temperature, precipitation probability/amount, and snowfall values. It refreshes/caches for 10 minutes.

The weather attention indicator is `Elevated` when forecast precipitation or snow coincides with freezing air temperature, `Moderate` when precipitation is forecast near freezing (0 to 3 °C), and `Low` otherwise. This is a demo indicator, not a road-surface observation. Environmental sensitivity uses the configurable `high` and `moderate` distance thresholds in `app/lib/demo-config.ts`. Road-to-feature distances use a local planar approximation suitable for this small demo radius; they are not survey measurements. No map data means sensitivity is `Unknown`.

No map API key or environment variable is required. An optional MapTiler basemap can be enabled; see "Environment configuration".

## Demo address and radius

The default demo address is:

```text
1101 Camden Ave, Salisbury, MD 21801
```

The map opens at approximately zoom 14 around that point. This is the default location; users can search for any other place, and it is never replaced by browser geolocation (`DEFAULT_LOCATION` in `app/lib/demo-config.ts`). Adjust `INITIAL_ZOOM` in the same file to change the initial map scale. Environmental proximity levels are controlled by `ENVIRONMENTAL_THRESHOLDS_METERS` there.

## Troubleshooting

- If the app does not render, check that dependencies were installed and the dev server is running.
- If a live API fails, confirm network access, API path formatting, and response status.
- If map or weather data seem stale, verify the request timing and whether cached responses are being reused.
- If roads never load, check that the basemap loaded (a basemap error names the variable to fix). Roads come from its tiles.
- To inspect the cache, open `/api/cache`. To reset it, stop the server and delete `.data/`.
- If an OSM feature is absent, remember local map coverage may be incomplete.
- The map/weather APIs can be retried from the displayed error state; no failure is silently replaced with sample data.

## Deployment

For a basic deployment, use any standard Next.js hosting environment that supports Node.js. Keep the deployment simple and maintain the same public-facing limitations: this is a demo and not an operational decision system.

## GitHub

The GitHub remote is configured as `origin`:

```text
https://github.com/AdkhamjonKhamidov/RoadSalt.git
```

The RoadSalt map implementation is committed locally on `main`. After reviewing the changes, push it to GitHub with:

```bash
git push -u origin main
```

GitHub authentication must be available in your terminal before pushing.

## Notes for future work

- Keep API calls server-side where practical.
- Keep data processing separate from the UI.
- Always label estimates and limitations clearly.
- Never present a road as definitively safe or unsafe without noting the data gaps.
