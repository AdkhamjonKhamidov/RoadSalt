"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Feature, Geometry } from "geojson";
import MapCanvas, { type MapFocus } from "./MapCanvas";
import LocationSearch from "./LocationSearch";
import type {
  EnvironmentalKind,
  EnvironmentalProperties,
  Location,
  MapData,
  ObservationData,
  RoadProperties,
  WeatherData,
} from "../lib/data-types";
import { ENVIRONMENTAL_KINDS } from "../lib/data-types";
import type { EnvironmentalAssessment } from "../lib/proximity";
import { assessEnvironmentalSensitivity } from "../lib/proximity";
import {
  classifyWeatherAttention,
  describePrecipitation,
  describeWeatherCode,
  forecastHours,
} from "../lib/weather";
import { DEFAULT_LOCATION, INITIAL_ZOOM } from "../lib/demo-config";
import { zoomForLocation } from "../lib/geocoding";
import { loadMapDataInBrowser } from "../lib/overpass";
import { isRecord } from "../lib/validation";

type RoadFeature = Feature<Geometry, RoadProperties>;
type EnvironmentFeature = Feature<Geometry, EnvironmentalProperties>;

/** Result of a location-scoped request; `key` ties it to the location it was for. */
type Loadable<T> =
  | { key: string; status: "loading" }
  | { key: string; status: "ready"; data: T }
  | { key: string; status: "error"; error: string };

const EMPTY_ROADS: MapData["roads"] = { type: "FeatureCollection", features: [] };
const EMPTY_ENVIRONMENT: MapData["environmentalFeatures"] = {
  type: "FeatureCollection",
  features: [],
};
const OBSERVATION_STALE_MS = 2 * 60 * 60 * 1000;

// --- Response checks (the API routes already validate; this guards the boundary) ---

function parseWeatherData(value: unknown): WeatherData | null {
  if (
    !isRecord(value) ||
    value.source !== "Open-Meteo" ||
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
    typeof value.updatedAt !== "string"
  ) {
    return null;
  }
  return value as WeatherData;
}

function parseObservationData(value: unknown): ObservationData | null {
  if (
    !isRecord(value) ||
    value.source !== "National Weather Service" ||
    typeof value.updatedAt !== "string" ||
    (value.observation !== null &&
      (!isRecord(value.observation) || typeof value.observation.timestamp !== "string")) ||
    (value.alerts !== null && !Array.isArray(value.alerts))
  ) {
    return null;
  }
  return value as ObservationData;
}

async function fetchJson<T>(
  url: string,
  signal: AbortSignal,
  parse: (value: unknown) => T | null,
  invalidMessage: string,
): Promise<T> {
  const response = await fetch(url, { signal });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      isRecord(body) && typeof body.error === "string"
        ? body.error
        : `Request failed with status ${response.status}.`,
    );
  }
  const parsed = parse(body);
  if (!parsed) throw new Error(invalidMessage);
  return parsed;
}

// --- Formatting ---

function indicatorClass(level: string): string {
  if (level === "Elevated" || level === "High") return "indicator indicator-elevated";
  if (level === "Moderate") return "indicator indicator-moderate";
  if (level === "Low") return "indicator indicator-low";
  return "indicator indicator-unknown";
}

function humanize(value: string): string {
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function roadDisplayName(road: RoadProperties): string {
  const name = road.name?.trim();
  if (name) return name;
  if (road.ref) return road.ref;
  return `Unnamed ${humanize(road.classification).toLowerCase()} road`;
}

function featureDisplayName(feature: EnvironmentalProperties): string {
  if (feature.name) return feature.name;
  const kindLabels: Record<EnvironmentalKind, string> = {
    waterway: "waterway",
    water: "water body",
    wetland: "wetland",
    farmland: "farmland",
    protected: "protected area",
  };
  const subtype = feature.subtype && feature.subtype !== feature.kind ? humanize(feature.subtype).toLowerCase() : null;
  return `Mapped ${subtype ?? kindLabels[feature.kind]}`;
}

function formatClock(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDistance(meters: number): string {
  if (meters < 1) return "touching or crossing";
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

/** Open-Meteo local time ("2026-11-07T17:00") → "17:00" in the location's zone. */
function formatLocalHour(time: string): string {
  return time.slice(11, 16);
}

function formatMeasurement(value: number | null, digits: number, unit: string): string {
  return value === null ? "Not reported" : `${value.toFixed(digits)} ${unit}`;
}

function formatDateTime(timestamp: string | null): string {
  if (!timestamp) return "unspecified";
  return new Date(timestamp).toLocaleString([], {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

// --- Small presentational pieces ---

function SectionLabel({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <p id={id} className="text-[0.6rem] uppercase tracking-[0.25em] text-[#3F72AF]">
      {children}
    </p>
  );
}

function ErrorWithRetry({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mt-2 text-sm" role="status">
      <p className="text-[#8B3F3F]">{message}</p>
      <button type="button" className="text-button mt-1" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

export default function RoadSaltDashboard() {
  const [location, setLocation] = useState<Location>(DEFAULT_LOCATION);
  const [selectionCount, setSelectionCount] = useState(0);
  const [tileData, setTileData] = useState<MapData | null>(null);
  const [overpass, setOverpass] = useState<Loadable<MapData> | null>(null);
  const [overpassAttempt, setOverpassAttempt] = useState(0);
  const [weather, setWeather] = useState<Loadable<WeatherData> | null>(null);
  const [weatherAttempt, setWeatherAttempt] = useState(0);
  const [observations, setObservations] = useState<Loadable<ObservationData> | null>(null);
  const [observationsAttempt, setObservationsAttempt] = useState(0);
  const [observationStale, setObservationStale] = useState(false);
  const [selectedRoad, setSelectedRoad] = useState<RoadFeature | null>(null);
  const [visibleEnvironmentalKinds, setVisibleEnvironmentalKinds] =
    useState<EnvironmentalKind[]>(ENVIRONMENTAL_KINDS);

  const { latitude, longitude } = location;
  // Every location-scoped request is tagged with this key; a result for an
  // older key is never shown (and its request is aborted on change).
  const locationKey = `${location.id}@${latitude.toFixed(5)},${longitude.toFixed(5)}`;

  const focus: MapFocus = useMemo(
    () => ({
      key: `${locationKey}#${selectionCount}`,
      latitude,
      longitude,
      zoom: location.id === DEFAULT_LOCATION.id ? INITIAL_ZOOM : zoomForLocation(location),
      label: location.displayName,
    }),
    [locationKey, selectionCount, latitude, longitude, location],
  );

  // Detailed OSM data (way ids, unnamed and service roads, tags) from Overpass.
  useEffect(() => {
    const controller = new AbortController();
    loadMapDataInBrowser(latitude, longitude, controller.signal, overpassAttempt > 0)
      .then((data) => {
        if (!controller.signal.aborted) setOverpass({ key: locationKey, status: "ready", data });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setOverpass({
          key: locationKey,
          status: "error",
          error: error instanceof Error ? error.message : "OpenStreetMap detail is unavailable.",
        });
      });
    return () => controller.abort();
  }, [locationKey, latitude, longitude, overpassAttempt]);

  // Open-Meteo current conditions + 24 h forecast for the selected point.
  useEffect(() => {
    const controller = new AbortController();
    fetchJson(
      `/api/weather?lat=${latitude.toFixed(4)}&lon=${longitude.toFixed(4)}`,
      controller.signal,
      parseWeatherData,
      "Open-Meteo returned invalid weather data.",
    )
      .then((data) => {
        if (!controller.signal.aborted) setWeather({ key: locationKey, status: "ready", data });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setWeather({
          key: locationKey,
          status: "error",
          error: error instanceof Error ? error.message : "Weather data is unavailable.",
        });
      });
    return () => controller.abort();
  }, [locationKey, latitude, longitude, weatherAttempt]);

  // NWS measured observations + alerts (US only).
  useEffect(() => {
    const controller = new AbortController();
    fetchJson(
      `/api/observations?lat=${latitude.toFixed(4)}&lon=${longitude.toFixed(4)}`,
      controller.signal,
      parseObservationData,
      "The National Weather Service returned invalid data.",
    )
      .then((data) => {
        if (controller.signal.aborted) return;
        setObservations({ key: locationKey, status: "ready", data });
        setObservationStale(
          data.observation !== null &&
            Date.now() - Date.parse(data.observation.timestamp) > OBSERVATION_STALE_MS,
        );
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setObservations({
          key: locationKey,
          status: "error",
          error: error instanceof Error ? error.message : "Observations are unavailable.",
        });
      });
    return () => controller.abort();
  }, [locationKey, latitude, longitude, observationsAttempt]);

  // Only results for the current location are used.
  const current = <T,>(value: Loadable<T> | null) =>
    value && value.key === locationKey ? value : null;
  const overpassState = current(overpass);
  const weatherState = current(weather);
  const observationsState = current(observations);
  const weatherData = weatherState?.status === "ready" ? weatherState.data : null;

  // Overpass detail wins when available; otherwise the basemap tile data.
  const mapData: MapData | null =
    overpassState?.status === "ready" ? overpassState.data : tileData;

  const handleTileData = useCallback((data: MapData) => setTileData(data), []);

  // Keep the selection in sync with the active data (e.g. tiles → Overpass).
  const activeSelectedRoad = useMemo(() => {
    if (!selectedRoad || !mapData) return selectedRoad;
    return (
      mapData.roads.features.find(
        (road) => road.properties.roadId === selectedRoad.properties.roadId,
      ) ?? selectedRoad
    );
  }, [mapData, selectedRoad]);

  const environmentalAssessment: EnvironmentalAssessment | null = useMemo(() => {
    if (!activeSelectedRoad || !mapData) return null;
    return assessEnvironmentalSensitivity(
      activeSelectedRoad,
      mapData.environmentalFeatures.features as EnvironmentFeature[],
    );
  }, [mapData, activeSelectedRoad]);

  const attention = classifyWeatherAttention(weatherData);
  const forecasts = weatherData ? forecastHours(weatherData) : [];

  function selectLocation(next: Location) {
    setLocation(next);
    setSelectionCount((count) => count + 1);
    setSelectedRoad(null);
    setOverpassAttempt(0);
  }

  function toggleEnvironmentalLayer(kind: EnvironmentalKind) {
    setVisibleEnvironmentalKinds((visible) =>
      visible.includes(kind) ? visible.filter((item) => item !== kind) : [...visible, kind],
    );
  }

  const usingOverpass = mapData?.source === "OpenStreetMap Overpass API";
  const mapStatus = !mapData
    ? "Loading mapped roads and features…"
    : `${mapData.roads.features.length} roads · ${mapData.environmentalFeatures.features.length} environmental features · ${
        usingOverpass ? "OSM detail (Overpass)" : "OSM map tiles"
      }`;

  return (
    <div className="min-h-screen bg-[#F9F7F7] text-[#112D4E]">
      <header className="border-b border-[#DBE2EF] bg-[#F9F7F7]">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3 md:px-8">
          <div className="min-w-[200px]">
            <p className="text-[0.6rem] font-semibold uppercase tracking-[0.3em] text-[#3F72AF]">
              RoadSalt
            </p>
            <p className="mt-1 text-sm font-medium" title={location.displayName}>
              {location.name}
            </p>
          </div>

          <div className="order-3 w-full md:order-none md:w-auto md:flex-1 md:max-w-xl">
            <LocationSearch bias={{ latitude, longitude }} onSelect={selectLocation} />
          </div>

          <div className="ml-auto text-sm">
            <p className="text-[0.6rem] uppercase tracking-[0.2em] text-[#3F72AF]">
              Weather attention
            </p>
            <span className={indicatorClass(attention)}>{attention}</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-4 py-4 md:px-6 md:py-6">
        <div className="grid gap-4 xl:grid-cols-[2.2fr_1fr]">
          <section className="overflow-hidden border border-[#112D4E] bg-[#DBE2EF]/40">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#112D4E]/20 bg-[#F9F7F7] px-4 py-3">
              <div className="min-w-0">
                <SectionLabel>Local road map</SectionLabel>
                <h2 className="mt-1 truncate text-lg font-semibold" title={location.displayName}>
                  {location.displayName}
                </h2>
              </div>
              <div className="flex flex-col items-end gap-1">
                <p className="map-data-status" role="status">
                  {mapStatus}
                </p>
                {(!overpassState || overpassState.status === "loading") && mapData && (
                  <p className="map-data-status">Loading detailed OSM road data…</p>
                )}
                {overpassState?.status === "error" && (
                  <p className="map-data-status">
                    Detailed OSM data unavailable ({overpassState.error}){" "}
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => {
                        setOverpass({ key: locationKey, status: "loading" });
                        setOverpassAttempt((attempt) => attempt + 1);
                      }}
                    >
                      Retry
                    </button>
                  </p>
                )}
              </div>
            </div>

            <div className="h-[560px] bg-[#EAF1F7]">
              <MapCanvas
                focus={focus}
                roads={mapData?.roads ?? EMPTY_ROADS}
                environmentalFeatures={mapData?.environmentalFeatures ?? EMPTY_ENVIRONMENT}
                selectedRoadId={activeSelectedRoad?.properties.roadId ?? null}
                visibleEnvironmentalKinds={visibleEnvironmentalKinds}
                onEnvironmentalVisibilityChange={toggleEnvironmentalLayer}
                onRoadSelect={setSelectedRoad}
                onTileData={handleTileData}
              />
            </div>
          </section>

          <aside className="space-y-5 border border-[#112D4E] bg-[#F9F7F7] p-4">
            {/* Road details first: it is what the user just clicked. */}
            <section className="border-b border-[#DBE2EF] pb-4" aria-labelledby="road-heading">
              <SectionLabel>Road details</SectionLabel>
              <h3 id="road-heading" className="mt-2 text-2xl font-semibold">
                {activeSelectedRoad
                  ? roadDisplayName(activeSelectedRoad.properties)
                  : "Select a road on the map"}
              </h3>

              {activeSelectedRoad ? (
                <div className="mt-3 space-y-4 text-sm">
                  <div>
                    <p className="detail-label">Road attributes · OpenStreetMap</p>
                    <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
                      <dt className="text-[#53677D]">Classification</dt>
                      <dd>{humanize(activeSelectedRoad.properties.classification)}</dd>
                      {activeSelectedRoad.properties.ref && (
                        <>
                          <dt className="text-[#53677D]">Route ref</dt>
                          <dd>{activeSelectedRoad.properties.ref}</dd>
                        </>
                      )}
                      {Object.entries(activeSelectedRoad.properties.tags ?? {})
                        .filter(([key]) => !["highway", "name", "ref"].includes(key))
                        .map(([key, value]) => (
                          <div key={key} className="contents">
                            <dt className="text-[#53677D]">{humanize(key)}</dt>
                            <dd>{humanize(value)}</dd>
                          </div>
                        ))}
                      <dt className="text-[#53677D]">OSM way</dt>
                      <dd>
                        {activeSelectedRoad.properties.osmId ? (
                          <a
                            className="underline"
                            href={`https://www.openstreetmap.org/way/${activeSelectedRoad.properties.osmId}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {activeSelectedRoad.properties.osmId}
                          </a>
                        ) : (
                          "Not available from map tiles"
                        )}
                      </dd>
                    </dl>
                  </div>

                  <div className="border-t border-[#DBE2EF] pt-3">
                    <p className="detail-label">Nearby mapped environmental features</p>
                    {environmentalAssessment ? (
                      <>
                        <span className={`mt-1 inline-block ${indicatorClass(environmentalAssessment.level)}`}>
                          {environmentalAssessment.level} sensitivity
                        </span>
                        <p className="mt-2">
                          Nearest mapped feature:{" "}
                          {environmentalAssessment.nearestDistanceMeters === null
                            ? "None in the loaded data"
                            : formatDistance(environmentalAssessment.nearestDistanceMeters)}
                        </p>
                        {environmentalAssessment.nearbyFeatures.length > 0 ? (
                          <ul className="mt-2 list-disc space-y-1 pl-5">
                            {environmentalAssessment.nearbyFeatures.slice(0, 8).map((item) => (
                              <li key={item.feature.featureId}>
                                {featureDisplayName(item.feature)} · {formatDistance(item.distanceMeters)}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-2">
                            {environmentalAssessment.level === "Unknown"
                              ? "No mapped sensitive feature found in the loaded data."
                              : "No mapped sensitive feature within 250 m."}
                          </p>
                        )}
                        <p className="mt-2 text-xs leading-5 text-[#53677D]">
                          Distances are approximate, measured along the whole loaded length of the
                          road. OSM coverage is incomplete; proximity does not prove pollution or
                          runoff, and absence does not mean an area is safe.
                        </p>
                      </>
                    ) : (
                      <p className="mt-1">Unknown</p>
                    )}
                  </div>

                  <div className="border-t border-[#DBE2EF] pt-3">
                    <p className="detail-label">Local weather · not road-specific</p>
                    <span className={`mt-1 inline-block ${indicatorClass(attention)}`}>
                      {attention} weather attention
                    </span>
                    <p className="mt-2 leading-5">
                      {weatherData
                        ? `${describeWeatherCode(weatherData.current.weatherCode)}, ${weatherData.current.temperature.toFixed(1)} °C air temperature at ${location.name}.`
                        : "Weather for this location is not available."}{" "}
                      Air temperature cannot confirm whether this road is icy.
                    </p>
                  </div>

                  <p className="border-t border-[#DBE2EF] pt-3 text-xs leading-5 text-[#53677D]">
                    Road data: {mapData?.source ?? "OpenStreetMap"}. Sources: © OpenStreetMap
                    contributors, Open-Meteo, National Weather Service. For awareness, not treatment
                    instructions.
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-sm leading-6">
                  Click a road line on the map to see its OpenStreetMap attributes, nearby mapped
                  environmental features and local weather. Search above to explore another place.
                </p>
              )}
            </section>

            <section className="border-b border-[#DBE2EF] pb-4" aria-labelledby="current-heading">
              <SectionLabel id="current-heading">Current conditions · Open-Meteo model</SectionLabel>
              {!weatherState || weatherState.status === "loading" ? (
                <p className="mt-2 text-sm" role="status">Loading weather…</p>
              ) : weatherState.status === "error" ? (
                <ErrorWithRetry
                  message={weatherState.error}
                  onRetry={() => {
                    setWeather({ key: locationKey, status: "loading" });
                    setWeatherAttempt((attempt) => attempt + 1);
                  }}
                />
              ) : (
                <div className="mt-2 text-sm">
                  <p className="font-medium">
                    {describeWeatherCode(weatherState.data.current.weatherCode)} ·{" "}
                    {weatherState.data.current.temperature.toFixed(1)} °C
                  </p>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <dt className="detail-label">Feels like</dt>
                    <dd>{formatMeasurement(weatherState.data.current.apparentTemperature, 1, "°C")}</dd>
                    <dt className="detail-label">Humidity</dt>
                    <dd>{formatMeasurement(weatherState.data.current.relativeHumidity, 0, "%")}</dd>
                    <dt className="detail-label">Wind</dt>
                    <dd>{formatMeasurement(weatherState.data.current.windSpeed, 0, "km/h")}</dd>
                    <dt className="detail-label">Precipitation</dt>
                    <dd>{weatherState.data.current.precipitation.toFixed(1)} mm · {describePrecipitation(weatherState.data)}</dd>
                  </dl>
                  <p className="mt-2 text-xs text-[#53677D]">
                    Model time {formatLocalHour(weatherState.data.current.time)} ({weatherState.data.timezone}) ·
                    fetched {formatClock(weatherState.data.updatedAt)}
                  </p>
                </div>
              )}
            </section>

            <section className="border-b border-[#DBE2EF] pb-4" aria-labelledby="observations-heading">
              <SectionLabel id="observations-heading">Observed now · National Weather Service</SectionLabel>
              {!observationsState || observationsState.status === "loading" ? (
                <p className="mt-2 text-sm" role="status">Loading station observations…</p>
              ) : observationsState.status === "error" ? (
                <ErrorWithRetry
                  message={observationsState.error}
                  onRetry={() => {
                    setObservations({ key: locationKey, status: "loading" });
                    setObservationsAttempt((attempt) => attempt + 1);
                  }}
                />
              ) : (
                <div className="mt-2 text-sm">
                  {observationsState.data.alerts && observationsState.data.alerts.length > 0 && (
                    <div className="mb-3 border border-[#8B3F3F] p-2" role="alert">
                      <p className="font-semibold text-[#8B3F3F]">
                        Active NWS alert{observationsState.data.alerts.length > 1 ? "s" : ""}
                      </p>
                      <ul className="mt-1 space-y-1">
                        {observationsState.data.alerts.map((alert) => (
                          <li key={alert.id}>
                            <span className="font-medium">{alert.event}</span>
                            {alert.severity ? ` · ${alert.severity}` : ""} · until {formatDateTime(alert.ends)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {observationsState.data.observation ? (
                    <>
                      <p className="font-medium">
                        {observationsState.data.observation.description ?? "Conditions not described"} ·{" "}
                        {formatMeasurement(observationsState.data.observation.temperatureC, 1, "°C")}
                      </p>
                      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                        <dt className="detail-label">Dew point</dt>
                        <dd>{formatMeasurement(observationsState.data.observation.dewpointC, 1, "°C")}</dd>
                        <dt className="detail-label">Wind</dt>
                        <dd>{formatMeasurement(observationsState.data.observation.windSpeedKmh, 0, "km/h")}</dd>
                        <dt className="detail-label">Visibility</dt>
                        <dd>
                          {observationsState.data.observation.visibilityM === null
                            ? "Not reported"
                            : `${(observationsState.data.observation.visibilityM / 1000).toFixed(1)} km`}
                        </dd>
                        <dt className="detail-label">Precip. last hour</dt>
                        <dd>{formatMeasurement(observationsState.data.observation.precipitationLastHourMm, 1, "mm")}</dd>
                        {observationsState.data.observation.presentWeather.length > 0 && (
                          <>
                            <dt className="detail-label">Present weather</dt>
                            <dd>{observationsState.data.observation.presentWeather.join(", ")}</dd>
                          </>
                        )}
                      </dl>
                      <p className="mt-2 text-xs leading-5 text-[#53677D]">
                        Measured at {observationsState.data.stationId}
                        {observationsState.data.stationName ? ` (${observationsState.data.stationName})` : ""} at{" "}
                        {formatDateTime(observationsState.data.observation.timestamp)}
                        {observationStale ? " — older than 2 hours" : ""}. Station air measurements, not
                        road-surface readings.
                      </p>
                    </>
                  ) : (
                    <p className="text-[#8B3F3F]">
                      Station observation unavailable: {observationsState.data.observationError}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-[#53677D]">
                    {observationsState.data.alerts === null
                      ? `Alerts unavailable: ${observationsState.data.alertsError}`
                      : observationsState.data.alerts.length === 0
                        ? "No active NWS alerts for this location."
                        : ""}
                  </p>
                </div>
              )}
            </section>

            <section aria-labelledby="forecast-heading">
              <SectionLabel id="forecast-heading">
                Forecast · next 24 hours{weatherData ? ` · ${weatherData.timezone}` : ""}
              </SectionLabel>
              {!weatherState || weatherState.status === "loading" ? (
                <p className="mt-2 text-sm">Loading forecast…</p>
              ) : weatherState.status === "error" ? (
                <p className="mt-2 text-sm text-[#8B3F3F]">Forecast unavailable.</p>
              ) : forecasts.length === 0 ? (
                <p className="mt-2 text-sm">No forecast hours were returned.</p>
              ) : (
                <>
                  <div className="forecast-strip mt-3">
                    {forecasts.map((hour) => (
                      <div key={hour.time} className="forecast-hour">
                        <span className="forecast-time">{formatLocalHour(hour.time)}</span>
                        <span className="forecast-temperature">{hour.temperature.toFixed(0)}°</span>
                        <span>{hour.precipitationProbability}%</span>
                        <span className="forecast-caption">
                          {hour.snowfall >= 0.1
                            ? `${hour.snowfall.toFixed(1)} cm snow`
                            : `${hour.precipitation.toFixed(1)} mm`}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-xs leading-5 text-[#53677D]">
                    Every third hour shown. Temperature is air temperature, not pavement temperature,
                    and cannot confirm whether a road is icy.
                  </p>
                </>
              )}
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}
