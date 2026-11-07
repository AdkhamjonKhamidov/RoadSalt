import type { NwsAlert, NwsObservation } from "./data-types";
import { finiteNumber, isRecord, text } from "./validation";

// National Weather Service API (https://api.weather.gov). US only, public
// domain, no key; NWS asks for an identifying User-Agent.
// Called only from the /api/observations route.

export const NWS_BASE = "https://api.weather.gov";

/** NWS quantitative value ({ value, unitCode }) → number or null. */
function quantity(value: unknown): number | null {
  return isRecord(value) ? finiteNumber(value.value) : null;
}

/** /points response → URL of the nearby observation-station list. */
export function parsePointStationsUrl(input: unknown): string {
  const url = isRecord(input) && isRecord(input.properties)
    ? text(input.properties.observationStations, 300)
    : null;
  if (!url || !url.startsWith(`${NWS_BASE}/`)) {
    throw new Error("The National Weather Service returned no station list for this location.");
  }
  return url;
}

/** /gridpoints/.../stations response → nearest station (NWS lists by distance). */
export function parseNearestStation(input: unknown): { id: string; name: string | null } {
  const first = isRecord(input) && Array.isArray(input.features) ? input.features[0] : null;
  const properties = isRecord(first) && isRecord(first.properties) ? first.properties : null;
  const id = properties ? text(properties.stationIdentifier, 10) : null;
  if (!properties || !id || !/^[A-Z0-9]+$/.test(id)) {
    throw new Error("No National Weather Service station was found near this location.");
  }
  return { id, name: text(properties.name, 200) };
}

export function parseObservation(input: unknown): NwsObservation {
  const properties = isRecord(input) && isRecord(input.properties) ? input.properties : null;
  const timestamp = properties ? text(properties.timestamp, 40) : null;
  if (!properties || !timestamp || Number.isNaN(Date.parse(timestamp))) {
    throw new Error("The National Weather Service returned no usable observation.");
  }
  const presentWeather = Array.isArray(properties.presentWeather)
    ? properties.presentWeather
        .map((item) => (isRecord(item) ? text(item.weather, 80) : null))
        .filter((item): item is string => item !== null)
    : [];
  return {
    timestamp,
    description: text(properties.textDescription, 200),
    temperatureC: quantity(properties.temperature),
    dewpointC: quantity(properties.dewpoint),
    relativeHumidity: quantity(properties.relativeHumidity),
    windSpeedKmh: quantity(properties.windSpeed),
    visibilityM: quantity(properties.visibility),
    precipitationLastHourMm: quantity(properties.precipitationLastHour),
    presentWeather,
  };
}

export function parseAlerts(input: unknown): NwsAlert[] {
  if (!isRecord(input) || !Array.isArray(input.features)) {
    throw new Error("The National Weather Service returned invalid alert data.");
  }
  const seen = new Set<string>();
  return input.features.flatMap((feature): NwsAlert[] => {
    const properties = isRecord(feature) && isRecord(feature.properties) ? feature.properties : null;
    const id = properties ? text(properties.id, 300) : null;
    const event = properties ? text(properties.event, 200) : null;
    if (!properties || !id || !event || seen.has(id)) return [];
    seen.add(id);
    return [
      {
        id,
        event,
        headline: text(properties.headline, 500),
        severity: text(properties.severity, 40),
        onset: text(properties.onset, 40) ?? text(properties.effective, 40),
        ends: text(properties.ends, 40) ?? text(properties.expires, 40),
      },
    ];
  });
}
