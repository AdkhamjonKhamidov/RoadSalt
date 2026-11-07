import assert from "node:assert/strict";
import { test } from "node:test";
import { boundingBox, overpassQuery, overpassToGeoJSON } from "../app/lib/geojson";

// Fixtures follow the shape of Overpass `out geom` JSON (synthetic values).
const line = (...points: [number, number][]) => points.map(([lon, lat]) => ({ lat, lon }));
const byIdKind = (data: ReturnType<typeof overpassToGeoJSON>, id: string) =>
  data.environmentalFeatures.features.find((feature) => feature.properties.featureId === id)?.properties.kind;

test("normalizes a road with OSM id, name, ref and selected tags", () => {
  const data = overpassToGeoJSON({
    elements: [
      {
        type: "way",
        id: 42,
        tags: { highway: "primary", name: "Main Street", ref: "US 13", surface: "asphalt", lanes: "2", fixme: "drop me" },
        geometry: line([-75.6, 38.3], [-75.59, 38.31]),
      },
    ],
  });
  const road = data.roads.features[0];
  assert.equal(road.properties.roadId, "way/42");
  assert.equal(road.properties.osmId, 42);
  assert.equal(road.properties.name, "Main Street");
  assert.equal(road.properties.ref, "US 13");
  assert.equal(road.properties.classification, "primary");
  assert.deepEqual(road.properties.tags, { highway: "primary", name: "Main Street", ref: "US 13", surface: "asphalt", lanes: "2" });
  assert.deepEqual(road.geometry, { type: "LineString", coordinates: [[-75.6, 38.3], [-75.59, 38.31]] });
  assert.equal(data.source, "OpenStreetMap Overpass API");
});

test("keeps unnamed roads and service roads, drops driveways and parking aisles", () => {
  const data = overpassToGeoJSON({
    elements: [
      { type: "way", id: 1, tags: { highway: "residential" }, geometry: line([0, 0], [0, 0.001]) },
      { type: "way", id: 2, tags: { highway: "service" }, geometry: line([0, 0], [0, 0.001]) },
      { type: "way", id: 3, tags: { highway: "service", service: "driveway" }, geometry: line([0, 0], [0, 0.001]) },
      { type: "way", id: 4, tags: { highway: "service", service: "parking_aisle" }, geometry: line([0, 0], [0, 0.001]) },
      { type: "way", id: 5, tags: { highway: "footway" }, geometry: line([0, 0], [0, 0.001]) },
    ],
  });
  assert.deepEqual(data.roads.features.map((road) => road.properties.roadId), ["way/1", "way/2"]);
  assert.equal(data.roads.features[0].properties.name, undefined);
});

test("drops elements with invalid coordinates or too few points", () => {
  const data = overpassToGeoJSON({
    elements: [
      { type: "way", id: 1, tags: { highway: "primary" }, geometry: [{ lat: 95, lon: 0 }, { lat: 0, lon: 0 }] },
      { type: "way", id: 2, tags: { highway: "primary" }, geometry: [{ lat: "x", lon: 0 }] },
      { type: "way", id: 3, tags: { highway: "primary" }, geometry: line([0, 0]) },
      { type: "way", id: 4.5, tags: { highway: "primary" }, geometry: line([0, 0], [0, 1]) },
      "garbage",
      null,
    ],
  });
  assert.equal(data.roads.features.length, 0);
});

test("deduplicates elements returned by several union statements", () => {
  const element = { type: "way", id: 7, tags: { natural: "water", water: "pond" }, geometry: line([0, 0], [0, 0.001], [0.001, 0.001], [0, 0]) };
  const data = overpassToGeoJSON({ elements: [element, element] });
  assert.equal(data.environmentalFeatures.features.length, 1);
});

test("classifies environmental features with subtypes and polygon geometry", () => {
  const data = overpassToGeoJSON({
    elements: [
      { type: "way", id: 10, tags: { waterway: "stream", name: "Tony Tank Creek" }, geometry: line([0, 0], [0.001, 0.001]) },
      { type: "way", id: 11, tags: { natural: "water", water: "pond" }, geometry: line([0, 0], [0, 0.001], [0.001, 0.001], [0, 0]) },
      { type: "way", id: 12, tags: { natural: "wetland", wetland: "marsh" }, geometry: line([0, 0], [0, 0.001], [0.001, 0.001], [0, 0]) },
      { type: "way", id: 13, tags: { landuse: "farmland" }, geometry: line([0, 0], [0, 0.001], [0.001, 0.001], [0, 0]) },
      { type: "way", id: 14, tags: { amenity: "parking" }, geometry: line([0, 0], [0, 0.001]) },
      { type: "way", id: 15, tags: { boundary: "protected_area", protect_class: "4" }, geometry: line([0, 0], [0, 0.001], [0.001, 0.001], [0, 0]) },
      { type: "way", id: 16, tags: { boundary: "protected_area", protect_class: "22", name: "Historic District" }, geometry: line([0, 0], [0, 0.001], [0.001, 0.001], [0, 0]) },
    ],
  });
  assert.equal(byIdKind(data, "way/15"), "protected");
  assert.equal(byIdKind(data, "way/16"), undefined, "cultural protections are not environmental");
  const byId = Object.fromEntries(data.environmentalFeatures.features.map((f) => [f.properties.featureId, f]));
  assert.equal(byId["way/10"].properties.kind, "waterway");
  assert.equal(byId["way/10"].properties.subtype, "stream");
  assert.equal(byId["way/10"].properties.osmId, 10);
  assert.equal(byId["way/10"].geometry.type, "LineString");
  assert.equal(byId["way/11"].properties.subtype, "pond");
  assert.equal(byId["way/11"].geometry.type, "Polygon");
  assert.equal(byId["way/12"].properties.kind, "wetland");
  assert.equal(byId["way/12"].properties.subtype, "marsh");
  assert.equal(byId["way/13"].properties.kind, "farmland");
  assert.equal(byId["way/14"], undefined);
});

test("treats an Overpass remark (server-side timeout) as an error", () => {
  assert.throws(
    () => overpassToGeoJSON({ elements: [], remark: "runtime error: Query timed out" }),
    /Query timed out/,
  );
  assert.throws(() => overpassToGeoJSON({ nope: true }), /invalid response/);
});

test("builds a bounding-box query that excludes driveways", () => {
  const query = overpassQuery(38.348, -75.607, 2000);
  assert.match(query, /\[bbox:38\.330\d+,-75\.629\d+,38\.365\d+,-75\.584\d+\]/);
  assert.match(query, /service!~"\^\(driveway\|parking_aisle\|drive-through\)\$"/);
  assert.match(query, /out geom qt;$/);
  const [south, west, north, east] = boundingBox(38.348, -75.607, 2000);
  assert.ok(north - south > 0.035 && north - south < 0.037);
  assert.ok(east - west > north - south, "longitude span widens away from the equator");
});
