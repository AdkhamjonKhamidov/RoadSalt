import assert from "node:assert/strict";
import { test } from "node:test";
import type { Feature, Geometry } from "geojson";
import type { EnvironmentalProperties, RoadProperties } from "../app/lib/data-types";
import { prepareSensitiveParts } from "../app/lib/proximity";
import { segmentRoad, segmentRoads, splitLine, summarizeSegments } from "../app/lib/segments";

// Synthetic geometry near the equator: 0.001° of longitude ≈ 111 m.
const metersToDegrees = (meters: number) => meters / 111_320;

test("splitLine cuts a 450 m line into 100 m pieces plus a 50 m tail", () => {
  const pieces = splitLine([[0, 0], [metersToDegrees(450), 0]], 100);
  assert.equal(pieces.length, 5);
  assert.deepEqual(pieces.map((piece) => Math.round(piece.meters)), [100, 100, 100, 100, 50]);
  // Pieces join end to start.
  assert.deepEqual(pieces[1].coordinates[0], pieces[0].coordinates.at(-1));
});

test("splitLine handles multi-vertex lines and drops a tiny tail", () => {
  const line = [[0, 0], [metersToDegrees(60), 0], [metersToDegrees(60), metersToDegrees(143)]];
  const pieces = splitLine(line, 100);
  assert.equal(pieces.length, 2);
  assert.equal(Math.round(pieces[0].meters), 100);
  assert.ok(pieces[0].coordinates.length === 3, "first piece bends around the corner");
  assert.equal(splitLine([[0, 0], [metersToDegrees(3), 0]], 100).length, 0);
});

const road: Feature<Geometry, RoadProperties> = {
  type: "Feature",
  geometry: { type: "LineString", coordinates: [[0, 0], [metersToDegrees(1000), 0]] },
  properties: { roadId: "tile:residential:Test Road", name: "Test Road", classification: "residential" },
};
// A creek crossing the road at x = 50 m, and woods along its whole length.
const creek: Feature<Geometry, EnvironmentalProperties> = {
  type: "Feature",
  geometry: { type: "LineString", coordinates: [[metersToDegrees(50), -0.001], [metersToDegrees(50), 0.001]] },
  properties: { featureId: "c", kind: "waterway", name: "Test Creek" },
};
const woods: Feature<Geometry, EnvironmentalProperties> = {
  type: "Feature",
  geometry: { type: "Polygon", coordinates: [[[0, 0], [metersToDegrees(1000), 0], [metersToDegrees(1000), 0.001], [0, 0]]] },
  properties: { featureId: "w", kind: "forest" },
};

test("segmentRoad rates each 100 m piece by its own distance to water", () => {
  const segments = segmentRoad(road, prepareSensitiveParts([creek, woods]));
  assert.equal(segments.length, 10);
  assert.equal(segments[0].properties.sensitivity, "High", "piece crossing the creek");
  assert.equal(segments[0].properties.nearestFeature?.name, "Test Creek");
  assert.equal(segments[1].properties.sensitivity, "Moderate", "50–150 m from the creek");
  assert.equal(segments[9].properties.sensitivity, "Low", "far end; woods alone never raise the level");
  assert.equal(segments[3].properties.segmentId, "tile:residential:Test Road#3");
  assert.equal(segments[3].properties.roadId, road.properties.roadId, "segments keep the road id for selection");
});

test("summarizeSegments merges consecutive pieces into stretches", () => {
  const summary = summarizeSegments(segmentRoad(road, prepareSensitiveParts([creek])));
  assert.equal(summary.count, 10);
  assert.equal(Math.round(summary.totalMeters), 1000);
  assert.equal(summary.counts.High, 1);
  assert.ok(summary.counts.Moderate >= 1);
  assert.equal(summary.stretches[0].level, "High");
  assert.equal(summary.stretches[0].startMeters, 0);
  const moderate = summary.stretches.filter((stretch) => stretch.level === "Moderate");
  assert.equal(moderate.length, 1, "adjacent moderate pieces merge into one stretch");
});

test("segmentRoads marks everything Unknown when no features are loaded", () => {
  const all = segmentRoads([road], []);
  assert.ok(all.features.every((segment) => segment.properties.sensitivity === "Unknown"));
});
