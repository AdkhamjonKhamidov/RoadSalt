export const DEMO_LOCATION = "1101 Camden Ave, Salisbury, MD 21801";
export const DEMO_CENTER: [number, number] = [-75.6070632, 38.34798];
export const INITIAL_ZOOM = 14;
export const SEARCH_RADIUS_METERS = 3_000;

export const ENVIRONMENTAL_THRESHOLDS_METERS = {
  high: 50,
  moderate: 250,
} as const;

export const BASEMAP_STYLE_URL =
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
