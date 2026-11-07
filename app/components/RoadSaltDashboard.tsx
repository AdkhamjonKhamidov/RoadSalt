"use client";

import { useEffect, useMemo, useState } from "react";
import type { Feature, Geometry } from "geojson";
import MapCanvas from "./MapCanvas";
import type {
  EnvironmentalKind,
  EnvironmentalProperties,
  MapData,
  RoadProperties,
  WeatherData,
} from "../lib/data-types";
import {
  ENVIRONMENTAL_KINDS,
} from "../lib/data-types";
import type { EnvironmentalAssessment } from "../lib/proximity";
import { assessEnvironmentalSensitivity } from "../lib/proximity";
import {
  classifyWeatherAttention,
  describePrecipitation,
  describeWeatherCode,
  forecastHours,
} from "../lib/weather";
import { DEMO_LOCATION, SEARCH_RADIUS_METERS } from "../lib/demo-config";

type RoadFeature = Feature<Geometry, RoadProperties>;
type EnvironmentFeature = Feature<Geometry, EnvironmentalProperties>;

const EMPTY_ROADS: MapData["roads"] = { type: "FeatureCollection", features: [] };
const EMPTY_ENVIRONMENT: MapData["environmentalFeatures"] = {
  type: "FeatureCollection",
  features: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseMapData(value: unknown): MapData | null {
  if (
    !isRecord(value) ||
    !isRecord(value.roads) ||
    !Array.isArray(value.roads.features) ||
    !isRecord(value.environmentalFeatures) ||
    !Array.isArray(value.environmentalFeatures.features) ||
    typeof value.updatedAt !== "string" ||
    value.source !== "OpenStreetMap Overpass API" ||
    typeof value.radiusMeters !== "number"
  ) {
    return null;
  }
  return value as MapData;
}

function parseWeatherData(value: unknown): WeatherData | null {
  if (
    !isRecord(value) ||
    !isRecord(value.current) ||
    typeof value.current.time !== "string" ||
    typeof value.current.temperature !== "number" ||
    typeof value.current.precipitation !== "number" ||
    typeof value.current.weatherCode !== "number" ||
    !Array.isArray(value.hourly) ||
    value.hourly.some(
      (hour) =>
        !isRecord(hour) ||
        typeof hour.time !== "string" ||
        typeof hour.temperature !== "number" ||
        typeof hour.precipitationProbability !== "number" ||
        typeof hour.precipitation !== "number" ||
        typeof hour.snowfall !== "number",
    ) ||
    typeof value.updatedAt !== "string" ||
    value.source !== "Open-Meteo"
  ) {
    return null;
  }
  return value as WeatherData;
}

async function responseError(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (isRecord(body) && typeof body.error === "string") return body.error;
  } catch {
    return `Request failed with status ${response.status}.`;
  }
  return `Request failed with status ${response.status}.`;
}

function weatherAttentionClass(level: string): string {
  if (level === "Elevated") return "indicator indicator-elevated";
  if (level === "Moderate") return "indicator indicator-moderate";
  if (level === "Low") return "indicator indicator-low";
  return "indicator indicator-unknown";
}

function sensitivityClass(level: string): string {
  if (level === "High") return "indicator indicator-elevated";
  if (level === "Moderate") return "indicator indicator-moderate";
  if (level === "Low") return "indicator indicator-low";
  return "indicator indicator-unknown";
}

function featureLabel(kind: EnvironmentalKind): string {
  const labels: Record<EnvironmentalKind, string> = {
    waterway: "waterway",
    water: "water body",
    wetland: "wetland",
    farmland: "farmland",
    protected: "protected area",
  };
  return labels[kind];
}

function roadClassLabel(classification: string): string {
  return classification.charAt(0).toUpperCase() + classification.slice(1);
}

function formatUpdatedAt(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDistance(meters: number): string {
  return meters < 1000
    ? `${Math.round(meters)} m`
    : `${(meters / 1000).toFixed(1)} km`;
}

function formatTime(time: string): string {
  return time.slice(11, 16);
}

function MapStatus({
  loading,
  error,
  mapData,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  mapData: MapData | null;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <p className="map-data-status" role="status">
        Loading mapped roads and features…
      </p>
    );
  }
  if (error) {
    return (
      <div className="map-data-status map-data-error" role="status">
        <span>{error}</span>
        <button type="button" className="text-button" onClick={onRetry}>
          Retry
        </button>
      </div>
    );
  }
  return (
    <p className="map-data-status">
      {mapData?.roads.features.length ?? 0} mapped roads ·{" "}
      {mapData?.environmentalFeatures.features.length ?? 0} environmental
      features · updated {mapData ? formatUpdatedAt(mapData.updatedAt) : ""}
    </p>
  );
}

export default function RoadSaltDashboard() {
  const [mapData, setMapData] = useState<MapData | null>(null);
  const [mapLoading, setMapLoading] = useState(true);
  const [mapError, setMapError] = useState<string | null>(null);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(true);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const [selectedRoad, setSelectedRoad] = useState<RoadFeature | null>(null);
  const [visibleEnvironmentalKinds, setVisibleEnvironmentalKinds] =
    useState<EnvironmentalKind[]>(ENVIRONMENTAL_KINDS);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/map-data", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response));
        const parsed = parseMapData(await response.json());
        if (!parsed) throw new Error("OpenStreetMap returned invalid map data.");
        setMapData(parsed);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setMapData(null);
        setSelectedRoad(null);
        setMapError(
          error instanceof Error ? error.message : "Map data is unavailable.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setMapLoading(false);
      });

    return () => controller.abort();
  }, [refreshKey]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/weather", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response));
        const parsed = parseWeatherData(await response.json());
        if (!parsed) throw new Error("Open-Meteo returned invalid weather data.");
        setWeather(parsed);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setWeather(null);
        setWeatherError(
          error instanceof Error
            ? error.message
            : "Weather data is unavailable.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setWeatherLoading(false);
      });

    return () => controller.abort();
  }, [refreshKey]);

  const selectedRoadId = selectedRoad?.properties.roadId ?? null;
  const environmentalAssessment: EnvironmentalAssessment | null = useMemo(() => {
    if (!selectedRoad || !mapData) return null;
    return assessEnvironmentalSensitivity(
      selectedRoad,
      mapData.environmentalFeatures.features as EnvironmentFeature[],
    );
  }, [mapData, selectedRoad]);

  const attention = classifyWeatherAttention(weather);
  const forecasts = weather ? forecastHours(weather) : [];

  function toggleEnvironmentalLayer(kind: EnvironmentalKind) {
    setVisibleEnvironmentalKinds((visible) =>
      visible.includes(kind)
        ? visible.filter((item) => item !== kind)
        : [...visible, kind],
    );
  }

  function retryRequests() {
    setMapData(null);
    setSelectedRoad(null);
    setMapLoading(true);
    setMapError(null);
    setWeather(null);
    setWeatherLoading(true);
    setWeatherError(null);
    setRefreshKey((key) => key + 1);
  }

  return (
    <div className="min-h-screen bg-[#F9F7F7] text-[#112D4E]">
      <header className="border-b border-[#DBE2EF] bg-[#F9F7F7]">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-3 px-5 py-3 md:px-8">
          <div className="min-w-[220px]">
            <p className="text-[0.6rem] font-semibold uppercase tracking-[0.3em] text-[#3F72AF]">
              RoadSalt
            </p>
            <p className="mt-1 text-sm font-medium text-[#112D4E]">
              {DEMO_LOCATION}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-x-5 gap-y-2 text-sm md:gap-x-8">
            <div>
              <p className="text-[0.6rem] uppercase tracking-[0.2em] text-[#3F72AF]">
                Current weather
              </p>
              {weatherLoading ? (
                <p className="font-medium">Loading…</p>
              ) : weatherError || !weather ? (
                <p className="font-medium text-[#8B3F3F]">Unavailable</p>
              ) : (
                <p className="font-medium">
                  {describeWeatherCode(weather.current.weatherCode)} ·{" "}
                  {weather.current.temperature.toFixed(1)} °C · updated{" "}
                  {formatUpdatedAt(weather.updatedAt)}
                </p>
              )}
            </div>
            <div>
              <p className="text-[0.6rem] uppercase tracking-[0.2em] text-[#3F72AF]">
                Precipitation
              </p>
              <p className="font-medium">
                {weather ? describePrecipitation(weather) : weatherLoading ? "Loading…" : "Unavailable"}
              </p>
            </div>
            <div>
              <p className="text-[0.6rem] uppercase tracking-[0.2em] text-[#3F72AF]">
                Weather attention
              </p>
              <span className={weatherAttentionClass(attention)}>{attention}</span>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-4 py-4 md:px-6 md:py-6">
        <div className="grid gap-4 xl:grid-cols-[2.2fr_1fr]">
          <section className="overflow-hidden border border-[#112D4E] bg-[#DBE2EF]/40">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#112D4E]/20 bg-[#F9F7F7] px-4 py-3">
              <div>
                <p className="text-[0.6rem] uppercase tracking-[0.25em] text-[#3F72AF]">
                  Local road map
                </p>
                <h2 className="mt-1 text-lg font-semibold">Salisbury area overview</h2>
              </div>

              <div className="flex items-center gap-3">
                <MapStatus
                  loading={mapLoading}
                  error={mapError}
                  mapData={mapData}
                  onRetry={retryRequests}
                />
                <div className="border border-[#112D4E]/20 bg-[#DBE2EF] px-2 py-1 text-xs text-[#112D4E]">
                  {Math.round(SEARCH_RADIUS_METERS / 1000)} km radius
                </div>
              </div>
            </div>

            <div className="h-[560px] bg-[#EAF1F7]">
              <MapCanvas
                roads={mapData?.roads ?? EMPTY_ROADS}
                environmentalFeatures={
                  mapData?.environmentalFeatures ?? EMPTY_ENVIRONMENT
                }
                selectedRoadId={selectedRoadId}
                visibleEnvironmentalKinds={visibleEnvironmentalKinds}
                onEnvironmentalVisibilityChange={toggleEnvironmentalLayer}
                onRoadSelect={setSelectedRoad}
              />
            </div>
          </section>

          <aside className="border border-[#112D4E] bg-[#F9F7F7] p-4">
            <section className="mb-5 border-b border-[#DBE2EF] pb-4">
              <p className="text-[0.6rem] uppercase tracking-[0.25em] text-[#3F72AF]">
                Next 24 hours · local time
              </p>
              {weatherLoading ? (
                <p className="mt-2 text-sm">Loading forecast…</p>
              ) : weatherError || !weather ? (
                <div className="mt-2 text-sm">
                  <p className="text-[#8B3F3F]">{weatherError ?? "Weather is unavailable."}</p>
                  <button type="button" className="text-button mt-1" onClick={retryRequests}>
                    Retry
                  </button>
                </div>
              ) : (
                <>
                  <div className="forecast-strip mt-3">
                    {forecasts.map((hour) => (
                      <div key={hour.time} className="forecast-hour">
                        <span className="forecast-time">{formatTime(hour.time)}</span>
                        <span className="forecast-temperature">
                          {hour.temperature.toFixed(0)}°
                        </span>
                        <span>{hour.precipitationProbability}%</span>
                        <span className="forecast-caption">
                          {hour.snowfall >= 0.1
                            ? `${hour.snowfall.toFixed(1)} mm snow`
                            : `${hour.precipitation.toFixed(1)} mm`}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-xs leading-5 text-[#53677D]">
                    Temperature is air temperature, not pavement temperature.
                    This indicator cannot confirm whether a road is icy.
                  </p>
                </>
              )}
            </section>

            <div className="mb-4 border-b border-[#DBE2EF] pb-3">
              <p className="text-[0.6rem] uppercase tracking-[0.25em] text-[#3F72AF]">
                Road details
              </p>
              <h3 className="mt-2 text-2xl font-semibold">
                {selectedRoad
                  ? selectedRoad.properties.name?.trim() || "Unnamed road"
                  : "Select a mapped road"}
              </h3>
            </div>

            {selectedRoad ? (
              <div className="space-y-4 text-sm">
                <div>
                  <p className="detail-label">Road classification</p>
                  <p className="mt-1 font-medium">
                    {roadClassLabel(selectedRoad.properties.classification)}
                  </p>
                </div>
                <div className="border-t border-[#DBE2EF] pt-3">
                  <p className="detail-label">Weather attention</p>
                  <span className={`mt-1 inline-block ${weatherAttentionClass(attention)}`}>
                    {attention}
                  </span>
                  <p className="mt-2 leading-5">
                    Based on the demo-area forecast, not pavement measurements.
                    Environmental sensitivity does not change this indicator.
                  </p>
                </div>
                <div className="border-t border-[#DBE2EF] pt-3">
                  <p className="detail-label">Environmental sensitivity</p>
                  {environmentalAssessment ? (
                    <>
                      <span
                        className={`mt-1 inline-block ${sensitivityClass(
                          environmentalAssessment.level,
                        )}`}
                      >
                        {environmentalAssessment.level}
                      </span>
                      <p className="mt-2">
                        Nearest mapped sensitive feature:{" "}
                        {environmentalAssessment.nearestDistanceMeters === null
                          ? "Not available"
                          : formatDistance(
                              environmentalAssessment.nearestDistanceMeters,
                            )}
                      </p>
                      {environmentalAssessment.nearbyFeatures.length > 0 ? (
                        <ul className="mt-2 list-disc space-y-1 pl-5">
                          {environmentalAssessment.nearbyFeatures.map((item) => (
                            <li key={`${item.feature.featureId}:${item.distanceMeters.toFixed(1)}`}>
                              {item.feature.name || `Mapped ${featureLabel(item.feature.kind)}`} ·{" "}
                              {formatDistance(item.distanceMeters)}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-2">
                          {environmentalAssessment.level === "Unknown"
                            ? mapError
                              ? "Environmental feature data is unavailable."
                              : "No mapped sensitive feature found nearby."
                            : "No mapped sensitive feature within the nearby threshold."}
                        </p>
                      )}
                      <p className="mt-2 text-xs leading-5 text-[#53677D]">
                        OSM coverage is incomplete. Proximity does not prove
                        pollution or runoff at this road.
                      </p>
                    </>
                  ) : (
                    <p className="mt-1">
                      {mapLoading ? "Loading mapped features…" : "Unknown"}
                    </p>
                  )}
                </div>
                <p className="border-t border-[#DBE2EF] pt-3 text-xs leading-5 text-[#53677D]">
                  Sources: OpenStreetMap contributors and Open-Meteo. These
                  mapped and forecast indicators are for awareness, not
                  treatment instructions.
                </p>
              </div>
            ) : (
              <div className="space-y-4 text-sm leading-6">
                <p>
                  Select a line from the queried OpenStreetMap road data to view
                  its name, class, local weather attention, and nearby mapped
                  environmental features.
                </p>
                <div className="border border-[#DBE2EF] bg-[#DBE2EF]/40 p-3">
                  <p className="text-[0.6rem] font-semibold uppercase tracking-[0.19em] text-[#3F72AF]">
                    Data limitations
                  </p>
                  <p className="mt-2">
                    Missing mapped features do not mean an area is
                    environmentally safe. Air temperature is not pavement
                    temperature and cannot confirm ice.
                  </p>
                </div>
                {weatherError && (
                  <p className="text-[#8B3F3F]">
                    Weather data unavailable: {weatherError}
                  </p>
                )}
              </div>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}
