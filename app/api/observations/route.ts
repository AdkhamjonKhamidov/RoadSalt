import { NextResponse, type NextRequest } from "next/server";
import { PersistentCache } from "../../lib/cache-db";
import type { ObservationData } from "../../lib/data-types";
import { NWS_BASE, parseAlerts, parseObservation } from "../../lib/nws";
import { NwsError, nwsJson, nwsPlace } from "../../lib/nws-server";
import {
  coordinateKey,
  coordinatesFromSearchParams,
} from "../../lib/validation";

// GET /api/observations?lat=..&lon=.. → measured conditions from the nearest
// NWS station plus active alerts for the point. US locations only.

const OBSERVATION_STALE_MS = 2 * 60 * 60 * 1000;
const dataCache = new PersistentCache<ObservationData>("observations", 200, 5 * 60 * 1000);
const pending = new Map<string, Promise<ObservationData>>();

async function fetchObservations(latitude: number, longitude: number): Promise<ObservationData> {
  const reason = (result: PromiseRejectedResult) =>
    result.reason instanceof Error ? result.reason.message : "Unavailable.";
  const [placeResult, alertsResult] = await Promise.allSettled([
    nwsPlace(latitude, longitude),
    nwsJson(`${NWS_BASE}/alerts/active?point=${latitude.toFixed(4)},${longitude.toFixed(4)}`).then(parseAlerts),
  ]);
  if (placeResult.status === "rejected" && alertsResult.status === "rejected") {
    throw placeResult.reason instanceof NwsError
      ? placeResult.reason
      : new NwsError("National Weather Service data is unavailable.", 503);
  }

  let observation: ObservationData["observation"] = null;
  let observationError: string | null = null;
  if (placeResult.status === "fulfilled") {
    try {
      observation = parseObservation(
        await nwsJson(`${NWS_BASE}/stations/${placeResult.value.station.id}/observations/latest`),
      );
    } catch (error) {
      observationError = error instanceof Error ? error.message : "Unavailable.";
    }
  } else {
    observationError = reason(placeResult);
  }

  return {
    stationId: placeResult.status === "fulfilled" ? placeResult.value.station.id : null,
    stationName: placeResult.status === "fulfilled" ? placeResult.value.station.name : null,
    observation,
    observationError,
    observationStale:
      observation !== null && Date.now() - Date.parse(observation.timestamp) > OBSERVATION_STALE_MS,
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
