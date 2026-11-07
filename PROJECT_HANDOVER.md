# RoadSalt Project Handover

**Updated:** 2026-11-07  
**Implementation status:** Stage 1 and Stage 2 are complete. Stage 3 is implemented in source and partially verified; successful live Overpass data and road selection have not been verified in this environment.

## Project overview

RoadSalt is a lightweight, location-based winter road awareness demo centered on Salisbury, Maryland. It helps road-maintenance staff, environmental stakeholders, and demonstration audiences inspect mapped roads, nearby mapped natural/agricultural features, and forecast weather in one place. The intended hackathon demonstration is to select a real local OSM road and review its classification, nearby mapped features, approximate environmental sensitivity, and weather attention—without prescribing salt use or claiming a road is icy.

Keep the existing map-centered, restrained institutional design. Colors are navy `#112D4E`, blue `#3F72AF`, pale blue `#DBE2EF`, and off-white `#F9F7F7`; typography is Georgia. Prefer clear labels, subtle solid borders, minimal panels, and cautious language. Do not turn this into a generic analytics dashboard.

## Current implementation status

| Area | Status |
|---|---|
| Next.js application and page shell | Implemented with the App Router. `app/page.tsx` renders `RoadSaltDashboard`; `app/layout.tsx` sets metadata and global CSS. |
| Interactive map | Implemented in `MapCanvas` using MapLibre GL JS, CARTO Positron, a Salisbury marker/popup, navigation controls, reset control, attribution, responsive resizing, OSM road selection, and environmental overlays/toggles. |
| Default location | 1101 Camden Ave, Salisbury, MD 21801; cached coordinates `[-75.6070632, 38.34798]`, initial zoom 14. |
| Favicon | Existing `public/assets/favicon.png` is referenced by Next metadata. Its URL returned HTTP 200 with `image/png` during handover inspection. Preserve the user's current image. |
| Overpass road/environment data | Server route, query, validation, conversion, caching, and UI wiring are implemented. The route timed out after 15 seconds in the development environment; real returned features and road-selection details remain unverified. |
| Open-Meteo weather | Server route and weather UI are implemented. A local route check returned 24 hourly values from `Open-Meteo`; the UI includes current conditions and a compact forecast. |
| Environmental assessment | Implemented as approximate geometric proximity to returned mapped features. It does not establish pollution or environmental safety. |
| Elevation / terrain | Not implemented; planned only. |
| Automated tests | No test script is defined in `package.json`. Targeted OSM conversion checks were run during Stage 3 work. |

Stage 3 code checks previously passed: `npm run lint`, `npx tsc --noEmit`, and `npm run build`. A browser check verified the map, marker, attribution, live weather/forecast, environmental layer controls, and a narrow viewport. The Overpass timeout prevented an end-to-end test of actual roads/features. These checks do not establish production availability.

## Technical architecture

- **Stack:** Next.js 16.4.5 App Router, React 19.3, TypeScript 5, Tailwind CSS 4, MapLibre GL JS 6.16.0; npm manifests are `package.json` and `package-lock.json`.
- **Page/UI:** `app/page.tsx` is a thin entry point. `app/components/RoadSaltDashboard.tsx` loads the same-origin API routes, displays weather and errors, and renders selected-road details. `app/components/MapCanvas.tsx` owns the client-side MapLibre instance, GeoJSON layers, road selection, controls, and cleanup.
- **Map configuration:** `app/lib/demo-config.ts` contains the demo address/coordinates, zoom, 3 km search radius, CARTO style URL, and environmental distance thresholds. `app/components/map-config.ts` re-exports map settings.
- **Data modules:** `app/lib/data-types.ts` defines API/GeoJSON types; `geojson.ts` builds the Overpass query, validates and converts OSM geometry; `proximity.ts` estimates road-to-feature distances; `weather.ts` summarizes conditions and classifies weather attention.
- **API routes:** `app/api/map-data/route.ts` calls Overpass; `app/api/weather/route.ts` calls Open-Meteo. Both validate data, share simultaneous requests, cache successful results in process memory, and return errors rather than sample data.
- **Map worker:** `scripts/copy-maplibre-worker.mjs` copies MapLibre's worker into `public/assets` after dependency installation.
- **Styling/docs:** `app/globals.css` holds global and map styling. `README.md` is public-facing; `programmer.md` is the developer guide; `docs/DATA_SOURCES.md` describes providers and limitations; `CHANGELOG.md` records staged changes.
- **Data flow:** Browser dashboard fetches `/api/map-data` and `/api/weather`. Road and environmental GeoJSON feed MapLibre. A selected road is passed to the dashboard, where proximity and weather-attention summaries are computed and displayed.
- **Configuration:** No `.env` variables or API keys are currently required. A working internet connection is required for CARTO assets and public data APIs.

## Data integrations

- **OpenStreetMap / CARTO basemap — implemented:** MapLibre loads `https://basemaps.cartocdn.com/gl/positron-gl-style/style.json`; visible attribution identifies OpenStreetMap contributors and CARTO. The public endpoint needs no key but is for demos/development, not unrestricted production traffic. Follow current provider terms and limits.
- **Nominatim — one-time lookup completed:** The configured address was geocoded and the coordinates are cached in source; page loads do not geocode again.
- **Overpass — implemented, live verification incomplete:** `app/api/map-data/route.ts` posts a 3 km query to `https://overpass-api.de/api/interpreter`, with `https://overpass.kumi.systems/api/interpreter` as a secondary endpoint after server errors or rate limits. Requests time out after 15 seconds; a timeout is surfaced rather than waiting on another timeout. Successful data is cached in process memory for 15 minutes. Queries include selected road classes and tagged waterways, water, wetlands, agricultural land, and protected/nature features. Coverage is incomplete; absence is not evidence of safety.
- **Open-Meteo Forecast — implemented and locally checked:** `https://api.open-meteo.com/v1/forecast` supplies current temperature, precipitation and WMO code plus hourly temperature, precipitation probability/amount, and snowfall for the configured location and `America/New_York`. The route keeps the next 24 hours and caches successes for 10 minutes. Weather attention is a demo forecast indicator, not pavement measurement or confirmation of ice.
- **Open-Meteo Elevation — planned:** No elevation requests or terrain analysis are implemented.

## Important decisions and limitations

- Keep the project simple and map-centered; use actual returned data and never fabricate live values.
- Keep weather attention separate from environmental sensitivity. Environmental sensitivity must not override road safety.
- Never say air temperature confirms road ice, or that mapped proximity proves pollution/runoff. Do not recommend a salt application rate.
- Do not add salt optimization, inventory, crew scheduling, authentication, or AI chat.
- The environmental levels use configurable thresholds in `app/lib/demo-config.ts`: High at 50 m or nearer, Moderate at 250 m or nearer, otherwise Low; no usable mapped feature data yields Unknown. Distances use a local planar approximation, not survey-grade measurements.
- Public endpoints may time out or rate-limit. CARTO's public basemap and public Overpass instances are not guaranteed production services. Successful in-process caches are per server process and are not a persistent/shared cache.
- `README.md` still contains a screenshot placeholder and mentions planned terrain analysis; no terrain integration should be inferred from that text.
- No local changes were made to application behavior to prepare this handover.
- Documentation drift found during the 2026-11-07 Claude Code setup audit was corrected the same day in `programmer.md` and `docs/DATA_SOURCES.md`. One code-level gap remains documented, not changed: `classifyEnvironment` recognises `landcover=wetland`, but the Overpass query does not request `landcover`. Adding it would be an application change and should be weighed against response size and timeouts.

## Claude Code development environment

Added 2026-11-07. Configuration only; no application behavior changed.

- `CLAUDE.md` (root): project rules (identity, conventions, design, data integrity, workflow, scope). It imports `AGENTS.md`.
- `.claude/settings.json`: conservative shared permissions. Lint, type check, build, read-only git and localhost curl are allowed. Installs, commits, pushes, branch changes and `rm` ask first. `.env*` reads, favicon edits, force-push, hard reset, `git clean`, deploy and publish are denied.
- `.claude/skills/`: `roadsalt-context`, `frontend-development`, `mapping-and-geospatial-data`, `external-api-integration`, `environmental-data`, `testing-and-verification`, `documentation-maintenance`, `roadsalt-code-review`.
- `.claude/agents/`: `project-architect`, `frontend-developer`, `mapping-specialist`, `api-integration-specialist`, `environmental-data-reviewer`, `testing-specialist`, `documentation-specialist`.
- `.claude/commands/`: `/project-status`, `/verify-project`, `/review-changes`, `/update-handover`.
- `.claude/launch.json`: `roadsalt-dev` (`npm run dev`, port 3000) for browser-pane verification in the Claude desktop app.
- No hooks and no MCP servers are configured. See `CHANGELOG.md` for the rationale.

## Exact next development step

The requested Stage 3 milestone—connect real OSM roads/environmental features and Open-Meteo weather, show them on the existing map, and support selecting roads with a details panel—is **already implemented in the repository**. Do not rebuild it. Continue by getting a successful Overpass response and verifying actual feature counts, road clicking/selection, feature proximity, retry/error behavior, and mobile layout end-to-end. Fix only issues exposed by that validation. Elevation and other later-stage work remain out of scope unless requested.

## Instructions for the next session

1. Read `PROJECT_HANDOVER.md` first. In Claude Code, `CLAUDE.md` loads automatically; run `/project-status` to orient.
2. Read other project files only as needed to inspect or change the relevant code.
3. Continue from the actual repository and working-tree state; do not rebuild completed features or replace the visual design.
4. Do not change architecture without a strong reason. Keep changes incremental and document them in `CHANGELOG.md`.
5. Run the available lint, TypeScript, and build checks after implementation (`/verify-project`). Add focused tests if appropriate.
6. This repository is on branch `main`, with `origin` set to `https://github.com/AdkhamjonKhamidov/RoadSalt.git`. At inspection time, Stage 3 files and the user-updated favicon were still local changes; inspect `git status` before editing, staging, or pushing. Do not overwrite or revert the favicon.
7. `AGENTS.md` warns that this Next.js version has breaking changes: before editing code, read the relevant guides under `node_modules/next/dist/docs/`.

**Could not verify:** A successful response from either Overpass endpoint, the real returned Salisbury road/environmental feature set, and end-to-end road selection/proximity using that live data. The local Overpass API check timed out; this is a provider/network limitation observed during implementation checks, not proof that the service is always unavailable.
