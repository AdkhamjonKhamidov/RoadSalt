import assert from "node:assert/strict";
import { test } from "node:test";
import type { Feature, Geometry } from "geojson";
import type { EnvironmentalProperties, RoadProperties } from "../app/lib/data-types";
import { assessEnvironmentalSensitivity } from "../app/lib/proximity";
import { coordinateKey, coordinatesFromSearchParams, ExpiringCache } from "../app/lib/validation";

const METERS_PER_DEGREE = 111_320;
const road: Feature<Geometry, RoadProperties> = {
  type: "Feature",
  geometry: { type: "LineString", coordinates: [[0, 0], [0.01, 0]] },
  properties: { roadId: "way/1", classification: "residential" },
};
const streamAt = (meters: number): Feature<Geometry, EnvironmentalProperties> => ({
  type: "Feature",
  geometry: {
    type: "LineString",
    coordinates: [[0, meters / METERS_PER_DEGREE], [0.01, meters / METERS_PER_DEGREE]],
  },
  properties: { featureId: `way/${meters}`, kind: "waterway" },
});

test("sensitivity levels follow the 50 m / 250 m thresholds", () => {
  assert.equal(assessEnvironmentalSensitivity(road, [streamAt(40)]).level, "High");
  assert.equal(assessEnvironmentalSensitivity(road, [streamAt(200)]).level, "Moderate");
  assert.equal(assessEnvironmentalSensitivity(road, [streamAt(600)]).level, "Low");
  const distance = assessEnvironmentalSensitivity(road, [streamAt(200)]).nearestDistanceMeters ?? 0;
  assert.ok(Math.abs(distance - 200) < 5, `expected ~200 m, got ${distance}`);
});

test("no mapped features means Unknown, not safe", () => {
  const result = assessEnvironmentalSensitivity(road, []);
  assert.equal(result.level, "Unknown");
  assert.equal(result.nearestDistanceMeters, null);
});

test("coordinate query parameters are validated", () => {
  assert.deepEqual(coordinatesFromSearchParams(new URLSearchParams("lat=38.3&lon=-75.6")), { latitude: 38.3, longitude: -75.6 });
  assert.equal(coordinatesFromSearchParams(new URLSearchParams("lat=91&lon=0")), null);
  assert.equal(coordinatesFromSearchParams(new URLSearchParams("lat=abc&lon=0")), null);
  assert.equal(coordinatesFromSearchParams(new URLSearchParams("lat=1")), null);
  assert.equal(coordinateKey(38.34798, -75.6070632), "38.348,-75.607");
});

test("the expiring cache evicts the oldest entry past its size cap", () => {
  const cache = new ExpiringCache<number>(2, 60_000);
  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("c", 3);
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.get("c"), 3);
});
