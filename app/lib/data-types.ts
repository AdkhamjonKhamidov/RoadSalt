import type { FeatureCollection, Geometry } from "geojson";

/**
 * A normalized road (GeoJSON feature properties). `roadId` is the stable app
 * id: `way/<osmId>` for Overpass data, `tile:<class>:<name>` for tile data.
 */
export type RoadProperties = {
  roadId: string;
  /** OSM way id; null when derived from vector tiles (which carry no ids). */
  osmId?: number | null;
  name?: string;
  /** OSM highway value (e.g. residential) or the tile class/subclass. */
  classification: string;
  /** Route reference, e.g. "US 13". */
  ref?: string;
  /** Selected raw OSM tags kept for the details panel (Overpass data only). */
  tags?: Record<string, string>;
};

export type EnvironmentalKind =
  | "waterway"
  | "water"
  | "wetland"
  | "farmland"
  | "protected";

export const ENVIRONMENTAL_KIND_LABELS: Record<EnvironmentalKind, string> = {
  waterway: "Waterways",
  water: "Water bodies",
  wetland: "Wetlands",
  farmland: "Farmland",
  protected: "Protected areas",
};

export const ENVIRONMENTAL_KINDS = Object.keys(
  ENVIRONMENTAL_KIND_LABELS,
) as EnvironmentalKind[];

export type EnvironmentalProperties = {
  featureId: string;
  /** OSM element id; null for tile-derived features. */
  osmId?: number | null;
  kind: EnvironmentalKind;
  /** Finer mapped type, e.g. river, stream, pond, reservoir, marsh. */
  subtype?: string;
  name?: string;
};

/** A normalized geocoding result. Coordinates are WGS84. */
export type Location = {
  /** Stable id, e.g. "osm:R133345" or "default". */
  id: string;
  /** Short primary label, e.g. "Baltimore" or "1101 Camden Avenue". */
  name: string;
  /** Full one-line label for display. */
  displayName: string;
  latitude: number;
  longitude: number;
  /** [west, south, east, north] when the provider supplies an extent. */
  boundingBox: [number, number, number, number] | null;
  locality: string | null;
  region: string | null;
  country: string | null;
  /** Provider place type, e.g. house, street, city, state, other. */
  placeType: string | null;
  source: "Photon (OpenStreetMap)" | "Configured default";
};

export type MapData = {
  roads: FeatureCollection<Geometry, RoadProperties>;
  environmentalFeatures: FeatureCollection<Geometry, EnvironmentalProperties>;
  updatedAt: string;
  source:
    | "OpenStreetMap Overpass API"
    | "OpenStreetMap vector tiles (MapTiler)"
    | "OpenStreetMap vector tiles (CARTO)";
  /** Query radius for Overpass data; null for tile data (loaded map area). */
  radiusMeters: number | null;
};

export type WeatherHour = {
  time: string;
  temperature: number;
  precipitationProbability: number;
  precipitation: number;
  snowfall: number;
};

export type WeatherData = {
  latitude: number;
  longitude: number;
  /** IANA time zone of the location; all times are local to it. */
  timezone: string;
  current: {
    time: string;
    temperature: number;
    /** null = not provided by the API (never filled in). */
    apparentTemperature: number | null;
    relativeHumidity: number | null;
    windSpeed: number | null;
    precipitation: number;
    weatherCode: number;
  };
  hourly: WeatherHour[];
  updatedAt: string;
  source: "Open-Meteo";
};

/** Measured conditions from an NWS station (null = not reported). */
export type NwsObservation = {
  timestamp: string;
  description: string | null;
  temperatureC: number | null;
  dewpointC: number | null;
  relativeHumidity: number | null;
  windSpeedKmh: number | null;
  visibilityM: number | null;
  precipitationLastHourMm: number | null;
  presentWeather: string[];
};

export type NwsAlert = {
  id: string;
  event: string;
  headline: string | null;
  severity: string | null;
  onset: string | null;
  ends: string | null;
};

export type ObservationData = {
  /** Nearest NWS station; null when it could not be determined. */
  stationId: string | null;
  stationName: string | null;
  observation: NwsObservation | null;
  observationError: string | null;
  /** null when the alerts request failed (distinct from "no active alerts"). */
  alerts: NwsAlert[] | null;
  alertsError: string | null;
  updatedAt: string;
  source: "National Weather Service";
};
