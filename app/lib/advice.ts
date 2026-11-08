// Treatment-strategy suggestions for one selected road, written by Gemini
// from the live data RoadSalt already shows plus Google Search grounding for
// current local news. Framework-free: the route and tests both use it.
//
// Scope (approved by the user 2026-11-07): a practical *approach* per road,
// clearly labelled as AI-generated. Never numeric application rates, and never
// a claim that a road is icy or safe.

import { finiteNumber, isRecord, text } from "./validation";

export const GEMINI_MODEL_DEFAULT = "gemini-3.5-flash-lite";
export const GEMINI_INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions?alt=sse";

export type AdviceContext = {
  roadId: string;
  road: { name: string; classification: string; ref: string | null };
  location: { name: string; displayName: string; latitude: number; longitude: number; timezone: string | null };
  condition: { label: string; reason: string; incidents: string[] };
  environment: {
    level: string;
    features: { name: string; distanceMeters: number }[];
    /** Per-100 m exposure along the road; null when not computed. */
    segments: {
      count: number;
      totalMeters: number;
      high: number;
      moderate: number;
      low: number;
      stretches: string[];
    } | null;
  };
  weather: {
    description: string | null;
    temperatureC: number | null;
    apparentC: number | null;
    windKmh: number | null;
    attention: string;
    next24h: {
      minC: number | null;
      maxC: number | null;
      maxPrecipChance: number | null;
      totalPrecipMm: number | null;
      totalSnowCm: number | null;
      hoursAtOrBelowFreezing: number | null;
    };
  };
  observation: { stationId: string; temperatureC: number | null; time: string } | null;
  alerts: string[];
  stormReports: string[];
};

export type AdviceCitation = { url: string; title: string };

/** One line of the route's NDJSON stream. */
export type AdviceEvent =
  | { type: "text"; text: string }
  | { type: "sources"; citations: AdviceCitation[]; searchSuggestionsHtml: string | null }
  | { type: "error"; message: string }
  | { type: "done"; cached: boolean; model: string; grounded: boolean };

// --- Input validation (the body comes from the browser) ---

function stringList(value: unknown, maxItems: number, maxLength = 200): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => text(item, maxLength)).filter((item): item is string => item !== null).slice(0, maxItems);
}

function numberOrNull(value: unknown): number | null {
  return value === null ? null : finiteNumber(value);
}

export function parseAdviceContext(value: unknown): AdviceContext | null {
  if (!isRecord(value)) return null;
  const { road, location, condition, environment, weather, observation } = value;
  const roadId = text(value.roadId, 200);
  if (!roadId || !isRecord(road) || !isRecord(location) || !isRecord(condition) || !isRecord(environment) || !isRecord(weather)) {
    return null;
  }
  const name = text(road.name, 200);
  const classification = text(road.classification, 60);
  const latitude = finiteNumber(location.latitude);
  const longitude = finiteNumber(location.longitude);
  const locationName = text(location.name, 200);
  if (!name || !classification || latitude === null || longitude === null || !locationName) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;

  const next = isRecord(weather.next24h) ? weather.next24h : {};
  const features = Array.isArray(environment.features)
    ? environment.features
        .filter(isRecord)
        .map((feature) => ({ name: text(feature.name, 120), distanceMeters: finiteNumber(feature.distanceMeters) }))
        .filter((feature): feature is { name: string; distanceMeters: number } => feature.name !== null && feature.distanceMeters !== null)
        .slice(0, 8)
    : [];

  let segments: AdviceContext["environment"]["segments"] = null;
  if (isRecord(environment.segments)) {
    const seg = environment.segments;
    const count = finiteNumber(seg.count);
    const totalMeters = finiteNumber(seg.totalMeters);
    if (count !== null && totalMeters !== null) {
      segments = {
        count,
        totalMeters,
        high: finiteNumber(seg.high) ?? 0,
        moderate: finiteNumber(seg.moderate) ?? 0,
        low: finiteNumber(seg.low) ?? 0,
        stretches: stringList(seg.stretches, 6),
      };
    }
  }

  let parsedObservation: AdviceContext["observation"] = null;
  if (isRecord(observation)) {
    const stationId = text(observation.stationId, 12);
    const time = text(observation.time, 40);
    if (stationId && time) parsedObservation = { stationId, time, temperatureC: numberOrNull(observation.temperatureC) };
  }

  return {
    roadId,
    road: { name, classification, ref: text(road.ref, 60) },
    location: {
      name: locationName,
      displayName: text(location.displayName, 300) ?? locationName,
      latitude,
      longitude,
      timezone: text(location.timezone, 60),
    },
    condition: {
      label: text(condition.label, 60) ?? "Unknown",
      reason: text(condition.reason, 300) ?? "",
      incidents: stringList(condition.incidents, 5),
    },
    environment: { level: text(environment.level, 20) ?? "Unknown", features, segments },
    weather: {
      description: text(weather.description, 60),
      temperatureC: numberOrNull(weather.temperatureC),
      apparentC: numberOrNull(weather.apparentC),
      windKmh: numberOrNull(weather.windKmh),
      attention: text(weather.attention, 30) ?? "Insufficient data",
      next24h: {
        minC: numberOrNull(next.minC),
        maxC: numberOrNull(next.maxC),
        maxPrecipChance: numberOrNull(next.maxPrecipChance),
        totalPrecipMm: numberOrNull(next.totalPrecipMm),
        totalSnowCm: numberOrNull(next.totalSnowCm),
        hoursAtOrBelowFreezing: numberOrNull(next.hoursAtOrBelowFreezing),
      },
    },
    observation: parsedObservation,
    alerts: stringList(value.alerts, 6),
    stormReports: stringList(value.stormReports, 6),
  };
}

/** Same road, same place, same clock hour → same answer (from cache). */
export function adviceCacheKey(context: AdviceContext, now = new Date()): string {
  const hour = now.toISOString().slice(0, 13);
  return `${context.roadId}@${context.location.latitude.toFixed(3)},${context.location.longitude.toFixed(3)}#${hour}`;
}

// --- Prompt ---

export const ADVICE_SYSTEM_INSTRUCTION = [
  "You advise municipal winter road maintenance staff on how to approach one road, balancing safe travel with limiting road salt runoff into nearby water, wetlands and farmland.",
  "Use the RoadSalt data provided. Use Google Search for current local news that matters for this road (winter weather, closures, road work, flooding, local salt or brine programs) near the given place. Prefer the last 7 days; ignore older or unrelated items.",
  "Rules:",
  "- Never give numeric application rates or quantities (no lbs, tons, gallons per lane-mile or similar).",
  "- Never say the road is icy, safe or clear of ice; the data describes air and forecasts, not the pavement.",
  "- If no freezing precipitation or freezing temperatures are expected, say treatment is likely unnecessary and suggest monitoring.",
  "- When high-exposure stretches are listed, target extra care at those stretches by their position along the road rather than the whole road.",
  "- Near mapped water, wetland or farmland, favour practices that reduce chloride runoff (anti-icing with brine before storms, pre-wetting, calibrated spreaders, plowing before treating, avoiding treatment on dry pavement, keeping material off shoulders near water). Name the nearby feature.",
  "- Say what is uncertain. Do not invent facts, sources or local programs.",
  "Format (plain text, under 170 words):",
  "## Assessment",
  "One or two sentences on what the data says for this road over the next 24 hours.",
  "## Suggested approach",
  "Two to four short bullets starting with '- '.",
  "## Environmental care",
  "One or two bullets.",
  "## Watch for",
  "One or two bullets, including any relevant local news you found (or say none was found).",
].join("\n");

function fmt(value: number | null, unit: string, digits = 0): string {
  return value === null ? "not reported" : `${value.toFixed(digits)} ${unit}`;
}

export function buildAdvicePrompt(context: AdviceContext): string {
  const { road, location, condition, environment, weather, observation } = context;
  const n = weather.next24h;
  const lines = [
    `Road: ${road.name} (${road.classification}${road.ref ? `, route ${road.ref}` : ""})`,
    `Place: ${location.displayName} (${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)})${location.timezone ? `, time zone ${location.timezone}` : ""}`,
    `Current date and time (UTC): ${new Date().toISOString()}`,
    "",
    "Reported road condition (TomTom Traffic incidents and NWS alerts):",
    `- ${condition.label}: ${condition.reason}`,
    ...condition.incidents.map((incident) => `- Incident on this road: ${incident}`),
    "",
    `Environmental sensitivity (OpenStreetMap proximity): ${environment.level}`,
    ...(environment.features.length
      ? environment.features.map((feature) => `- ${feature.name}: ${Math.round(feature.distanceMeters)} m from the road`)
      : ["- No mapped water, wetland or farmland within 250 m in the loaded data"]),
    ...(environment.segments
      ? [
          `Runoff exposure by 100 m segment (${environment.segments.count} segments, ${Math.round(environment.segments.totalMeters)} m loaded): ${environment.segments.high} high (within 50 m), ${environment.segments.moderate} moderate (within 250 m), ${environment.segments.low} low`,
          ...environment.segments.stretches.map((stretch) => `- ${stretch}`),
        ]
      : []),
    "",
    "Weather (Open-Meteo model, air not pavement):",
    `- Now: ${weather.description ?? "unknown"}, ${fmt(weather.temperatureC, "°C", 1)}, feels like ${fmt(weather.apparentC, "°C")}, wind ${fmt(weather.windKmh, "km/h")}`,
    `- Next 24 h: ${fmt(n.minC, "°C", 1)} to ${fmt(n.maxC, "°C", 1)}; max precipitation chance ${fmt(n.maxPrecipChance, "%")}; total precipitation ${fmt(n.totalPrecipMm, "mm", 1)}; snowfall ${fmt(n.totalSnowCm, "cm", 1)}; ${n.hoursAtOrBelowFreezing ?? "unknown"} hours at or below 0 °C`,
    `- RoadSalt winter weather attention: ${weather.attention}`,
    observation
      ? `- Measured at NWS station ${observation.stationId}: ${fmt(observation.temperatureC, "°C", 1)} at ${observation.time}`
      : "- No NWS station observation",
    "",
    `Active NWS alerts: ${context.alerts.length ? context.alerts.join("; ") : "none"}`,
    `NWS storm reports nearby (72 h): ${context.stormReports.length ? context.stormReports.join("; ") : "none"}`,
  ];
  return lines.join("\n");
}

export function adviceRequestBody(context: AdviceContext, model: string, options: { grounded?: boolean } = {}) {
  const grounded = options.grounded ?? true;
  return {
    model,
    input: buildAdvicePrompt(context),
    system_instruction: grounded
      ? ADVICE_SYSTEM_INSTRUCTION
      : `${ADVICE_SYSTEM_INSTRUCTION}
Web search is not available for this answer: use only the RoadSalt data, and under "Watch for" say that local news was not checked.`,
    ...(grounded ? { tools: [{ type: "google_search" }] } : {}),
    stream: true,
    store: false,
    generation_config: { max_output_tokens: 700, thinking_level: "low" },
  };
}

// --- Response parsing (Gemini Interactions API, server-sent events) ---

/** Splits an SSE buffer into complete `data:` payloads; returns the remainder. */
export function splitSseEvents(buffer: string): { events: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const blocks = normalized.split("\n\n");
  const rest = blocks.pop() ?? "";
  const events = blocks
    .map((block) =>
      block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n"),
    )
    .filter((data) => data && data !== "[DONE]");
  return { events, rest };
}

export type ParsedAdviceChunk = {
  /** Streamed text delta, if this event carries one. */
  delta: string | null;
  /** Full output text, when the event is the completed interaction. */
  finalText: string | null;
  citations: AdviceCitation[];
  searchSuggestionsHtml: string | null;
  error: string | null;
};

function collect(value: unknown, visit: (record: Record<string, unknown>) => void, depth = 0): void {
  if (depth > 12) return;
  if (Array.isArray(value)) {
    for (const item of value) collect(item, visit, depth + 1);
  } else if (isRecord(value)) {
    visit(value);
    for (const child of Object.values(value)) collect(child, visit, depth + 1);
  }
}

/**
 * Reads one SSE `data` payload. The streamed shape is only partly documented,
 * so citations and search suggestions are found wherever they appear.
 */
export function parseAdviceChunk(data: string): ParsedAdviceChunk {
  const result: ParsedAdviceChunk = { delta: null, finalText: null, citations: [], searchSuggestionsHtml: null, error: null };
  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch {
    return result;
  }
  if (!isRecord(payload)) return result;

  const eventType = typeof payload.event_type === "string" ? payload.event_type : null;
  if (eventType === "error" || (isRecord(payload.error) && typeof payload.error.message === "string")) {
    result.error = isRecord(payload.error) && typeof payload.error.message === "string" ? payload.error.message : "Gemini returned an error.";
    return result;
  }
  if (eventType === "step.delta" && isRecord(payload.delta) && payload.delta.type === "text" && typeof payload.delta.text === "string") {
    result.delta = payload.delta.text;
  }

  const seen = new Set<string>();
  const finalParts: string[] = [];
  collect(payload, (record) => {
    if (record.type === "url_citation" && typeof record.url === "string" && /^https?:\/\//.test(record.url)) {
      if (!seen.has(record.url)) {
        seen.add(record.url);
        result.citations.push({ url: record.url, title: typeof record.title === "string" ? record.title : record.url });
      }
    }
    if (typeof record.search_suggestions === "string" && record.search_suggestions.trim()) {
      result.searchSuggestionsHtml = record.search_suggestions;
    }
    if (eventType === "interaction.completed" && record.type === "text" && typeof record.text === "string") {
      finalParts.push(record.text);
    }
  });
  if (finalParts.length) result.finalText = finalParts.join("");
  return result;
}

/** Last line of defence: drop any line that slipped a numeric rate through. */
export function redactRates(output: string): string {
  const rate = /\b\d+(?:[.,]\d+)?\s*(?:-|–|to)?\s*\d*\s*(?:lbs?|pounds?|tons?|gal(?:lons?)?|kg|liters?|litres?)\b[^\n]*(?:lane|mile|km|acre|sq)/i;
  return output
    .split("\n")
    .map((line) => (rate.test(line) ? "- (A specific application rate was removed. Follow your agency's calibrated rates.)" : line))
    .join("\n");
}
