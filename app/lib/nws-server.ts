import { NWS_BASE, parseNearestStation, parsePointInfo } from "./nws";
import { PersistentCache } from "./cache-db";
import { coordinateKey } from "./validation";

// Server-only helpers for api.weather.gov (imported by route handlers only).

export const NWS_HEADERS = {
  "User-Agent": "RoadSalt/0.1 (road salt awareness demo)",
  Accept: "application/geo+json",
};
const REQUEST_TIMEOUT_MS = 10_000;

export class NwsError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function nwsJson(url: string): Promise<unknown> {
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
    throw new NwsError("National Weather Service data is only available for United States locations.", 404);
  }
  if (!response.ok) {
    throw new NwsError(`National Weather Service returned HTTP ${response.status}.`, 502);
  }
  return response.json();
}

export type NwsPlace = {
  office: string;
  station: { id: string; name: string | null };
};

const placeCache = new PersistentCache<NwsPlace>("nws-points", 300, 24 * 60 * 60 * 1000);

/** Forecast office and nearest observation station for a US point (cached 24 h). */
export async function nwsPlace(latitude: number, longitude: number): Promise<NwsPlace> {
  const key = coordinateKey(latitude, longitude);
  const hit = placeCache.get(key);
  if (hit) return hit;
  const point = parsePointInfo(await nwsJson(`${NWS_BASE}/points/${latitude.toFixed(4)},${longitude.toFixed(4)}`));
  const station = parseNearestStation(await nwsJson(point.stationsUrl));
  const place = { office: point.office, station };
  placeCache.set(key, place);
  return place;
}
