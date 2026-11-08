// Splits roads into fixed-length pieces (100 m by default) and rates salt
// runoff exposure for each piece: the distance from that stretch to the
// nearest mapped waterway, water body, wetland, farmland or protected area.
// A long road that only touches a creek at one end is then "High" only where
// it actually meets the creek, instead of along its whole length.

import type { Feature, FeatureCollection, Geometry, Position } from "geojson";
import type { EnvironmentalProperties, RoadProperties } from "./data-types";
import { ROAD_SEGMENT_METERS } from "./demo-config";
import {
  levelForDistance,
  nearestSensitiveFeature,
  prepareSensitiveParts,
  type SensitiveParts,
  type SensitivityLevel,
} from "./proximity";

export type SegmentProperties = RoadProperties & {
  segmentId: string;
  /** 0-based order along the road (across all of its loaded parts). */
  segmentIndex: number;
  /** Distance along the road where this piece starts and ends, in metres. */
  startMeters: number;
  endMeters: number;
  sensitivity: SensitivityLevel;
  /** Nearest sensitive feature within 250 m, if any. */
  nearestFeature: { name: string | null; kind: EnvironmentalProperties["kind"]; distanceMeters: number } | null;
};

export type RoadSegment = Feature<Geometry, SegmentProperties>;

const METERS_PER_DEGREE = 111_320;

function distanceMeters(a: Position, b: Position): number {
  const latitude = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const dx = (b[0] - a[0]) * METERS_PER_DEGREE * Math.cos(latitude);
  const dy = (b[1] - a[1]) * METERS_PER_DEGREE;
  return Math.hypot(dx, dy);
}

function interpolate(a: Position, b: Position, amount: number): Position {
  return [a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount];
}

/** Cuts one polyline into consecutive pieces of `length` metres (the last may be shorter). */
export function splitLine(line: Position[], length = ROAD_SEGMENT_METERS): { coordinates: Position[]; meters: number }[] {
  const pieces: { coordinates: Position[]; meters: number }[] = [];
  let current: Position[] = [line[0]];
  let currentLength = 0;
  for (let index = 1; index < line.length; index += 1) {
    let start = line[index - 1];
    const end = line[index];
    let remaining = distanceMeters(start, end);
    while (currentLength + remaining >= length && remaining > 0) {
      const needed = length - currentLength;
      const cut = interpolate(start, end, needed / remaining);
      current.push(cut);
      pieces.push({ coordinates: current, meters: length });
      current = [cut];
      currentLength = 0;
      remaining -= needed;
      start = cut;
    }
    if (remaining > 0) {
      current.push(end);
      currentLength += remaining;
    }
  }
  // Keep a short tail only if it is a real stretch of road (> 5 m).
  if (current.length >= 2 && currentLength > 5) pieces.push({ coordinates: current, meters: currentLength });
  return pieces;
}

function lineParts(geometry: Geometry): Position[][] {
  if (geometry.type === "LineString") return geometry.coordinates.length >= 2 ? [geometry.coordinates] : [];
  if (geometry.type === "MultiLineString") return geometry.coordinates.filter((line) => line.length >= 2);
  return [];
}

function rateSegment(geometry: Geometry, parts: SensitiveParts) {
  if (parts.length === 0) return { sensitivity: "Unknown" as const, nearestFeature: null };
  const nearest = nearestSensitiveFeature(geometry, parts);
  return {
    sensitivity: levelForDistance(nearest?.distanceMeters ?? null),
    nearestFeature: nearest
      ? { name: nearest.feature.name ?? null, kind: nearest.feature.kind, distanceMeters: nearest.distanceMeters }
      : null,
  };
}

/** Splits one road and rates each piece. `parts` comes from prepareSensitiveParts. */
export function segmentRoad(road: Feature<Geometry, RoadProperties>, parts: SensitiveParts, length = ROAD_SEGMENT_METERS): RoadSegment[] {
  const segments: RoadSegment[] = [];
  let along = 0;
  for (const line of lineParts(road.geometry)) {
    for (const piece of splitLine(line, length)) {
      const geometry: Geometry = { type: "LineString", coordinates: piece.coordinates };
      const index = segments.length;
      segments.push({
        type: "Feature",
        geometry,
        properties: {
          ...road.properties,
          segmentId: `${road.properties.roadId}#${index}`,
          segmentIndex: index,
          startMeters: along,
          endMeters: along + piece.meters,
          ...rateSegment(geometry, parts),
        },
      });
      along += piece.meters;
    }
  }
  return segments;
}

/** Segments for every road (used to colour the map in the proximity view). */
export function segmentRoads(
  roads: Feature<Geometry, RoadProperties>[],
  features: Feature<Geometry, EnvironmentalProperties>[],
  length = ROAD_SEGMENT_METERS,
): FeatureCollection<Geometry, SegmentProperties> {
  const parts = prepareSensitiveParts(features);
  return { type: "FeatureCollection", features: roads.flatMap((road) => segmentRoad(road, parts, length)) };
}

export type SegmentSummary = {
  count: number;
  totalMeters: number;
  counts: Record<SensitivityLevel, number>;
  /** Consecutive High/Moderate pieces merged into stretches, worst first. */
  stretches: {
    level: "High" | "Moderate";
    startMeters: number;
    endMeters: number;
    nearestFeature: SegmentProperties["nearestFeature"];
  }[];
};

export function summarizeSegments(segments: RoadSegment[]): SegmentSummary {
  const counts: Record<SensitivityLevel, number> = { High: 0, Moderate: 0, Low: 0, Unknown: 0 };
  const stretches: SegmentSummary["stretches"] = [];
  for (const { properties } of segments) {
    counts[properties.sensitivity] += 1;
    if (properties.sensitivity !== "High" && properties.sensitivity !== "Moderate") continue;
    const last = stretches[stretches.length - 1];
    if (last && last.level === properties.sensitivity && Math.abs(last.endMeters - properties.startMeters) < 1) {
      last.endMeters = properties.endMeters;
      if (properties.nearestFeature && (!last.nearestFeature || properties.nearestFeature.distanceMeters < last.nearestFeature.distanceMeters)) {
        last.nearestFeature = properties.nearestFeature;
      }
    } else {
      stretches.push({
        level: properties.sensitivity,
        startMeters: properties.startMeters,
        endMeters: properties.endMeters,
        nearestFeature: properties.nearestFeature,
      });
    }
  }
  stretches.sort((a, b) => (a.level === b.level ? a.startMeters - b.startMeters : a.level === "High" ? -1 : 1));
  return {
    count: segments.length,
    totalMeters: segments.reduce((sum, segment) => sum + (segment.properties.endMeters - segment.properties.startMeters), 0),
    counts,
    stretches,
  };
}
