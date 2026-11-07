import type {
  Feature,
  FeatureCollection,
  Geometry,
  LineString,
  MultiLineString,
  Polygon,
  MultiPolygon,
  Point,
} from "geojson";
import type {
  EnvironmentalKind,
  EnvironmentalProperties,
  MapData,
  RoadProperties,
} from "./data-types";
import { SEARCH_RADIUS_METERS } from "./demo-config";

type Position = [number, number];

type OSMGeometryPoint = {
  lat: number;
  lon: number;
};

type OSMMember = {
  role?: string;
  geometry?: OSMGeometryPoint[];
};

type OSMElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  geometry?: OSMGeometryPoint[];
  members?: OSMMember[];
  tags?: Record<string, string>;
};

type OSMResponse = {
  elements: OSMElement[];
  remark?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parsePoint(value: unknown): Position | null {
  if (!isRecord(value)) return null;
  const { lat, lon } = value;
  if (
    typeof lat !== "number" ||
    typeof lon !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    return null;
  }
  return [lon, lat];
}

function parseGeometry(value: unknown): Position[] {
  if (!Array.isArray(value)) return [];
  const points = value.map(parsePoint);
  if (points.some((point) => point === null)) return [];
  return points.filter((point): point is Position => point !== null);
}

function readOSMGeometry(value: unknown): OSMGeometryPoint[] | null {
  if (!Array.isArray(value)) return null;
  const points = value.map((point) => {
    if (!isRecord(point)) return null;
    const position = parsePoint(point);
    return position ? { lat: position[1], lon: position[0] } : null;
  });
  if (points.some((point) => point === null)) return null;
  return points.filter(
    (point): point is OSMGeometryPoint => point !== null,
  );
}

function parseTags(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const tags: Record<string, string> = {};
  for (const [key, tag] of Object.entries(value)) {
    if (key.length <= 100 && typeof tag === "string" && tag.length <= 500) {
      tags[key] = tag;
    }
  }
  return tags;
}

function classifyEnvironment(
  tags: Record<string, string>,
): EnvironmentalKind | null {
  if (tags.waterway === "riverbank") return "water";
  if (tags.waterway) return "waterway";
  if (
    tags.natural === "wetland" ||
    tags.wetland ||
    tags.landcover === "wetland"
  ) {
    return "wetland";
  }
  if (
    tags.natural === "water" || tags.water
  ) {
    return "water";
  }
  if (
    ["farmland", "farmyard", "orchard", "vineyard", "plant_nursery"].includes(
      tags.landuse ?? "",
    )
  ) {
    return "farmland";
  }
  if (
    ["protected_area", "national_park"].includes(tags.boundary ?? "") ||
    tags.leisure === "nature_reserve" ||
    tags.protect_class
  ) {
    return "protected";
  }
  return null;
}

function readElement(value: unknown): OSMElement | null {
  if (!isRecord(value)) return null;
  const geometryInput = value.geometry;
  const membersInput = value.members;
  if (
    (value.type !== "node" && value.type !== "way" && value.type !== "relation") ||
    typeof value.id !== "number" ||
    !Number.isSafeInteger(value.id) ||
    (value.type === "node" && !parsePoint(value)) ||
    (geometryInput !== undefined && !Array.isArray(geometryInput)) ||
    (membersInput !== undefined && !Array.isArray(membersInput))
  ) {
    return null;
  }
  const element: OSMElement = {
    type: value.type,
    id: value.id,
    tags: parseTags(value.tags),
  };

  if (value.type === "node") {
    const point = parsePoint(value);
    if (!point) return null;
    element.lat = point[1];
    element.lon = point[0];
  }

  if (geometryInput !== undefined) {
    const geometry = readOSMGeometry(geometryInput);
    if (!geometry) return null;
    element.geometry = geometry;
  }

  if (membersInput !== undefined) {
    if (!Array.isArray(membersInput)) return null;
    const members: OSMMember[] = [];
    for (const member of membersInput) {
      if (!isRecord(member)) return null;
      if (member.role !== undefined && typeof member.role !== "string") {
        return null;
      }
      const parsedMember: OSMMember = {};
      if (typeof member.role === "string") parsedMember.role = member.role;
      if (member.geometry !== undefined) {
        const geometry = readOSMGeometry(member.geometry);
        if (!geometry) return null;
        parsedMember.geometry = geometry;
      }
      members.push(parsedMember);
    }
    element.members = members;
  }
  return element;
}

function stitchRings(segments: Position[][]): Position[][] {
  const pending = segments
    .filter((segment) => segment.length >= 2)
    .map((segment) => [...segment]);
  const rings: Position[][] = [];

  while (pending.length > 0) {
    const ring = pending.shift();
    if (!ring) continue;

    let changed = true;
    while (
      changed &&
      ring.length >= 2 &&
      !samePosition(ring[0], ring[ring.length - 1])
    ) {
      changed = false;
      for (let index = 0; index < pending.length; index += 1) {
        const segment = pending[index];
        if (!segment) continue;
        if (samePosition(ring[ring.length - 1], segment[0])) {
          ring.push(...segment.slice(1));
        } else if (samePosition(ring[ring.length - 1], segment.at(-1))) {
          ring.push(...segment.slice(0, -1).reverse());
        } else if (samePosition(ring[0], segment.at(-1))) {
          ring.unshift(...segment.slice(0, -1));
        } else if (samePosition(ring[0], segment[0])) {
          ring.unshift(...segment.slice(1).reverse());
        } else {
          continue;
        }
        pending.splice(index, 1);
        changed = true;
        break;
      }
    }

    if (ring.length >= 4 && samePosition(ring[0], ring.at(-1))) {
      rings.push(ring);
    } else if (ring.length >= 2) {
      rings.push(ring);
    }
  }

  return rings;
}

function samePosition(a?: Position, b?: Position): boolean {
  return Boolean(
    a && b && Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7,
  );
}

function relationGeometry(element: OSMElement): Geometry | null {
  const members = element.members ?? [];
  const lineMembers = members
    .filter((member) => member.role !== "inner")
    .map((member) => parseGeometry(member.geometry))
    .filter((line) => line.length >= 2);
  if (lineMembers.length === 0) return null;

  const rings = stitchRings(lineMembers);
  const polygons = rings
    .filter(
      (ring) =>
        ring.length >= 4 && samePosition(ring[0], ring.at(-1)),
    )
    .map((ring) => [ring]);
  if (polygons.length > 0) {
    return { type: "MultiPolygon", coordinates: polygons } satisfies MultiPolygon;
  }
  return {
    type: "MultiLineString",
    coordinates: rings,
  } satisfies MultiLineString;
}

function featureGeometry(
  element: OSMElement,
  kind: EnvironmentalKind | null,
): Geometry | null {
  if (element.type === "node") {
    const point = parsePoint(element);
    return point ? ({ type: "Point", coordinates: point } satisfies Point) : null;
  }

  if (element.type === "relation") return relationGeometry(element);

  const line = parseGeometry(element.geometry);
  if (line.length < 2) return null;

  const closed = samePosition(line[0], line.at(-1));
  const areaKind =
    kind === "water" ||
    kind === "wetland" ||
    kind === "farmland" ||
    kind === "protected";
  if (closed && areaKind) {
    return { type: "Polygon", coordinates: [line] } satisfies Polygon;
  }
  return { type: "LineString", coordinates: line } satisfies LineString;
}

function normalizeResponse(input: unknown): OSMResponse {
  if (!isRecord(input) || !Array.isArray(input.elements)) {
    throw new Error("Overpass returned an invalid response.");
  }
  if (typeof input.remark === "string" && input.remark.length > 0) {
    throw new Error(`Overpass reported: ${input.remark.slice(0, 300)}`);
  }
  const elements = input.elements
    .map(readElement)
    .filter((element): element is OSMElement => element !== null);
  return { elements };
}

export function overpassQuery(
  latitude: number,
  longitude: number,
  radiusMeters: number,
): string {
  const around = `(around:${radiusMeters},${latitude},${longitude})`;
  const query = [
    `[out:json][timeout:12];`,
    `(`,
    `way${around}[highway~"^(primary|secondary|tertiary|residential|unclassified|service)$"];`,
    `way${around}[waterway];`,
    `way${around}[natural~"^(water|wetland)$"];`,
    `way${around}[water];`,
    `way${around}[wetland];`,
    `way${around}[landuse~"^(farmland|farmyard|orchard|vineyard|plant_nursery)$"];`,
    `way${around}[boundary~"^(protected_area|national_park)$"];`,
    `way${around}[leisure=nature_reserve];`,
    `way${around}[protect_class];`,
    `relation${around}[waterway];`,
    `relation${around}[natural~"^(water|wetland)$"];`,
    `relation${around}[water];`,
    `relation${around}[wetland];`,
    `relation${around}[landuse~"^(farmland|farmyard|orchard|vineyard|plant_nursery)$"];`,
    `relation${around}[boundary~"^(protected_area|national_park)$"];`,
    `relation${around}[leisure=nature_reserve];`,
    `relation${around}[protect_class];`,
    `);out geom;`,
  ].join("");
  return query;
}

export function overpassToGeoJSON(
  input: unknown,
  updatedAt = new Date().toISOString(),
): MapData {
  const response = normalizeResponse(input);
  const roads: Feature<Geometry, RoadProperties>[] = [];
  const environmentalFeatures: Feature<
    Geometry,
    EnvironmentalProperties
  >[] = [];

  for (const element of response.elements) {
    const tags = parseTags(element.tags);
    const roadClass = tags.highway;
    if (
      element.type === "way" &&
      roadClass &&
      /^(primary|secondary|tertiary|residential|unclassified|service)$/.test(
        roadClass,
      )
    ) {
      const geometry = featureGeometry(element, null);
      if (!geometry || (geometry.type !== "LineString" && geometry.type !== "MultiLineString")) {
        continue;
      }
      const properties: RoadProperties = {
        roadId: `way/${element.id}`,
        classification: roadClass,
      };
      if (tags.name) properties.name = tags.name;
      roads.push({
        type: "Feature",
        id: properties.roadId,
        geometry,
        properties,
      });
      continue;
    }

    const kind = classifyEnvironment(tags);
    if (!kind) continue;
    const geometry = featureGeometry(element, kind);
    if (!geometry) continue;
    const properties: EnvironmentalProperties = {
      featureId: `${element.type}/${element.id}`,
      kind,
    };
    if (tags.name) properties.name = tags.name;
    environmentalFeatures.push({
      type: "Feature",
      id: properties.featureId,
      geometry,
      properties,
    });
  }

  const roadsCollection: FeatureCollection<Geometry, RoadProperties> = {
    type: "FeatureCollection",
    features: roads,
  };
  const environmentCollection: FeatureCollection<
    Geometry,
    EnvironmentalProperties
  > = { type: "FeatureCollection", features: environmentalFeatures };

  return {
    roads: roadsCollection,
    environmentalFeatures: environmentCollection,
    updatedAt,
    source: "OpenStreetMap Overpass API",
    radiusMeters: SEARCH_RADIUS_METERS,
  };
}
