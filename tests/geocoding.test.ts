import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeQuery, parsePhotonResponse, zoomForLocation } from "../app/lib/geocoding";

// Fixtures follow the shape of real Photon responses (synthetic values).
const photonFeature = (properties: Record<string, unknown>, coordinates: unknown = [-76.61, 39.29]) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates },
  properties,
});

test("parses a city result with locality, region, country and extent", () => {
  const [location] = parsePhotonResponse({
    features: [
      photonFeature({
        osm_type: "R",
        osm_id: 133345,
        name: "Baltimore",
        state: "Maryland",
        country: "United States",
        type: "city",
        extent: [-76.71, 39.37, -76.53, 39.2],
      }),
    ],
  });
  assert.equal(location.id, "osm:R133345");
  assert.equal(location.name, "Baltimore");
  assert.equal(location.displayName, "Baltimore, Maryland, United States");
  assert.equal(location.region, "Maryland");
  assert.deepEqual(location.boundingBox, [-76.71, 39.2, -76.53, 39.37]);
  assert.equal(location.placeType, "city");
});

test("builds a street address when there is no place name", () => {
  const [location] = parsePhotonResponse({
    features: [
      photonFeature({ housenumber: "1101", street: "Camden Avenue", city: "Salisbury", state: "Maryland", type: "house" }),
    ],
  });
  assert.equal(location.name, "1101 Camden Avenue");
  assert.equal(location.locality, "Salisbury");
});

test("skips malformed features instead of crashing", () => {
  const results = parsePhotonResponse({
    features: [
      null,
      "nope",
      photonFeature({ name: "Bad latitude" }, [-76.6, 123]),
      photonFeature({ name: "Not numbers" }, ["a", "b"]),
      photonFeature({ state: "Maryland" }), // no name or street
      { type: "Feature", geometry: { type: "LineString", coordinates: [] }, properties: { name: "Line" } },
      photonFeature({ name: "Valid" }),
    ],
  });
  assert.deepEqual(results.map((item) => item.name), ["Valid"]);
});

test("ignores an invalid extent but keeps the place", () => {
  const [location] = parsePhotonResponse({
    features: [photonFeature({ name: "Somewhere", extent: [1, 2, "x", 4] })],
  });
  assert.equal(location.boundingBox, null);
});

test("deduplicates repeated OSM objects and same-label places close together", () => {
  const feature = photonFeature({ osm_type: "W", osm_id: 1, name: "Lincoln Memorial", city: "Washington" });
  assert.equal(parsePhotonResponse({ features: [feature, feature] }).length, 1);
  // A city's boundary relation and its center node, ~1 km apart.
  const relation = photonFeature({ osm_type: "R", osm_id: 2, name: "Baltimore", state: "Maryland" }, [-76.611, 39.291]);
  const node = photonFeature({ osm_type: "N", osm_id: 3, name: "Baltimore", state: "Maryland" }, [-76.6, 39.29]);
  // Same name in another state stays.
  const other = photonFeature({ osm_type: "R", osm_id: 4, name: "Baltimore", state: "Ohio" }, [-82.6, 39.85]);
  assert.equal(parsePhotonResponse({ features: [relation, node, other] }).length, 2);
});

test("rejects a response without a features array", () => {
  assert.throws(() => parsePhotonResponse({ results: [] }), /invalid response/);
  assert.throws(() => parsePhotonResponse(null), /invalid response/);
});

test("normalizes queries and enforces the minimum length", () => {
  assert.equal(normalizeQuery("  Salisbury   MD "), "Salisbury MD");
  assert.equal(normalizeQuery("ab"), null);
  assert.equal(normalizeQuery(null), null);
  assert.equal(normalizeQuery("x".repeat(201)), null);
});

test("chooses a zoom by place type", () => {
  const base = parsePhotonResponse({ features: [photonFeature({ name: "X", type: "house" })] })[0];
  assert.equal(zoomForLocation(base), 16);
  assert.equal(zoomForLocation({ ...base, placeType: "city" }), 14);
  assert.equal(zoomForLocation({ ...base, placeType: "state" }), 9);
  assert.equal(zoomForLocation({ ...base, placeType: null }), 15);
});
