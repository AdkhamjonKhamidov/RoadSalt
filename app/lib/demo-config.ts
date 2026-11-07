import type { Location } from "./data-types";

export const DEMO_LOCATION = "1101 Camden Ave, Salisbury, MD 21801";
export const DEMO_CENTER: [number, number] = [-75.6070632, 38.34798];

/** The location RoadSalt opens with (never replaced by browser geolocation). */
export const DEFAULT_LOCATION: Location = {
  id: "default",
  name: "1101 Camden Ave",
  displayName: DEMO_LOCATION,
  latitude: DEMO_CENTER[1],
  longitude: DEMO_CENTER[0],
  boundingBox: null,
  locality: "Salisbury",
  region: "Maryland",
  country: "United States",
  placeType: "house",
  source: "Configured default",
};
export const INITIAL_ZOOM = 14;
// Half-width of the Overpass query box. Kept small: service roads are included.
export const SEARCH_RADIUS_METERS = 2_000;

export const ENVIRONMENTAL_THRESHOLDS_METERS = {
  high: 50,
  moderate: 250,
} as const;

const CARTO_POSITRON_STYLE_URL =
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

// MapTiler keys are browser-visible by design; restrict the key to your
// domains in the MapTiler dashboard. These literal process.env references are
// inlined by Next.js at build time (dynamic lookups are not).
const MAPTILER_API_KEY = (process.env.NEXT_PUBLIC_MAPTILER_API_KEY ?? "").trim();
const MAPTILER_STYLE_ID =
  (process.env.NEXT_PUBLIC_MAPTILER_STYLE_ID ?? "").trim() || "positron";

const SAFE_TOKEN = /^[A-Za-z0-9_-]+$/;
const useMapTiler =
  SAFE_TOKEN.test(MAPTILER_API_KEY) && SAFE_TOKEN.test(MAPTILER_STYLE_ID);

/** "MapTiler" when a valid key is configured, otherwise the keyless CARTO default. */
export const BASEMAP_PROVIDER: "MapTiler" | "CARTO" = useMapTiler
  ? "MapTiler"
  : "CARTO";

export const BASEMAP_STYLE_URL = useMapTiler
  ? `https://api.maptiler.com/maps/${MAPTILER_STYLE_ID}/style.json?key=${MAPTILER_API_KEY}`
  : CARTO_POSITRON_STYLE_URL;
