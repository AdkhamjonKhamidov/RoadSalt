import type {
  Feature,
  FeatureCollection,
  Geometry,
  Position,
} from "geojson";
import type { Map as MapLibreMap } from "maplibre-gl";
import type {
  EnvironmentalKind,
  EnvironmentalProperties,
  MapData,
  RoadProperties,
} from "./data-types";

// Reads real OpenStreetMap roads and environmental features from the vector
// tiles the basemap has already loaded (OpenMapTiles schema, served by MapTiler
// or CARTO). No extra network requests: if the basemap is visible, this data
// is available. Coverage is the loaded map area, not a fixed radius.

/** OpenMapTiles road classes treated as roads (no paths, tracks or service). */
const ROAD_CLASSES = new Set([
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "minor",
]);
// Tiles do not carry protect_class, so a generic "protected_area" could be a
// historic or cultural district. Only clearly natural park classes count.
const PROTECTED_PARK_CLASSES = new Set(["nature_reserve", "national_park"]);

type Group<P> = { properties: P; lines: Position[][]; polygons: Position[][][] };

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function addGeometry<P>(group: Group<P>, geometry: Geometry): void {
  switch (geometry.type) {
    case "LineString":
      group.lines.push(geometry.coordinates);
      break;
    case "MultiLineString":
      group.lines.push(...geometry.coordinates);
      break;
    case "Polygon":
      group.polygons.push(geometry.coordinates);
      break;
    case "MultiPolygon":
      group.polygons.push(...geometry.coordinates);
      break;
    default:
      break;
  }
}

function toFeature<P>(group: Group<P>, preferPolygons: boolean): Feature<Geometry, P> | null {
  if (preferPolygons && group.polygons.length > 0) {
    return {
      type: "Feature",
      geometry: { type: "MultiPolygon", coordinates: group.polygons },
      properties: group.properties,
    };
  }
  if (group.lines.length > 0) {
    return {
      type: "Feature",
      geometry: { type: "MultiLineString", coordinates: group.lines },
      properties: group.properties,
    };
  }
  return null;
}

/** The style's first vector source that carries OpenMapTiles road names. */
function findOpenMapTilesSource(map: MapLibreMap): string | null {
  const sources = map.getStyle()?.sources ?? {};
  for (const [id, source] of Object.entries(sources)) {
    if (source.type !== "vector") continue;
    if (map.querySourceFeatures(id, { sourceLayer: "transportation_name" }).length > 0) {
      return id;
    }
  }
  return null;
}

function classifyEnvironment(
  sourceLayer: string,
  className: string | undefined,
): EnvironmentalKind | null {
  switch (sourceLayer) {
    case "waterway":
      return "waterway";
    case "water":
      // Swimming pools are mapped water but not environmental features.
      return className === "swimming_pool" ? null : "water";
    case "landcover":
      if (className === "wetland") return "wetland";
      if (className === "farmland") return "farmland";
      return null;
    case "park":
      return className && PROTECTED_PARK_CLASSES.has(className) ? "protected" : null;
    default:
      return null;
  }
}

/**
 * Extracts roads and environmental features from the loaded basemap tiles.
 * Tile pieces of the same named road (or named feature) are merged, so a
 * selected road highlights along its whole loaded length. Unnamed features of
 * one kind are merged into a single feature per kind.
 * Returns null when the style has no OpenMapTiles source or nothing is loaded.
 */
export function extractTileMapData(
  map: MapLibreMap,
  providerLabel: "MapTiler" | "CARTO",
): MapData | null {
  const sourceId = findOpenMapTilesSource(map);
  if (!sourceId) return null;

  const roadGroups = new Map<string, Group<RoadProperties>>();
  for (const feature of map.querySourceFeatures(sourceId, {
    sourceLayer: "transportation_name",
  })) {
    const roadClass = text(feature.properties?.class);
    const name = text(feature.properties?.name);
    if (!roadClass || !ROAD_CLASSES.has(roadClass) || !name) continue;
    const classification = text(feature.properties?.subclass) ?? roadClass;
    const roadId = `tile:${roadClass}:${name}`;
    let group = roadGroups.get(roadId);
    if (!group) {
      group = { properties: { roadId, name, classification }, lines: [], polygons: [] };
      roadGroups.set(roadId, group);
    }
    addGeometry(group, feature.geometry);
  }

  const environmentGroups = new Map<string, Group<EnvironmentalProperties>>();
  for (const sourceLayer of ["waterway", "water", "landcover", "park"]) {
    for (const feature of map.querySourceFeatures(sourceId, { sourceLayer })) {
      const kind = classifyEnvironment(sourceLayer, text(feature.properties?.class));
      if (!kind) continue;
      const name = text(feature.properties?.name);
      const featureId = name ? `tile:${kind}:${name}` : `tile:${kind}:unnamed`;
      let group = environmentGroups.get(featureId);
      if (!group) {
        group = { properties: { featureId, kind, name }, lines: [], polygons: [] };
        environmentGroups.set(featureId, group);
      }
      addGeometry(group, feature.geometry);
    }
  }

  const roads: FeatureCollection<Geometry, RoadProperties> = {
    type: "FeatureCollection",
    features: [...roadGroups.values()]
      .map((group) => toFeature(group, false))
      .filter((item): item is Feature<Geometry, RoadProperties> => item !== null),
  };
  const environmentalFeatures: FeatureCollection<Geometry, EnvironmentalProperties> = {
    type: "FeatureCollection",
    features: [...environmentGroups.values()]
      .map((group) => toFeature(group, group.properties.kind !== "waterway"))
      .filter(
        (item): item is Feature<Geometry, EnvironmentalProperties> => item !== null,
      ),
  };

  if (roads.features.length === 0 && environmentalFeatures.features.length === 0) {
    return null;
  }
  return {
    roads,
    environmentalFeatures,
    updatedAt: new Date().toISOString(),
    source: `OpenStreetMap vector tiles (${providerLabel})`,
    radiusMeters: null,
  };
}
