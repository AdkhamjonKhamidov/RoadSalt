---
name: mapping-and-geospatial-data
description: RoadSalt map and geospatial procedures. Covers OSM tag conventions, Overpass QL query design, [lon, lat] coordinate handling, OSM-to-GeoJSON road and relation geometry, MapLibre source/layer management, environmental feature rendering, road selection, geometry validation, and map performance. Use when touching geojson.ts, proximity.ts, MapCanvas.tsx layers, or the Overpass query.
---

# Mapping and geospatial data (RoadSalt)

## Coordinates
- GeoJSON and MapLibre use **`[longitude, latitude]`**. `DEMO_CENTER = [-75.6070632, 38.34798]`. Overpass `around:` and the Open-Meteo parameters use **latitude, longitude**, so destructure explicitly: `const [longitude, latitude] = DEMO_CENTER`.
- Validate ranges (lat −90..90, lon −180..180) and `Number.isFinite`. `parsePoint` in `geojson.ts` does this. Reuse it.
- Distances in `proximity.ts` use a local planar approximation, which is adequate at a 3 km scale. Present results as "approximately X m", never as survey-grade figures.

## Overpass query (`overpassQuery`)
- Uses a global `[bbox:s,w,n,e]` (from `boundingBox()`, ±`SEARCH_RADIUS_METERS`), `[out:json][timeout:12]`, `wr[...]` statements for ways and relations, and `out geom qt` (inline geometry, unsorted). Do not go back to per-statement `around:` filters, which are much slower.
- Roads: `highway ~ primary|secondary|tertiary|residential|unclassified` (`ROAD_CLASSES`). Service roads, footways, paths and motorways are not queried.
- Environment: `waterway`, `natural=water|wetland`, `water`, `wetland`, `landuse=farmland|farmyard|orchard|vineyard|plant_nursery`, `boundary=protected_area|national_park`, `leisure=nature_reserve`, `protect_class`, on both ways and relations.
- Before adding a tag class or growing the radius, estimate the response-size and timeout impact. Public Overpass instances have already timed out at the 15 s client limit. Prefer narrowing over widening.
- Test queries manually in overpass-turbo or by reading the OSM wiki. Do not hammer public instances (see `external-api-integration`).

## OSM → GeoJSON (`overpassToGeoJSON`)
- Roads are ways with ≥ 2 valid points → `LineString`, with properties `roadId` (`way/<id>`), `name?` and `classification` (the highway value).
- Area kinds (water, wetland, farmland, protected) come from closed ways → `Polygon`. Relations use stitched outer rings (`stitchRings`). Linear waterways stay `LineString`.
- If any point is invalid, or a ring cannot close, **drop the feature**. Never interpolate, snap or invent geometry.
- `classifyEnvironment` precedence: `waterway=riverbank` → water, any `waterway` → waterway, then wetland, water, farmland, protected. Keep the single-kind-per-feature rule. Changes to it must go past the `environmental-data-reviewer`.

## MapLibre layers (`MapCanvas.tsx`)
- Two GeoJSON sources: `roadsalt-roads` and `roadsalt-environment`. They are created once on `load`, and data changes go through `source.setData(...)`. Do not remove and re-add sources or layers on every render.
- Layers are inserted before the first symbol/label layer (`addLayer(layer, firstLabelLayer)`) so basemap labels stay readable. Paint order is environment fills/lines, then the road network, then the selected road on top.
- Visibility toggles filter by `kind` and set `visibility`. Keep layer IDs prefixed `roadsalt-`.
- Selection: a map `click` queries `roadsalt-road-network` and passes properties up via `onRoadSelect`. The selected road is drawn by the `roadsalt-selected-road` layer filter. Only the OSM overlay is selectable, not basemap roads.
- Cleanup: remove listeners, marker, ResizeObserver and `map.remove()` on unmount. Any new listener must be added to `removeMapListeners`.
- Attribution control must stay visible (OSM contributors and CARTO).

## Performance
- One query per page load, cached server-side. No refetch on pan or zoom.
- Avoid `queryRenderedFeatures` on `mousemove` without throttling. Hover effects should use feature-state or a cheap filter.
- Keep GeoJSON lean: only needed properties, no raw OSM tag blobs.

## Validating geographic output
After a successful live response, check the following:
- Feature counts by kind are non-zero and plausible for Salisbury (it has rivers, such as the Wicomico, and surrounding farmland).
- Roads render on the right streets near the marker.
- Clicking a road shows its OSM name and class.
- Polygons are not inverted or spiky.
- The nearest-feature distance is sane. If counts are zero, report "not returned", not "none exist".

## Mapped vs. verified
OSM features are volunteer-mapped geographic features. They are not verified environmental conditions, monitoring data or legal designations.
