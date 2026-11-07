import assert from "node:assert/strict";
import { test } from "node:test";
import type { Feature, Geometry } from "geojson";
import type { NwsAlert, RoadProperties, TrafficIncident } from "../app/lib/data-types";
import {
  areaCautionReason,
  baseRoadCondition,
  incidentsOnRoad,
  roadConditionFor,
  summarizeConditions,
} from "../app/lib/road-conditions";
import { incidentsUrl, parseIncidents } from "../app/lib/traffic-incidents";

// Fixtures follow the shape of TomTom incidentDetails v5 responses (synthetic values).
const tomtom = (iconCategory: number, coordinates: unknown, extra: Record<string, unknown> = {}) => ({
  type: "Feature",
  geometry: { type: Array.isArray((coordinates as unknown[])[0]) ? "LineString" : "Point", coordinates },
  properties: { id: `i${iconCategory}-${JSON.stringify(coordinates).length}`, iconCategory, events: [{ description: extra.description ?? "Event" }], ...extra },
});

test("parses closures and hazards, drops unknown categories and bad geometry", () => {
  const incidents = parseIncidents({
    incidents: [
      tomtom(9, [[-75.6, 38.35], [-75.59, 38.35]], { description: "Roadworks", roadNumbers: ["US-13"] }),
      tomtom(8, [[-75.6, 38.36], [-75.59, 38.36]], { description: "Closed", from: "Main St", to: "Oak St" }),
      tomtom(0, [-75.6, 38.35]),
      tomtom(5, [[-75.6, 95], [-75.59, 38.35]]),
      tomtom(1, [-75.61, 38.34], { description: "Crash" }),
      null,
    ],
  });
  assert.deepEqual(incidents.map((incident) => incident.condition), ["closed", "caution", "caution"]);
  assert.equal(incidents[0].type, "Road closed");
  assert.equal(incidents[0].from, "Main St");
  assert.deepEqual(incidents[1].roads, ["US-13"]);
  assert.equal(incidents[2].geometry.type, "Point");
  assert.throws(() => parseIncidents({ detailedError: { message: "Invalid key" } }), /Invalid key/);
});

test("builds a TomTom query box around the point", () => {
  const url = new URL(incidentsUrl("abc", 38.35, -75.6));
  assert.equal(url.searchParams.get("bbox"), "-75.70000,38.25000,-75.50000,38.45000");
  assert.equal(url.searchParams.get("timeValidityFilter"), "present");
});

const alert = (event: string): NwsAlert => ({ id: event, event, headline: null, severity: null, onset: null, ends: null });

test("area caution comes from winter alerts or freezing forecast, not other alerts", () => {
  assert.equal(areaCautionReason([alert("Winter Storm Warning")], "Low"), "Winter Storm Warning in effect");
  assert.equal(areaCautionReason([alert("Heat Advisory")], "Low"), null);
  assert.equal(areaCautionReason([alert("Freeze Warning"), alert("Frost Advisory")], "Low"), null, "crop alerts are not road hazards");
  assert.equal(areaCautionReason([alert("Ice Storm Warning")], "Low"), "Ice Storm Warning in effect");
  assert.equal(areaCautionReason([], "Elevated"), "Freezing precipitation in the 24-hour forecast");
  assert.equal(areaCautionReason(null, "Moderate"), null);
});

test("roads are green only when incident data was actually loaded", () => {
  assert.equal(baseRoadCondition(true, null), "clear");
  assert.equal(baseRoadCondition(false, null), "unknown");
  assert.equal(baseRoadCondition(true, "Ice Storm Warning in effect"), "caution");
});

const road: Feature<Geometry, RoadProperties> = {
  type: "Feature",
  geometry: { type: "LineString", coordinates: [[-75.6, 38.35], [-75.59, 38.35]] },
  properties: { roadId: "r", classification: "primary" },
};
const incident = (condition: TrafficIncident["condition"], latitude: number): TrafficIncident => ({
  id: `${condition}${latitude}`,
  condition,
  type: condition === "closed" ? "Road closed" : "Accident",
  description: condition === "closed" ? "Closed for flooding" : "Crash",
  from: null,
  to: null,
  roads: [],
  start: null,
  end: null,
  geometry: { type: "LineString", coordinates: [[-75.6, latitude], [-75.595, latitude]] },
});

test("a road's condition comes from incidents on it, then area caution", () => {
  const onRoad = incidentsOnRoad(road, [incident("caution", 38.35), incident("closed", 38.40)]);
  assert.equal(onRoad.length, 1, "the closure 5.5 km away is not on this road");
  assert.equal(roadConditionFor(onRoad, true, null).condition, "caution");
  assert.equal(roadConditionFor([incident("closed", 38.35), ...onRoad], true, null).reason, "Closed for flooding");
  assert.equal(roadConditionFor([], true, "Winter Storm Warning in effect").condition, "caution");
  assert.equal(roadConditionFor([], true, null).condition, "clear");
  assert.equal(roadConditionFor([], false, null).condition, "unknown");
});

test("the banner states what is happening in plain words", () => {
  assert.match(
    summarizeConditions({ incidents: [], incidentsConfigured: true, incidentsError: null, areaCaution: null }).headline,
    /No closures or hazards reported/,
  );
  const closures = summarizeConditions({
    incidents: [incident("closed", 1), incident("caution", 2)],
    incidentsConfigured: true,
    incidentsError: null,
    areaCaution: null,
  });
  assert.equal(closures.tone, "closed");
  assert.equal(closures.headline, "1 closure and 1 hazard reported nearby.");
  const notConnected = summarizeConditions({ incidents: null, incidentsConfigured: false, incidentsError: null, areaCaution: null });
  assert.equal(notConnected.tone, "unknown");
  assert.match(notConnected.detail, /TOMTOM_API_KEY/);
  assert.match(
    summarizeConditions({ incidents: null, incidentsConfigured: false, incidentsError: null, areaCaution: "Winter Storm Warning in effect" }).headline,
    /Use caution on all roads/,
  );
});
