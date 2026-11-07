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

function minimumDistance(
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

  const nearest = distances[0];
  if (!nearest) {
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
