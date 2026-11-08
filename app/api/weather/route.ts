import { NextResponse, type NextRequest } from "next/server";
import { PersistentCache } from "../../lib/cache-db";
import type { WeatherData } from "../../lib/data-types";
import { openMeteoUrl, parseOpenMeteo } from "../../lib/open-meteo";
import {
  coordinateKey,
  coordinatesFromSearchParams,
} from "../../lib/validation";

// GET /api/weather?lat=..&lon=.. → current conditions + next 24 hours.
const REQUEST_TIMEOUT_MS = 15_000;
const cache = new PersistentCache<WeatherData>("weather", 200, 10 * 60 * 1000);
const pending = new Map<string, Promise<WeatherData>>();

class WeatherProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function fetchWeather(latitude: number, longitude: number): Promise<WeatherData> {
  let response: Response;
  try {
    response = await fetch(openMeteoUrl(latitude, longitude), {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    throw new WeatherProviderError(
      error instanceof Error && error.name === "TimeoutError"
        ? "Open-Meteo request timed out. Please try again shortly."
        : "Could not retrieve weather data from Open-Meteo.",
      error instanceof Error && error.name === "TimeoutError" ? 504 : 503,
    );
  }
  if (!response.ok) {
    throw new WeatherProviderError(
      `Open-Meteo returned HTTP ${response.status}.`,
      response.status === 429 ? 429 : 502,
    );
  }
  try {
    return parseOpenMeteo(await response.json());
  } catch (error) {
    throw new WeatherProviderError(
      error instanceof Error ? error.message : "Open-Meteo returned invalid data.",
      502,
    );
  }
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
    return NextResponse.json(hit, {
      headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=600" },
    });
  }

  let request$ = pending.get(key);
  if (!request$) {
    request$ = fetchWeather(coordinates.latitude, coordinates.longitude);
    pending.set(key, request$);
  }
  try {
    const data = await request$;
    cache.set(key, data);
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=600" },
    });
  } catch (error) {
    const status = error instanceof WeatherProviderError ? error.status : 503;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not retrieve weather data." },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    pending.delete(key);
  }
}
