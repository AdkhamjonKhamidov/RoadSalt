import { NextResponse, type NextRequest } from "next/server";
import type { IncidentData } from "../../lib/data-types";
import { incidentsUrl, parseIncidents } from "../../lib/traffic-incidents";
import {
  coordinatesFromSearchParams,
  ExpiringCache,
} from "../../lib/validation";

// GET /api/incidents?lat=..&lon=.. → live closures and hazards (TomTom) in a
// ~22 km box. The key stays on the server (TOMTOM_API_KEY in .env.local).
// Without a key the route answers { configured: false } and the UI says so.

const REQUEST_TIMEOUT_MS = 10_000;
// Free tier is ~2,500 requests/day; cache per ~1 km point for 3 minutes.
const cache = new ExpiringCache<IncidentData>(200, 3 * 60 * 1000);
const pending = new Map<string, Promise<IncidentData>>();

async function fetchIncidents(apiKey: string, latitude: number, longitude: number): Promise<IncidentData> {
  let response: Response;
  try {
    response = await fetch(incidentsUrl(apiKey, latitude, longitude), {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new Error("Could not reach the traffic incident service.");
  }
  if (response.status === 403 || response.status === 401) {
    throw new Error("The traffic incident service rejected the API key (check TOMTOM_API_KEY).");
  }
  if (response.status === 429) {
    throw new Error("Traffic incident requests are rate-limited. Please try again shortly.");
  }
  if (!response.ok) {
    throw new Error(`Traffic incident service returned HTTP ${response.status}.`);
  }
  return {
    configured: true,
    incidents: parseIncidents(await response.json()),
    updatedAt: new Date().toISOString(),
    source: "TomTom Traffic",
  };
}

export async function GET(request: NextRequest) {
  const coordinates = coordinatesFromSearchParams(request.nextUrl.searchParams);
  if (!coordinates) {
    return NextResponse.json(
      { error: "Valid lat and lon query parameters are required." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const apiKey = (process.env.TOMTOM_API_KEY ?? "").trim();
  if (!/^[A-Za-z0-9]+$/.test(apiKey)) {
    const notConfigured: IncidentData = {
      configured: false,
      incidents: [],
      updatedAt: new Date().toISOString(),
      source: "TomTom Traffic",
    };
    return NextResponse.json(notConfigured, { headers: { "Cache-Control": "no-store" } });
  }

  // ~1 km cache cell: nearby searches share one request.
  const key = `${coordinates.latitude.toFixed(2)},${coordinates.longitude.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit) return NextResponse.json(hit, { headers: { "Cache-Control": "private, max-age=60" } });
  let request$ = pending.get(key);
  if (!request$) {
    request$ = fetchIncidents(apiKey, coordinates.latitude, coordinates.longitude);
    pending.set(key, request$);
  }
  try {
    const data = await request$;
    cache.set(key, data);
    return NextResponse.json(data, { headers: { "Cache-Control": "private, max-age=60" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Traffic incidents are unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    pending.delete(key);
  }
}
