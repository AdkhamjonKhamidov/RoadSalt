---
name: environmental-data
description: Environmental data integrity rules for RoadSalt. Covers how OSM waterways, water bodies, wetlands, farmland and protected areas are classified and described, what geographic proximity does and does not mean, the sensitivity thresholds, data limitations, and approved versus forbidden wording. Use when changing feature classification, proximity logic, weather-attention rules, or any user-facing environmental or weather copy.
---

# Environmental data integrity (RoadSalt)

## Classification (implemented in `classifyEnvironment`, `app/lib/geojson.ts`)

| Kind | OSM tags | Geometry | Notes |
|---|---|---|---|
| `waterway` | any `waterway=*` (except riverbank) | line | Includes streams, ditches and drains. A drainage ditch is still a mapped waterway; do not call it a "river". |
| `water` | `natural=water`, `water=*`, `waterway=riverbank` | polygon | Ponds, reservoirs, river areas. Some are stormwater basins, which are often tagged `water=basin` or `water=pond`. |
| `wetland` | `natural=wetland`, `wetland=*`, `landcover=wetland` | polygon | OSM wetlands are not jurisdictional (regulatory) wetland delineations. |
| `farmland` | `landuse=farmland|farmyard|orchard|vineyard|plant_nursery` | polygon | Agricultural land use. It is not a statement about crops, soil or yield impact. |
| `protected` | `boundary=protected_area|national_park`, `leisure=nature_reserve`, `protect_class=*` | polygon | Mapped boundaries. They may be incomplete or outdated. |

One kind per feature, first match wins. If you change the precedence or add tags, document the rationale and update `docs/DATA_SOURCES.md`.

## Proximity and sensitivity (`assessEnvironmentalSensitivity`)
- Distance is from the road geometry to the nearest returned feature (planar approximation).
- **High** ≤ 50 m, **Moderate** ≤ 250 m, otherwise **Low**. With no usable feature data the level is **Unknown**. Thresholds live in `ENVIRONMENTAL_THRESHOLDS_METERS`.
- These are **modeled sensitivity indicators based on mapped proximity**. They are not measurements of chloride, runoff, drainage direction, or ecological harm. Drainage, slope, soils, storm sewers and buffers are not modeled.

## Two separate concepts. Never merge them silently.
| Weather attention | Environmental sensitivity |
|---|---|
| From the Open-Meteo forecast (air temperature 2 m, precipitation, snowfall) | From mapped OSM feature proximity |
| Low / Moderate / Elevated / Insufficient data | Low / Moderate / High / Unknown |
| "Forecast conditions may warrant attention" | "Mapped sensitive features lie nearby" |

Environmental sensitivity must never be presented as overriding road safety. Any future combined "risk highlighting" (only on explicit request) must show both inputs and explain the reason a road was flagged.

## Data limitations to disclose
- OSM coverage is volunteer-mapped and incomplete. Absence of features is not evidence of absence.
- Results are limited to the data loaded for the selected location: Overpass (±2 km box) or the loaded basemap tiles. Features outside it, or dropped for malformed geometry, are not considered. Tile data has no generic `protected_area` and no unnamed roads.
- Air temperature is not pavement temperature. Forecasts are uncertain.

## Wording

| Avoid | Use instead |
|---|---|
| "This road pollutes the creek" | "A mapped waterway lies approximately 40 m from this road" |
| "High environmental impact" | "High sensitivity (mapped feature within 50 m)" |
| "Safe area" / "No environmental concern" | "No mapped sensitive feature found nearby" |
| "Road is icy" / "Ice confirmed" | "Forecast air temperature at or below 0 °C with precipitation possible" |
| "Apply less salt here" / any rate | Nothing. RoadSalt does not recommend treatment. |
| "Wetland (protected by law)" | "Mapped wetland (OpenStreetMap)" |

## Review checklist
- [ ] Each kind label matches its tags and geometry.
- [ ] Copy says "mapped", "approximately", "forecast".
- [ ] Unknown and empty states are worded neutrally.
- [ ] Weather and environment indicators are labelled separately.
- [ ] Sources are named (OpenStreetMap, Open-Meteo).
- [ ] No treatment or rate advice anywhere.
