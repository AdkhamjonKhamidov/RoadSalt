import type { Geometry, Position } from "geojson";
import type { TrafficIncident } from "./data-types";
import { finiteNumber, isLatitude, isLongitude, isRecord, text } from "./validation";

// TomTom Traffic Incident Details API v5 — live closures and hazards across
// the US. Needs a (free-tier) key, used only on the server: TOMTOM_API_KEY.
// https://developer.tomtom.com/traffic-api/documentation/traffic-incidents/incident-details

export const TOMTOM_INCIDENTS_ENDPOINT = "https://api.tomtom.com/traffic/services/5/incidentDetails";
/** Half-size of the query box in degrees (~11 km north–south). */
export const INCIDENT_BOX_DEGREES = 0.1;

const FIELDS =
  "{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description,code,iconCategory},startTime,endTime,from,to,roadNumbers,timeValidity}}}";

/** TomTom iconCategory → label and RoadSalt condition. */
const CATEGORIES: Record<number, { label: string; condition: TrafficIncident["condition"] }> = {
  1: { label: "Accident", condition: "caution" },
  2: { label: "Fog", condition: "caution" },
  3: { label: "Dangerous conditions", condition: "caution" },
  4: { label: "Rain", condition: "caution" },
  5: { label: "Ice", condition: "caution" },
  6: { label: "Traffic jam", condition: "caution" },
  7: { label: "Lane closed", condition: "caution" },
  8: { label: "Road closed", condition: "closed" },
  9: { label: "Road works", condition: "caution" },
  10: { label: "Wind", condition: "caution" },
  11: { label: "Flooding", condition: "caution" },
  14: { label: "Broken-down vehicle", condition: "caution" },
};

export function incidentsUrl(apiKey: string, latitude: number, longitude: number): string {
  const d = INCIDENT_BOX_DEGREES;
  const params = new URLSearchParams({
    key: apiKey,
    bbox: [longitude - d, latitude - d, longitude + d, latitude + d].map((v) => v.toFixed(5)).join(","),
    fields: FIELDS,
    language: "en-US",
    timeValidityFilter: "present",
  });
  return `${TOMTOM_INCIDENTS_ENDPOINT}?${params.toString()}`;
}

function position(value: unknown): Position | null {
  if (!Array.isArray(value)) return null;
  const longitude = finiteNumber(value[0]);
  const latitude = finiteNumber(value[1]);
  return longitude !== null && latitude !== null && isLongitude(longitude) && isLatitude(latitude)
    ? [longitude, latitude]
    : null;
}

function incidentGeometry(value: unknown): Geometry | null {
  if (!isRecord(value)) return null;
  if (value.type === "Point") {
    const point = position(value.coordinates);
    return point ? { type: "Point", coordinates: point } : null;
  }
  if (value.type === "LineString" && Array.isArray(value.coordinates)) {
    const line = value.coordinates.map(position);
    if (line.length < 2 || line.some((point) => point === null)) return null;
    return { type: "LineString", coordinates: line as Position[] };
  }
  return null;
}

/** Parses a TomTom incidentDetails response; malformed incidents are dropped. */
export function parseIncidents(input: unknown): TrafficIncident[] {
  if (!isRecord(input) || !Array.isArray(input.incidents)) {
    const message = isRecord(input) && isRecord(input.detailedError) ? text(input.detailedError.message, 200) : null;
    throw new Error(message ? `TomTom: ${message}` : "The traffic incident service returned an invalid response.");
  }
  const seen = new Set<string>();
  const incidents: TrafficIncident[] = [];
  for (const item of input.incidents) {
    if (!isRecord(item) || !isRecord(item.properties)) continue;
    const geometry = incidentGeometry(item.geometry);
    if (!geometry) continue;
    const p = item.properties;
    const category = finiteNumber(p.iconCategory);
    const known = category !== null ? CATEGORIES[category] : undefined;
    if (!known) continue; // Unknown or non-road categories are not shown.
    const id = text(p.id, 200) ?? `${category}:${JSON.stringify("coordinates" in geometry ? geometry.coordinates : null).slice(0, 80)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const events = Array.isArray(p.events) ? p.events : [];
    const description = events
      .map((event) => (isRecord(event) ? text(event.description, 200) : null))
      .filter((value): value is string => value !== null)
      .join("; ");
    const roads = Array.isArray(p.roadNumbers)
      ? p.roadNumbers.map((road) => text(road, 30)).filter((road): road is string => road !== null)
      : [];
    incidents.push({
      id,
      condition: known.condition,
      type: known.label,
      description: description || known.label,
      from: text(p.from, 200),
      to: text(p.to, 200),
      roads,
      start: text(p.startTime, 40),
      end: text(p.endTime, 40),
      geometry,
    });
  }
  // Closures first, then hazards.
  return incidents.sort((a, b) => (a.condition === b.condition ? 0 : a.condition === "closed" ? -1 : 1));
}
