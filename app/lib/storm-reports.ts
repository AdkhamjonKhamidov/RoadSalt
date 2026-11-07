import type { StormReport } from "./data-types";
import { finiteNumber, isLatitude, isLongitude, isRecord, text } from "./validation";

// NWS Local Storm Reports (LSRs): reports from trained spotters, emergency
// managers, the public, mesonets and road crews, issued by each NWS forecast
// office. Retrieved as GeoJSON from the Iowa Environmental Mesonet archive,
// which collects every office's LSR products nationwide.

export const IEM_LSR_ENDPOINT = "https://mesonet.agron.iastate.edu/geojson/lsr.geojson";
export const STORM_REPORT_WINDOW_HOURS = 72;
export const STORM_REPORT_RADIUS_KM = 80;

/** Report types that matter for winter roads (IEM `typetext`). */
const WINTER_TYPES = /SNOW|SLEET|FREEZING|ICE|BLIZZARD|WIND CHILL|EXTREME COLD|FROST|AVALANCHE/i;

export function stormReportsUrl(officeId: string, now = new Date()): string {
  const iso = (date: Date) => `${date.toISOString().slice(0, 16)}Z`;
  const start = new Date(now.getTime() - STORM_REPORT_WINDOW_HOURS * 3600 * 1000);
  const params = new URLSearchParams({ wfos: officeId, sts: iso(start), ets: iso(now) });
  return `${IEM_LSR_ENDPOINT}?${params.toString()}`;
}

export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

/**
 * Parses IEM LSR GeoJSON, keeps reports within `radiusKm` of the point,
 * deduplicates, and sorts newest first.
 */
export function parseStormReports(
  input: unknown,
  latitude: number,
  longitude: number,
  radiusKm = STORM_REPORT_RADIUS_KM,
): StormReport[] {
  if (!isRecord(input) || !Array.isArray(input.features)) {
    throw new Error("The storm report service returned an invalid response.");
  }
  const seen = new Set<string>();
  const reports: StormReport[] = [];
  for (const feature of input.features) {
    if (!isRecord(feature) || !isRecord(feature.properties) || !isRecord(feature.geometry)) continue;
    const coordinates = feature.geometry.coordinates;
    if (feature.geometry.type !== "Point" || !Array.isArray(coordinates)) continue;
    const lon = finiteNumber(coordinates[0]);
    const lat = finiteNumber(coordinates[1]);
    if (lon === null || lat === null || !isLatitude(lat) || !isLongitude(lon)) continue;

    const p = feature.properties;
    const type = text(p.typetext, 80);
    const valid = text(p.valid, 40);
    if (!type || !valid || Number.isNaN(Date.parse(valid))) continue;
    const time = new Date(valid.endsWith("Z") || /[+-]\d\d:?\d\d$/.test(valid) ? valid : `${valid}Z`).toISOString();

    const distance = distanceKm(latitude, longitude, lat, lon);
    if (distance > radiusKm) continue;

    const city = text(p.city, 120);
    const key = `${time}|${type}|${lat.toFixed(3)},${lon.toFixed(3)}|${text(p.magnitude, 20) ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const magnitude = finiteNumber(p.magf);
    reports.push({
      id: key,
      type,
      winter: WINTER_TYPES.test(type),
      magnitude: magnitude !== null && magnitude !== 0 ? magnitude : null,
      unit: text(p.unit, 20),
      location: [city, text(p.county, 80) ? `${text(p.county, 80)} County` : null, text(p.state, 4)]
        .filter(Boolean)
        .join(", ") || "Location not given",
      time,
      remark: text(p.remark, 600),
      source: text(p.source, 80),
      office: text(p.wfo, 6),
      latitude: lat,
      longitude: lon,
      distanceKm: distance,
    });
  }
  return reports.sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
}
