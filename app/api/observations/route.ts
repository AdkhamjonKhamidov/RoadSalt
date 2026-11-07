import { NextResponse, type NextRequest } from "next/server";
import type { ObservationData } from "../../lib/data-types";
import {
  NWS_BASE,
  parseAlerts,
  parseNearestStation,
  parseObservation,
  parsePointStationsUrl,
} from "../../lib/nws";
import {
  coordinateKey,
  coordinatesFromSearchParams,
  ExpiringCache,
} from "../../lib/validation";

// GET /api/observations?lat=..&lon=.. → measured conditions from the nearest
// NWS station plus active alerts for the point. US locations only.

const NWS_HEADERS = {
  "User-Agent": "RoadSalt/0.1 (road salt awareness demo)",
  Accept: "application/geo+json",
};
const REQUEST_TIMEOUT_MS = 10_000;
const stationCache = new ExpiringCache<{ id: string; name: string | null }>(200, 24 * 60 * 60 * 1000);
const dataCache = new ExpiringCache<ObservationData>(200, 5 * 60 * 1000);
const pending = new Map<string, Promise<ObservationData>>();

class NwsError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function getJson(url: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: NWS_HEADERS,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    throw new NwsError(
      error instanceof Error && error.name === "TimeoutError"
        ? "National Weather Service request timed out."
        : "Could not reach the National Weather Service.",
      503,
    );
  }
  if (response.status === 404) {
    throw new NwsError(
      "National Weather Service data is only available for United States locations.",
      404,
    );
  }
  if (!response.ok) {
    throw new NwsError(`National Weather Service returned HTTP ${response.status}.`, 502);
  }
  return response.json();
}

async function nearestStation(latitude: number, longitude: number) {
  const key = coordinateKey(latitude, longitude);
  const hit = stationCache.get(key);
  if (hit) return hit;
  const point = await getJson(`${NWS_BASE}/points/${latitude.toFixed(4)},${longitude.toFixed(4)}`);
  const station = parseNearestStation(await getJson(parsePointStationsUrl(point)));
  stationCache.set(key, station);
  return station;
}

async function fetchObservations(latitude: number, longitude: number): Promise<ObservationData> {
  const reason = (result: PromiseRejectedResult) =>
    result.reason instanceof Error ? result.reason.message : "Unavailable.";
  const [stationResult, alertsResult] = await Promise.allSettled([
    nearestStation(latitude, longitude),
    getJson(`${NWS_BASE}/alerts/active?point=${latitude.toFixed(4)},${longitude.toFixed(4)}`).then(parseAlerts),
  ]);
  if (stationResult.status === "rejected" && alertsResult.status === "rejected") {
    throw stationResult.reason instanceof NwsError
      ? stationResult.reason
      : new NwsError("National Weather Service data is unavailable.", 503);
  }

  let observation: ObservationData["observation"] = null;
  let observationError: string | null = null;
  if (stationResult.status === "fulfilled") {
    try {
      observation = parseObservation(
        await getJson(`${NWS_BASE}/stations/${stationResult.value.id}/observations/latest`),
      );
    } catch (error) {
      observationError = error instanceof Error ? error.message : "Unavailable.";
    }
  } else {
    observationError = reason(stationResult);
  }

  return {
    stationId: stationResult.status === "fulfilled" ? stationResult.value.id : null,
    stationName: stationResult.status === "fulfilled" ? stationResult.value.name : null,
    observation,
    observationError,
    alerts: alertsResult.status === "fulfilled" ? alertsResult.value : null,
    alertsError: alertsResult.status === "rejected" ? reason(alertsResult) : null,
    updatedAt: new Date().toISOString(),
    source: "National Weather Service",
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
  const hit = dataCache.get(key);
  if (hit) {
    return NextResponse.json(hit, {
      headers: { "Cache-Control": "public, max-age=120, stale-while-revalidate=300" },
    });
  }
  let request$ = pending.get(key);
  if (!request$) {
    request$ = fetchObservations(coordinates.latitude, coordinates.longitude);
    pending.set(key, request$);
  }
  try {
    const data = await request$;
    // Cache only complete answers; partial failures are retried next time.
    if (data.observation && data.alerts) dataCache.set(key, data);
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, max-age=120, stale-while-revalidate=300" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "National Weather Service data is unavailable." },
      {
        status: error instanceof NwsError ? error.status : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } finally {
    pending.delete(key);
  }
}
