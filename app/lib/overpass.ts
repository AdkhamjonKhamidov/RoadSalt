import { DEMO_CENTER, SEARCH_RADIUS_METERS } from "./demo-config";
import { coordinateKey } from "./validation";
import type { MapData } from "./data-types";
import { overpassQuery, overpassToGeoJSON } from "./geojson";

// Shared by the browser loader (used by the dashboard) and the server route.
// Both public instances send CORS headers, so browsers can query them directly.
export const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
// One deadline for the whole request, including downloading the geometry and
// any retries. Keep it above the server-side [timeout:...] in overpassQuery.
export const OVERPASS_DEADLINE_MS = 25_000;
// Busy instances answer 429 or 502/504 ("at capacity, request queue is full")
// and ask clients to retry with exponential backoff.
const FIRST_RETRY_DELAY_MS = 2_000;

export class OverpassError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "OverpassError";
  }
}

type FetchOptions = {
  /** Center of the query box; defaults to the configured demo location. */
  latitude?: number;
  longitude?: number;
  /** Extra request headers. Browsers forbid setting User-Agent; servers should. */
  headers?: Record<string, string>;
  /** Aborts the request early, e.g. when a React effect is cleaned up. */
  signal?: AbortSignal;
  /** Called once per instance that fails before another one succeeds. */
  onEndpointFailure?: (endpoint: string, reason: string) => void;
};

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function fetchFromEndpoint(
  endpoint: string,
  query: string,
  signal: AbortSignal,
  headers: Record<string, string>,
): Promise<MapData> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...headers,
    },
    body: `data=${encodeURIComponent(query)}`,
    signal,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new OverpassError(
      response.status === 429
        ? "OpenStreetMap data is temporarily rate-limited. Please try again shortly."
        : response.status >= 500
          ? `OpenStreetMap data servers are busy (HTTP ${response.status}). Please try again shortly.`
          : `OpenStreetMap data service returned HTTP ${response.status}.`,
      response.status === 429 ? 429 : response.status >= 500 ? 503 : 502,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    if (signal.aborted) throw error;
    throw new OverpassError(
      "OpenStreetMap data service returned invalid JSON.",
      502,
    );
  }
  try {
    return overpassToGeoJSON(payload);
  } catch (error) {
    // e.g. an Overpass "remark" reporting a server-side timeout.
    throw new OverpassError(
      error instanceof Error ? error.message : "Invalid OpenStreetMap data.",
      502,
    );
  }
}

/**
 * Queries the public Overpass instances in parallel for the demo area and
 * returns the first valid result. Never returns sample data: every failure
 * becomes an OverpassError (or an AbortError if `signal` aborted).
 */
export async function fetchOverpassMapData(
  options: FetchOptions = {},
): Promise<MapData> {
  const latitude = options.latitude ?? DEMO_CENTER[1];
  const longitude = options.longitude ?? DEMO_CENTER[0];
  const query = overpassQuery(latitude, longitude, SEARCH_RADIUS_METERS);
  const deadline = AbortSignal.timeout(OVERPASS_DEADLINE_MS);
  const settled = new AbortController();
  const signal = AbortSignal.any(
    [deadline, settled.signal, options.signal].filter(
      (item): item is AbortSignal => item !== undefined,
    ),
  );

  // The most informative provider answer seen so far (e.g. "servers are
  // busy"), reported instead of a bare timeout if nothing succeeds.
  const providerErrors: OverpassError[] = [];

  const report = (endpoint: string, error: unknown) => {
    if (settled.signal.aborted || options.signal?.aborted) return;
    const reason = deadline.aborted
      ? `no response within ${OVERPASS_DEADLINE_MS / 1000}s`
      : error instanceof Error
        ? `${error.name}: ${error.message}${error.cause instanceof Error ? ` (${error.cause.message})` : ""}`
        : String(error);
    options.onEndpointFailure?.(endpoint, reason);
  };

  // Query every instance in parallel and keep the first valid answer. An
  // instance that says it is busy (429 / 5xx) is retried with exponential
  // backoff until the shared deadline, as the Overpass servers request.
  const attempts = OVERPASS_ENDPOINTS.map(async (endpoint) => {
    let delay = FIRST_RETRY_DELAY_MS;
    for (;;) {
      try {
        return await fetchFromEndpoint(
          endpoint,
          query,
          signal,
          options.headers ?? {},
        );
      } catch (error) {
        report(endpoint, error);
        const retryable =
          error instanceof OverpassError &&
          (error.status === 429 || error.status === 503);
        if (error instanceof OverpassError) providerErrors.push(error);
        if (!retryable) throw error;
        await abortableDelay(delay, signal);
        delay *= 2;
      }
    }
  });

  try {
    return await Promise.any(attempts);
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason;
    const errors = error instanceof AggregateError ? error.errors : [error];
    const overpassErrors = [
      ...errors.filter(
        (item): item is OverpassError => item instanceof OverpassError,
      ),
      ...providerErrors,
    ];
    if (deadline.aborted && overpassErrors.length === 0) {
      throw new OverpassError(
        "OpenStreetMap data request timed out. Please try again shortly.",
        504,
      );
    }
    throw (
      overpassErrors.find((item) => item.status === 429) ??
      overpassErrors.find((item) => item.status === 503) ??
      overpassErrors[0] ??
      new OverpassError(
        "Could not reach OpenStreetMap data services. Check your connection and try again.",
        503,
      )
    );
  } finally {
    settled.abort();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Structural check for MapData that came from storage or the network. */
export function parseMapData(value: unknown): MapData | null {
  if (
    !isRecord(value) ||
    !isRecord(value.roads) ||
    !Array.isArray(value.roads.features) ||
    !isRecord(value.environmentalFeatures) ||
    !Array.isArray(value.environmentalFeatures.features) ||
    typeof value.updatedAt !== "string" ||
    typeof value.source !== "string" ||
    !value.source.startsWith("OpenStreetMap") ||
    (typeof value.radiusMeters !== "number" && value.radiusMeters !== null)
  ) {
    return null;
  }
  return value as MapData;
}

// --- Browser loader with a short per-tab cache -------------------------------

const BROWSER_CACHE_PREFIX = "roadsalt:map-data:v2:";
const BROWSER_CACHE_MS = 15 * 60 * 1000;

function readBrowserCache(key: string): MapData | null {
  try {
    const raw = window.sessionStorage.getItem(BROWSER_CACHE_PREFIX + key);
    if (!raw) return null;
    const stored: unknown = JSON.parse(raw);
    if (!isRecord(stored) || typeof stored.expiresAt !== "number") return null;
    if (stored.expiresAt <= Date.now()) return null;
    const data = parseMapData(stored.data);
    // Same demo area only; a changed radius invalidates the cache.
    return data && data.radiusMeters === SEARCH_RADIUS_METERS ? data : null;
  } catch {
    return null;
  }
}

function writeBrowserCache(key: string, data: MapData): void {
  try {
    window.sessionStorage.setItem(
      BROWSER_CACHE_PREFIX + key,
      JSON.stringify({ expiresAt: Date.now() + BROWSER_CACHE_MS, data }),
    );
  } catch {
    // Storage full or blocked: the data is still shown, just not cached.
  }
}

/**
 * Loads live OSM map data directly from the browser. A successful result is
 * reused for 15 minutes in this tab (its original `updatedAt` is kept, so the
 * UI shows when OpenStreetMap was actually queried). `forceRefresh` skips it.
 */
export async function loadMapDataInBrowser(
  latitude: number,
  longitude: number,
  signal: AbortSignal,
  forceRefresh = false,
): Promise<MapData> {
  if (!forceRefresh) {
    const cached = readBrowserCache(coordinateKey(latitude, longitude));
    if (cached) return cached;
  }
  const data = await fetchOverpassMapData({
    latitude,
    longitude,
    signal,
    onEndpointFailure: (endpoint, reason) =>
      console.warn(`[map-data] ${new URL(endpoint).host} failed: ${reason}`),
  });
  writeBrowserCache(coordinateKey(latitude, longitude), data);
  return data;
}
