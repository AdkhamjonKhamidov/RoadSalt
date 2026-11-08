import { NextResponse, type NextRequest } from "next/server";
import { PersistentCache } from "../../lib/cache-db";
import type { Location } from "../../lib/data-types";
import { normalizeQuery, parsePhotonResponse, photonUrl } from "../../lib/geocoding";
import { coordinatesFromSearchParams } from "../../lib/validation";

// GET /api/geocode?q=<text>[&lat=..&lon=..] → { results: Location[] }
// Proxies Photon so results are cached server-side (repeated queries never hit
// the public instance twice within an hour) and requests carry a User-Agent.
// The client debounces typing and sends nothing for queries under 3 characters.

const REQUEST_TIMEOUT_MS = 8_000;
const cache = new PersistentCache<Location[]>("geocode", 500, 60 * 60 * 1000);
const pending = new Map<string, Promise<Location[]>>();

async function geocode(
  query: string,
  bias: { latitude: number; longitude: number } | undefined,
): Promise<Location[]> {
  let response: Response;
  try {
    response = await fetch(photonUrl(query, bias), {
      headers: { "User-Agent": "RoadSalt/0.1 (road salt awareness demo)" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    throw new Error(
      error instanceof Error && error.name === "TimeoutError"
        ? "Location search timed out. Please try again."
        : "Could not reach the location search service.",
    );
  }
  if (!response.ok) {
    throw new Error(
      response.status === 429
        ? "Location search is temporarily rate-limited. Please wait a moment."
        : `Location search service returned HTTP ${response.status}.`,
    );
  }
  return parsePhotonResponse(await response.json());
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const query = normalizeQuery(params.get("q"));
  if (!query) {
    return NextResponse.json(
      { error: "Enter at least 3 characters to search." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  // Optional bias toward the current map area; rounded so it barely affects caching.
  const coordinates = coordinatesFromSearchParams(params);
  const bias = coordinates
    ? {
        latitude: Math.round(coordinates.latitude * 10) / 10,
        longitude: Math.round(coordinates.longitude * 10) / 10,
      }
    : undefined;
  const key = `${query.toLowerCase()}|${bias ? `${bias.latitude},${bias.longitude}` : ""}`;

  const hit = cache.get(key);
  if (hit) {
    return NextResponse.json({ results: hit }, { headers: { "Cache-Control": "private, max-age=600" } });
  }
  let request$ = pending.get(key);
  if (!request$) {
    request$ = geocode(query, bias);
    pending.set(key, request$);
  }
  try {
    const results = await request$;
    cache.set(key, results);
    return NextResponse.json({ results }, { headers: { "Cache-Control": "private, max-age=600" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Location search failed." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    pending.delete(key);
  }
}
