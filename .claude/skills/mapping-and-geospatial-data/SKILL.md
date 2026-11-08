---
name: mapping-and-geospatial-data
description: RoadSalt map and geospatial procedures. Covers reading roads and environmental features from the basemap's vector tiles, [lon, lat] coordinate handling, 100 m road segmentation, proximity distances, MapLibre source/layer management, road selection, geometry validation, and map performance. Use when touching tile-features.ts, segments.ts, proximity.ts, or MapCanvas.tsx layers.
---

# Mapping and geospatial data (RoadSalt)

## Coordinates
- GeoJSON and MapLibre use **`[longitude, latitude]`**. `DEMO_CENTER = [-75.6070632, 38.34798]`. The API routes take `lat`/`lon` query parameters, so destructure explicitly: `const [longitude, latitude] = DEMO_CENTER`.
- Validate ranges (lat −90..90, lon −180..180) and `Number.isFinite`. `coordinatesFromSearchParams` and `isLatitude`/`isLongitude` in `validation.ts` do this. Reuse them.
- Distances in `proximity.ts` and `segments.ts` use a local planar approximation, adequate at city scale. Present results as approximate, never as survey-grade figures.

## Roads and features come from the basemap tiles (`tile-features.ts`)
- `extractTileMapData(map, provider)` reads the OpenMapTiles layers the basemap already loaded (MapTiler or CARTO). There are no extra network requests, and coverage is the loaded map area.
- Roads: `transportation` classes `motorway`, `trunk`, `primary`, `secondary`, `tertiary`, `minor` (no paths, tracks or service roads). Tile pieces of the same named road are merged, and `roadId` is `tile:<class>:<name>`. Tiles carry no OSM ids or tags.
- Environment (`classifyEnvironment`): `waterway` → waterway; `water` → water (not swimming pools); `landcover` wetland → wetland, farmland → farmland, wood/forest → forest; `park` with `nature_reserve`/`national_park` → protected (a generic `protected_area` could be a historic district, so it is excluded).
- Extraction runs after each map move settles (`idle`), guarded by a view key so overlay updates don't loop. Below zoom 12 tiles are generalized, so extraction is skipped.
- Overpass was removed on 2026-11-08 (its public instances never answered). Don't reintroduce it without the user's approval.

## Runoff exposure (`proximity.ts`, `segments.ts`)
- Thresholds: `ENVIRONMENTAL_THRESHOLDS_METERS` {high: 50, moderate: 250}. Forests are listed as nearby but never set the level.
- `prepareSensitiveParts(features)` splits multi-geometries and computes bounding boxes once. `nearestSensitiveFeature(geometry, parts)` bounding-box filters, then measures, and returns the nearest feature within 250 m.
- `segmentRoad` cuts a road into `ROAD_SEGMENT_METERS` (100 m) pieces (a tail ≤ 5 m is dropped) and rates each piece on its own. `summarizeSegments` merges consecutive High/Moderate pieces into stretches. Segment features keep the parent `roadId`, so clicking a segment selects the whole road.
- Changes to classification or thresholds must go past the `environmental-data-reviewer`.

## MapLibre layers (`MapCanvas.tsx`)
- GeoJSON sources `roadsalt-roads`, `roadsalt-environment`, `roadsalt-plow`, `roadsalt-reports` and `roadsalt-incidents` are created once, and data changes go through `setData`. Do not remove and re-add sources or layers on every render.
- Overlays are inserted above the **last basemap geometry layer** and below the labels that follow it. The first symbol layer is not enough: MapTiler styles put water labels before buildings and roads, which hid the overlays.
- After `setStyle` (Light/Dark), `style.load` handlers call `updateOverlays(map, props, true)`, because `isStyleLoaded()` can still be false at that moment.
- Views (`RoadColorMode`): `conditions`, `sensitivity` (100 m segments) and `plow`. In `sensitivity` the selected road is a navy halo moved under the segment layer, so the colours stay readable.
- Selection: a `click` queries `roadsalt-road-network` (6 px tolerance) and passes the full road up via `onRoadSelect`. Only the overlay is selectable, not basemap roads.
- Cleanup: remove listeners, marker, ResizeObserver and `map.remove()` on unmount. Any new listener must be added to `removeMapListeners`.
- The attribution control must stay visible.

## Performance
- Segmentation for the whole map runs only in the proximity view, and is recomputed when tile data changes.
- Avoid `queryRenderedFeatures` on `mousemove` without throttling.
- Keep GeoJSON lean: only the properties the UI needs.

## Validating geographic output
WebGL layers are invisible to DOM assertions. Check them in screenshots (`npm run test:ui` writes them to `e2e/screenshots/`):
- Roads render on the right streets near the marker, in the expected colours.
- Clicking a road highlights it and fills the panel, including the segment strip.
- Feature counts by kind are plausible for the place. If counts are zero, report "not returned", not "none exist".

## Mapped vs. verified
OSM features are volunteer-mapped geographic features. They are not verified environmental conditions, monitoring data or legal designations.
