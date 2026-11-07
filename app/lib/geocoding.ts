import type { Location } from "./data-types";
import { finiteNumber, isLatitude, isLongitude, isRecord, text } from "./validation";

// Geocoding via Photon (https://photon.komoot.io), an OpenStreetMap-based
// geocoder built for search-as-you-type. Nominatim's usage policy forbids
// client-driven autocomplete, so it is not used for suggestions.
// Called only from the /api/geocode route (server-side cache + User-Agent).

export const PHOTON_ENDPOINT = "https://photon.komoot.io/api/";
export const GEOCODE_MIN_QUERY_LENGTH = 3;
export const GEOCODE_MAX_QUERY_LENGTH = 200;
export const GEOCODE_RESULT_LIMIT = 6;

export function photonUrl(
  query: string,
  bias?: { latitude: number; longitude: number },
): string {
  const params = new URLSearchParams({
    q: query,
    limit: String(GEOCODE_RESULT_LIMIT),
    lang: "en",
  });
  if (bias) {
    params.set("lat", bias.latitude.toFixed(4));
    params.set("lon", bias.longitude.toFixed(4));
  }
  return `${PHOTON_ENDPOINT}?${params.toString()}`;
}

/** Normalizes user input; returns null when too short or too long. */
export function normalizeQuery(input: string | null): string | null {
  const query = (input ?? "").replace(/\s+/g, " ").trim();
  if (query.length < GEOCODE_MIN_QUERY_LENGTH || query.length > GEOCODE_MAX_QUERY_LENGTH) {
    return null;
  }
  return query;
}

function parseExtent(value: unknown): Location["boundingBox"] {
  // Photon extent: [minLon, maxLat, maxLon, minLat].
  if (!Array.isArray(value) || value.length !== 4) return null;
  const [west, north, east, south] = value.map(finiteNumber);
  if (
    west === null || north === null || east === null || south === null ||
    !isLongitude(west) || !isLongitude(east) || !isLatitude(north) || !isLatitude(south) ||
    south > north
  ) {
    return null;
  }
  return [west, south, east, north];
}

function parseFeature(feature: unknown): Location | null {
  if (!isRecord(feature) || !isRecord(feature.geometry) || !isRecord(feature.properties)) {
    return null;
  }
  const coordinates = feature.geometry.coordinates;
  if (feature.geometry.type !== "Point" || !Array.isArray(coordinates)) return null;
  const longitude = finiteNumber(coordinates[0]);
  const latitude = finiteNumber(coordinates[1]);
  if (longitude === null || latitude === null || !isLatitude(latitude) || !isLongitude(longitude)) {
    return null;
  }

  const p = feature.properties;
  const houseNumber = text(p.housenumber, 40);
  const street = text(p.street, 200);
  const placeName = text(p.name, 200);
  const streetAddress = street ? [houseNumber, street].filter(Boolean).join(" ") : null;
  const name = placeName ?? streetAddress;
  if (!name) return null;

  const locality = text(p.city, 200) ?? text(p.town, 200) ?? text(p.village, 200) ??
    text(p.district, 200) ?? text(p.county, 200);
  const region = text(p.state, 200);
  const country = text(p.country, 200);
  const postcode = text(p.postcode, 20);
  // Avoid repeating the name ("Baltimore, Baltimore, Maryland").
  const parts = [
    name,
    placeName && streetAddress && streetAddress !== placeName ? streetAddress : null,
    locality !== name ? locality : null,
    region !== name ? region : null,
    postcode && postcode !== name ? postcode : null,
    country,
  ].filter((part): part is string => Boolean(part));

  const osmType = text(p.osm_type, 2);
  const osmId = finiteNumber(p.osm_id);
  const id = osmType && osmId !== null
    ? `osm:${osmType}${osmId}`
    : `coord:${latitude.toFixed(5)},${longitude.toFixed(5)}:${name}`;

  return {
    id,
    name,
    displayName: [...new Set(parts)].join(", "),
    latitude,
    longitude,
    boundingBox: parseExtent(p.extent),
    locality,
    region,
    country,
    placeType: text(p.type, 40),
    source: "Photon (OpenStreetMap)",
  };
}

/** Parses a Photon GeoJSON response into deduplicated locations. */
export function parsePhotonResponse(input: unknown): Location[] {
  if (!isRecord(input) || !Array.isArray(input.features)) {
    throw new Error("The geocoding service returned an invalid response.");
  }
  const seen = new Set<string>();
  const locations: Location[] = [];
  for (const feature of input.features) {
    const location = parseFeature(feature);
    if (!location) continue;
    // The same OSM object, or the same label within ~10 km (e.g. a city's
    // boundary relation and its center node), only once.
    const key = `${location.id}|${location.displayName}`;
    const spotKey = `${location.displayName}|${location.latitude.toFixed(1)},${location.longitude.toFixed(1)}`;
    if (seen.has(key) || seen.has(spotKey)) continue;
    seen.add(key);
    seen.add(spotKey);
    locations.push(location);
  }
  return locations;
}

/** Map zoom suited to the kind of place that was selected. */
export function zoomForLocation(location: Location): number {
  switch (location.placeType) {
    case "house":
    case "street":
      return 16;
    case "locality":
    case "district":
      return 15;
    case "city":
    case "town":
    case "village":
      return 14;
    case "county":
      return 12;
    case "state":
    case "country":
      return 9;
    default:
      return 15;
  }
}
