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

- `app/page.tsx` — thin route entry that renders `RoadSaltDashboard`.
- `app/components/MapCanvas.tsx` — client-side MapLibre map, controls, GeoJSON layers, and road selection.
- `app/components/RoadSaltDashboard.tsx` — data loading, weather summary, map-layer controls, and selected-road details.
- `app/components/map-config.ts` — re-exports shared map configuration for the client map.
- `app/lib/demo-config.ts` — central demo coordinates, 3 km radius, map zoom, and environmental distance thresholds.
- `app/lib/geojson.ts` — Overpass parsing and OSM way/relation conversion.
- `app/lib/proximity.ts` — approximate road-to-feature distance and sensitivity classification.
- `app/lib/weather.ts` — weather code labels, precipitation status, and attention rules.
- `app/api/map-data/route.ts` — cached server-side Overpass request.
- `app/api/weather/route.ts` — cached server-side Open-Meteo request.
- `app/layout.tsx` — app metadata and global document shell.
- `app/globals.css` — theme colors, typography, and core styling.
- `README.md` — public-facing project summary.
- `CHANGELOG.md` — implementation record.
- `docs/DATA_SOURCES.md` — data-source documentation.

## Environment configuration

The map, Overpass, and Open-Meteo integrations require no `.env.local` variables, secret, or API key. The basemap style and demo data configuration are in `app/lib/demo-config.ts`.

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

No map API key or environment variable is required.

## Demo address and radius

The default demo address is:

```text
1101 Camden Ave, Salisbury, MD 21801
```

The map opens at approximately zoom 14 around that point. The Overpass query radius is configured by `SEARCH_RADIUS_METERS` in `app/lib/demo-config.ts` (default 3,000 m). Adjust `INITIAL_ZOOM` in the same file to change the initial map scale. Environmental proximity levels are controlled by `ENVIRONMENTAL_THRESHOLDS_METERS` there.

## Troubleshooting

- If the app does not render, check that dependencies were installed and the dev server is running.
- If a live API fails, confirm network access, API path formatting, and response status.
- If map or weather data seem stale, verify the request timing and whether cached responses are being reused.
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
