# RoadSalt

**Winter road conditions, and where road salt could harm nearby water.**

RoadSalt is a map-based tool for road maintenance staff and environmental planners. For any place in the US, it shows live road closures and hazards, current and forecast winter weather, and, for every 100 m of road, how close that stretch sits to mapped waterways, wetlands and farmland that salt runoff can reach. Selecting a road gives its reported condition, its runoff exposure along its length, and an AI-generated treatment approach to review.

![RoadSalt in the Environmental proximity view around the White House, Washington, DC: roads coloured by distance to mapped water, with current weather and the 24-hour forecast in the side panel](public/project%20demo/demo%20screenshot.png)

## The problem

Road salt keeps winter roads passable, but chloride runoff damages streams, wetlands, soil and farmland, and it does not break down. Treatment decisions are usually made from area-wide forecasts, even though one stretch of road may drain straight into a creek while the next does not. That matters especially on Maryland's Eastern Shore, where low-lying roads run beside tidal creeks, marshes and fields.

RoadSalt puts the two questions side by side, road by road:

1. **What is happening on this road?** Live closures and hazards, NWS winter alerts and the forecast.
2. **Where would its salt go?** Distance from each 100 m stretch to mapped water, wetland and farmland.

## What it does

- **Search any US place:** address, city, ZIP code or landmark.
- **Road conditions view:** roads with no reported problems stay a quiet slate blue. Closures (red) and hazards (amber) from TomTom Traffic stand out, along with area-wide caution from NWS winter alerts or forecast freezing precipitation.
- **Environmental proximity view:** every road is split into 100 m segments, and each segment is coloured by its own distance to the nearest mapped waterway, water body, wetland or farmland: within 50 m, within 250 m, or farther.
- **Selected road:** its classification and reported condition, a segment-by-segment runoff exposure strip, the exposed stretches with the nearest feature, and nearby mapped features with distances.
- **Treatment approach (Gemini):** a short, clearly labelled AI suggestion for review, built from the road's live data and exposed stretches (for example anti-icing, pre-wetting, plowing first, extra care beside a named creek). It never gives application rates, and never calls a road icy or safe.
- **Weather and reports:** Open-Meteo current conditions and a 24-hour forecast, the nearest NWS station observation, active NWS alerts, NWS local storm reports, and official agency plow status where a public feed exists (for example St. Mary's County, MD).
- **Usability:** °F/°C switch, light or dark basemap, environmental layer toggles, and layouts for desktop, tablet and phone.

## Hackathon tracks

- **Sustainability & Climate Technology:** targets salt where it is needed and away from Eastern Shore waterways, reducing waste and runoff.
- **Public Systems & Infrastructure:** gives public works staff a road-by-road picture for planning winter maintenance.

## Running it

Requires Node.js 22.18 or newer.

```bash
npm install
npm run dev
```

Then open http://localhost:3000. The app works without any keys. Optional keys go in `.env.local`:

| Variable | Enables |
|---|---|
| `NEXT_PUBLIC_MAPTILER_API_KEY` | MapTiler basemap and the dark style (otherwise CARTO Positron) |
| `TOMTOM_API_KEY` | Live road closures and hazards (server-only) |
| `GEMINI_API_KEY` | The per-road treatment approach (server-only) |

Checks: `npm run lint`, `npm test`, `npm run test:ui` (Playwright, with screenshots) and `npm run build`. Developer notes are in [`programmer.md`](programmer.md).

## Data sources and attribution

- **Roads and environmental features:** © OpenStreetMap contributors (ODbL), read from the basemap's vector tiles (MapTiler or CARTO).
- **Closures and hazards:** TomTom Traffic Incidents.
- **Weather model and forecast:** Open-Meteo (CC BY 4.0).
- **Observations and alerts:** U.S. National Weather Service.
- **Local storm reports:** NWS, via the Iowa Environmental Mesonet.
- **Place search:** Photon (OpenStreetMap).
- **Plow status:** official agency feeds only.
- **Treatment approach:** Google Gemini, with Google Search grounding when available.

## Limitations

- Weather values describe the air, not the pavement. They cannot confirm ice.
- Proximity to mapped features is not proof of runoff. OpenStreetMap coverage is incomplete, so unmapped areas are not necessarily free of water or wetlands.
- Distances are planar approximations, suited to a local map, not survey measurements.
- The treatment approach is AI-generated and is for review only. Follow your agency's winter operations plan and calibrated application rates.
- RoadSalt supports awareness and planning. It is not an operational road-treatment system.
