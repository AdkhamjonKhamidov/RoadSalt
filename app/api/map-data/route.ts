import { NextResponse } from "next/server";
import { DEMO_CENTER, SEARCH_RADIUS_METERS } from "../../lib/demo-config";
import { overpassQuery, overpassToGeoJSON } from "../../lib/geojson";
import type { MapData } from "../../lib/data-types";

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const CACHE_DURATION_MS = 15 * 60 * 1000;

let cached: { expiresAt: number; data: MapData } | undefined;
let pending: Promise<MapData> | undefined;

class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function fetchMapData(): Promise<MapData> {
  const [longitude, latitude] = DEMO_CENTER;
  const query = overpassQuery(latitude, longitude, SEARCH_RADIUS_METERS);
  let lastError: unknown;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "RoadSalt/0.1 (public Salisbury road awareness demo)",
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      });

      if (!response.ok) {
        const status =
          response.status === 429
            ? 429
            : response.status >= 500
              ? 503
              : 502;
        lastError = new ProviderError(
          response.status === 429
            ? "OpenStreetMap data is temporarily rate-limited. Please try again shortly."
            : `OpenStreetMap data service returned HTTP ${response.status}.`,
          status,
        );
        if (response.status < 500 && response.status !== 429) break;
        continue;
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new ProviderError(
          "OpenStreetMap data service returned invalid JSON.",
          502,
        );
      }
      return overpassToGeoJSON(payload);
    } catch (error) {
      if (error instanceof ProviderError) {
        lastError = error;
        if (error.status !== 429 && error.status !== 503) break;
      } else {
        lastError = error;
        if (error instanceof Error && error.name === "TimeoutError") break;
      }
    }
  }

  if (lastError instanceof ProviderError) throw lastError;
  if (lastError instanceof Error && lastError.name === "TimeoutError") {
    throw new ProviderError(
      "OpenStreetMap data request timed out. Please try again shortly.",
      504,
    );
  }
  throw new ProviderError(
    "Could not retrieve OpenStreetMap data. Check your connection and try again.",
    503,
  );
}

export async function GET() {
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.data, {
      headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=900" },
    });
  }

  pending ??= fetchMapData();
  try {
    const data = await pending;
    cached = { data, expiresAt: Date.now() + CACHE_DURATION_MS };
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=900" },
    });
  } catch (error) {
    const status = error instanceof ProviderError ? error.status : 503;
    const message =
      error instanceof Error
        ? error.message
        : "Could not retrieve OpenStreetMap data.";
    return NextResponse.json(
      { error: message },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    pending = undefined;
  }
}
