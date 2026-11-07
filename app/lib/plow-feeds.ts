import type { Feature, FeatureCollection, Geometry, Position } from "geojson";
import { finiteNumber, isLatitude, isLongitude, isRecord, text } from "./validation";

// Local agency plow / treatment status feeds.
//
// There is no national plow-status dataset: only some counties, cities and
// states publish one, each with its own schema. Feeds are therefore listed
// here explicitly, each verified by hand with an explicit field mapping.
// (Automatic discovery via ArcGIS search was evaluated and rejected: its area
// filter returns unrelated worldwide items.) Outside every feed's extent the
// UI says that no plow-status feed is available; it never infers status.

export type PlowStatusCategory = "untreated" | "treated" | "repeat-pass" | "unknown";

export const PLOW_STATUS_LABELS: Record<PlowStatusCategory, string> = {
  untreated: "Not yet plowed or treated",
  treated: "Plowed or treated",
  "repeat-pass": "Additional passes made",
  unknown: "Status not recognized",
};

export type PlowFeed = {
  id: string;
  agency: string;
  title: string;
  /** ArcGIS FeatureServer layer URL (hosted on arcgis.com). */
  layerUrl: string;
  /** Public page where people can see the agency's own map. */
  publicMapUrl: string;
  /** [west, south, east, north] coverage, from the layer's own extent. */
  extent: [number, number, number, number];
  fields: {
    name: string;
    status: string;
    updated: string;
    route?: string;
    area?: string;
    miles?: string;
  };
};

export const PLOW_FEEDS: PlowFeed[] = [
  {
    id: "stmarys-md",
    agency: "St. Mary's County, Maryland (Department of Public Works & Transportation)",
    title: "Public Snow Removal Map",
    layerUrl:
      "https://services3.arcgis.com/R7akN8K2mtP0bdMI/arcgis/rest/services/Snow_Routes_Public/FeatureServer/0",
    publicMapUrl:
      "https://stmarysmd.maps.arcgis.com/apps/instant/basic/index.html?appid=51de001a66e6490dba71c45e8dbee702",
    extent: [-76.8577, 38.055, -76.3254, 38.5118],
    fields: {
      name: "Group_",
      status: "Status",
      updated: "EditDate",
      route: "FIRST_Rout",
      area: "FIRST_SERV",
      miles: "SUM_Miles",
    },
  },
];

/** Status older than this is shown as outdated, not as current conditions. */
export const PLOW_STATUS_STALE_MS = 48 * 60 * 60 * 1000;
/** Feeds are considered for a location within this distance of their extent. */
const COVERAGE_MARGIN_DEGREES = 0.05;

export function feedsForLocation(latitude: number, longitude: number): PlowFeed[] {
  return PLOW_FEEDS.filter(({ extent: [west, south, east, north] }) =>
    longitude >= west - COVERAGE_MARGIN_DEGREES &&
    longitude <= east + COVERAGE_MARGIN_DEGREES &&
    latitude >= south - COVERAGE_MARGIN_DEGREES &&
    latitude <= north + COVERAGE_MARGIN_DEGREES,
  );
}

export function categorizePlowStatus(status: string | null): PlowStatusCategory {
  if (!status) return "unknown";
  // Order matters: "not plowed" also contains "plowed".
  if (/un\s?treated|not\s+(yet\s+)?(plowed|treated|started)|pending|unplowed/i.test(status)) {
    return "untreated";
  }
  if (/\b(2nd|3rd|[4-9]th|second|third|fourth|fifth|sixth)\s+pass/i.test(status)) {
    return "repeat-pass";
  }
  if (/plowed|treated|salted|sanded|complete|cleared|inspected/i.test(status)) {
    return "treated";
  }
  return "unknown";
}

export function plowQueryUrl(feed: PlowFeed): string {
  const outFields = [...new Set(Object.values(feed.fields))].join(",");
  const params = new URLSearchParams({
    where: "1=1",
    outFields,
    returnGeometry: "true",
    outSR: "4326",
    // Light simplification (~5 m) keeps the payload small without visible change.
    maxAllowableOffset: "0.00005",
    resultRecordCount: "2000",
    f: "geojson",
  });
  return `${feed.layerUrl}/query?${params.toString()}`;
}

export type PlowRouteProperties = {
  routeId: string;
  feedId: string;
  name: string;
  status: string | null;
  category: PlowStatusCategory;
  /** ISO time the agency last edited this record; null if not provided. */
  updatedAt: string | null;
  /** True when the status is older than PLOW_STATUS_STALE_MS (or undated). */
  stale: boolean;
  route: string | null;
  area: string | null;
  miles: number | null;
};

export type PlowFeedResult = {
  feed: Pick<PlowFeed, "id" | "agency" | "title" | "publicMapUrl">;
  routes: FeatureCollection<Geometry, PlowRouteProperties>;
  counts: Record<PlowStatusCategory, number>;
  newestUpdate: string | null;
  allStale: boolean;
};

function validLine(coordinates: unknown): Position[] | null {
  if (!Array.isArray(coordinates)) return null;
  const line: Position[] = [];
  for (const point of coordinates) {
    if (!Array.isArray(point)) return null;
    const longitude = finiteNumber(point[0]);
    const latitude = finiteNumber(point[1]);
    if (longitude === null || latitude === null || !isLongitude(longitude) || !isLatitude(latitude)) {
      return null;
    }
    line.push([longitude, latitude]);
  }
  return line.length >= 2 ? line : null;
}

function lineGeometry(input: unknown): Geometry | null {
  if (!isRecord(input)) return null;
  if (input.type === "LineString") {
    const line = validLine(input.coordinates);
    return line ? { type: "LineString", coordinates: line } : null;
  }
  if (input.type === "MultiLineString" && Array.isArray(input.coordinates)) {
    const lines = input.coordinates.map(validLine).filter((line): line is Position[] => line !== null);
    return lines.length > 0 ? { type: "MultiLineString", coordinates: lines } : null;
  }
  return null;
}

function dateValue(value: unknown): string | null {
  const epoch = finiteNumber(value);
  if (epoch !== null && epoch > 0) return new Date(epoch).toISOString();
  const iso = text(value, 40);
  return iso && !Number.isNaN(Date.parse(iso)) ? new Date(iso).toISOString() : null;
}

/** Normalizes an ArcGIS `f=geojson` response for one registered feed. */
export function parsePlowFeedResponse(
  feed: PlowFeed,
  input: unknown,
  now = Date.now(),
): PlowFeedResult {
  if (!isRecord(input) || !Array.isArray(input.features)) {
    const message = isRecord(input) && isRecord(input.error) ? text(input.error.message, 200) : null;
    throw new Error(message ? `${feed.agency}: ${message}` : `${feed.agency} returned an invalid response.`);
  }
  const counts: Record<PlowStatusCategory, number> = {
    untreated: 0,
    treated: 0,
    "repeat-pass": 0,
    unknown: 0,
  };
  const seen = new Set<string>();
  let newest: number | null = null;
  const features: Feature<Geometry, PlowRouteProperties>[] = [];

  input.features.forEach((item, index) => {
    if (!isRecord(item) || !isRecord(item.properties)) return;
    const geometry = lineGeometry(item.geometry);
    if (!geometry) return;
    const p = item.properties;
    const id = item.id ?? index;
    const routeId = `${feed.id}:${String(id)}`;
    if (seen.has(routeId)) return;
    seen.add(routeId);

    const status = text(p[feed.fields.status], 120);
    const category = categorizePlowStatus(status);
    const updatedAt = dateValue(p[feed.fields.updated]);
    const updatedMs = updatedAt ? Date.parse(updatedAt) : null;
    if (updatedMs !== null) newest = newest === null ? updatedMs : Math.max(newest, updatedMs);
    counts[category] += 1;
    features.push({
      type: "Feature",
      id: routeId,
      geometry,
      properties: {
        routeId,
        feedId: feed.id,
        name: text(p[feed.fields.name], 200) ?? "Unnamed route segment",
        status,
        category,
        updatedAt,
        stale: updatedMs === null || now - updatedMs > PLOW_STATUS_STALE_MS,
        route: feed.fields.route ? text(p[feed.fields.route], 60) : null,
        area: feed.fields.area ? text(p[feed.fields.area], 60) : null,
        miles: feed.fields.miles ? finiteNumber(p[feed.fields.miles]) : null,
      },
    });
  });

  return {
    feed: { id: feed.id, agency: feed.agency, title: feed.title, publicMapUrl: feed.publicMapUrl },
    routes: { type: "FeatureCollection", features },
    counts,
    newestUpdate: newest === null ? null : new Date(newest).toISOString(),
    allStale: features.every((feature) => feature.properties.stale),
  };
}
