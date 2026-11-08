import assert from "node:assert/strict";
import { test } from "node:test";
import type { Feature, Geometry } from "geojson";
import type { EnvironmentalProperties, RoadProperties } from "../app/lib/data-types";
import {
  categorizePlowStatus,
  feedsForLocation,
  parsePlowFeedResponse,
  PLOW_FEEDS,
} from "../app/lib/plow-feeds";
import { roadSensitivityLevels } from "../app/lib/proximity";
import { parseStormReports } from "../app/lib/storm-reports";
import {
  celsiusToFahrenheit,
  fahrenheitToCelsius,
  formatDistance,
  formatPrecipitation,
  formatSpeed,
  formatTemperature,
} from "../app/lib/units";

// Fixtures follow the shape of real IEM LSR and ArcGIS responses (synthetic values).

test("converts and formats units, Fahrenheit first", () => {
  assert.equal(celsiusToFahrenheit(0), 32);
  assert.equal(celsiusToFahrenheit(-40), -40);
  assert.ok(Math.abs(fahrenheitToCelsius(212) - 100) < 1e-9);
  assert.equal(formatTemperature(0, "imperial"), "32 °F");
  assert.equal(formatTemperature(0, "metric"), "0 °C");
  assert.equal(formatTemperature(null, "imperial"), "Not reported");
  assert.equal(formatSpeed(16.0934, "imperial"), "10 mph");
  assert.equal(formatPrecipitation(25.4, "imperial"), "1.00 in");
  assert.equal(formatDistance(30.48, "imperial"), "100 ft");
  assert.equal(formatDistance(0.2, "metric"), "touching or crossing");
});

const lsr = (properties: Record<string, unknown>, coordinates: unknown = [-75.6, 38.35]) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates },
  properties,
});

test("parses storm reports near the point, newest first, winter flagged", () => {
  const reports = parseStormReports(
    {
      features: [
        lsr({ typetext: "SNOW", magf: 3.5, unit: "INCH", city: "2 N Salisbury", county: "Wicomico", state: "MD", valid: "2026-11-07T10:00:00Z", source: "Trained Spotter", wfo: "AKQ" }),
        lsr({ typetext: "TSTM WND GST", magf: 58, unit: "MPH", city: "Far Away", valid: "2026-11-07T12:00:00Z" }, [-80, 40]),
        lsr({ typetext: "FREEZING RAIN", magf: 0, city: "Fruitland", valid: "2026-11-07T11:00:00Z" }, [-75.62, 38.32]),
        lsr({ typetext: "SNOW", valid: "not a date" }),
        lsr({ typetext: "SNOW", valid: "2026-11-07T10:00:00Z" }, [999, 0]),
        null,
      ],
    },
    38.348,
    -75.607,
  );
  assert.deepEqual(reports.map((report) => report.type), ["FREEZING RAIN", "SNOW"]);
  assert.equal(reports[0].winter, true);
  assert.equal(reports[0].magnitude, null, "0 magnitude means none was given");
  assert.equal(reports[1].magnitude, 3.5);
  assert.equal(reports[1].location, "2 N Salisbury, Wicomico County, MD");
  assert.ok(reports[1].distanceKm < 2);
  assert.throws(() => parseStormReports({}, 0, 0), /invalid response/);
});

test("categorizes agency plow statuses without over-claiming", () => {
  assert.equal(categorizePlowStatus("Untreated"), "untreated");
  assert.equal(categorizePlowStatus("Not plowed"), "untreated");
  assert.equal(categorizePlowStatus("Inspected Plowed or Treated"), "treated");
  assert.equal(categorizePlowStatus("3rd Pass"), "repeat-pass");
  assert.equal(categorizePlowStatus("Crew assigned"), "unknown");
  assert.equal(categorizePlowStatus(null), "unknown");
});

test("finds registered plow feeds only where they cover", () => {
  assert.deepEqual(feedsForLocation(38.29, -76.64).map((feed) => feed.id), ["stmarys-md"]);
  assert.deepEqual(feedsForLocation(38.348, -75.607), []);
  assert.deepEqual(feedsForLocation(44.98, -93.27), []);
});

test("parses an agency feed and marks old status as stale", () => {
  const feed = PLOW_FEEDS[0];
  const now = Date.parse("2026-11-07T12:00:00Z");
  const result = parsePlowFeedResponse(
    feed,
    {
      features: [
        { id: 1, type: "Feature", geometry: { type: "LineString", coordinates: [[-76.6, 38.3], [-76.59, 38.31]] }, properties: { Group_: "Abells Wharf Road", Status: "Untreated", EditDate: Date.parse("2026-03-02T17:15:00Z"), FIRST_Rout: "Route 22", SUM_Miles: 0.86 } },
        { id: 2, type: "Feature", geometry: { type: "LineString", coordinates: [[-76.6, 38.3], [-76.59, 38.31]] }, properties: { Group_: "Fresh Road", Status: "2nd Pass", EditDate: Date.parse("2026-11-07T11:00:00Z") } },
        { id: 3, type: "Feature", geometry: { type: "LineString", coordinates: [[-76.6, 95]] }, properties: { Status: "Untreated" } },
        { id: 4, type: "Feature", geometry: { type: "Point", coordinates: [-76.6, 38.3] }, properties: { Status: "Untreated" } },
      ],
    },
    now,
  );
  assert.equal(result.routes.features.length, 2);
  const [old, fresh] = result.routes.features.map((feature) => feature.properties);
  assert.equal(old.stale, true);
  assert.equal(old.category, "untreated");
  assert.equal(old.route, "Route 22");
  assert.equal(fresh.stale, false);
  assert.equal(fresh.category, "repeat-pass");
  assert.equal(result.allStale, false);
  assert.equal(result.newestUpdate, "2026-11-07T11:00:00.000Z");
  assert.throws(() => parsePlowFeedResponse(feed, { error: { message: "Invalid token" } }), /Invalid token/);
});

test("keeps forests out of the sensitivity level", () => {
  const road = (id: string, latitudeOffset: number): Feature<Geometry, RoadProperties> => ({
    type: "Feature",
    geometry: { type: "LineString", coordinates: [[0, latitudeOffset], [0.01, latitudeOffset]] },
    properties: { roadId: id, classification: "residential" },
  });
  const stream: Feature<Geometry, EnvironmentalProperties> = {
    type: "Feature",
    geometry: { type: "LineString", coordinates: [[0, 0], [0.01, 0]] },
    properties: { featureId: "s", kind: "waterway" },
  };
  const woods: Feature<Geometry, EnvironmentalProperties> = {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [[[0, 0.01], [0.01, 0.01], [0.01, 0.02], [0, 0.01]]] },
    properties: { featureId: "w", kind: "forest" },
  };
  const levels = roadSensitivityLevels(
    [road("near", 30 / 111_320), road("mid", 200 / 111_320), road("far", 0.0099)],
    [stream, woods],
  );
  assert.equal(levels.get("near"), "High");
  assert.equal(levels.get("mid"), "Moderate");
  assert.equal(levels.get("far"), "Low", "touching woods but far from water stays Low");
  assert.equal(roadSensitivityLevels([road("x", 0)], []).get("x"), "Unknown");
});
