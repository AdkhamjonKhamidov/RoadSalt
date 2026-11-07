# RoadSalt developer guide

This project is a small Next.js demo for exploring local roads, weather risk, terrain estimates, and nearby environmental sensitivity in Salisbury, Maryland.

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

- `app/page.tsx` — the main experience and layout for the map, weather bar, and road details panel.
- `app/components/MapCanvas.tsx` — client-side MapLibre map, controls, marker, and future GeoJSON overlay interface.
- `app/components/map-config.ts` — the cached demo coordinates, initial zoom, address, and tile style URL.
- `app/layout.tsx` — app metadata and global document shell.
- `app/globals.css` — theme colors, typography, and core styling.
- `README.md` — public-facing project summary.
- `CHANGELOG.md` — implementation record.
- `docs/DATA_SOURCES.md` — data-source documentation.

## Environment configuration

The current map stage requires no `.env.local` variables, secret, or API key. The public CARTO style URL and cached demo coordinates are configured in `app/components/map-config.ts`. If a later API requires configuration, add only the necessary values to `.env.local` and keep secrets out of source control.

## Map behavior and data sources

The map uses MapLibre GL JS in a client component. It loads a light CARTO Positron style and includes its OSM/CARTO attribution, a location marker and popup, built-in navigation/zoom controls, a reset control, and a compact map key. It supports panning, wheel and double-click zoom, and touch gestures. The map component accepts optional road and environmental GeoJSON features and a road-selection callback for later data stages.

The demo coordinates are cached in `app/components/map-config.ts` following a successful OpenStreetMap Nominatim lookup for:

```text
1101 Camden Ave, Salisbury, MD 21801
```

Changing the location:

1. Geocode the new address with OpenStreetMap Nominatim and check that the returned result matches the intended place.
2. Update `DEMO_LOCATION` and `DEMO_CENTER` in `app/components/map-config.ts`.
3. If geocoding is unavailable, use a clearly documented approximate coordinate for the same address area; do not silently substitute another city.

### Map tile provider

The configured style is `https://basemaps.cartocdn.com/gl/positron-gl-style/style.json`. It is currently available without an API key. Its style supplies OpenStreetMap and CARTO attribution, which MapLibre displays on the map. The map also requires an internet connection to fetch styles, fonts, sprites, and vector tiles.

The MapLibre worker is served from `public/assets/maplibre-gl-worker.mjs`. The `postinstall` script copies the matching worker from the installed MapLibre package so the Next.js bundle can load it reliably. Reinstall dependencies after changing the MapLibre version; the worker is refreshed during installation.

To change providers, update `BASEMAP_STYLE_URL` in `app/components/map-config.ts` to a compatible MapLibre style URL and confirm that the provider's required attribution is present and visible. Follow the provider's terms, rate limits, and caching rules. CARTO's public endpoint is suitable for development and demos; do not treat it as an unrestricted production tile service. Arrange an appropriate production plan or host a permitted tile service for public production traffic.

Other planned sources:

- OpenStreetMap Overpass API for roads, waterways, wetlands, farmland, and environmental features.
- OpenStreetMap Nominatim for the one-time address lookup; the current result is cached in source and is not queried on each page load.
- Open-Meteo Forecast API for weather and precipitation values.
- Open-Meteo Elevation API for elevation samples and terrain incline estimates.

No map API key or environment variable is required for the current stage.

## Demo address and radius

The default demo address is:

```text
1101 Camden Ave, Salisbury, MD 21801
```

The map opens at approximately zoom 14 around that point, showing a few kilometers in each direction. Change `INITIAL_ZOOM` in `app/components/map-config.ts` to adjust the initial map scale.

## Troubleshooting

- If the app does not render, check that dependencies were installed and the dev server is running.
- If a live API fails, confirm network access, API path formatting, and response status.
- If map or weather data seem stale, verify the request timing and whether cached responses are being reused.
- If a feature is missing, review the Overpass query and verify the coordinate radius around the demo address.

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
