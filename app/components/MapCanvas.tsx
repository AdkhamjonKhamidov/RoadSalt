"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Feature, FeatureCollection, Geometry, Point } from "geojson";
import type {
  ExpressionSpecification,
  ErrorEvent,
  GeoJSONSource,
  Map as MapLibreMap,
  MapMouseEvent,
  Marker,
  Popup,
} from "maplibre-gl";
import type {
  EnvironmentalKind,
  EnvironmentalProperties,
  MapData,
  RoadProperties,
} from "../lib/data-types";
import { ENVIRONMENTAL_KIND_LABELS, ENVIRONMENTAL_KINDS } from "../lib/data-types";
import type { PlowRouteProperties } from "../lib/plow-feeds";
import { PLOW_STATUS_LABELS } from "../lib/plow-feeds";
import { extractTileMapData } from "../lib/tile-features";
import { CONDITION_COLORS, CONDITION_LABELS, type RoadCondition } from "../lib/road-conditions";
import {
  BASEMAP_PROVIDER,
  BASEMAP_STYLE_URL,
  BASEMAP_STYLES,
  DEMO_CENTER,
  DEMO_LOCATION,
  INITIAL_ZOOM,
  type MapTheme,
} from "../lib/demo-config";

export type RoadFeatureProperties = RoadProperties & {
  /** Mapped environmental sensitivity, set by the dashboard for colouring. */
  sensitivity?: "High" | "Moderate" | "Low" | "Unknown";
  /** Road condition colour (set by the dashboard in "conditions" mode). */
  condition?: RoadCondition;
};
export type EnvironmentalFeatureProperties = EnvironmentalProperties;
export type RoadColorMode = "conditions" | "sensitivity" | "plow";

export type IncidentProperties = {
  id: string;
  condition: "closed" | "caution";
  title: string;
  detail: string;
};

export type ReportPointProperties = {
  id: string;
  title: string;
  detail: string;
  winter: boolean;
};

/** Where the map should be centered; a new `key` triggers a fly-to. */
export type MapFocus = {
  key: string;
  latitude: number;
  longitude: number;
  zoom: number;
  label: string;
};

export type MapCanvasProps = {
  focus?: MapFocus;
  theme?: MapTheme;
  roadColorMode?: RoadColorMode;
  roads?: FeatureCollection<Geometry, RoadFeatureProperties>;
  environmentalFeatures?: FeatureCollection<Geometry, EnvironmentalFeatureProperties>;
  plowRoutes?: FeatureCollection<Geometry, PlowRouteProperties>;
  reportPoints?: FeatureCollection<Point, ReportPointProperties>;
  incidents?: FeatureCollection<Geometry, IncidentProperties>;
  selectedRoadId?: string | null;
  visibleEnvironmentalKinds?: EnvironmentalKind[];
  onEnvironmentalVisibilityChange?: (kind: EnvironmentalKind) => void;
  /** Show the RoadSalt road network overlay (default true). */
  roadsVisible?: boolean;
  onRoadsVisibleChange?: (visible: boolean) => void;
  /** Rendered at the top of the map control panel (view and basemap choice). */
  controls?: React.ReactNode;
  onRoadSelect?: (road: Feature<Geometry, RoadFeatureProperties>) => void;
  /** Receives roads/features read from the loaded basemap tiles after each view change. */
  onTileData?: (data: MapData) => void;
};

// Below this zoom, tiles are generalized and drop minor roads and features.
const MIN_EXTRACTION_ZOOM = 12;
// Click tolerance in pixels around the pointer when selecting a road.
const ROAD_HIT_TOLERANCE_PX = 6;

// The interface keeps the navy / blue / off-white palette. Roads get three
// contrasting accents so they read clearly on either basemap.
export const ROAD_COLORS = {
  red: "#B3261E",
  amber: "#D4890F",
  teal: "#2E7D8C",
  gray: "#9AA4B1",
  selected: "#112D4E",
} as const;
const THEME = {
  light: { minor: "#112D4E", casing: "#FFFFFF", envOpacity: 1 },
  dark: { minor: "#F9F7F7", casing: "#141414", envOpacity: 0.55 },
} as const;

const MAJOR = ["motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link"];
const MID = ["secondary", "secondary_link", "tertiary", "tertiary_link"];

const EMPTY_COLLECTION = { type: "FeatureCollection", features: [] } as FeatureCollection;

const ENVIRONMENT_STYLES: Record<
  EnvironmentalKind,
  { fill: string; line: string; fillOpacity: number }
> = {
  waterway: { fill: "#91BED1", line: "#6E9FB7", fillOpacity: 0.25 },
  water: { fill: "#B7D6E4", line: "#6E9FB7", fillOpacity: 0.5 },
  wetland: { fill: "#D2E5EE", line: "#8CB5C6", fillOpacity: 0.62 },
  farmland: { fill: "#E3D9B8", line: "#B5A36A", fillOpacity: 0.5 },
  forest: { fill: "#9DBB97", line: "#6E8F69", fillOpacity: 0.22 },
  protected: { fill: "#CEDDCB", line: "#789177", fillOpacity: 0.22 },
};

function roadClass(): ExpressionSpecification {
  return ["get", "classification"];
}

/** Road width by zoom and class; `extra` widens it for the casing. */
function roadWidth(extra: number): ExpressionSpecification {
  const byClass = (major: number, mid: number, minor: number): ExpressionSpecification => [
    "match",
    roadClass(),
    MAJOR,
    major + extra,
    MID,
    mid + extra,
    minor + extra,
  ];
  return ["interpolate", ["linear"], ["zoom"], 10, byClass(1.6, 1.1, 0.7), 14, byClass(4, 3, 2), 17, byClass(9, 7, 5)];
}

function roadColor(mode: RoadColorMode, theme: MapTheme): ExpressionSpecification | string {
  const minor = THEME[theme].minor;
  if (mode === "conditions") {
    return [
      "match",
      ["coalesce", ["get", "condition"], "unknown"],
      "clear",
      CONDITION_COLORS.clear,
      "caution",
      CONDITION_COLORS.caution,
      "closed",
      CONDITION_COLORS.closed,
      CONDITION_COLORS.unknown,
    ];
  }
  if (mode === "sensitivity") {
    return [
      "match",
      ["coalesce", ["get", "sensitivity"], "Unknown"],
      "High",
      ROAD_COLORS.red,
      "Moderate",
      ROAD_COLORS.amber,
      "Low",
      ROAD_COLORS.teal,
      ROAD_COLORS.gray,
    ];
  }
  return minor; // plow view: roads recede behind the agency routes
}

function plowColor(): ExpressionSpecification {
  return [
    "case",
    ["get", "stale"],
    ROAD_COLORS.gray,
    [
      "match",
      ["get", "category"],
      "untreated",
      ROAD_COLORS.red,
      ["treated", "repeat-pass"],
      ROAD_COLORS.teal,
      ROAD_COLORS.gray,
    ],
  ];
}

function setData(map: MapLibreMap, id: string, data: FeatureCollection | undefined) {
  (map.getSource(id) as GeoJSONSource | undefined)?.setData(data ?? EMPTY_COLLECTION);
}

/**
 * `styleReady` is passed as true from the `load` / `style.load` handlers:
 * there the style can take layers, but `isStyleLoaded()` may still be false
 * while tiles and sprites load. Bailing out then left a freshly switched
 * basemap without any overlays until some other prop changed.
 */
function updateOverlays(map: MapLibreMap, props: MapCanvasProps, styleReady = map.isStyleLoaded()) {
  if (!styleReady) return;
  const theme = props.theme ?? "light";
  const mode = props.roadColorMode ?? "conditions";
  const palette = THEME[theme];
  // Insert overlays above all basemap geometry (roads, buildings) but below the
  // labels that follow it. The first symbol layer is not enough: MapTiler
  // styles put water labels before buildings and roads, which hid our roads.
  const basemapLayers = (map.getStyle().layers ?? []).filter((layer) => !layer.id.startsWith("roadsalt-"));
  const lastGeometryIndex = basemapLayers
    .map((layer) => layer.type !== "symbol" && !layer.id.includes("boundary"))
    .lastIndexOf(true);
  const firstLabelLayer = basemapLayers.find((layer, index) => index > lastGeometryIndex && layer.type === "symbol")?.id;
  const addBelowLabels = (layer: Parameters<MapLibreMap["addLayer"]>[0]) =>
    map.addLayer(layer, firstLabelLayer);

  for (const id of ["roadsalt-roads", "roadsalt-environment", "roadsalt-plow", "roadsalt-reports", "roadsalt-incidents"]) {
    if (!map.getSource(id)) map.addSource(id, { type: "geojson", data: EMPTY_COLLECTION });
  }

  for (const kind of ENVIRONMENTAL_KINDS) {
    const style = ENVIRONMENT_STYLES[kind];
    const base = `roadsalt-${kind}`;
    if (!map.getLayer(`${base}-fill`)) {
      addBelowLabels({
        id: `${base}-fill`,
        type: "fill",
        source: "roadsalt-environment",
        filter: [
          "all",
          ["==", ["get", "kind"], kind],
          ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon"]]],
        ],
        paint: { "fill-color": style.fill, "fill-outline-color": style.line },
      });
    }
    if (!map.getLayer(`${base}-lines`)) {
      addBelowLabels({
        id: `${base}-lines`,
        type: "line",
        source: "roadsalt-environment",
        filter: [
          "all",
          ["==", ["get", "kind"], kind],
          ["in", ["geometry-type"], ["literal", ["LineString", "MultiLineString"]]],
        ],
        paint: { "line-color": style.line, "line-width": kind === "waterway" ? 2 : 1.2 },
      });
    }
    map.setPaintProperty(`${base}-fill`, "fill-opacity", style.fillOpacity * palette.envOpacity);
  }

  const lineLayout = { "line-cap": "round", "line-join": "round" } as const;
  if (!map.getLayer("roadsalt-road-casing")) {
    addBelowLabels({ id: "roadsalt-road-casing", type: "line", source: "roadsalt-roads", layout: lineLayout, paint: { "line-width": roadWidth(2.5) } });
  }
  if (!map.getLayer("roadsalt-road-network")) {
    addBelowLabels({ id: "roadsalt-road-network", type: "line", source: "roadsalt-roads", layout: lineLayout, paint: { "line-width": roadWidth(0) } });
  }
  if (!map.getLayer("roadsalt-plow-casing")) {
    addBelowLabels({ id: "roadsalt-plow-casing", type: "line", source: "roadsalt-plow", layout: lineLayout, paint: { "line-width": roadWidth(4) } });
  }
  if (!map.getLayer("roadsalt-plow-routes")) {
    addBelowLabels({ id: "roadsalt-plow-routes", type: "line", source: "roadsalt-plow", layout: lineLayout, paint: { "line-width": roadWidth(1.5), "line-color": plowColor() } });
  }
  if (!map.getLayer("roadsalt-selected-casing")) {
    addBelowLabels({ id: "roadsalt-selected-casing", type: "line", source: "roadsalt-roads", layout: lineLayout, filter: ["==", ["get", "roadId"], ""], paint: { "line-color": "#FFFFFF", "line-width": roadWidth(7) } });
  }
  if (!map.getLayer("roadsalt-selected-road")) {
    addBelowLabels({ id: "roadsalt-selected-road", type: "line", source: "roadsalt-roads", layout: lineLayout, filter: ["==", ["get", "roadId"], ""], paint: { "line-color": ROAD_COLORS.selected, "line-width": roadWidth(3) } });
  }
  // Closures and hazards drawn on top of the road they affect.
  const incidentWidth = (extra: number): ExpressionSpecification => [
    "interpolate",
    ["linear"],
    ["zoom"],
    10,
    ["match", ["get", "condition"], "closed", 3 + extra, 2.5 + extra],
    14,
    ["match", ["get", "condition"], "closed", 6 + extra, 5 + extra],
    17,
    ["match", ["get", "condition"], "closed", 11 + extra, 9 + extra],
  ];
  const incidentColor: ExpressionSpecification = [
    "match",
    ["get", "condition"],
    "closed",
    CONDITION_COLORS.closed,
    CONDITION_COLORS.caution,
  ];
  if (!map.getLayer("roadsalt-incident-casing")) {
    addBelowLabels({ id: "roadsalt-incident-casing", type: "line", source: "roadsalt-incidents", layout: lineLayout, filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": "#FFFFFF", "line-width": incidentWidth(3) } });
  }
  if (!map.getLayer("roadsalt-incident-lines")) {
    addBelowLabels({ id: "roadsalt-incident-lines", type: "line", source: "roadsalt-incidents", layout: lineLayout, filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": incidentColor, "line-width": incidentWidth(0) } });
  }
  if (!map.getLayer("roadsalt-incident-points")) {
    map.addLayer({
      id: "roadsalt-incident-points",
      type: "circle",
      source: "roadsalt-incidents",
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 6, 14, 9],
        "circle-color": incidentColor,
        "circle-stroke-color": "#FFFFFF",
        "circle-stroke-width": 2,
      },
    });
  }
  if (!map.getLayer("roadsalt-reports")) {
    // Above labels so report points stay visible and clickable.
    map.addLayer({
      id: "roadsalt-reports",
      type: "circle",
      source: "roadsalt-reports",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 5, 14, 8],
        "circle-color": ["case", ["get", "winter"], ROAD_COLORS.selected, ROAD_COLORS.gray],
        "circle-stroke-color": "#FFFFFF",
        "circle-stroke-width": 2,
      },
    });
  }

  // Theme- and mode-dependent paint.
  map.setPaintProperty("roadsalt-road-casing", "line-color", palette.casing);
  map.setPaintProperty("roadsalt-road-casing", "line-width", roadWidth(mode === "conditions" ? 1.6 : 2.5));
  const roadVisibility = props.roadsVisible === false ? "none" : "visible";
  for (const id of ["roadsalt-road-casing", "roadsalt-road-network"]) {
    map.setLayoutProperty(id, "visibility", roadVisibility);
  }
  map.setPaintProperty("roadsalt-road-network", "line-color", roadColor(mode, theme));
  map.setPaintProperty("roadsalt-road-network", "line-opacity", mode === "plow" ? 0.35 : 0.95);
  map.setPaintProperty("roadsalt-road-casing", "line-opacity", mode === "plow" ? 0.3 : 0.9);
  map.setPaintProperty("roadsalt-plow-casing", "line-color", palette.casing);
  const plowVisibility = mode === "plow" ? "visible" : "none";
  map.setLayoutProperty("roadsalt-plow-casing", "visibility", plowVisibility);
  map.setLayoutProperty("roadsalt-plow-routes", "visibility", plowVisibility);

  setData(map, "roadsalt-roads", props.roads);
  setData(map, "roadsalt-environment", props.environmentalFeatures);
  setData(map, "roadsalt-plow", props.plowRoutes);
  setData(map, "roadsalt-reports", props.reportPoints);
  setData(map, "roadsalt-incidents", props.incidents);
  const incidentVisibility = mode === "conditions" ? "visible" : "none";
  for (const id of ["roadsalt-incident-casing", "roadsalt-incident-lines", "roadsalt-incident-points"]) {
    map.setLayoutProperty(id, "visibility", incidentVisibility);
  }

  const selectedFilter: ExpressionSpecification = ["==", ["get", "roadId"], props.selectedRoadId ?? ""];
  map.setFilter("roadsalt-selected-casing", selectedFilter);
  map.setFilter("roadsalt-selected-road", selectedFilter);
  // Proximity view: show the selected road as a navy halo *under* its coloured
  // 100 m segments, so the per-segment exposure stays readable.
  const halo = mode === "sensitivity";
  if (halo) map.moveLayer("roadsalt-selected-casing", "roadsalt-road-casing");
  else map.moveLayer("roadsalt-selected-casing", "roadsalt-selected-road");
  map.setPaintProperty("roadsalt-selected-casing", "line-color", halo ? ROAD_COLORS.selected : "#FFFFFF");
  map.setPaintProperty("roadsalt-selected-casing", "line-width", roadWidth(halo ? 9 : 7));
  map.setLayoutProperty("roadsalt-selected-road", "visibility", halo ? "none" : "visible");

  const visibleKinds = props.visibleEnvironmentalKinds ?? [];
  for (const kind of ENVIRONMENTAL_KINDS) {
    for (const suffix of ["fill", "lines"]) {
      map.setLayoutProperty(`roadsalt-${kind}-${suffix}`, "visibility", visibleKinds.includes(kind) ? "visible" : "none");
    }
  }
}

/** Popup body built with text nodes only (feed and report text is untrusted). */
function popupContent(title: string, lines: string[]): HTMLElement {
  const container = document.createElement("div");
  const heading = document.createElement("strong");
  heading.textContent = title;
  container.appendChild(heading);
  for (const line of lines) {
    const paragraph = document.createElement("p");
    paragraph.textContent = line;
    paragraph.style.margin = "0.25rem 0 0";
    container.appendChild(paragraph);
  }
  return container;
}

function subscribeToNarrowScreen(callback: () => void) {
  const query = window.matchMedia("(max-width: 640px)");
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

function LegendRow({ color, label, swatch = "line" }: { color: string; label: string; swatch?: "line" | "dot" | "fill" }) {
  return (
    <div className="map-legend-row">
      <span className={`map-legend-swatch map-legend-swatch-${swatch}`} style={{ background: color }} />
      <span>{label}</span>
    </div>
  );
}

export default function MapCanvas(props: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const styleLoadedRef = useRef(false);
  const markerRef = useRef<Marker | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const infoPopupRef = useRef<Popup | null>(null);
  const propsRef = useRef(props);
  const appliedThemeRef = useRef<MapTheme | null>(null);
  const [loading, setLoading] = useState(true);
  const [mapError, setMapError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let locationMarker: Marker | null = null;
    let removeMapListeners: (() => void) | null = null;

    async function initializeMap() {
      try {
        const maplibre = await import("maplibre-gl");
        if (cancelled || !containerRef.current || mapRef.current) return;

        maplibre.setWorkerUrl("/assets/maplibre-gl-worker.mjs");
        const theme = propsRef.current.theme ?? "light";
        appliedThemeRef.current = theme;
        map = new maplibre.Map({
          container: containerRef.current,
          style: BASEMAP_STYLES[theme] ?? BASEMAP_STYLE_URL,
          center: propsRef.current.focus
            ? [propsRef.current.focus.longitude, propsRef.current.focus.latitude]
            : DEMO_CENTER,
          zoom: propsRef.current.focus?.zoom ?? INITIAL_ZOOM,
          minZoom: 3,
          maxZoom: 19,
          attributionControl: { compact: true },
          cooperativeGestures: false,
        });
        mapRef.current = map;
        map.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
        infoPopupRef.current = new maplibre.Popup({ closeButton: true, maxWidth: "280px" });

        const onLoad = () => {
          if (cancelled || !map) return;
          styleLoadedRef.current = true;
          setLoading(false);
          setMapError(null);
          updateOverlays(map, propsRef.current, true);

          const markerElement = document.createElement("div");
          markerElement.className = "roadsalt-location-marker";
          markerElement.setAttribute("role", "img");
          markerElement.setAttribute("aria-label", "Selected location marker");

          const popup = new maplibre.Popup({ offset: 17, closeButton: true })
            .setText(propsRef.current.focus?.label ?? DEMO_LOCATION);
          popupRef.current = popup;
          locationMarker = new maplibre.Marker({ element: markerElement, anchor: "center" })
            .setLngLat(
              propsRef.current.focus
                ? [propsRef.current.focus.longitude, propsRef.current.focus.latitude]
                : DEMO_CENTER,
            )
            .setPopup(popup)
            .addTo(map);
          markerRef.current = locationMarker;
        };

        // After a theme switch the new style has none of our layers.
        const onStyleLoad = () => {
          if (cancelled || !map) return;
          styleLoadedRef.current = true;
          updateOverlays(map, propsRef.current, true);
        };

        const onError = (event: ErrorEvent) => {
          if (cancelled || !event.error) return;
          setLoading(false);
          setMapError(
            BASEMAP_PROVIDER === "MapTiler"
              ? "The MapTiler basemap could not be loaded. Check your connection and NEXT_PUBLIC_MAPTILER_API_KEY, or leave the key blank to use the CARTO basemap."
              : "The basemap could not be loaded. Check your connection and try again.",
          );
        };

        const box = (event: MapMouseEvent): [[number, number], [number, number]] => {
          const { x, y } = event.point;
          return [
            [x - ROAD_HIT_TOLERANCE_PX, y - ROAD_HIT_TOLERANCE_PX],
            [x + ROAD_HIT_TOLERANCE_PX, y + ROAD_HIT_TOLERANCE_PX],
          ];
        };
        const showInfo = (event: MapMouseEvent, title: string, lines: string[]) => {
          if (!map) return;
          infoPopupRef.current?.setLngLat(event.lngLat).setDOMContent(popupContent(title, lines)).addTo(map);
        };

        const onClick = (event: MapMouseEvent) => {
          if (!map) return;
          const incidentLayers = ["roadsalt-incident-lines", "roadsalt-incident-points"].filter((id) => map?.getLayer(id));
          const incident = propsRef.current.roadColorMode === "conditions" && incidentLayers.length
            ? map.queryRenderedFeatures(box(event), { layers: incidentLayers })[0]
            : undefined;
          if (incident) {
            showInfo(event, String(incident.properties?.title ?? "Reported incident"), [String(incident.properties?.detail ?? "")]);
            return;
          }
          const report = map.getLayer("roadsalt-reports")
            ? map.queryRenderedFeatures(box(event), { layers: ["roadsalt-reports"] })[0]
            : undefined;
          if (report) {
            showInfo(event, String(report.properties?.title ?? "Storm report"), [String(report.properties?.detail ?? "")]);
            return;
          }
          if (propsRef.current.roadColorMode === "plow" && map.getLayer("roadsalt-plow-routes")) {
            const route = map.queryRenderedFeatures(box(event), { layers: ["roadsalt-plow-routes"] })[0];
            const routeProps = route?.properties as Partial<PlowRouteProperties> | undefined;
            if (routeProps) {
              const category = (routeProps.category ?? "unknown") as PlowRouteProperties["category"];
              showInfo(event, String(routeProps.name ?? "Route segment"), [
                `Status: ${routeProps.status ?? "Not reported"} (${PLOW_STATUS_LABELS[category]})`,
                routeProps.updatedAt
                  ? `Updated ${new Date(String(routeProps.updatedAt)).toLocaleString()}${String(routeProps.stale) === "true" ? " — outdated" : ""}`
                  : "Update time not provided",
                [routeProps.route, routeProps.area].filter((part) => part && part !== "null").join(" · "),
              ].filter(Boolean));
            }
          }

          if (!propsRef.current.onRoadSelect || !map.getLayer("roadsalt-road-network")) return;
          const feature = map.queryRenderedFeatures(box(event), { layers: ["roadsalt-road-network"] })[0];
          // Rendered features are clipped to tiles; select the full merged road.
          const fullRoad = propsRef.current.roads?.features.find(
            (road) => road.properties.roadId === String(feature?.properties?.roadId),
          );
          if (fullRoad) propsRef.current.onRoadSelect?.(fullRoad);
        };

        const setPointer = (cursor: string) => () => {
          if (map) map.getCanvas().style.cursor = cursor;
        };
        const pointer = setPointer("pointer");
        const arrow = setPointer("");

        // Read roads/features from loaded tiles once the map settles after a
        // view change. Updating our overlays also ends in "idle", so the view
        // key prevents re-extracting (and an update loop) when nothing moved.
        let lastExtractedView = "";
        const onIdle = () => {
          if (!map || !styleLoadedRef.current) return;
          const zoom = map.getZoom();
          if (zoom < MIN_EXTRACTION_ZOOM) return;
          const center = map.getCenter();
          const viewKey = `${center.lng.toFixed(5)},${center.lat.toFixed(5)},${zoom.toFixed(2)}`;
          if (viewKey === lastExtractedView) return;
          const data = extractTileMapData(map, BASEMAP_PROVIDER);
          if (!data) return;
          lastExtractedView = viewKey;
          propsRef.current.onTileData?.(data);
        };

        map.on("load", onLoad);
        map.on("style.load", onStyleLoad);
        map.on("error", onError);
        map.on("click", onClick);
        map.on("idle", onIdle);
        map.on("mouseenter", "roadsalt-road-network", pointer);
        map.on("mouseleave", "roadsalt-road-network", arrow);
        map.on("mouseenter", "roadsalt-reports", pointer);
        map.on("mouseenter", "roadsalt-incident-lines", pointer);
        map.on("mouseleave", "roadsalt-incident-lines", arrow);
        map.on("mouseleave", "roadsalt-reports", arrow);
        const initializedMap = map;
        removeMapListeners = () => {
          initializedMap.off("load", onLoad);
          initializedMap.off("style.load", onStyleLoad);
          initializedMap.off("error", onError);
          initializedMap.off("click", onClick);
          initializedMap.off("idle", onIdle);
          initializedMap.off("mouseenter", "roadsalt-road-network", pointer);
          initializedMap.off("mouseleave", "roadsalt-road-network", arrow);
          initializedMap.off("mouseenter", "roadsalt-reports", pointer);
          initializedMap.off("mouseleave", "roadsalt-reports", arrow);
          initializedMap.off("mouseenter", "roadsalt-incident-lines", pointer);
          initializedMap.off("mouseleave", "roadsalt-incident-lines", arrow);
        };

        resizeObserver = new ResizeObserver(() => map?.resize());
        resizeObserver.observe(containerRef.current);
      } catch (error) {
        console.error("RoadSalt map initialization failed:", error);
        if (!cancelled) {
          setLoading(false);
          setMapError("The interactive map could not be initialized. Refresh the page to try again.");
        }
      }
    }

    void initializeMap();

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      removeMapListeners?.();
      locationMarker?.remove();
      infoPopupRef.current?.remove();
      markerRef.current = null;
      popupRef.current = null;
      map?.remove();
      mapRef.current = null;
      styleLoadedRef.current = false;
    };
  }, []);

  useEffect(() => {
    propsRef.current = props;
    const map = mapRef.current;
    if (!map) return;
    const theme = props.theme ?? "light";
    if (appliedThemeRef.current && appliedThemeRef.current !== theme) {
      const url = BASEMAP_STYLES[theme];
      if (url) {
        appliedThemeRef.current = theme;
        styleLoadedRef.current = false;
        map.setStyle(url, { diff: false });
        return; // onStyleLoad re-adds the overlays.
      }
    }
    if (styleLoadedRef.current) updateOverlays(map, props);
  }, [props]);

  // Fly to a newly selected location and move the marker with it.
  const focusKey = props.focus?.key;
  useEffect(() => {
    const focus = propsRef.current.focus;
    const map = mapRef.current;
    if (!focus || !map) return;
    map.flyTo({ center: [focus.longitude, focus.latitude], zoom: focus.zoom, duration: 900 });
    markerRef.current?.setLngLat([focus.longitude, focus.latitude]);
    popupRef.current?.setText(focus.label);
    infoPopupRef.current?.remove();
  }, [focusKey]);

  const [layerControlsOpen, setLayerControlsOpen] = useState(false);
  // Map key: open on wide screens, closed on phones until the user opens it.
  const narrowScreen = useSyncExternalStore(
    subscribeToNarrowScreen,
    () => window.matchMedia("(max-width: 640px)").matches,
    () => false,
  );
  const [legendChoice, setLegendChoice] = useState<boolean | null>(null);
  const legendOpen = legendChoice ?? !narrowScreen;

  const resetLocation = useCallback(
    () =>
      mapRef.current?.flyTo({
        center: propsRef.current.focus
          ? [propsRef.current.focus.longitude, propsRef.current.focus.latitude]
          : DEMO_CENTER,
        zoom: propsRef.current.focus?.zoom ?? INITIAL_ZOOM,
        duration: 500,
      }),
    [],
  );

  const theme = props.theme ?? "light";
  const mode = props.roadColorMode ?? "conditions";
  return (
    <div className={`map-canvas map-theme-${theme} relative h-full w-full`}>
      <div
        ref={containerRef}
        className="absolute inset-0"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        aria-label={`Interactive road map around ${props.focus?.label ?? DEMO_LOCATION}`}
      />

      <button type="button" className="map-recenter absolute right-[10px] top-[78px] z-10" onClick={resetLocation} title="Return to the selected location">
        Recenter
      </button>

      {/* One control panel: view and basemap (from the dashboard), legend, layers. */}
      <div className="map-control-panel absolute left-3 top-3 z-10">
        {props.controls}

        <div className="map-legend mc-section">
          <button
            type="button"
            className="map-legend-toggle mc-heading"
            aria-expanded={legendOpen}
            onClick={() => setLegendChoice(!legendOpen)}
          >
            Legend
          </button>
          {legendOpen && (
            <div className="mc-body">
              {mode === "conditions" && (
                <>
                  <LegendRow color={CONDITION_COLORS.closed} label={CONDITION_LABELS.closed} />
                  <LegendRow color={CONDITION_COLORS.caution} label={CONDITION_LABELS.caution} />
                  <LegendRow color={CONDITION_COLORS.clear} label={CONDITION_LABELS.clear} />
                  <LegendRow color={CONDITION_COLORS.unknown} label={CONDITION_LABELS.unknown} />
                </>
              )}
              {mode === "sensitivity" && (
                <>
                  <p className="mc-subheading">Each 100 m of road, distance to water, wetland or farmland</p>
                  <LegendRow color={ROAD_COLORS.red} label="Within 50 m" />
                  <LegendRow color={ROAD_COLORS.amber} label="Within 250 m" />
                  <LegendRow color={ROAD_COLORS.teal} label="Beyond 250 m" />
                  <LegendRow color={ROAD_COLORS.gray} label="No feature data" />
                </>
              )}
              {mode === "plow" && (
                <>
                  <LegendRow color={ROAD_COLORS.red} label="Not yet plowed/treated" />
                  <LegendRow color={ROAD_COLORS.teal} label="Plowed or treated" />
                  <LegendRow color={ROAD_COLORS.gray} label="Outdated or unknown status" />
                </>
              )}
              <LegendRow color={ROAD_COLORS.selected} label="Selected road" />
              <p className="mc-subheading">Mapped features (OSM)</p>
              <LegendRow color={ENVIRONMENT_STYLES.waterway.line} label="Waterway" />
              <LegendRow color={ENVIRONMENT_STYLES.water.fill} label="Water body" swatch="fill" />
              <LegendRow color={ENVIRONMENT_STYLES.wetland.fill} label="Wetland" swatch="fill" />
              <LegendRow color={ENVIRONMENT_STYLES.farmland.fill} label="Farmland" swatch="fill" />
              <LegendRow color={ENVIRONMENT_STYLES.forest.fill} label="Forest" swatch="fill" />
            </div>
          )}
        </div>

        <div className="mc-section">
          <button
            type="button"
            className="mc-heading"
            aria-expanded={layerControlsOpen}
            onClick={() => setLayerControlsOpen((open) => !open)}
          >
            Layers
          </button>
          {layerControlsOpen && (
            <div className="map-layer-controls mc-body">
              <label className="map-layer-option">
                <input
                  type="checkbox"
                  checked={props.roadsVisible !== false}
                  onChange={() => props.onRoadsVisibleChange?.(props.roadsVisible === false)}
                />
                <span>Roads</span>
              </label>
              {ENVIRONMENTAL_KINDS.map((kind) => (
                <label key={kind} className="map-layer-option">
                  <input
                    type="checkbox"
                    checked={props.visibleEnvironmentalKinds?.includes(kind) ?? false}
                    onChange={() => props.onEnvironmentalVisibilityChange?.(kind)}
                  />
                  <span>{ENVIRONMENTAL_KIND_LABELS[kind]}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {loading && (
        <div className="map-status absolute inset-0 z-20" role="status">
          Loading map…
        </div>
      )}
      {!loading && mapError && (
        <div className="map-error absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2">
          {mapError}
        </div>
      )}
    </div>
  );
}
