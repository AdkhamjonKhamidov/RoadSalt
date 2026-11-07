import { NextResponse, type NextRequest } from "next/server";
import type { MapData } from "../../lib/data-types";
import { DEMO_CENTER } from "../../lib/demo-config";
import { fetchOverpassMapData, OverpassError } from "../../lib/overpass";
import {
  coordinateKey,
  coordinatesFromSearchParams,
  ExpiringCache,
} from "../../lib/validation";

// GET /api/map-data[?lat=..&lon=..] → normalized OSM roads and features.
// Server-side alternative to the browser loader. The dashboard loads Overpass
// data directly in the browser (loadMapDataInBrowser) because public Overpass
// instances were often unreachable from the server during development; this
// route uses the same shared code for deployments where the server can reach them.

const cache = new ExpiringCache<MapData>(50, 15 * 60 * 1000);
const pending = new Map<string, Promise<MapData>>();

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const hasCoordinates = params.has("lat") || params.has("lon");
  const coordinates = hasCoordinates
    ? coordinatesFromSearchParams(params)
    : { latitude: DEMO_CENTER[1], longitude: DEMO_CENTER[0] };
  if (!coordinates) {
    return NextResponse.json(
      { error: "Valid lat and lon query parameters are required." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const key = coordinateKey(coordinates.latitude, coordinates.longitude);
  const hit = cache.get(key);
  if (hit) {
    return NextResponse.json(hit, {
      headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=900" },
    });
  }

  let request$ = pending.get(key);
  if (!request$) {
    request$ = fetchOverpassMapData({
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      headers: { "User-Agent": "RoadSalt/0.1 (road salt awareness demo)" },
      onEndpointFailure: (endpoint, reason) =>
        console.warn(`[map-data] ${new URL(endpoint).host} failed: ${reason}`),
    });
    pending.set(key, request$);
  }
  try {
    const data = await request$;
    cache.set(key, data);
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=900" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not retrieve OpenStreetMap data." },
      {
        status: error instanceof OverpassError ? error.status : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } finally {
    pending.delete(key);
  }
}
