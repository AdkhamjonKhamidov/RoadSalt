import type { FeatureCollection, Geometry } from "geojson";

export type RoadProperties = {
  roadId: string;
  name?: string;
  classification: string;
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
  kind: EnvironmentalKind;
  name?: string;
};

export type MapData = {
  roads: FeatureCollection<Geometry, RoadProperties>;
  environmentalFeatures: FeatureCollection<Geometry, EnvironmentalProperties>;
  updatedAt: string;
  source: "OpenStreetMap Overpass API";
  radiusMeters: number;
};

export type WeatherHour = {
  time: string;
  temperature: number;
  precipitationProbability: number;
  precipitation: number;
  snowfall: number;
};

export type WeatherData = {
  current: {
    time: string;
    temperature: number;
    precipitation: number;
    weatherCode: number;
  };
  hourly: WeatherHour[];
  updatedAt: string;
  source: "Open-Meteo";
};
