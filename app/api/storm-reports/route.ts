import { NextResponse, type NextRequest } from "next/server";
import type { StormReportData } from "../../lib/data-types";
import { NwsError, nwsPlace } from "../../lib/nws-server";
import {
  parseStormReports,
  STORM_REPORT_RADIUS_KM,
  STORM_REPORT_WINDOW_HOURS,
  stormReportsUrl,
} from "../../lib/storm-reports";
import {
  coordinateKey,
  coordinatesFromSearchParams,
  ExpiringCache,
} from "../../lib/validation";

// GET /api/storm-reports?lat=..&lon=.. → NWS Local Storm Reports from the
// last 72 hours within 80 km of the point (US only). The point's NWS forecast
// office comes from api.weather.gov; the reports from the Iowa Environmental
// Mesonet LSR archive for that office.

const REQUEST_TIMEOUT_MS = 10_000;
const cache = new ExpiringCache<StormReportData>(200, 10 * 60 * 1000);
const pending = new Map<string, Promise<StormReportData>>();

async function fetchReports(latitude: number, longitude: number): Promise<StormReportData> {
  const { office } = await nwsPlace(latitude, longitude);
  let response: Response;
  try {
    response = await fetch(stormReportsUrl(office), {
      headers: { "User-Agent": "RoadSalt/0.1 (road salt awareness demo)" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new NwsError("Could not reach the storm report archive.", 503);
  }
  if (!response.ok) {
    throw new NwsError(`Storm report archive returned HTTP ${response.status}.`, 502);
  }
  return {
    office,
    windowHours: STORM_REPORT_WINDOW_HOURS,
    radiusKm: STORM_REPORT_RADIUS_KM,
    reports: parseStormReports(await response.json(), latitude, longitude),
    updatedAt: new Date().toISOString(),
    source: "NWS Local Storm Reports (via Iowa Environmental Mesonet)",
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
  const key = coordinateKey(coordinates.latitude, coordinates.longitude);
  const hit = cache.get(key);
  if (hit) {
    return NextResponse.json(hit, { headers: { "Cache-Control": "public, max-age=300" } });
  }
  let request$ = pending.get(key);
  if (!request$) {
    request$ = fetchReports(coordinates.latitude, coordinates.longitude);
    pending.set(key, request$);
  }
  try {
    const data = await request$;
    cache.set(key, data);
    return NextResponse.json(data, { headers: { "Cache-Control": "public, max-age=300" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Storm reports are unavailable." },
      {
        status: error instanceof NwsError ? error.status : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } finally {
    pending.delete(key);
  }
}
