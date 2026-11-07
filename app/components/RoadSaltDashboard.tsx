"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { Feature, FeatureCollection, Geometry, Point } from "geojson";
import MapCanvas, {
  type IncidentProperties,
  type MapFocus,
  type ReportPointProperties,
  type RoadColorMode,
  type RoadFeatureProperties,
} from "./MapCanvas";
import LocationSearch from "./LocationSearch";
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
import { ENVIRONMENTAL_KINDS } from "../lib/data-types";
import type { EnvironmentalAssessment } from "../lib/proximity";
import { assessEnvironmentalSensitivity, roadSensitivityLevels } from "../lib/proximity";
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
import { loadMapDataInBrowser } from "../lib/overpass";
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
    forest: "forest",
    protected: "protected area",
  };
  const subtype =
    feature.subtype && feature.subtype !== feature.kind ? humanize(feature.subtype).toLowerCase() : null;
  return `Mapped ${subtype ?? kindLabels[feature.kind]}`;
}

function formatClock(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
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

function subscribeNarrow(callback: () => void) {
  const query = window.matchMedia("(max-width: 640px)");
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
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

/** Collapsible panel section: open on wide screens, closed on phones. */
function Panel({
  title,
  summary,
  narrow,
  children,
}: {
  title: string;
  summary?: string;
  narrow: boolean;
  children: React.ReactNode;
}) {
  return (
    <details key={narrow ? "narrow" : "wide"} className="panel-section" open={!narrow}>
      <summary>
        <span className="text-[0.6rem] uppercase tracking-[0.25em] text-[#3F72AF]">{title}</span>
        {summary && <span className="panel-summary">{summary}</span>}
      </summary>
      <div className="panel-body">{children}</div>
    </details>
  );
}

function SegmentedToggle<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
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

export default function RoadSaltDashboard() {
  const [location, setLocation] = useState<Location>(DEFAULT_LOCATION);
  const [selectionCount, setSelectionCount] = useState(0);
  const [tileData, setTileData] = useState<MapData | null>(null);
  const [overpass, setOverpass] = useState<Loadable<MapData> | null>(null);
  const [overpassAttempt, setOverpassAttempt] = useState(0);
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
  const narrow = useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia("(max-width: 640px)").matches,
    () => false,
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

  const overpassState = overpass && overpass.key === locationKey ? overpass : null;
  const weatherData = weatherState?.status === "ready" ? weatherState.data : null;
  const observationData = observationsState?.status === "ready" ? observationsState.data : null;
  const plowFeeds = useMemo(
    () => (plowState?.status === "ready" ? plowState.data.feeds : []),
    [plowState],
  );
  const hasPlowFeed = plowFeeds.length > 0;
  const colorMode: RoadColorMode = colorChoice === "plow" && !hasPlowFeed ? "type" : colorChoice;

  // Overpass detail wins when available; otherwise the basemap tile data.
  const mapData: MapData | null = overpassState?.status === "ready" ? overpassState.data : tileData;
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

  // Per-road sensitivity, computed only when roads are coloured by it.
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
    const levels = roadSensitivityLevels(
      mapData.roads.features,
      mapData.environmentalFeatures.features as EnvironmentFeature[],
    );
    return {
      type: "FeatureCollection",
      features: mapData.roads.features.map((road) => ({
        ...road,
        properties: { ...road.properties, sensitivity: levels.get(road.properties.roadId) ?? "Unknown" },
      })),
    };
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

  // Keep the selection in sync with the active data (e.g. tiles → Overpass).
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

  const forecasts = weatherData ? forecastHours(weatherData) : [];
  const selectedCondition = useMemo(() => {
    if (!activeSelectedRoad) return null;
    const onRoad = incidentsOnRoad(activeSelectedRoad, incidentList);
    return { ...roadConditionFor(onRoad, incidentDataLoaded, areaCaution), onRoad };
  }, [activeSelectedRoad, incidentList, incidentDataLoaded, areaCaution]);
  const winterReports = reportsState?.status === "ready" ? reportsState.data.reports.filter((r) => r.winter) : [];

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
    ? "Loading roads…"
    : `${mapData.roads.features.length} roads · ${mapData.environmentalFeatures.features.length} features · ${
        usingOverpass ? "OSM detail" : "OSM map tiles"
      }`;

  const alertCount = observationData?.alerts?.length ?? 0;
  const reportSummary =
    reportsState?.status === "ready"
      ? `${alertCount ? `${alertCount} alert${alertCount > 1 ? "s" : ""} · ` : ""}${reportsState.data.reports.length} report${reportsState.data.reports.length === 1 ? "" : "s"}`
      : undefined;

  return (
    <div className="min-h-screen bg-[#F9F7F7] text-[#112D4E]">
      <header className="border-b border-[#DBE2EF] bg-[#F9F7F7]">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 md:px-8">
          <div className="min-w-0">
            <p className="text-[0.6rem] font-semibold uppercase tracking-[0.3em] text-[#3F72AF]">RoadSalt</p>
            <p className="mt-0.5 truncate text-sm font-medium" title={location.displayName}>
              {location.name}
            </p>
          </div>

          <div className="ml-auto flex items-center gap-3 md:order-last">
            <SegmentedToggle
              label="Temperature units"
              value={units}
              options={[
                { value: "imperial", label: "°F" },
                { value: "metric", label: "°C" },
              ]}
              onChange={storeUnits}
            />
            <span className={indicatorClass(attention)} title="Weather attention (forecast, not road ice)">
              {attention}
            </span>
          </div>

          <div className="w-full md:w-auto md:flex-1 md:max-w-xl">
            <LocationSearch bias={{ latitude, longitude }} onSelect={selectLocation} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-0 py-0 md:px-6 md:py-5">
        <div className="grid gap-4 xl:grid-cols-[2.2fr_1fr]">
          <section className="overflow-hidden border-[#112D4E] bg-[#DBE2EF]/40 md:border">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#112D4E]/20 bg-[#F9F7F7] px-4 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs" htmlFor="road-color-mode">
                  Color roads by
                </label>
                <select
                  id="road-color-mode"
                  className="map-select"
                  value={colorMode}
                  onChange={(event) => setColorChoice(event.target.value as RoadColorMode)}
                >
                  <option value="conditions">Road conditions</option>
                  <option value="type">Road type</option>
                  <option value="sensitivity">Nearby water, wetland &amp; farmland</option>
                  <option value="plow" disabled={!hasPlowFeed}>
                    {hasPlowFeed ? "Agency plow status" : "Agency plow status (none here)"}
                  </option>
                </select>
                {BASEMAP_STYLES.dark && (
                  <SegmentedToggle
                    label="Map style"
                    value={theme}
                    options={[
                      { value: "dark", label: "Dark" },
                      { value: "light", label: "Light" },
                    ]}
                    onChange={setTheme}
                  />
                )}
              </div>
              <div className="flex flex-col items-end">
                <p className="map-data-status" role="status">{mapStatus}</p>
                {!narrow && (!overpassState || overpassState.status === "loading") && mapData && (
                  <p className="map-data-status">Loading detailed OSM data…</p>
                )}
                {overpassState?.status === "error" && (
                  <p className="map-data-status">
                    {narrow ? "OSM detail unavailable" : `Detailed OSM data unavailable (${overpassState.error})`}{" "}
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

            {colorMode === "conditions" && (
              <div
                className="condition-banner"
                style={{ borderLeftColor: CONDITION_COLORS[conditionSummary.tone] }}
                role="status"
              >
                <span
                  className="condition-dot"
                  style={{ background: CONDITION_COLORS[conditionSummary.tone] }}
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p className="condition-headline">{conditionSummary.headline}</p>
                  {conditionSummary.detail && <p className="condition-detail">{conditionSummary.detail}</p>}
                </div>
                {incidentsState?.status === "error" && (
                  <button type="button" className="text-button ml-auto" onClick={retryIncidents}>
                    Retry
                  </button>
                )}
              </div>
            )}

            <div className="map-frame bg-[#2A2A2A]">
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
                onRoadSelect={setSelectedRoad}
                onTileData={handleTileData}
              />
            </div>
          </section>

          <aside className="space-y-4 bg-[#F9F7F7] p-4 md:border md:border-[#112D4E]">
            {/* Road details first: it is what the user just clicked. */}
            <section className="border-b border-[#DBE2EF] pb-4" aria-labelledby="road-heading">
              <SectionLabel>Road details</SectionLabel>
              <h3 id="road-heading" className="mt-1 text-xl font-semibold md:text-2xl">
                {activeSelectedRoad ? roadDisplayName(activeSelectedRoad.properties) : "Tap a road on the map"}
              </h3>

              {activeSelectedRoad ? (
                <div className="mt-3 space-y-4 text-sm">
                  {selectedCondition && (
                    <div
                      className="condition-card"
                      style={{ borderLeftColor: CONDITION_COLORS[selectedCondition.condition] }}
                    >
                      <p className="detail-label">Current condition</p>
                      <p className="mt-1 flex items-center gap-2 text-base font-semibold">
                        <span
                          className="condition-dot"
                          style={{ background: CONDITION_COLORS[selectedCondition.condition] }}
                          aria-hidden="true"
                        />
                        {CONDITION_LABELS[selectedCondition.condition]}
                      </p>
                      <p className="mt-1">{selectedCondition.reason}</p>
                      {selectedCondition.onRoad.length > 1 && (
                        <ul className="mt-1 list-disc pl-5 text-xs">
                          {selectedCondition.onRoad.slice(1, 4).map((incident) => (
                            <li key={incident.id}>{incident.description}</li>
                          ))}
                        </ul>
                      )}
                      <p className="mt-1 text-xs text-[#53677D]">
                        {selectedCondition.onRoad.length > 0 || incidentDataLoaded
                          ? "Reports: TomTom Traffic, NWS. "
                          : ""}
                        Not a measurement of the road surface.
                      </p>
                    </div>
                  )}
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
                      {!narrow &&
                        Object.entries(activeSelectedRoad.properties.tags ?? {})
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
                          Nearest water, wetland or farmland:{" "}
                          {environmentalAssessment.nearestDistanceMeters === null
                            ? "none in the loaded data"
                            : formatDistance(environmentalAssessment.nearestDistanceMeters, units)}
                        </p>
                        {environmentalAssessment.nearbyFeatures.length > 0 ? (
                          <ul className="mt-2 list-disc space-y-1 pl-5">
                            {environmentalAssessment.nearbyFeatures.slice(0, narrow ? 4 : 8).map((item) => (
                              <li key={item.feature.featureId}>
                                {featureDisplayName(item.feature)} · {formatDistance(item.distanceMeters, units)}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-2">
                            {environmentalAssessment.level === "Unknown"
                              ? "No mapped sensitive feature found in the loaded data."
                              : `No mapped sensitive feature within ${formatDistance(250, units)}.`}
                          </p>
                        )}
                        <p className="mt-2 text-xs leading-5 text-[#53677D]">
                          Approximate, along the road&apos;s loaded length. Forests are listed but don&apos;t set the
                          level. Proximity does not prove runoff; missing features don&apos;t mean safe.
                        </p>
                      </>
                    ) : (
                      <p className="mt-1">Unknown</p>
                    )}
                  </div>

                  <div className="border-t border-[#DBE2EF] pt-3">
                    <p className="detail-label">Local weather · not road-specific</p>
                    <p className="mt-1 leading-5">
                      {weatherData
                        ? `${describeWeatherCode(weatherData.current.weatherCode)}, ${formatTemperature(weatherData.current.temperature, units)} air temperature.`
                        : "Weather for this location is not available."}{" "}
                      Air temperature cannot confirm whether this road is icy.
                    </p>
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-sm leading-6">
                  Tap a road to see its OpenStreetMap details, nearby water, wetlands, farmland and forest, and local
                  weather. Search above to explore anywhere in the US.
                </p>
              )}
            </section>

            <Panel
              title="Local reports"
              summary={reportSummary}
              narrow={narrow}
            >
              {observationData?.alerts && observationData.alerts.length > 0 && (
                <div className="mb-3 border border-[#8B3F3F] p-2 text-sm" role="alert">
                  <p className="font-semibold text-[#8B3F3F]">
                    Active NWS alert{observationData.alerts.length > 1 ? "s" : ""}
                  </p>
                  <ul className="mt-1 space-y-1">
                    {observationData.alerts.map((alert) => (
                      <li key={alert.id}>
                        <span className="font-medium">{alert.event}</span>
                        {alert.severity ? ` · ${alert.severity}` : ""} · until {formatDateTime(alert.ends)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {observationData?.alerts?.length === 0 && (
                <p className="text-sm">No active NWS alerts for this location.</p>
              )}

              <p className="detail-label mt-3">Storm reports · last 72 h within 50 mi</p>
              {!reportsState || reportsState.status === "loading" ? (
                <p className="mt-1 text-sm" role="status">Loading reports…</p>
              ) : reportsState.status === "error" ? (
                <ErrorWithRetry message={reportsState.error} onRetry={retryReports} />
              ) : reportsState.data.reports.length === 0 ? (
                <p className="mt-1 text-sm">
                  No reports from NWS {reportsState.data.office} near here in the last 72 hours.
                </p>
              ) : (
                <ul className="mt-1 space-y-2 text-sm">
                  {[...winterReports, ...reportsState.data.reports.filter((r) => !r.winter)]
                    .slice(0, narrow ? 4 : 10)
                    .map((report) => (
                      <li key={report.id} className={report.winter ? "report report-winter" : "report"}>
                        <span className="font-medium">
                          {humanize(report.type.toLowerCase())}
                          {reportMagnitude(report.magnitude, report.unit, units)}
                        </span>
                        <span className="block text-xs text-[#53677D]">
                          {report.location} · {formatDateTime(report.time)}
                          {report.source ? ` · ${report.source}` : ""}
                        </span>
                        {!narrow && report.remark && <span className="block text-xs">{report.remark}</span>}
                      </li>
                    ))}
                </ul>
              )}

              <p className="detail-label mt-3">Agency plow status</p>
              {!plowState || plowState.status === "loading" ? (
                <p className="mt-1 text-sm">Checking for a local plow-status feed…</p>
              ) : plowState.status === "error" ? (
                <ErrorWithRetry message={plowState.error} onRetry={retryPlow} />
              ) : plowFeeds.length === 0 ? (
                <p className="mt-1 text-sm">
                  No public plow-status feed is connected for this area. Plow status is published by some local
                  agencies; check your county or state DOT.
                </p>
              ) : (
                plowFeeds.map((feed) => (
                  <div key={feed.feed.id} className="mt-1 text-sm">
                    <p className="font-medium">{feed.feed.agency}</p>
                    <p className="text-xs text-[#53677D]">
                      {feed.routes.features.length} route segments ·{" "}
                      {(Object.keys(feed.counts) as (keyof typeof feed.counts)[])
                        .filter((category) => feed.counts[category] > 0)
                        .map((category) => `${feed.counts[category]} ${PLOW_STATUS_LABELS[category].toLowerCase()}`)
                        .join(", ")}
                    </p>
                    <p className={feed.allStale ? "mt-1 text-xs text-[#8B3F3F]" : "mt-1 text-xs"}>
                      {feed.newestUpdate
                        ? `Last updated ${formatDate(feed.newestUpdate)}${feed.allStale ? " — outdated; not current road conditions" : ""}.`
                        : "No update time provided."}{" "}
                      <a className="underline" href={feed.feed.publicMapUrl} target="_blank" rel="noreferrer">
                        Agency map
                      </a>
                    </p>
                    {colorMode !== "plow" && (
                      <button type="button" className="text-button mt-1" onClick={() => setColorChoice("plow")}>
                        Show on map
                      </button>
                    )}
                  </div>
                ))
              )}
              {plowState?.status === "ready" &&
                plowState.data.errors.map((error) => (
                  <p key={error.feedId} className="mt-1 text-xs text-[#8B3F3F]">
                    {error.message}
                  </p>
                ))}
            </Panel>

            <Panel
              title="Current conditions"
              summary={
                weatherData
                  ? `${formatTemperature(weatherData.current.temperature, units)} · ${describeWeatherCode(weatherData.current.weatherCode)}`
                  : undefined
              }
              narrow={narrow}
            >
              {!weatherState || weatherState.status === "loading" ? (
                <p className="text-sm" role="status">Loading weather…</p>
              ) : weatherState.status === "error" ? (
                <ErrorWithRetry message={weatherState.error} onRetry={retryWeather} />
              ) : (
                <div className="text-sm">
                  <p className="font-medium">
                    {describeWeatherCode(weatherState.data.current.weatherCode)} ·{" "}
                    {formatTemperature(weatherState.data.current.temperature, units, 1)}
                    <span className="ml-1 text-xs font-normal text-[#53677D]">Open-Meteo model</span>
                  </p>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <dt className="detail-label">Feels like</dt>
                    <dd>{formatTemperature(weatherState.data.current.apparentTemperature, units)}</dd>
                    <dt className="detail-label">Humidity</dt>
                    <dd>
                      {weatherState.data.current.relativeHumidity === null
                        ? "Not reported"
                        : `${weatherState.data.current.relativeHumidity.toFixed(0)} %`}
                    </dd>
                    <dt className="detail-label">Wind</dt>
                    <dd>{formatSpeed(weatherState.data.current.windSpeed, units)}</dd>
                    <dt className="detail-label">Precipitation</dt>
                    <dd>
                      {formatPrecipitation(weatherState.data.current.precipitation, units)} ·{" "}
                      {describePrecipitation(weatherState.data)}
                    </dd>
                  </dl>

                  {observationsState?.status === "ready" && observationsState.data.observation && (
                    <div className="mt-3 border-t border-[#DBE2EF] pt-2">
                      <p className="font-medium">
                        {observationsState.data.observation.description ?? "Observed"} ·{" "}
                        {formatTemperature(observationsState.data.observation.temperatureC, units, 1)}
                        <span className="ml-1 text-xs font-normal text-[#53677D]">measured</span>
                      </p>
                      <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                        <dt className="detail-label">Dew point</dt>
                        <dd>{formatTemperature(observationsState.data.observation.dewpointC, units)}</dd>
                        <dt className="detail-label">Wind</dt>
                        <dd>{formatSpeed(observationsState.data.observation.windSpeedKmh, units)}</dd>
                        <dt className="detail-label">Visibility</dt>
                        <dd>{formatVisibility(observationsState.data.observation.visibilityM, units)}</dd>
                        <dt className="detail-label">Precip. last hour</dt>
                        <dd>{formatPrecipitation(observationsState.data.observation.precipitationLastHourMm, units)}</dd>
                      </dl>
                      <p className="mt-1 text-xs leading-5 text-[#53677D]">
                        NWS station {observationsState.data.stationId}
                        {observationsState.data.stationName ? ` (${observationsState.data.stationName})` : ""},{" "}
                        {formatDateTime(observationsState.data.observation.timestamp)}
                        {observationsState.data.observationStale ? " — older than 2 hours" : ""}
                        . Station air readings, not road surface.
                      </p>
                    </div>
                  )}
                  {observationsState?.status === "error" && (
                    <p className="mt-2 text-xs text-[#53677D]">
                      Measured observations: {observationsState.error}{" "}
                      <button type="button" className="text-button" onClick={retryObservations}>
                        Retry
                      </button>
                    </p>
                  )}
                </div>
              )}
            </Panel>

            <Panel
              title={`Forecast · next 24 h${weatherData ? ` · ${weatherData.timezone.replace(/_/g, " ")}` : ""}`}
              narrow={narrow}
            >
              {!weatherState || weatherState.status === "loading" ? (
                <p className="text-sm">Loading forecast…</p>
              ) : weatherState.status === "error" ? (
                <p className="text-sm text-[#8B3F3F]">Forecast unavailable.</p>
              ) : forecasts.length === 0 ? (
                <p className="text-sm">No forecast hours were returned.</p>
              ) : (
                <>
                  <div className="forecast-strip">
                    {forecasts.map((hour) => (
                      <div key={hour.time} className="forecast-hour">
                        <span className="forecast-time">{formatLocalHour(hour.time)}</span>
                        <span className="forecast-temperature">{shortTemperature(hour.temperature, units)}</span>
                        <span>{hour.precipitationProbability}%</span>
                        <span className="forecast-caption">
                          {hour.snowfall >= 0.1
                            ? formatSnowfall(hour.snowfall, units)
                            : formatPrecipitation(hour.precipitation, units)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-xs leading-5 text-[#53677D]">
                    Every third hour. Air temperature, not pavement temperature; it cannot confirm ice. Fetched{" "}
                    {formatClock(weatherState.data.updatedAt)}.
                  </p>
                </>
              )}
            </Panel>

            <p className="text-xs leading-5 text-[#53677D]">
              Sources: © OpenStreetMap contributors · Open-Meteo · National Weather Service · Iowa Environmental
              Mesonet{hasPlowFeed ? " · local agency plow feeds" : ""}. For awareness, not treatment instructions.
            </p>
          </aside>
        </div>
      </main>
    </div>
  );
}
