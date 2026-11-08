import assert from "node:assert/strict";
import { test } from "node:test";
import {
  adviceCacheKey,
  adviceRequestBody,
  buildAdvicePrompt,
  parseAdviceChunk,
  parseAdviceContext,
  redactRates,
  splitSseEvents,
} from "../app/lib/advice";

// Synthetic fixtures shaped like the browser's request and Gemini's SSE events.
// Used only to check parsing logic; never shown in the UI.

const context = {
  roadId: "tile:Camden Avenue:tertiary",
  road: { name: "Camden Avenue", classification: "Tertiary", ref: null },
  location: { name: "1101 Camden Ave", displayName: "1101 Camden Ave, Salisbury, MD 21801", latitude: 38.348, longitude: -75.6071, timezone: "America/New_York" },
  condition: { label: "No reported problems", reason: "No closures or hazards reported on this road.", incidents: [] },
  environment: {
    level: "High",
    features: [{ name: "Mapped water body", distanceMeters: 0 }],
    segments: { count: 12, totalMeters: 1180, high: 2, moderate: 3, low: 7, stretches: ["0–200 m along the road: High, Mapped water body 0 m away"] },
  },
  weather: {
    description: "Clear",
    temperatureC: 7.3,
    apparentC: 4.4,
    windKmh: 9,
    attention: "Low",
    next24h: { minC: 6, maxC: 14, maxPrecipChance: 3, totalPrecipMm: 0, totalSnowCm: 0, hoursAtOrBelowFreezing: 0 },
  },
  observation: { stationId: "KSBY", temperatureC: 7.8, time: "2026-11-07T22:54:00Z" },
  alerts: [],
  stormReports: [],
};

test("parseAdviceContext accepts a well-formed context and caps lists", () => {
  const parsed = parseAdviceContext({ ...context, alerts: Array.from({ length: 20 }, (_, i) => `Alert ${i}`) });
  assert.ok(parsed);
  assert.equal(parsed.road.name, "Camden Avenue");
  assert.equal(parsed.alerts.length, 6);
  assert.equal(parsed.environment.features[0].distanceMeters, 0);
});

test("parseAdviceContext rejects missing road or bad coordinates", () => {
  assert.equal(parseAdviceContext({ ...context, road: null }), null);
  assert.equal(parseAdviceContext({ ...context, location: { ...context.location, latitude: 120 } }), null);
  assert.equal(parseAdviceContext("nope"), null);
});

test("prompt carries the real values and the request enables Google Search", () => {
  const parsed = parseAdviceContext(context);
  assert.ok(parsed);
  const prompt = buildAdvicePrompt(parsed);
  assert.match(prompt, /Camden Avenue \(Tertiary\)/);
  assert.match(prompt, /Mapped water body: 0 m/);
  assert.match(prompt, /KSBY/);
  assert.match(prompt, /12 segments, 1180 m loaded\): 2 high/);
  assert.match(prompt, /- 0–200 m along the road: High/);
  const body = adviceRequestBody(parsed, "gemini-3.5-flash-lite");
  assert.deepEqual(body.tools, [{ type: "google_search" }]);
  assert.equal(body.stream, true);
  assert.match(body.system_instruction, /Never give numeric application rates/);
});

test("cache key is stable within the hour and changes with the road", () => {
  const parsed = parseAdviceContext(context);
  assert.ok(parsed);
  const at = new Date("2026-11-07T23:10:00Z");
  assert.equal(adviceCacheKey(parsed, at), adviceCacheKey(parsed, new Date("2026-11-07T23:55:00Z")));
  assert.notEqual(adviceCacheKey(parsed, at), adviceCacheKey({ ...parsed, roadId: "other" }, at));
});

test("splitSseEvents returns complete data payloads and keeps the remainder", () => {
  const { events, rest } = splitSseEvents('event: step.delta\ndata: {"a":1}\n\nevent: x\ndata: [DONE]\n\ndata: {"partial"');
  assert.deepEqual(events, ['{"a":1}']);
  assert.equal(rest, 'data: {"partial"');
});

test("parseAdviceChunk reads text deltas, citations, suggestions and errors", () => {
  const delta = parseAdviceChunk(JSON.stringify({ event_type: "step.delta", index: 1, delta: { type: "text", text: "## Assessment" } }));
  assert.equal(delta.delta, "## Assessment");

  const completed = parseAdviceChunk(
    JSON.stringify({
      event_type: "interaction.completed",
      interaction: {
        outputs: [
          { type: "google_search_result", result: [{ search_suggestions: "<div>chips</div>" }] },
          { type: "text", text: "Full text", annotations: [{ type: "url_citation", url: "https://example.org/a", title: "A" }, { type: "url_citation", url: "javascript:alert(1)", title: "bad" }] },
        ],
      },
    }),
  );
  assert.equal(completed.finalText, "Full text");
  assert.deepEqual(completed.citations, [{ url: "https://example.org/a", title: "A" }]);
  assert.equal(completed.searchSuggestionsHtml, "<div>chips</div>");

  assert.equal(parseAdviceChunk(JSON.stringify({ event_type: "error", error: { message: "quota" } })).error, "quota");
  assert.equal(parseAdviceChunk("not json").delta, null);
});

test("redactRates removes lines with numeric application rates", () => {
  const output = "- Pre-wet salt before spreading.\n- Apply 200 lbs per lane mile.\n- Monitor the bridge.";
  const cleaned = redactRates(output);
  assert.doesNotMatch(cleaned, /200 lbs/);
  assert.match(cleaned, /Pre-wet salt/);
  assert.match(cleaned, /Monitor the bridge/);
});
