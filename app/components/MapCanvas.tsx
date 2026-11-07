"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type {
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
import { extractTileMapData } from "../lib/tile-features";
import {
  BASEMAP_PROVIDER,
  BASEMAP_STYLE_URL,
  DEMO_CENTER,
  DEMO_LOCATION,
  INITIAL_ZOOM,
} from "./map-config";

export type RoadFeatureProperties = RoadProperties;
export type EnvironmentalFeatureProperties = EnvironmentalProperties;

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
  roads?: FeatureCollection<Geometry, RoadFeatureProperties>;
  environmentalFeatures?: FeatureCollection<
    Geometry,
    EnvironmentalFeatureProperties
  >;
  selectedRoadId?: string | null;
  visibleEnvironmentalKinds?: EnvironmentalKind[];
  onEnvironmentalVisibilityChange?: (kind: EnvironmentalKind) => void;
  onRoadSelect?: (road: Feature<Geometry, RoadFeatureProperties>) => void;
  /** Receives roads/features read from the loaded basemap tiles after each view change. */
  onTileData?: (data: MapData) => void;
};

// Below this zoom, tiles are generalized and drop minor roads and features.
const MIN_EXTRACTION_ZOOM = 12;
// Click tolerance in pixels around the pointer when selecting a road.
const ROAD_HIT_TOLERANCE_PX = 6;

const EMPTY_ROADS: FeatureCollection<Geometry, RoadFeatureProperties> = {
  type: "FeatureCollection",
  features: [],
};
const EMPTY_ENVIRONMENT: FeatureCollection<
  Geometry,
  EnvironmentalFeatureProperties
> = { type: "FeatureCollection", features: [] };

function updateOverlays(
  map: MapLibreMap,
  props: MapCanvasProps,
) {
  if (!map.isStyleLoaded()) return;
  const firstLabelLayer = map
    .getStyle()
    .layers?.find((layer) => layer.type === "symbol")?.id;
  const addLayer = (
    layer: Parameters<MapLibreMap["addLayer"]>[0],
  ) => map.addLayer(layer, firstLabelLayer);

  if (!map.getSource("roadsalt-roads")) {
    map.addSource("roadsalt-roads", {
      type: "geojson",
      data: props.roads ?? EMPTY_ROADS,
    });
  }

  if (!map.getSource("roadsalt-environment")) {
    map.addSource("roadsalt-environment", {
      type: "geojson",
      data: props.environmentalFeatures ?? EMPTY_ENVIRONMENT,
    });
  }

  const environmentStyles: Record<
    EnvironmentalKind,
    { fill: string; line: string; fillOpacity: number }
  > = {
    waterway: { fill: "#91BED1", line: "#6E9FB7", fillOpacity: 0.25 },
    water: { fill: "#B7D6E4", line: "#6E9FB7", fillOpacity: 0.5 },
    wetland: { fill: "#D2E5EE", line: "#8CB5C6", fillOpacity: 0.62 },
    farmland: { fill: "#D7E2D2", line: "#8CA287", fillOpacity: 0.46 },
    protected: { fill: "#CEDDCB", line: "#789177", fillOpacity: 0.22 },
  };

  for (const [kind, style] of Object.entries(environmentStyles) as [
    EnvironmentalKind,
    (typeof environmentStyles)[EnvironmentalKind],
  ][]) {
    const layerBase = `roadsalt-${kind}`;
    if (!map.getLayer(`${layerBase}-fill`)) {
      addLayer({
        id: `${layerBase}-fill`,
        type: "fill",
        source: "roadsalt-environment",
        filter: [
          "all",
          ["==", ["get", "kind"], kind],
          ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon"]]],
        ],
        paint: {
          "fill-color": style.fill,
          "fill-opacity": style.fillOpacity,
          "fill-outline-color": style.line,
        },
      });
    }
    if (!map.getLayer(`${layerBase}-lines`)) {
      addLayer({
        id: `${layerBase}-lines`,
        type: "line",
        source: "roadsalt-environment",
        filter: [
          "all",
          ["==", ["get", "kind"], kind],
          ["in", ["geometry-type"], ["literal", ["LineString", "MultiLineString"]]],
        ],
        paint: {
          "line-color": style.line,
          "line-width": kind === "waterway" ? 2 : 1.5,
          "line-opacity": 0.9,
        },
      });
    }
    if (!map.getLayer(`${layerBase}-points`)) {
      addLayer({
        id: `${layerBase}-points`,
        type: "circle",
        source: "roadsalt-environment",
        filter: [
          "all",
          ["==", ["get", "kind"], kind],
          ["==", ["geometry-type"], "Point"],
        ],
        paint: {
          "circle-radius": 4,
          "circle-color": style.line,
          "circle-stroke-color": "#F9F7F7",
          "circle-stroke-width": 1,
        },
      });
    }
  }

  if (!map.getLayer("roadsalt-road-network")) {
    addLayer({
      id: "roadsalt-road-network",
      type: "line",
      source: "roadsalt-roads",
      paint: {
        "line-color": "#112D4E",
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          10,
          1.1,
          15,
          2.4,
        ],
        "line-opacity": 0.45,
      },
    });
  }
  if (!map.getLayer("roadsalt-selected-road")) {
    addLayer({
      id: "roadsalt-selected-road",
      type: "line",
      source: "roadsalt-roads",
      filter: ["==", ["get", "roadId"], ""],
      paint: {
        "line-color": "#3F72AF",
        "line-width": 5,
        "line-opacity": 0.95,
      },
    });
  }

  const roadsSource = map.getSource("roadsalt-roads") as
    | GeoJSONSource
    | undefined;
  roadsSource?.setData(props.roads ?? EMPTY_ROADS);

  const environmentSource = map.getSource("roadsalt-environment") as
    | GeoJSONSource
    | undefined;
  environmentSource?.setData(props.environmentalFeatures ?? EMPTY_ENVIRONMENT);

  if (map.getLayer("roadsalt-selected-road")) {
    map.setFilter("roadsalt-selected-road", [
      "==",
      ["get", "roadId"],
      props.selectedRoadId ?? "",
    ]);
  }
  const visibleKinds = props.visibleEnvironmentalKinds ?? [];
  for (const kind of Object.keys(environmentStyles) as EnvironmentalKind[]) {
    for (const suffix of ["fill", "lines", "points"]) {
      const layerId = `roadsalt-${kind}-${suffix}`;
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(
          layerId,
          "visibility",
          visibleKinds.includes(kind) ? "visible" : "none",
        );
      }
    }
  }
}

export default function MapCanvas(props: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const styleLoadedRef = useRef(false);
  const markerRef = useRef<Marker | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const propsRef = useRef(props);
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
        map = new maplibre.Map({
          container: containerRef.current,
          style: BASEMAP_STYLE_URL,
          center: propsRef.current.focus
            ? [propsRef.current.focus.longitude, propsRef.current.focus.latitude]
            : DEMO_CENTER,
          zoom: propsRef.current.focus?.zoom ?? INITIAL_ZOOM,
          minZoom: 3,
          maxZoom: 19,
          attributionControl: { compact: false },
          cooperativeGestures: false,
        });
        mapRef.current = map;
        map.addControl(
          new maplibre.NavigationControl({ showCompass: true }),
          "top-right",
        );

        const onLoad = () => {
          if (cancelled || !map) return;
          styleLoadedRef.current = true;
          setLoading(false);
          setMapError(null);
          updateOverlays(map, propsRef.current);

          const markerElement = document.createElement("div");
          markerElement.className = "roadsalt-location-marker";
          markerElement.setAttribute("role", "img");
          markerElement.setAttribute("aria-label", "Demo location marker");

          const popup = new maplibre.Popup({ offset: 17, closeButton: true })
            .setText(propsRef.current.focus?.label ?? DEMO_LOCATION);
          popupRef.current = popup;
          locationMarker = new maplibre.Marker({
            element: markerElement,
            anchor: "center",
          })
            .setLngLat(
              propsRef.current.focus
                ? [propsRef.current.focus.longitude, propsRef.current.focus.latitude]
                : DEMO_CENTER,
            )
            .setPopup(popup)
            .addTo(map);
          locationMarker.togglePopup();
          markerRef.current = locationMarker;
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

        const onRoadClick = (event: MapMouseEvent) => {
          if (!map || !propsRef.current.onRoadSelect) return;
          const layers = ["roadsalt-road-network"];
          const availableLayers = layers.filter((layer) => map?.getLayer(layer));
          if (availableLayers.length === 0) return;

          const { x, y } = event.point;
          const feature = map.queryRenderedFeatures(
            [
              [x - ROAD_HIT_TOLERANCE_PX, y - ROAD_HIT_TOLERANCE_PX],
              [x + ROAD_HIT_TOLERANCE_PX, y + ROAD_HIT_TOLERANCE_PX],
            ],
            { layers: availableLayers },
          )[0];
          // Rendered features are clipped to tiles; select the full merged road.
          const fullRoad = propsRef.current.roads?.features.find(
            (road) => road.properties.roadId === String(feature?.properties?.roadId),
          );
          if (fullRoad) {
            propsRef.current.onRoadSelect?.(fullRoad);
            return;
          }
          const roadId = feature?.properties?.roadId;
          if (
            !feature ||
            (typeof roadId !== "string" && typeof roadId !== "number")
          ) {
            return;
          }

          propsRef.current.onRoadSelect?.({
            type: "Feature",
            id: feature.id,
            geometry: feature.geometry,
            properties: {
              ...(feature.properties ?? {}),
              roadId: String(roadId),
              classification:
                typeof feature.properties?.classification === "string"
                  ? feature.properties.classification
                  : "unclassified",
            },
          });
        };

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
        map.on("error", onError);
        map.on("click", onRoadClick);
        map.on("idle", onIdle);
        const initializedMap = map;
        removeMapListeners = () => {
          initializedMap.off("load", onLoad);
          initializedMap.off("error", onError);
          initializedMap.off("click", onRoadClick);
          initializedMap.off("idle", onIdle);
        };

        resizeObserver = new ResizeObserver(() => map?.resize());
        resizeObserver.observe(containerRef.current);
      } catch (error) {
        console.error("RoadSalt map initialization failed:", error);
        if (!cancelled) {
          setLoading(false);
          setMapError(
            "The interactive map could not be initialized. Refresh the page to try again.",
          );
        }
      }
    }

    void initializeMap();

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      removeMapListeners?.();
      locationMarker?.remove();
      markerRef.current = null;
      popupRef.current = null;
      map?.remove();
      mapRef.current = null;
      styleLoadedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const currentProps = {
      focus: props.focus,
      roads: props.roads,
      environmentalFeatures: props.environmentalFeatures,
      selectedRoadId: props.selectedRoadId,
      visibleEnvironmentalKinds: props.visibleEnvironmentalKinds,
      onRoadSelect: props.onRoadSelect,
      onTileData: props.onTileData,
    };
    propsRef.current = currentProps;
    if (mapRef.current && styleLoadedRef.current) {
      updateOverlays(mapRef.current, currentProps);
    }
  }, [
    props.roads,
    props.environmentalFeatures,
    props.selectedRoadId,
    props.visibleEnvironmentalKinds,
    props.onRoadSelect,
    props.onTileData,
    props.focus,
  ]);

  // Fly to a newly selected location and move the marker with it.
  const focusKey = props.focus?.key;
  useEffect(() => {
    const focus = propsRef.current.focus;
    const map = mapRef.current;
    if (!focus || !map) return;
    map.flyTo({ center: [focus.longitude, focus.latitude], zoom: focus.zoom, duration: 900 });
    markerRef.current?.setLngLat([focus.longitude, focus.latitude]);
    popupRef.current?.setText(focus.label);
    if (markerRef.current && !markerRef.current.getPopup()?.isOpen()) {
      markerRef.current.togglePopup();
    }
  }, [focusKey]);

  const [layerControlsOpen, setLayerControlsOpen] = useState(false);
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

  return (
    <div className="map-canvas relative h-full min-h-[420px] w-full">
      <div
        ref={containerRef}
        className="absolute inset-0"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        aria-label={`Interactive road map around ${props.focus?.label ?? DEMO_LOCATION}`}
      />

      <div className="map-toolbar absolute left-3 top-3 z-10 flex items-center gap-2">
        <span className="map-toolbar-label">Selected location</span>
        <button
          type="button"
          className="map-toolbar-button"
          onClick={resetLocation}
        >
          Reset location
        </button>
        <button
          type="button"
          className="map-toolbar-button"
          aria-expanded={layerControlsOpen}
          onClick={() => setLayerControlsOpen((open) => !open)}
        >
          Layers
        </button>
      </div>

      {layerControlsOpen && (
        <div className="map-layer-controls absolute left-3 top-[3.4rem] z-10">
          <p className="map-legend-title">Environmental layers</p>
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

      <div className="map-legend absolute bottom-3 left-3 z-10">
        <p className="map-legend-title">Map key</p>
        <div className="map-legend-row">
          <span className="map-legend-line map-legend-road" />
          <span>OpenStreetMap roads</span>
        </div>
        <div className="map-legend-row">
          <span className="map-legend-line map-legend-selected" />
          <span>Selected road</span>
        </div>
        <div className="map-legend-row">
          <span className="map-legend-line map-legend-water" />
          <span>Waterways &amp; water bodies</span>
        </div>
        <div className="map-legend-row">
          <span className="map-legend-line map-legend-wetland" />
          <span>Wetlands</span>
        </div>
        <div className="map-legend-row">
          <span className="map-legend-line map-legend-farmland" />
          <span>Farmland / protected areas</span>
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
