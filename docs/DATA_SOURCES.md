# Data sources

RoadSalt uses only public, real-world data. Every provider is called with a timeout. Every response is validated and normalized in `app/lib/` before the UI sees it, and a failure is shown as unavailable, never replaced with sample data. All location-dependent data follows the **selected location**, which defaults to 1101 Camden Ave, Salisbury, MD 21801.

| Provider | Used for | Called from | Key |
|---|---|---|---|
| Photon (OpenStreetMap) | Location search / autocomplete | Server route `/api/geocode` | None |
| MapTiler or CARTO vector tiles (OpenStreetMap) | Basemap; roads and features shown immediately | Browser (MapLibre) | MapTiler: optional public key |
| OpenStreetMap Overpass API | Detailed roads and features (OSM IDs, tags, unnamed and service roads) | Browser (`app/lib/overpass.ts`) | None |
| Open-Meteo Forecast | Current conditions and 24-hour forecast | Server route `/api/weather` | None |
| National Weather Service (api.weather.gov) | Measured station observations and active alerts (US only) | Server route `/api/observations` | None |
| NWS Local Storm Reports via Iowa Environmental Mesonet | Spotter, public and mesonet storm reports near the location (US) | Server route `/api/storm-reports` | None |
| Local agency plow-status feeds (ArcGIS) | Plow / treatment status where an agency publishes it | Server route `/api/plow-status` | None |
| TomTom Traffic Incidents API v5 | Live road closures and hazards (US) | Server route `/api/incidents` | `TOMTOM_API_KEY` (server-only, free tier) |

## Normalized data structures (`app/lib/data-types.ts`)

- **Location:** `id`, `name`, `displayName`, `latitude`, `longitude`, `boundingBox` (`[west, south, east, north]` or null), `locality`, `region`, `country`, `placeType`, `source`.
- **Road** (GeoJSON feature properties, `RoadProperties`):
  - `roadId`: `way/<id>` from Overpass, or `tile:<class>:<name>` from tiles.
  - `osmId`: null for tile data.
  - `name`, `classification` (OSM highway value), `ref`.
  - `tags`: a whitelist of highway, name, ref, service, surface, lanes, maxspeed, oneway, bridge, tunnel, lit and sidewalk.
  - Geometry is a GeoJSON `LineString` or `MultiLineString` in `[lon, lat]`.
- **EnvironmentalFeature** (`EnvironmentalProperties`):
  - `featureId`, `osmId`, `name`.
  - `kind`: waterway, water, wetland, farmland, forest or protected.
  - `subtype`: for example stream, river, pond, marsh or farmland.
  - Geometry is a LineString or (Multi)Polygon.
- **WeatherData:** `latitude`, `longitude`, `timezone`, and `current` with `time`, `temperature`, `apparentTemperature`, `relativeHumidity`, `windSpeed`, `precipitation` and `weatherCode`. Optional values are `null` when not provided. Also `hourly` (24 hours from the current hour), `updatedAt` and `source`.
- **ObservationData:** `stationId`, `stationName`, `observation` (measured values; `null` = not reported), `alerts` (`null` = request failed, `[]` = none active), and per-part error strings.

## Parsing rules (all parsers)

- Input is `unknown` and narrowed field by field (`app/lib/validation.ts`).
- Invalid coordinates (non-numeric or out of range), too-short geometry, unexpected geometry types and malformed elements are **dropped**, never repaired with guesses.
- Missing optional values stay `null` and are shown as "Not reported". Missing required values reject the response with a clear error.
- Duplicates are removed: Overpass elements by `type/id`; geocoding results by OSM object, and by the same label within about 10 km (for example a city's boundary and its center point).
- Source IDs are preserved (OSM way and relation IDs, Photon OSM IDs, NWS station IDs).
- Parsers are covered by `npm test` (`tests/*.test.ts`), including malformed inputs.

## 1. Photon geocoder (location search)

- **Endpoint:** `https://photon.komoot.io/api/?q=<query>&limit=6&lang=en&lat=<bias>&lon=<bias>`, called through `/api/geocode`.
- **Why Photon:** Nominatim's usage policy forbids client-driven autocomplete. Photon is an OpenStreetMap-based geocoder built for search-as-you-type. It handles addresses, cities, ZIP codes and landmarks.
- **Request discipline:**
  - The client waits 350 ms after typing stops and sends nothing for queries under 3 characters.
  - Each new keystroke cancels the pending request.
  - The server caches results for 1 hour (up to 500 queries), shares in-flight duplicates, sends an identifying `User-Agent`, and times out after 8 seconds.
- **Bias:** results are weighted toward the current map center (rounded to 0.1°). So "Ocean City" typed near Salisbury may list local matches first.
- **Attribution:** the suggestion panel shows "Search by Photon · © OpenStreetMap contributors".
- **Limits:** the public instance is fair-use and has no SLA. For heavy production use, self-host Photon or use a commercial geocoder.

## 2. Vector-tile roads and features (immediate)

- **Source:** the basemap's OpenMapTiles-schema vector tiles (MapTiler `openmaptiles` source, or CARTO). `app/lib/tile-features.ts` reads them with MapLibre `querySourceFeatures` after each map move. No extra network request is made.
- **Roads:** `transportation_name` features with class motorway, trunk, primary, secondary, tertiary or minor and a name. Tile pieces of the same named road are merged into one road. Unnamed roads are not included (tiles carry no IDs to tell them apart).
- **Features:**
  - `waterway` (all classes).
  - `water` (excluding swimming pools).
  - `landcover` class wetland or farmland.
  - `park` class nature_reserve or national_park. Generic `protected_area` is excluded, because tiles don't say whether it's natural or cultural.
  - Unnamed features of one kind are merged into one feature.
- **Coverage:** the loaded map area, not a fixed radius. The UI labels this source "OSM map tiles", and road details say that no OSM way ID is available.

## 3. OpenStreetMap Overpass API (detail, when available)

- **Endpoints:** queried in parallel, first valid answer wins:
  - `https://overpass-api.de/api/interpreter`
  - `https://overpass.kumi.systems/api/interpreter`
  - `https://overpass.private.coffee/api/interpreter`
- **Query** (`overpassQuery`): a global `[bbox:…]` of ±`SEARCH_RADIUS_METERS` (2 km, so about 4 × 4 km) around the selected location, with `[timeout:20]` and `out geom qt`.
  - Roads: `highway` ∈ motorway, trunk, primary, secondary, tertiary, unclassified, residential, living_street, service, excluding `service=driveway|parking_aisle|drive-through`.
  - Features: `waterway`, `natural=water|wetland`, `water`, `wetland`, `landuse=farmland|farmyard|orchard|vineyard|plant_nursery`, `boundary=protected_area|national_park`, `leisure=nature_reserve` and `protect_class`, for ways and relations. Cultural protections (`protect_class` 21–29, or a "historic" `protection_title`) are excluded.
- **Reliability:**
  - Busy answers (429, or 5xx "at capacity, request queue is full") are retried after 2, 4 and 8 seconds, within one 25-second deadline.
  - The most informative error is shown, with Retry. Failures are logged to the console as `[map-data] …`.
  - Successes are cached per location in `sessionStorage` for 15 minutes.
  - When Overpass succeeds, its data replaces the tile data for that location. When it fails, the tile data stays and the map remains usable.
- **Limits:** public instances are often at capacity, so detailed data may be unavailable for a while. Relation boundaries are rebuilt from returned outer members, and incomplete rings become lines. `/api/map-data?lat=..&lon=..` offers the same query server-side, but the UI doesn't use it.

## 4. Open-Meteo Forecast API

- **Endpoint:** `https://api.open-meteo.com/v1/forecast`, via `/api/weather?lat=..&lon=..`.
  - `current` = temperature_2m, apparent_temperature, relative_humidity_2m, wind_speed_10m, precipitation, weather_code.
  - `hourly` = temperature_2m, precipitation_probability, precipitation, snowfall.
  - Also `forecast_days=2` and `timezone=auto`.
- **Times:** returned in the location's own time zone. The UI shows them as-is and names the zone.
- **Caching:** 10 minutes per point (rounded to about 100 m), up to 200 points. In-flight requests are shared; the timeout is 15 seconds. An invalid `lat`/`lon` gets a 400.
- **Limits:** these are model values, not road observations. Air temperature is not pavement temperature and cannot confirm ice. Free tier is for non-commercial use, about 10,000 calls a day. Attribution: CC BY 4.0, "Weather data by Open-Meteo.com".

## 5. National Weather Service API

- **Flow** (via `/api/observations?lat=..&lon=..`):
  1. `GET /points/{lat},{lon}` finds the nearby station list (cached 24 h).
  2. The nearest station is the first in that list.
  3. `GET /stations/{id}/observations/latest` gets the latest measurement.
  4. `GET /alerts/active?point={lat},{lon}` gets active alerts.
- **Headers:** an identifying `User-Agent` and `Accept: application/geo+json`.
- **Caching and timeouts:** complete answers are cached 5 minutes; the timeout is 10 seconds per request.
- **Partial failures:** observation and alerts fail independently. If one fails, the other is still shown.
- **Limits:** United States only (other locations get a clear 404 message). Values are station air measurements, often from an airport, not road-surface readings. Observations older than 2 hours are marked as such. NWS data is US public domain.

## 6. Basemap (MapTiler or CARTO)

- **With `NEXT_PUBLIC_MAPTILER_API_KEY`:** `https://api.maptiler.com/maps/<NEXT_PUBLIC_MAPTILER_STYLE_ID or positron>/style.json?key=…`. The key is public by design; restrict it to your domains in the MapTiler dashboard.
- **Without a key:** CARTO Positron `https://basemaps.cartocdn.com/gl/positron-gl-style/style.json`, which is for development and demos.
- **Attribution:** the map's attribution control shows "© MapTiler © OpenStreetMap contributors" or "© CARTO © OpenStreetMap contributors". It must stay visible.

## 7. NWS Local Storm Reports (nationwide local reporting)

- **What they are:** reports issued by each NWS forecast office from trained spotters, emergency managers, the public, mesonets and road crews. They cover snow totals, freezing rain, ice, wind and similar events.
- **Flow** (via `/api/storm-reports?lat=..&lon=..`):
  1. `api.weather.gov/points` gives the location's forecast office (for example AKQ or MPX), cached for 24 h.
  2. `https://mesonet.agron.iastate.edu/geojson/lsr.geojson?wfos=<office>&sts=<now−72h>&ets=<now>` returns that office's reports.
  3. Reports are kept if they lie within 80 km (about 50 mi), deduplicated and sorted newest first. Winter types (snow, sleet, freezing rain, ice, blizzard, cold) are flagged and listed first.
- **Caching:** 10 minutes per point.
- **Map and units:** reports appear as map points (blue = winter), and magnitudes are converted to °C, cm or km/h when metric is selected.
- **Limits:** reports exist only when someone reported something. "No reports" is not evidence of clear roads. Coverage is US only, and timing depends on each office.
- **Attribution:** National Weather Service, archived by the Iowa Environmental Mesonet, Iowa State University.

## 8. Local agency plow-status feeds

- **Why a registry:** there is no national plow or treatment dataset. Some counties, cities and DOTs publish one, usually as an ArcGIS FeatureServer layer, each with its own field names. Automatic discovery through ArcGIS search was tested and rejected, because its area filter returned unrelated worldwide items. Feeds are therefore registered by hand in `app/lib/plow-feeds.ts` (`PLOW_FEEDS`), each with its verified extent and field mapping.
- **Registered feeds:** St. Mary's County, MD, "Public Snow Removal Map": `services3.arcgis.com/R7akN8K2mtP0bdMI/.../Snow_Routes_Public/FeatureServer/0`. It has 572 route segments, with fields `Group_`, `Status`, `EditDate`, `FIRST_Rout`, `FIRST_SERV` and `SUM_Miles`. Status values run from "Untreated" and "Inspected Plowed or Treated" to "2nd" through "6th Pass".
- **Flow:** `/api/plow-status?lat&lon` returns the feeds whose extent (plus about 5 km) contains the point. It queries each with `f=geojson`, `outSR=4326` and light simplification, caches for 2 minutes, and normalizes each segment: name, raw status, category (untreated, treated, repeat-pass or unknown), update time and a stale flag. Feed URLs come only from the registry, never from the request.
- **Honesty rules:**
  - Status older than 48 hours is drawn gray and labelled outdated, never shown as current conditions.
  - Unrecognized status text stays "unknown".
  - Outside every feed, the UI says no feed is connected; it never infers status.
- **Adding a feed:** see `programmer.md` ("Adding a local plow-status feed").

## 9. Basemap themes

- **Dark (default when a MapTiler key is set):** MapTiler `dataviz-dark`, the dark canvas style used by county snow-route maps, so colored roads stand out. It uses the same OpenMapTiles layer names, so roads and features are still read from it.
- **Light:** MapTiler `positron`, or CARTO Positron without a key. CARTO's dark style uses a different tile schema (Protomaps), so without a MapTiler key only the light theme is offered.
- **Tile feature classes:** `landcover` class `wood` or `forest` becomes forest. Through Overpass, `natural=wood` and `landuse=forest` become forest. Forests are shown and listed, but they don't set the sensitivity level, because woods line most rural roads.

## 10. Road conditions (default map view)

Every colour is backed by named data. Green means **nothing is reported**, never "safe".

| Colour | Meaning | Source |
|---|---|---|
| `#E00000` Closed | A reported road closure, drawn along the closed stretch | TomTom incident `iconCategory` 8 |
| `#F1A344` Use caution | A reported hazard on that stretch (accident, ice, flooding, dangerous conditions, road works, lane closure, fog, wind, jam, broken-down vehicle), **or** an area-wide winter road alert, **or** freezing precipitation in the forecast | TomTom; NWS alerts (winter storm, winter weather, ice storm, blizzard, freezing rain/drizzle/fog, snow squall, lake-effect/heavy snow, sleet); Open-Meteo (Elevated weather attention) |
| `#B7D894` No reported problems | Incident data loaded and nothing reported on this road, and no area-wide winter hazard | TomTom + NWS + Open-Meteo |
| Gray: No condition data | Incident data not configured or unavailable, and no area caution | — |

- NWS **Freeze Warnings, Frost Advisories, Wind Chill and cold alerts are excluded** from area caution. They concern crops and people, not roads, and flagging every road for them would be misleading.
- **TomTom request:** `GET https://api.tomtom.com/traffic/services/5/incidentDetails?key=…&bbox=<±0.1°>&fields={incidents{…}}&timeValidityFilter=present&language=en-US`, made from `/api/incidents` only, so the key never reaches the browser. It's cached for 3 minutes per ~1 km cell; the free tier allows about 2,500 requests a day. Without a key the route answers `{ configured: false }`, and the banner says closures are not connected.
- **Parsing** (`app/lib/traffic-incidents.ts`): validates geometry (Point or LineString), maps `iconCategory` to closed or caution, and drops unknown categories. It keeps description, from/to, road numbers and start/end times, and deduplicates by id.
- **Not yet verified against a live TomTom response:** no key was available during development. The parser is built from the documented v5 format and covered by fixture tests.
- **Attribution:** "Traffic data © TomTom".

## Not connected

- Open-Meteo Elevation, slopes and terrain: out of scope unless an approved milestone requires them.
- Nominatim: used once, earlier, to find the default coordinates (cached in `app/lib/demo-config.ts`). It is not called at runtime.

## Usage notes

- Respect each provider's terms and rate limits. Don't add polling or load tests against public instances.
- Never substitute generic or sample values for failed live data.
- Absence of mapped features is not evidence that an area is environmentally safe. Proximity is not evidence of pollution.
