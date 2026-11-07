import type { Feature, Geometry, Position } from "geojson";
import {
  ENVIRONMENTAL_THRESHOLDS_METERS,
} from "./demo-config";
import type {
  EnvironmentalProperties,
  RoadProperties,
} from "./data-types";

type RoadFeature = Feature<Geometry, RoadProperties>;
type EnvironmentFeature = Feature<Geometry, EnvironmentalProperties>;
type Point2D = [number, number];
type Segment = [Position, Position];

export type NearbyEnvironmentFeature = {
  feature: EnvironmentalProperties;
  distanceMeters: number;
};

export type EnvironmentalAssessment = {
  level: "Low" | "Moderate" | "High" | "Unknown";
  nearestDistanceMeters: number | null;
  nearbyFeatures: NearbyEnvironmentFeature[];
};

function isPosition(value: Position): boolean {
  return value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]);
}

function collectGeometry(
  geometry: Geometry,
  lines: Position[][],
  points: Position[],
  polygons: Position[][][],
): void {
  switch (geometry.type) {
    case "Point":
      if (isPosition(geometry.coordinates)) points.push(geometry.coordinates);
      break;
    case "MultiPoint":
      points.push(...geometry.coordinates.filter(isPosition));
      break;
    case "LineString":
      if (geometry.coordinates.length >= 2) lines.push(geometry.coordinates);
      break;
    case "MultiLineString":
      lines.push(...geometry.coordinates.filter((line) => line.length >= 2));
      break;
    case "Polygon":
      polygons.push(geometry.coordinates);
      lines.push(...geometry.coordinates.filter((ring) => ring.length >= 2));
      break;
    case "MultiPolygon":
      for (const polygon of geometry.coordinates) {
        polygons.push(polygon);
        lines.push(...polygon.filter((ring) => ring.length >= 2));
      }
      break;
    case "GeometryCollection":
      for (const child of geometry.geometries) {
        collectGeometry(child, lines, points, polygons);
      }
      break;
  }
}

function project(position: Position, latitude: number): Point2D {
  const longitudeScale = 111_320 * Math.cos((latitude * Math.PI) / 180);
  return [position[0] * longitudeScale, position[1] * 111_320];
}

function pointSegmentDistance(
  point: Point2D,
  start: Point2D,
  end: Point2D,
): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const denominator = dx * dx + dy * dy;
  if (denominator === 0) {
    return Math.hypot(point[0] - start[0], point[1] - start[1]);
  }
  const amount = Math.max(
    0,
    Math.min(
      1,
      ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) /
        denominator,
    ),
  );
  return Math.hypot(
    point[0] - (start[0] + amount * dx),
    point[1] - (start[1] + amount * dy),
  );
}

function orientation(a: Point2D, b: Point2D, c: Point2D): number {
  return (b[0] - a[0]) * (c[1] - a[1]) -
    (b[1] - a[1]) * (c[0] - a[0]);
}

function segmentsIntersect(
  a: Point2D,
  b: Point2D,
  c: Point2D,
  d: Point2D,
): boolean {
  const first = orientation(a, b, c);
  const second = orientation(a, b, d);
  const third = orientation(c, d, a);
  const fourth = orientation(c, d, b);
  const epsilon = 1e-8;
  const onSegment = (start: Point2D, point: Point2D, end: Point2D) =>
    point[0] >= Math.min(start[0], end[0]) - epsilon &&
    point[0] <= Math.max(start[0], end[0]) + epsilon &&
    point[1] >= Math.min(start[1], end[1]) - epsilon &&
    point[1] <= Math.max(start[1], end[1]) + epsilon;

  if (
    Math.abs(first) <= epsilon &&
    onSegment(a, c, b)
  ) return true;
  if (
    Math.abs(second) <= epsilon &&
    onSegment(a, d, b)
  ) return true;
  if (
    Math.abs(third) <= epsilon &&
    onSegment(c, a, d)
  ) return true;
  if (
    Math.abs(fourth) <= epsilon &&
    onSegment(c, b, d)
  ) return true;
  return first * second < 0 && third * fourth < 0;
}

function segmentDistance(
  first: Segment,
  second: Segment,
  latitude: number,
): number {
  const a = project(first[0], latitude);
  const b = project(first[1], latitude);
  const c = project(second[0], latitude);
  const d = project(second[1], latitude);
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    pointSegmentDistance(a, c, d),
    pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b),
    pointSegmentDistance(d, a, b),
  );
}

function segments(lines: Position[][]): Segment[] {
  const result: Segment[] = [];
  for (const line of lines) {
    for (let index = 1; index < line.length; index += 1) {
      const start = line[index - 1];
      const end = line[index];
      if (start && end && isPosition(start) && isPosition(end)) {
        result.push([start, end]);
      }
    }
  }
  return result;
}

function pointInRing(point: Position, ring: Position[]): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const currentPoint = ring[index];
    const previousPoint = ring[previous];
    if (!currentPoint || !previousPoint) continue;
    const crosses =
      currentPoint[1] > point[1] !== previousPoint[1] > point[1] &&
      point[0] <
        ((previousPoint[0] - currentPoint[0]) *
          (point[1] - currentPoint[1])) /
          (previousPoint[1] - currentPoint[1]) +
          currentPoint[0];
    if (crosses) inside = !inside;
  }
  return inside;
}

function insidePolygon(point: Position, polygon: Position[][]): boolean {
  const [outer, ...holes] = polygon;
  return Boolean(
    outer &&
      pointInRing(point, outer) &&
      !holes.some((hole) => pointInRing(point, hole)),
  );
}

/** Approximate minimum distance in metres between two geometries (0 when they touch). */
export function minimumDistance(
  road: Geometry,
  environment: Geometry,
): number | null {
  const roadLines: Position[][] = [];
  const roadPoints: Position[] = [];
  const roadPolygons: Position[][][] = [];
  const environmentLines: Position[][] = [];
  const environmentPoints: Position[] = [];
  const environmentPolygons: Position[][][] = [];
  collectGeometry(road, roadLines, roadPoints, roadPolygons);
  collectGeometry(
    environment,
    environmentLines,
    environmentPoints,
    environmentPolygons,
  );

  const roadSegments = segments(roadLines);
  const environmentSegments = segments(environmentLines);
  const latitudes = [...roadPoints, ...environmentPoints]
    .map((point) => point[1])
    .filter(Number.isFinite);
  for (const segment of [...roadSegments, ...environmentSegments]) {
    latitudes.push(segment[0][1], segment[1][1]);
  }
  const referenceLatitude =
    latitudes.length > 0
      ? latitudes.reduce((sum, latitude) => sum + latitude, 0) / latitudes.length
      : 38.35;

  for (const point of roadPoints) {
    if (environmentPolygons.some((polygon) => insidePolygon(point, polygon))) {
      return 0;
    }
  }
  for (const point of roadLines.flat()) {
    if (environmentPolygons.some((polygon) => insidePolygon(point, polygon))) {
      return 0;
    }
  }

  let nearest = Number.POSITIVE_INFINITY;
  for (const roadSegment of roadSegments) {
    for (const environmentSegment of environmentSegments) {
      nearest = Math.min(
        nearest,
        segmentDistance(roadSegment, environmentSegment, referenceLatitude),
      );
    }
    for (const point of environmentPoints) {
      nearest = Math.min(
        nearest,
        pointSegmentDistance(
          project(point, referenceLatitude),
          project(roadSegment[0], referenceLatitude),
          project(roadSegment[1], referenceLatitude),
        ),
      );
    }
  }
  for (const environmentSegment of environmentSegments) {
    for (const point of roadPoints) {
      nearest = Math.min(
        nearest,
        pointSegmentDistance(
          project(point, referenceLatitude),
          project(environmentSegment[0], referenceLatitude),
          project(environmentSegment[1], referenceLatitude),
        ),
      );
    }
  }
  for (const roadPoint of roadPoints) {
    for (const environmentPoint of environmentPoints) {
      const first = project(roadPoint, referenceLatitude);
      const second = project(environmentPoint, referenceLatitude);
      nearest = Math.min(
        nearest,
        Math.hypot(first[0] - second[0], first[1] - second[1]),
      );
    }
  }

  return Number.isFinite(nearest) ? nearest : null;
}

const LEVEL_EXCLUDED_KINDS = new Set<EnvironmentalProperties["kind"]>(["forest"]);

export function assessEnvironmentalSensitivity(
  road: RoadFeature,
  features: EnvironmentFeature[],
): EnvironmentalAssessment {
  const distances = features
    .map((feature) => {
      const distance = minimumDistance(road.geometry, feature.geometry);
      return distance === null
        ? null
        : {
            feature: feature.properties,
            distanceMeters: distance,
          };
    })
    .filter(
      (entry): entry is NearbyEnvironmentFeature =>
        entry !== null && Number.isFinite(entry.distanceMeters),
    )
    .sort((a, b) => a.distanceMeters - b.distanceMeters);

  // Forests are listed as nearby features but do not set the sensitivity
  // level: woods line most rural roads and would make nearly every road
  // "High", hiding the water, wetland and farmland signal.
  const nearest = distances.find(
    (entry) => !LEVEL_EXCLUDED_KINDS.has(entry.feature.kind),
  );
  if (!nearest) {
    const nearbyOnly = distances.filter(
      (item) => item.distanceMeters <= ENVIRONMENTAL_THRESHOLDS_METERS.moderate,
    );
    if (nearbyOnly.length > 0) {
      return { level: "Low", nearestDistanceMeters: null, nearbyFeatures: nearbyOnly };
    }
    return {
      level: "Unknown",
      nearestDistanceMeters: null,
      nearbyFeatures: [],
    };
  }

  const level =
    nearest.distanceMeters <= ENVIRONMENTAL_THRESHOLDS_METERS.high
      ? "High"
      : nearest.distanceMeters <= ENVIRONMENTAL_THRESHOLDS_METERS.moderate
        ? "Moderate"
        : "Low";

  return {
    level,
    nearestDistanceMeters: nearest.distanceMeters,
    nearbyFeatures: distances.filter(
      (item) =>
        item.distanceMeters <= ENVIRONMENTAL_THRESHOLDS_METERS.moderate,
    ),
  };
}

export type SensitivityLevel = EnvironmentalAssessment["level"];

type Bounds = [number, number, number, number];

function geometryBounds(geometry: Geometry): Bounds | null {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  const visit = (value: unknown): void => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === "number" && typeof value[1] === "number") {
      west = Math.min(west, value[0]);
      east = Math.max(east, value[0]);
      south = Math.min(south, value[1]);
      north = Math.max(north, value[1]);
      return;
    }
    value.forEach(visit);
  };
  if ("coordinates" in geometry) visit(geometry.coordinates);
  return Number.isFinite(west) ? [west, south, east, north] : null;
}

/** Splits multi-geometries so each part gets its own (tight) bounding box. */
function geometryParts(geometry: Geometry): Geometry[] {
  switch (geometry.type) {
    case "MultiPolygon":
      return geometry.coordinates.map((coordinates) => ({ type: "Polygon", coordinates }));
    case "MultiLineString":
      return geometry.coordinates.map((coordinates) => ({ type: "LineString", coordinates }));
    default:
      return [geometry];
  }
}

/**
 * Sensitivity level for many roads at once (for colouring the map).
 * Same rules as assessEnvironmentalSensitivity (forests excluded from the
 * level), but each feature part is bounding-box filtered first so only parts
 * within the moderate threshold are measured.
 */
export function roadSensitivityLevels(
  roads: RoadFeature[],
  features: EnvironmentFeature[],
): Map<string, SensitivityLevel> {
  const levels = new Map<string, SensitivityLevel>();
  const parts = features
    .filter((feature) => !LEVEL_EXCLUDED_KINDS.has(feature.properties.kind))
    .flatMap((feature) => geometryParts(feature.geometry))
    .map((geometry) => ({ geometry, bounds: geometryBounds(geometry) }))
    .filter((part): part is { geometry: Geometry; bounds: Bounds } => part.bounds !== null);

  for (const road of roads) {
    const roadBounds = geometryBounds(road.geometry);
    if (!roadBounds) continue;
    if (parts.length === 0) {
      levels.set(road.properties.roadId, "Unknown");
      continue;
    }
    // Expand by the moderate threshold (degrees; longitude scaled by latitude).
    const latitude = (roadBounds[1] + roadBounds[3]) / 2;
    const marginLat = ENVIRONMENTAL_THRESHOLDS_METERS.moderate / 111_320;
    const marginLon = marginLat / Math.max(0.2, Math.cos((latitude * Math.PI) / 180));
    const [west, south, east, north] = [
      roadBounds[0] - marginLon,
      roadBounds[1] - marginLat,
      roadBounds[2] + marginLon,
      roadBounds[3] + marginLat,
    ];
    let nearest = Infinity;
    for (const part of parts) {
      const [pw, ps, pe, pn] = part.bounds;
      if (pe < west || pw > east || pn < south || ps > north) continue;
      const distance = minimumDistance(road.geometry, part.geometry);
      if (distance !== null && distance < nearest) nearest = distance;
      if (nearest <= ENVIRONMENTAL_THRESHOLDS_METERS.high) break;
    }
    levels.set(
      road.properties.roadId,
      nearest <= ENVIRONMENTAL_THRESHOLDS_METERS.high
        ? "High"
        : nearest <= ENVIRONMENTAL_THRESHOLDS_METERS.moderate
          ? "Moderate"
          : "Low",
    );
  }
  return levels;
}
