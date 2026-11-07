# Data sources

RoadSalt is designed around public, real-world data sources without requiring a custom backend. In this map stage, CARTO basemap tiles and the cached OpenStreetMap Nominatim lookup are active. Overpass and Open-Meteo integrations are planned, not yet connected.

## 1. OpenStreetMap Overpass API

### Purpose
Used to identify nearby roads, paths, water bodies, wetlands, farmland, and protected or nature areas near the demo location.

### Implementation status
Planned for a later stage; the current basemap is not selectable RoadSalt road data.

### Data retrieved
- road geometry and names when available
- road class or classification when available
- waterways and bodies of water
- wetlands
- farmland and agricultural land
- protected or nature areas when mapped

### Update behavior
- When implemented, query only as needed and cache results where practical to reduce repeated lookups.

### Limitations
- Map completeness varies by region.
- Some environmental features may not be mapped or may be labeled inconsistently.
- The feature set is not guaranteed to be complete for every road segment.

### Fallback behavior
- If no mapped feature is found, the interface should show `No mapped sensitive feature found nearby` instead of implying the area is safe.

## 2. OpenStreetMap Nominatim

### Purpose
Used to look up the fixed demo address. The successful lookup result is cached in source so Nominatim is not requested on each page load.

### Data retrieved
- latitude and longitude for the target address
- display-friendly location label

### Update behavior
- One lookup when the configured demo address is changed.

### Limitations
- Geocoding can be approximate in some cases.
- Rate limits may apply under heavy use.
- If a new address cannot be geocoded, show an error and use only a clearly documented approximate location for that same area.

## 3. CARTO Positron basemap

### Purpose
Provides the live, light vector basemap used for roads, place labels, and geographic context. The configured MapLibre style is `https://basemaps.cartocdn.com/gl/positron-gl-style/style.json`.

### Data retrieved
- Vector map tiles, labels, fonts, and style assets.
- The configured style identifies OpenStreetMap contributors and CARTO in its attribution.

### Update behavior
- The browser requests map style assets and vector tiles as the user loads and navigates the map.

### Attribution and limitations
- Keep the required OpenStreetMap and CARTO attribution visible on the map.
- The current public style endpoint works without an API key but is subject to CARTO usage terms and service limits.
- Public endpoints are intended for development and demos, not unrestricted production traffic. Confirm the provider's current terms and use an appropriate plan or permitted tile hosting for production.
- Basemap road lines are not yet RoadSalt road-selection data or a risk overlay.

### Fallback behavior
- If the style or tiles fail, show a map loading error; do not substitute a different city or a fabricated map.

## 4. Open-Meteo Forecast API

### Purpose
Used to retrieve current conditions and the next 24 hours of relevant weather values.

### Implementation status
Planned for a later stage; no weather values are currently displayed as live data.

### Data retrieved
- air temperature
- precipitation amount
- precipitation probability
- snowfall
- weather code
- hourly temperature and precipitation expectations

### Update behavior
- Live data should be refreshed periodically.
- Cached values are acceptable if clearly labeled as stale or recent.

### Limitations
- It captures atmospheric weather, not pavement temperature.
- Data should be used to describe a potential icing indicator, not to say a road definitely has ice.

## 5. Open-Meteo Elevation API

### Purpose
Used to estimate terrain change around selected road coordinates.

### Implementation status
Planned for a later stage.

### Data retrieved
- elevation samples for road areas
- distance and slope estimates

### Update behavior
- Sampled at the time a road is evaluated or when a new area is inspected.

### Limitations
- The elevation model is coarse and should be labeled as `Estimated terrain incline`.
- It cannot replace engineering-grade slope analysis.
- Insufficient or uneven data should be presented as `Insufficient elevation data`.

## Attribution and usage notes

- Respect each provider's terms of use and rate-limit guidance.
- Keep API requests server-side where practical.
- Do not silently substitute generic values for failed live data.
- If a fallback is necessary, clearly flag it as sample data and explain the reason.
