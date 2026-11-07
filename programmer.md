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
- `app/components/RoadSaltDashboard.tsx` — selected location, location-scoped data loading (each request tagged with the location key and aborted on change, so older results can't overwrite newer ones), map data source choice (Overpass detail over tile data), weather/observation/forecast panels, and road details.
- `app/components/LocationSearch.tsx` — accessible search combobox: 350 ms debounce, 3-character minimum, cancellation, loading/empty/error states, arrow keys, Enter and Escape.
- `app/components/MapCanvas.tsx` — MapLibre map, overlay layers, road selection (6 px click tolerance), flying to the selected location (`focus` prop), and tile extraction after each move.

Data services and parsing (`app/lib/`, framework-free):
- `data-types.ts` — normalized types: `Location`, `RoadProperties`, `EnvironmentalProperties`, `MapData`, `WeatherData`, `ObservationData`.
- `validation.ts` — runtime guards, `lat`/`lon` query validation, `ExpiringCache`.
- `geocoding.ts` — Photon URL, response parser, deduplication, zoom by place type.
- `geojson.ts` — Overpass query (bbox) and OSM → GeoJSON normalization (IDs, tags, subtypes, dedup, drops malformed geometry).
- `overpass.ts` — Overpass fetching: parallel instances, backoff, 25 s deadline, per-location `sessionStorage` cache.
- `tile-features.ts` — roads and features read from the loaded basemap vector tiles.
- `open-meteo.ts` — Open-Meteo URL and parser (optional values stay null).
- `nws.ts` — NWS station, observation and alert parsers.
- `proximity.ts` — approximate road-to-feature distance and sensitivity level.
- `weather.ts` — weather code labels, precipitation wording, attention rule.
- `demo-config.ts` — default location, zoom, Overpass radius (2 km), thresholds, basemap selection.

API routes (server):
- `app/api/geocode/route.ts` — `GET /api/geocode?q=…[&lat&lon]`, Photon proxy with a 1-hour cache.
- `app/api/weather/route.ts` — `GET /api/weather?lat&lon`, Open-Meteo with a 10-minute per-point cache.
- `app/api/observations/route.ts` — `GET /api/observations?lat&lon`, NWS nearest station plus alerts (US only).
- `app/api/map-data/route.ts` — `GET /api/map-data?lat&lon`, server-side Overpass alternative (not used by the UI).

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

## Testing location search and roads by hand

1. Run `npm run dev` and open the app. It starts at 1101 Camden Ave, Salisbury, MD. Roads appear within a few seconds, and the status line shows "OSM map tiles".
2. Type in the search box, for example `Baltimore`, `21801`, `1101 Camden Ave Salisbury` or `Lincoln Memorial`. Suggestions appear after a short pause. Use ↑/↓ and Enter, or click. Escape closes the list, and × clears it.
3. The map flies to the place. The title, weather, NWS station and roads all change to the new location.
4. Click a road line (navy). The panel shows its OSM attributes, nearby mapped features and local weather. With Overpass detail loaded, it also shows the OSM way ID (linked), tags, and unnamed or service roads.
5. If "Detailed OSM data unavailable" appears, public Overpass servers are busy. The tile data stays usable; press Retry later.
6. A location outside the US (for example `London`) shows weather from Open-Meteo, and NWS reports that it covers US locations only.

## Environment configuration

All variables are optional. With none set, the app runs on keyless public services: the CARTO basemap, Photon, Overpass, Open-Meteo and the National Weather Service. Put local values in `.env.local`, which is gitignored. Restart `npm run dev` after changing it. `NEXT_PUBLIC_` values are inlined at build time, so rebuild after changing them for production.

| Variable | Purpose | Blank behavior |
|---|---|---|
| `NEXT_PUBLIC_MAPTILER_API_KEY` | MapTiler key for the basemap. It is browser-visible by design, so restrict it to your domains in the MapTiler dashboard. | Uses the CARTO Positron basemap. |
| `NEXT_PUBLIC_MAPTILER_STYLE_ID` | MapTiler map ID, such as `positron`, `dataviz` or `streets-v2`. Used only when a key is set. | `positron` |

The style selection lives in `app/lib/demo-config.ts` (`BASEMAP_PROVIDER`, `BASEMAP_STYLE_URL`). A key or style ID containing characters other than letters, digits, `_` and `-` is ignored, and the CARTO style is used. If MapTiler rejects the key, for example because it's invalid or the domain isn't allowed, the map shows a basemap error that names the variable. Overpass and Open-Meteo need no keys.

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

The configured style is `https://basemaps.cartocdn.com/gl/positron-gl-style/style.json`. It is currently available without an API key. Its style supplies OpenStreetMap and CARTO attribution, which MapLibre displays on the map. The map also requires an internet connection to fetch styles, fonts, sprites, and vector tiles. `/api/map-data` queries Overpass for roads and environmental features within `SEARCH_RADIUS_METERS`; successful results are cached in server memory for 15 minutes. A second public Overpass instance is tried after rate limiting or an HTTP service error. A timeout is reported without waiting for a second timeout.

The MapLibre worker is served from `public/assets/maplibre-gl-worker.mjs`. The `postinstall` script copies the matching worker from the installed MapLibre package so the Next.js bundle can load it reliably. Reinstall dependencies after changing the MapLibre version; the worker is refreshed during installation.

To change providers, update `BASEMAP_STYLE_URL` in `app/lib/demo-config.ts` to a compatible MapLibre style URL and confirm that required attribution is present and visible. Follow provider terms, rate limits, and caching rules. CARTO's public endpoint is suitable for development and demos, not unrestricted production traffic.

Current integrations:

- OpenStreetMap Overpass API for roads, waterways, wetlands, farmland, and environmental features.
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

The map opens at approximately zoom 14 around that point. This is the default location; users can search for any other place, and it is never replaced by browser geolocation (`DEFAULT_LOCATION` in `app/lib/demo-config.ts`). The Overpass query box extends `SEARCH_RADIUS_METERS` (default 2,000 m) around the selected location. Adjust `INITIAL_ZOOM` in the same file to change the initial map scale. Environmental proximity levels are controlled by `ENVIRONMENTAL_THRESHOLDS_METERS` there.

## Troubleshooting

- If the app does not render, check that dependencies were installed and the dev server is running.
- If a live API fails, confirm network access, API path formatting, and response status.
- If map or weather data seem stale, verify the request timing and whether cached responses are being reused.
- If roads never load, open the browser console and look for `[map-data]` lines. "Busy (HTTP 502)" or "no response within 25s" means the public Overpass instances are at capacity. Wait a few minutes and press Retry; the code already backs off and tries three instances.
- If Overpass is unavailable or rate-limited, the map remains usable with CARTO basemap tiles; an error and retry option are shown instead of fabricated features.
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
