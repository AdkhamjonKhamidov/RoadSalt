"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import type { Feature, FeatureCollection, Geometry, Point } from "geojson";
import MapCanvas, {
  type IncidentProperties,
  type MapFocus,
  type ReportPointProperties,
  type RoadColorMode,
  type RoadFeatureProperties,
} from "./MapCanvas";
import LocationSearch from "./LocationSearch";
import RoadAdvice from "./RoadAdvice";
import type { AdviceContext } from "../lib/advice";
import type {
  EnvironmentalKind,
  EnvironmentalProperties,
  IncidentData,
  Location,
  MapData,
  ObservationData,
  RoadProperties,
  StormReportData,
  WeatherData,
} from "../lib/data-types";
import { ENVIRONMENTAL_KIND_LABELS, ENVIRONMENTAL_KINDS } from "../lib/data-types";
import type { EnvironmentalAssessment } from "../lib/proximity";
import { assessEnvironmentalSensitivity, prepareSensitiveParts } from "../lib/proximity";
import { segmentRoad, segmentRoads, summarizeSegments } from "../lib/segments";
import {
  classifyWeatherAttention,
  describePrecipitation,
  describeWeatherCode,
  forecastHours,
} from "../lib/weather";
import {
  BASEMAP_STYLES,
  DEFAULT_LOCATION,
  DEFAULT_MAP_THEME,
  INITIAL_ZOOM,
  type MapTheme,
} from "../lib/demo-config";
import { zoomForLocation } from "../lib/geocoding";
import { PLOW_STATUS_LABELS, type PlowFeedResult } from "../lib/plow-feeds";
import {
  DEFAULT_UNITS,
  formatDistance,
  formatPrecipitation,
  formatSnowfall,
  formatSpeed,
  formatTemperature,
  formatVisibility,
  parseUnitSystem,
  shortTemperature,
  UNIT_STORAGE_KEY,
  type UnitSystem,
} from "../lib/units";
import { isRecord } from "../lib/validation";
import {
  areaCautionReason,
  baseRoadCondition,
  CONDITION_COLORS,
  CONDITION_LABELS,
  incidentsOnRoad,
  roadConditionFor,
  summarizeConditions,
} from "../lib/road-conditions";

type RoadFeature = Feature<Geometry, RoadProperties>;
type EnvironmentFeature = Feature<Geometry, EnvironmentalProperties>;

/** Result of a location-scoped request; `key` ties it to the location it was for. */
type Loadable<T> =
  | { key: string; status: "loading" }
  | { key: string; status: "ready"; data: T }
  | { key: string; status: "error"; error: string };

type PlowStatusData = {
  feeds: PlowFeedResult[];
  errors: { feedId: string; agency: string; message: string }[];
};

const EMPTY_ROADS: FeatureCollection<Geometry, RoadFeatureProperties> = { type: "FeatureCollection", features: [] };
const EMPTY_ENVIRONMENT: MapData["environmentalFeatures"] = { type: "FeatureCollection", features: [] };

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

function parseStormReportData(value: unknown): StormReportData | null {
  if (!isRecord(value) || typeof value.office !== "string" || !Array.isArray(value.reports)) return null;
  return value as StormReportData;
}

function parseIncidentData(value: unknown): IncidentData | null {
  if (!isRecord(value) || typeof value.configured !== "boolean" || !Array.isArray(value.incidents)) return null;
  return value as IncidentData;
}

function parsePlowStatusData(value: unknown): PlowStatusData | null {
  if (!isRecord(value) || !Array.isArray(value.feeds) || !Array.isArray(value.errors)) return null;
  return value as PlowStatusData;
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

/** Runs a location-scoped request; results for an older location are dropped. */
function useLocationRequest<T>(
  url: string,
  parse: (value: unknown) => T | null,
  invalidMessage: string,
  locationKey: string,
) {
  const [state, setState] = useState<Loadable<T> | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetchJson(url, controller.signal, parse, invalidMessage)
      .then((data) => {
        if (!controller.signal.aborted) setState({ key: locationKey, status: "ready", data });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          key: locationKey,
          status: "error",
          error: error instanceof Error ? error.message : invalidMessage,
        });
      });
    return () => controller.abort();
  }, [url, parse, invalidMessage, locationKey, attempt]);
  const retry = useCallback(() => {
    setState({ key: locationKey, status: "loading" });
    setAttempt((value) => value + 1);
  }, [locationKey]);
  // A result tagged with another location counts as still loading.
  return [state && state.key === locationKey ? state : null, retry] as const;
}

// --- Formatting ---

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
    forest: "forest",
    protected: "protected area",
  };
  const subtype =
    feature.subtype && feature.subtype !== feature.kind ? humanize(feature.subtype).toLowerCase() : null;
  return `Mapped ${subtype ?? kindLabels[feature.kind]}`;
}

/** Open-Meteo local time ("2026-11-07T17:00") → "5 PM" in the location's zone. */
function formatLocalHour(time: string): string {
  const hour = Number(time.slice(11, 13));
  if (!Number.isFinite(hour)) return time.slice(11, 16);
  const suffix = hour < 12 ? "AM" : "PM";
  return `${hour % 12 === 0 ? 12 : hour % 12} ${suffix}`;
}

function formatDateTime(timestamp: string | null): string {
  if (!timestamp) return "unspecified";
  return new Date(timestamp).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
}

function formatDate(timestamp: string): string {
  return new Date(timestamp).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function reportMagnitude(magnitude: number | null, unit: string | null, units: UnitSystem): string {
  if (magnitude === null) return "";
  if (unit === "INCH" && units === "metric") return ` · ${(magnitude * 2.54).toFixed(1)} cm`;
  if (unit === "MPH" && units === "metric") return ` · ${Math.round(magnitude * 1.609)} km/h`;
  if (unit === "F" && units === "metric") return ` · ${Math.round(((magnitude - 32) * 5) / 9)} °C`;
  return ` · ${magnitude} ${unit === "INCH" ? "in" : unit === "MPH" ? "mph" : unit === "F" ? "°F" : (unit ?? "")}`.trimEnd();
}

// --- Preferences (per browser; storage may be unavailable) ---

function readStoredUnits(): UnitSystem {
  try {
    return parseUnitSystem(window.localStorage.getItem(UNIT_STORAGE_KEY)) ?? DEFAULT_UNITS;
  } catch {
    return DEFAULT_UNITS;
  }
}

const unitListeners = new Set<() => void>();
function subscribeUnits(callback: () => void) {
  unitListeners.add(callback);
  return () => unitListeners.delete(callback);
}
function storeUnits(units: UnitSystem) {
  try {
    window.localStorage.setItem(UNIT_STORAGE_KEY, units);
  } catch {
    // Not persisted; still applied for this page view below.
  }
  sessionUnits = units;
  unitListeners.forEach((listener) => listener());
}
let sessionUnits: UnitSystem | null = null;

// --- Small presentational pieces ---

function formatClock(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Position along a road, in one unit for a whole table (mi or km, 2 decimals). */
function formatAlong(meters: number, units: UnitSystem): string {
  return units === "imperial" ? `${(meters / 1609.344).toFixed(2)} mi` : `${(meters / 1000).toFixed(2)} km`;
}

function nearestFeatureLabel(nearest: { name: string | null; kind: EnvironmentalKind }): string {
  return featureDisplayName({ featureId: "", kind: nearest.kind, name: nearest.name ?? undefined });
}

function formatCoordinates(latitude: number, longitude: number): string {
  return `${Math.abs(latitude).toFixed(4)}° ${latitude >= 0 ? "N" : "S"}, ${Math.abs(longitude).toFixed(4)}° ${longitude >= 0 ? "E" : "W"}`;
}

function ErrorWithRetry({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <p className="ip-error" role="status">
      {message}{" "}
      <button type="button" className="text-button" onClick={onRetry}>
        Retry
      </button>
    </p>
  );
}

/** A titled section of the information panel: heading, rule, content. */
function Section({
  title,
  aside,
  children,
  id,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section className="ip-section" aria-labelledby={id}>
      <div className="ip-section-head">
        <h2 id={id} className="ip-heading">
          {title}
        </h2>
        {aside && <span className="ip-aside">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

function SegmentedToggle<T extends string>({
  label,
  value,
  options,
  onChange,
  className = "",
}: {
  label: string;
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={`segmented ${className}`} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          disabled={option.disabled}
          className={value === option.value ? "segmented-option segmented-option-active" : "segmented-option"}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Swatch({ color }: { color: string }) {
  return <span className="swatch" style={{ background: color }} aria-hidden="true" />;
}

const SENSITIVITY_DESCRIPTIONS: Record<string, string> = {
  High: "mapped feature within 50 m",
  Moderate: "mapped feature within 250 m",
  Low: "no mapped feature within 250 m",
  Unknown: "no environmental features in the loaded data",
};

const SENSITIVITY_COLORS: Record<string, string> = {
  High: "#B3261E",
  Moderate: "#D4890F",
  Low: "#2E7D8C",
  Unknown: "#A7B0BC",
};

const ATTENTION_DESCRIPTIONS: Record<string, string> = {
  Elevated: "precipitation forecast at or below freezing",
  Moderate: "precipitation forecast near freezing (0–3 °C)",
  Low: "no freezing precipitation in the forecast",
  "Insufficient data": "forecast not available",
};

export default function RoadSaltDashboard() {
  const [location, setLocation] = useState<Location>(DEFAULT_LOCATION);
  const [selectionCount, setSelectionCount] = useState(0);
  const [tileData, setTileData] = useState<MapData | null>(null);
  const [selectedRoad, setSelectedRoad] = useState<RoadFeature | null>(null);
  const [visibleEnvironmentalKinds, setVisibleEnvironmentalKinds] =
    useState<EnvironmentalKind[]>(ENVIRONMENTAL_KINDS);
  const [theme, setTheme] = useState<MapTheme>(DEFAULT_MAP_THEME);
  const [colorChoice, setColorChoice] = useState<RoadColorMode>("conditions");

  const units = useSyncExternalStore(
    subscribeUnits,
    () => sessionUnits ?? readStoredUnits(),
    () => DEFAULT_UNITS,
  );

  const { latitude, longitude } = location;
  // Every location-scoped request is tagged with this key; a result for an
  // older key is never shown (and its request is aborted on change).
  const locationKey = `${location.id}@${latitude.toFixed(5)},${longitude.toFixed(5)}`;
  const coordinateQuery = `lat=${latitude.toFixed(4)}&lon=${longitude.toFixed(4)}`;

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

  const [weatherState, retryWeather] = useLocationRequest(
    `/api/weather?${coordinateQuery}`,
    parseWeatherData,
    "Open-Meteo returned invalid weather data.",
    locationKey,
  );
  const [observationsState, retryObservations] = useLocationRequest(
    `/api/observations?${coordinateQuery}`,
    parseObservationData,
    "The National Weather Service returned invalid data.",
    locationKey,
  );
  const [reportsState, retryReports] = useLocationRequest(
    `/api/storm-reports?${coordinateQuery}`,
    parseStormReportData,
    "Storm reports returned invalid data.",
    locationKey,
  );
  const [incidentsState, retryIncidents] = useLocationRequest(
    `/api/incidents?${coordinateQuery}`,
    parseIncidentData,
    "Traffic incidents returned invalid data.",
    locationKey,
  );
  const [plowState, retryPlow] = useLocationRequest(
    `/api/plow-status?${coordinateQuery}`,
    parsePlowStatusData,
    "Plow status returned invalid data.",
    locationKey,
  );

  const weatherData = weatherState?.status === "ready" ? weatherState.data : null;
  const observationData = observationsState?.status === "ready" ? observationsState.data : null;
  const plowFeeds = useMemo(
    () => (plowState?.status === "ready" ? plowState.data.feeds : []),
    [plowState],
  );
  const hasPlowFeed = plowFeeds.length > 0;
  const colorMode: RoadColorMode = colorChoice === "plow" && !hasPlowFeed ? "conditions" : colorChoice;

  // Roads and environmental features read from the basemap's OSM vector tiles.
  const mapData: MapData | null = tileData;
  const handleTileData = useCallback((data: MapData) => setTileData(data), []);

  const attention = classifyWeatherAttention(weatherData);
  const incidentData = incidentsState?.status === "ready" ? incidentsState.data : null;
  const incidentList = useMemo(() => incidentData?.incidents ?? [], [incidentData]);
  const incidentDataLoaded = Boolean(incidentData?.configured);
  const areaCaution = useMemo(
    () => areaCautionReason(observationData?.alerts, attention),
    [observationData, attention],
  );
  const conditionSummary = summarizeConditions({
    incidents: incidentDataLoaded ? incidentList : null,
    incidentsConfigured: incidentData?.configured ?? true,
    incidentsError: incidentsState?.status === "error" ? incidentsState.error : null,
    areaCaution,
  });
  const baseCondition = useMemo(
    () => baseRoadCondition(incidentDataLoaded, areaCaution),
    [incidentDataLoaded, areaCaution],
  );

  const incidentFeatures = useMemo<FeatureCollection<Geometry, IncidentProperties>>(
    () => ({
      type: "FeatureCollection",
      features: incidentList.map((incident) => ({
        type: "Feature",
        geometry: incident.geometry,
        properties: {
          id: incident.id,
          condition: incident.condition,
          title: `${incident.type}${incident.roads.length ? ` · ${incident.roads.join(", ")}` : ""}`,
          detail: [
            incident.description !== incident.type ? incident.description : null,
            incident.from && incident.to ? `${incident.from} → ${incident.to}` : incident.from,
            incident.end ? `Until ${formatDateTime(incident.end)}` : null,
            "Source: TomTom Traffic",
          ]
            .filter(Boolean)
            .join(" · "),
        },
      })),
    }),
    [incidentList],
  );

  // Per-road colouring for the active view.
  const coloredRoads = useMemo<FeatureCollection<Geometry, RoadFeatureProperties>>(() => {
    if (!mapData) return EMPTY_ROADS;
    if (colorMode === "conditions") {
      return {
        type: "FeatureCollection",
        features: mapData.roads.features.map((road) => ({
          ...road,
          properties: { ...road.properties, condition: baseCondition },
        })),
      };
    }
    if (colorMode !== "sensitivity") return mapData.roads;
    // Proximity view: every road split into 100 m pieces, each rated on its own.
    return segmentRoads(mapData.roads.features, mapData.environmentalFeatures.features as EnvironmentFeature[]);
  }, [mapData, colorMode, baseCondition]);

  const plowRoutes = useMemo(() => {
    const features = plowFeeds.flatMap((feed) => feed.routes.features);
    return features.length > 0 ? { type: "FeatureCollection" as const, features } : undefined;
  }, [plowFeeds]);

  const reportPoints = useMemo<FeatureCollection<Point, ReportPointProperties> | undefined>(() => {
    if (reportsState?.status !== "ready") return undefined;
    return {
      type: "FeatureCollection",
      features: reportsState.data.reports.map((report) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [report.longitude, report.latitude] },
        properties: {
          id: report.id,
          title: `${humanize(report.type.toLowerCase())}${reportMagnitude(report.magnitude, report.unit, units)}`,
          detail: `${report.location} · ${formatDateTime(report.time)}${report.source ? ` · ${report.source}` : ""}${report.remark ? ` — ${report.remark}` : ""}`,
          winter: report.winter,
        },
      })),
    };
  }, [reportsState, units]);

  // Keep the selection in sync with freshly read tile data after map moves.
  const activeSelectedRoad = useMemo(() => {
    if (!selectedRoad || !mapData) return selectedRoad;
    return (
      mapData.roads.features.find((road) => road.properties.roadId === selectedRoad.properties.roadId) ??
      selectedRoad
    );
  }, [mapData, selectedRoad]);

  const environmentalAssessment: EnvironmentalAssessment | null = useMemo(() => {
    if (!activeSelectedRoad || !mapData) return null;
    return assessEnvironmentalSensitivity(
      activeSelectedRoad,
      mapData.environmentalFeatures.features as EnvironmentFeature[],
    );
  }, [mapData, activeSelectedRoad]);

  // Runoff exposure along the selected road, 100 m at a time.
  const segmentSummary = useMemo(() => {
    if (!activeSelectedRoad || !mapData) return null;
    const parts = prepareSensitiveParts(mapData.environmentalFeatures.features as EnvironmentFeature[]);
    const segments = segmentRoad(activeSelectedRoad, parts);
    return segments.length ? { segments, ...summarizeSegments(segments) } : null;
  }, [mapData, activeSelectedRoad]);

  const forecasts = weatherData ? forecastHours(weatherData) : [];
  const selectedCondition = useMemo(() => {
    if (!activeSelectedRoad) return null;
    const onRoad = incidentsOnRoad(activeSelectedRoad, incidentList);
    return { ...roadConditionFor(onRoad, incidentDataLoaded, areaCaution), onRoad };
  }, [activeSelectedRoad, incidentList, incidentDataLoaded, areaCaution]);
  const winterReports = useMemo(
    () => (reportsState?.status === "ready" ? reportsState.data.reports.filter((r) => r.winter) : []),
    [reportsState],
  );

  function selectLocation(next: Location) {
    setLocation(next);
    setSelectionCount((count) => count + 1);
    setSelectedRoad(null);
  }

  function toggleEnvironmentalLayer(kind: EnvironmentalKind) {
    setVisibleEnvironmentalKinds((visible) =>
      visible.includes(kind) ? visible.filter((item) => item !== kind) : [...visible, kind],
    );
  }

  const mapStatus = !mapData
    ? "Loading roads…"
    : `${mapData.roads.features.length} roads · ${mapData.environmentalFeatures.features.length} features in view`;

  const alertCount = observationData?.alerts?.length ?? 0;
  const reportCount = reportsState?.status === "ready" ? reportsState.data.reports.length : null;

  const [roadsVisible, setRoadsVisible] = useState(true);

  // Mapped environmental features in the loaded area, by kind (real counts).
  const featureCounts = useMemo(() => {
    const counts = new Map<EnvironmentalKind, number>();
    for (const feature of mapData?.environmentalFeatures.features ?? []) {
      const kind = feature.properties.kind;
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
    return ENVIRONMENTAL_KINDS.filter((kind) => counts.has(kind)).map((kind) => ({
      kind,
      count: counts.get(kind) ?? 0,
    }));
  }, [mapData]);

  const viewOptions: { value: RoadColorMode; label: string }[] = [
    { value: "conditions", label: "Road conditions" },
    { value: "sensitivity", label: "Environmental proximity" },
    ...(hasPlowFeed ? [{ value: "plow" as const, label: "Plow status" }] : []),
  ];

  const mapControls = (
    <div className="mc-section mc-display">
      <p className="mc-label">Road display</p>
      <SegmentedToggle label="Road view" value={colorMode} options={viewOptions} onChange={setColorChoice} className="segmented-stack" />
      {BASEMAP_STYLES.dark && (
        <>
          <p className="mc-label mt-2">Basemap</p>
          <SegmentedToggle
            label="Map style"
            value={theme}
            options={[
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
            onChange={setTheme}
          />
        </>
      )}
    </div>
  );

  const observation = observationsState?.status === "ready" ? observationsState.data : null;

  // Everything RoadSalt knows about the selected road, for the Gemini suggestion.
  // Metric throughout; only real loaded values (null when missing).
  const adviceContext = useMemo<AdviceContext | null>(() => {
    if (!activeSelectedRoad || !selectedCondition) return null;
    const hours = weatherData?.hourly ?? [];
    const sum = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) : null);
    return {
      roadId: activeSelectedRoad.properties.roadId,
      road: {
        name: roadDisplayName(activeSelectedRoad.properties),
        classification: humanize(activeSelectedRoad.properties.classification),
        ref: activeSelectedRoad.properties.ref ?? null,
      },
      location: {
        name: location.name,
        displayName: location.displayName,
        latitude,
        longitude,
        timezone: weatherData?.timezone ?? null,
      },
      condition: {
        label: CONDITION_LABELS[selectedCondition.condition],
        reason: selectedCondition.reason,
        incidents: selectedCondition.onRoad.map((incident) => incident.description),
      },
      environment: {
        level: environmentalAssessment?.level ?? "Unknown",
        features: (environmentalAssessment?.nearbyFeatures ?? []).slice(0, 8).map((item) => ({
          name: featureDisplayName(item.feature),
          distanceMeters: item.distanceMeters,
        })),
        segments: segmentSummary
          ? {
              count: segmentSummary.count,
              totalMeters: segmentSummary.totalMeters,
              high: segmentSummary.counts.High,
              moderate: segmentSummary.counts.Moderate,
              low: segmentSummary.counts.Low,
              stretches: segmentSummary.stretches.slice(0, 6).map(
                (stretch) =>
                  `${Math.round(stretch.startMeters)}–${Math.round(stretch.endMeters)} m along the road: ${stretch.level}${stretch.nearestFeature ? `, ${nearestFeatureLabel(stretch.nearestFeature)} ${Math.round(stretch.nearestFeature.distanceMeters)} m away` : ""}`,
              ),
            }
          : null,
      },
      weather: {
        description: weatherData ? describeWeatherCode(weatherData.current.weatherCode) : null,
        temperatureC: weatherData?.current.temperature ?? null,
        apparentC: weatherData?.current.apparentTemperature ?? null,
        windKmh: weatherData?.current.windSpeed ?? null,
        attention,
        next24h: {
          minC: hours.length ? Math.min(...hours.map((hour) => hour.temperature)) : null,
          maxC: hours.length ? Math.max(...hours.map((hour) => hour.temperature)) : null,
          maxPrecipChance: hours.length ? Math.max(...hours.map((hour) => hour.precipitationProbability)) : null,
          totalPrecipMm: sum(hours.map((hour) => hour.precipitation)),
          totalSnowCm: sum(hours.map((hour) => hour.snowfall)),
          hoursAtOrBelowFreezing: hours.length ? hours.filter((hour) => hour.temperature <= 0).length : null,
        },
      },
      observation:
        observation?.observation && observation.stationId
          ? {
              stationId: observation.stationId,
              temperatureC: observation.observation.temperatureC,
              time: observation.observation.timestamp,
            }
          : null,
      alerts: (observationData?.alerts ?? []).map((alert) => alert.event),
      stormReports: winterReports
        .slice(0, 6)
        .map((report) => `${humanize(report.type.toLowerCase())}${reportMagnitude(report.magnitude, report.unit, "metric")} at ${report.location}, ${report.time}`),
    };
  }, [activeSelectedRoad, selectedCondition, environmentalAssessment, segmentSummary, weatherData, observation, observationData, attention, winterReports, location, latitude, longitude]);
  const adviceReady =
    Boolean(adviceContext) &&
    weatherState !== null && weatherState.status !== "loading" &&
    incidentsState !== null && incidentsState.status !== "loading" &&
    observationsState !== null && observationsState.status !== "loading";

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <Image className="brand-mark" src="/assets/favicon.png" alt="" width={30} height={30} priority />
          <span className="wordmark">RoadSalt</span>
        </div>
        <div className="header-location" title={location.displayName}>
          <span className="header-location-label">Location</span>
          <span className="header-location-name">{location.displayName}</span>
        </div>
        <div className="header-search">
          <LocationSearch bias={{ latitude, longitude }} onSelect={selectLocation} />
        </div>
        <SegmentedToggle
          label="Temperature units"
          value={units}
          className="header-units"
          options={[
            { value: "imperial", label: "°F" },
            { value: "metric", label: "°C" },
          ]}
          onChange={storeUnits}
        />
      </header>

      <main className="workspace">
        <section className="map-area" aria-label="Road map">
          {colorMode === "conditions" ? (
            <div className="map-statusbar condition-banner" role="status">
              <Swatch color={CONDITION_COLORS[conditionSummary.tone]} />
              <p className="condition-headline">{conditionSummary.headline}</p>
              {conditionSummary.detail && <p className="statusbar-detail">{conditionSummary.detail}</p>}
              {incidentsState?.status === "error" && (
                <button type="button" className="text-button" onClick={retryIncidents}>
                  Retry
                </button>
              )}
            </div>
          ) : colorMode === "sensitivity" ? (
            <div className="map-statusbar" role="status">
              <p className="condition-headline">Distance from each road to the nearest mapped waterway, water body, wetland or farmland.</p>
              <p className="statusbar-detail">OpenStreetMap features only. Proximity is not evidence of runoff.</p>
            </div>
          ) : (
            <div className="map-statusbar" role="status">
              <p className="condition-headline">Plow and treatment status from {plowFeeds.map((feed) => feed.feed.agency).join(", ")}.</p>
              <p className="statusbar-detail">Status older than 48 hours is shown as outdated.</p>
            </div>
          )}

          <div className="map-frame">
            <MapCanvas
              focus={focus}
              theme={theme}
              roadColorMode={colorMode}
              roads={coloredRoads}
              environmentalFeatures={mapData?.environmentalFeatures ?? EMPTY_ENVIRONMENT}
              plowRoutes={colorMode === "plow" ? plowRoutes : undefined}
              reportPoints={reportPoints}
              incidents={incidentFeatures}
              selectedRoadId={activeSelectedRoad?.properties.roadId ?? null}
              visibleEnvironmentalKinds={visibleEnvironmentalKinds}
              onEnvironmentalVisibilityChange={toggleEnvironmentalLayer}
              roadsVisible={roadsVisible}
              onRoadsVisibleChange={setRoadsVisible}
              controls={mapControls}
              onRoadSelect={setSelectedRoad}
              onTileData={handleTileData}
            />
          </div>
        </section>

        <aside className="info-panel" aria-label="Location and road information">
          <Section title="Selected location" id="location-heading">
            <p className="place-name">{location.name}</p>
            <dl className="facts">
              <dt>Address</dt>
              <dd>{location.displayName}</dd>
              <dt>Coordinates</dt>
              <dd className="tabular">{formatCoordinates(latitude, longitude)}</dd>
              {observation && (
                <>
                  <dt>NWS station</dt>
                  <dd>
                    {observation.stationId}
                    {observation.stationName ? ` · ${observation.stationName}` : ""}
                  </dd>
                </>
              )}
              {weatherData && (
                <>
                  <dt>Time zone</dt>
                  <dd>{weatherData.timezone.replace(/_/g, " ")}</dd>
                </>
              )}
            </dl>
          </Section>

          {observationData?.alerts && observationData.alerts.length > 0 && (
            <div className="alert-box" role="alert">
              <p className="alert-title">Active NWS alert{observationData.alerts.length > 1 ? "s" : ""}</p>
              <ul>
                {observationData.alerts.map((alert) => (
                  <li key={alert.id}>
                    {alert.event}
                    {alert.severity ? ` (${alert.severity})` : ""}, until {formatDateTime(alert.ends)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Section
            title="Selected road"
            aside={
              activeSelectedRoad ? (
                <button type="button" className="text-button" aria-label="Clear road selection" onClick={() => setSelectedRoad(null)}>
                  Clear
                </button>
              ) : undefined
            }
          >
            {activeSelectedRoad ? (
              <>
                <h3 id="road-heading" className="road-name">
                  {roadDisplayName(activeSelectedRoad.properties)}
                </h3>
                <dl className="facts">
                  <dt>Road classification</dt>
                  <dd>{humanize(activeSelectedRoad.properties.classification)}</dd>
                  {activeSelectedRoad.properties.ref && (
                    <>
                      <dt>Route</dt>
                      <dd>{activeSelectedRoad.properties.ref}</dd>
                    </>
                  )}
                  {selectedCondition && (
                    <>
                      <dt>Reported condition</dt>
                      <dd className="condition-card">
                        <span className="status-line">
                          <Swatch color={CONDITION_COLORS[selectedCondition.condition]} />
                          {CONDITION_LABELS[selectedCondition.condition]}
                        </span>
                        <span className="dd-note">{selectedCondition.reason}</span>
                        {selectedCondition.onRoad.length > 1 && (
                          <span className="dd-note">
                            Also: {selectedCondition.onRoad.slice(1, 4).map((incident) => incident.description).join("; ")}
                          </span>
                        )}
                      </dd>
                    </>
                  )}
                  {segmentSummary && (
                    <>
                      <dt>Loaded length</dt>
                      <dd className="tabular">{formatDistance(segmentSummary.totalMeters, units)}</dd>
                    </>
                  )}
                </dl>
                <p className="fine-print">
                  Condition from TomTom Traffic incidents and NWS alerts. Not a measurement of the road surface; air
                  temperature cannot confirm ice.
                </p>
                {adviceContext && <RoadAdvice context={adviceContext} ready={adviceReady} />}
              </>
            ) : (
              <p className="empty-state">
                No road selected. Select a road on the map to view its classification, reported condition and nearby
                mapped environmental features.
              </p>
            )}
          </Section>

          <Section title="Nearby environmental features">
            {activeSelectedRoad ? (
              environmentalAssessment ? (
                <>
                  <p className="status-line">
                    <Swatch color={SENSITIVITY_COLORS[environmentalAssessment.level]} />
                    <span>
                      <strong>{environmentalAssessment.level} sensitivity</strong>
                      <span className="muted">: {SENSITIVITY_DESCRIPTIONS[environmentalAssessment.level]}</span>
                    </span>
                  </p>
                  {segmentSummary && (
                    <div className="segment-breakdown">
                      <p className="ip-subheading">
                        Runoff exposure in 100 m segments ({segmentSummary.count})
                      </p>
                      <div
                        className="segment-strip"
                        role="img"
                        aria-label={`${segmentSummary.counts.High} high, ${segmentSummary.counts.Moderate} moderate, ${segmentSummary.counts.Low} low exposure segments`}
                      >
                        {segmentSummary.segments.map((segment) => (
                          <span
                            key={segment.properties.segmentId}
                            className="segment-cell"
                            style={{ background: SENSITIVITY_COLORS[segment.properties.sensitivity] }}
                            title={`${formatAlong(segment.properties.startMeters, units)}–${formatAlong(segment.properties.endMeters, units)}: ${segment.properties.sensitivity}${segment.properties.nearestFeature ? `, ${nearestFeatureLabel(segment.properties.nearestFeature)} ${formatDistance(segment.properties.nearestFeature.distanceMeters, units)}` : ""}`}
                          />
                        ))}
                      </div>
                      <p className="segment-axis">
                        <span>One end</span>
                        <span>{formatDistance(segmentSummary.totalMeters, units)}</span>
                      </p>
                      <p className="segment-counts">
                        {(["High", "Moderate", "Low", "Unknown"] as const)
                          .filter((level) => segmentSummary.counts[level] > 0)
                          .map((level) => (
                            <span key={level}>
                              <Swatch color={SENSITIVITY_COLORS[level]} /> {level} {segmentSummary.counts[level]}
                            </span>
                          ))}
                      </p>
                      {segmentSummary.stretches.length > 0 && (
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th scope="col">Stretch</th>
                              <th scope="col">Exposure</th>
                              <th scope="col" className="num">
                                Nearest feature
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {segmentSummary.stretches.slice(0, 6).map((stretch) => (
                              <tr key={`${stretch.startMeters}`}>
                                <td className="tabular">
                                  {formatAlong(stretch.startMeters, units)}–{formatAlong(stretch.endMeters, units)}
                                </td>
                                <td>{stretch.level}</td>
                                <td className="num">
                                  {stretch.nearestFeature
                                    ? `${nearestFeatureLabel(stretch.nearestFeature)}, ${formatDistance(stretch.nearestFeature.distanceMeters, units)}`
                                    : "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                  {environmentalAssessment.nearbyFeatures.length > 0 ? (
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th scope="col">Feature</th>
                          <th scope="col" className="num">
                            Distance
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {environmentalAssessment.nearbyFeatures.slice(0, 8).map((item) => (
                          <tr key={item.feature.featureId}>
                            <td>{featureDisplayName(item.feature)}</td>
                            <td className="num">{formatDistance(item.distanceMeters, units)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="empty-state">
                      {environmentalAssessment.level === "Unknown"
                        ? "No mapped sensitive feature found in the loaded data."
                        : `No mapped sensitive feature within ${formatDistance(250, units)}.`}
                    </p>
                  )}
                </>
              ) : (
                <p className="empty-state">Environmental data is not loaded for this road.</p>
              )
            ) : featureCounts.length > 0 ? (
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Mapped in the loaded area</th>
                    <th scope="col" className="num">
                      Features
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {featureCounts.map(({ kind, count }) => (
                    <tr key={kind}>
                      <td>{ENVIRONMENTAL_KIND_LABELS[kind]}</td>
                      <td className="num">{count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="empty-state">{mapData ? "No environmental features mapped in the loaded area." : "Loading map features…"}</p>
            )}
            <p className="fine-print">
              Distances are approximate, measured along the road&apos;s loaded length to OpenStreetMap features.
              Proximity does not prove runoff, and unmapped areas are not necessarily free of sensitive features.
            </p>
          </Section>

          <Section
            title="Current weather conditions"
            aside={weatherData ? `Retrieved ${formatClock(weatherData.updatedAt)}` : undefined}
          >
            {!weatherState || weatherState.status === "loading" ? (
              <p className="empty-state" role="status">Loading weather…</p>
            ) : weatherState.status === "error" ? (
              <ErrorWithRetry message={weatherState.error} onRetry={retryWeather} />
            ) : (
              <dl className="facts">
                <dt>Conditions</dt>
                <dd>{describeWeatherCode(weatherState.data.current.weatherCode)}</dd>
                <dt>Air temperature</dt>
                <dd className="tabular">{formatTemperature(weatherState.data.current.temperature, units, 1)}</dd>
                <dt>Feels like</dt>
                <dd className="tabular">{formatTemperature(weatherState.data.current.apparentTemperature, units)}</dd>
                <dt>Humidity</dt>
                <dd className="tabular">
                  {weatherState.data.current.relativeHumidity === null
                    ? "Not reported"
                    : `${weatherState.data.current.relativeHumidity.toFixed(0)} %`}
                </dd>
                <dt>Wind</dt>
                <dd className="tabular">{formatSpeed(weatherState.data.current.windSpeed, units)}</dd>
                <dt>Precipitation</dt>
                <dd>
                  {formatPrecipitation(weatherState.data.current.precipitation, units)} · {describePrecipitation(weatherState.data)}
                </dd>
                <dt>Winter weather attention</dt>
                <dd>
                  <strong>{attention}</strong>
                  <span className="dd-note">{ATTENTION_DESCRIPTIONS[attention]}</span>
                </dd>
              </dl>
            )}
            {observation?.observation && (
              <>
                <p className="ip-subheading">
                  Observed at {observation.stationId}, {formatDateTime(observation.observation.timestamp)}
                  {observation.observationStale ? " (older than 2 hours)" : ""}
                </p>
                <dl className="facts">
                  <dt>Air temperature</dt>
                  <dd className="tabular">{formatTemperature(observation.observation.temperatureC, units, 1)}</dd>
                  <dt>Dew point</dt>
                  <dd className="tabular">{formatTemperature(observation.observation.dewpointC, units)}</dd>
                  <dt>Wind</dt>
                  <dd className="tabular">{formatSpeed(observation.observation.windSpeedKmh, units)}</dd>
                  <dt>Visibility</dt>
                  <dd className="tabular">{formatVisibility(observation.observation.visibilityM, units)}</dd>
                </dl>
              </>
            )}
            {observationsState?.status === "error" && (
              <p className="fine-print">
                Measured observations: {observationsState.error}{" "}
                <button type="button" className="text-button" onClick={retryObservations}>
                  Retry
                </button>
              </p>
            )}
            <p className="fine-print">Open-Meteo model values and NWS station readings describe the air, not the road surface.</p>
          </Section>

          <Section title="24-hour forecast" aside={weatherData ? "Every 3 hours, local time" : undefined}>
            {!weatherState || weatherState.status === "loading" ? (
              <p className="empty-state">Loading forecast…</p>
            ) : weatherState.status === "error" ? (
              <p className="ip-error">Forecast unavailable.</p>
            ) : forecasts.length === 0 ? (
              <p className="empty-state">No forecast hours were returned.</p>
            ) : (
              <table className="data-table forecast-table">
                <thead>
                  <tr>
                    <th scope="col">Time</th>
                    <th scope="col" className="num">
                      Air temp.
                    </th>
                    <th scope="col" className="num">
                      Precip. chance
                    </th>
                    <th scope="col" className="num">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {forecasts.map((hour) => (
                    <tr key={hour.time} className="forecast-hour">
                      <td>{formatLocalHour(hour.time)}</td>
                      <td className="num forecast-temperature">{shortTemperature(hour.temperature, units)}</td>
                      <td className="num">{hour.precipitationProbability}%</td>
                      <td className="num">
                        {hour.snowfall >= 0.1
                          ? `${formatSnowfall(hour.snowfall, units)} snow`
                          : formatPrecipitation(hour.precipitation, units)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section
            title="Alerts and local reports"
            aside={reportCount === null ? undefined : `${alertCount} alert${alertCount === 1 ? "" : "s"} · ${reportCount} report${reportCount === 1 ? "" : "s"}`}
          >
            {observationData?.alerts?.length === 0 && <p className="empty-state">No active NWS alerts for this location.</p>}
            <p className="ip-subheading">NWS storm reports, last 72 hours within 50 mi</p>
            {!reportsState || reportsState.status === "loading" ? (
              <p className="empty-state" role="status">Loading reports…</p>
            ) : reportsState.status === "error" ? (
              <ErrorWithRetry message={reportsState.error} onRetry={retryReports} />
            ) : reportsState.data.reports.length === 0 ? (
              <p className="empty-state">No reports from NWS {reportsState.data.office} in the last 72 hours.</p>
            ) : (
              <table className="data-table">
                <tbody>
                  {[...winterReports, ...reportsState.data.reports.filter((r) => !r.winter)].slice(0, 8).map((report) => (
                    <tr key={report.id}>
                      <td>
                        {humanize(report.type.toLowerCase())}
                        {reportMagnitude(report.magnitude, report.unit, units)}
                        <span className="dd-note">{report.location}</span>
                      </td>
                      <td className="num">{formatDateTime(report.time)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <p className="ip-subheading">Agency plow status</p>
            {!plowState || plowState.status === "loading" ? (
              <p className="empty-state">Checking for a local plow-status feed…</p>
            ) : plowState.status === "error" ? (
              <ErrorWithRetry message={plowState.error} onRetry={retryPlow} />
            ) : plowFeeds.length === 0 ? (
              <p className="empty-state">No public plow-status feed is connected for this area.</p>
            ) : (
              plowFeeds.map((feed) => (
                <div key={feed.feed.id} className="plow-feed">
                  <p>
                    <strong>{feed.feed.agency}</strong>
                  </p>
                  <p className="dd-note">
                    {feed.routes.features.length} route segments ·{" "}
                    {(Object.keys(feed.counts) as (keyof typeof feed.counts)[])
                      .filter((category) => feed.counts[category] > 0)
                      .map((category) => `${feed.counts[category]} ${PLOW_STATUS_LABELS[category].toLowerCase()}`)
                      .join(", ")}
                  </p>
                  <p className={feed.allStale ? "dd-note ip-error" : "dd-note"}>
                    {feed.newestUpdate
                      ? `Last updated ${formatDate(feed.newestUpdate)}${feed.allStale ? ". Outdated; not current road conditions" : ""}.`
                      : "No update time provided."}{" "}
                    <a className="link" href={feed.feed.publicMapUrl} target="_blank" rel="noreferrer">
                      Agency map
                    </a>
                    {colorMode !== "plow" && (
                      <>
                        {" · "}
                        <button type="button" className="text-button" onClick={() => setColorChoice("plow")}>
                          Show on map
                        </button>
                      </>
                    )}
                  </p>
                </div>
              ))
            )}
            {plowState?.status === "ready" &&
              plowState.data.errors.map((error) => (
                <p key={error.feedId} className="ip-error">
                  {error.message}
                </p>
              ))}
          </Section>

          <Section title="Data sources">
            <dl className="facts sources">
              <dt>Roads and features</dt>
              <dd>
                OpenStreetMap
                <span className="dd-note">
                  <span className="map-data-status" role="status">{mapStatus}</span> · read from the basemap&apos;s vector tiles
                </span>
              </dd>
              <dt>Road incidents</dt>
              <dd>
                TomTom Traffic
                <span className="dd-note">
                  {!incidentsState
                    ? "Requesting…"
                    : incidentsState.status === "error"
                      ? "Unavailable"
                      : incidentData?.configured
                        ? `${incidentList.length} incident${incidentList.length === 1 ? "" : "s"} in the area`
                        : "Not connected (no API key)"}
                </span>
              </dd>
              <dt>Weather model</dt>
              <dd>
                Open-Meteo
                {weatherData && <span className="dd-note">Retrieved {formatClock(weatherData.updatedAt)}</span>}
              </dd>
              <dt>Observations, alerts</dt>
              <dd>National Weather Service</dd>
              <dt>Storm reports</dt>
              <dd>NWS via Iowa Environmental Mesonet</dd>
              <dt>Place search</dt>
              <dd>Photon (OpenStreetMap)</dd>
              {hasPlowFeed && (
                <>
                  <dt>Plow status</dt>
                  <dd>{plowFeeds.map((feed) => feed.feed.agency).join(", ")}</dd>
                </>
              )}
            </dl>
            <p className="fine-print">
              RoadSalt supports awareness and review. It does not recommend treatment or application rates.
            </p>
          </Section>
        </aside>
      </main>
    </div>
  );
}
