import { NextResponse } from "next/server";
import { DEMO_CENTER } from "../../lib/demo-config";
import type { WeatherData, WeatherHour } from "../../lib/data-types";

const CACHE_DURATION_MS = 10 * 60 * 1000;

let cached: { expiresAt: number; data: WeatherData } | undefined;
let pending: Promise<WeatherData> | undefined;

class WeatherProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function validateWeather(input: unknown): WeatherData {
  if (!isRecord(input) || !isRecord(input.current) || !isRecord(input.hourly)) {
    throw new WeatherProviderError("Open-Meteo returned an invalid response.", 502);
  }

  const current = input.current;
  const currentTemperature = finiteNumber(current.temperature_2m);
  const currentPrecipitation = finiteNumber(current.precipitation);
  const currentCode = finiteNumber(current.weather_code);
  const currentTime =
    typeof current.time === "string" && !Number.isNaN(Date.parse(current.time))
      ? current.time
      : null;

  if (
    currentTemperature === null ||
    currentPrecipitation === null ||
    currentCode === null ||
    currentCode < 0 ||
    currentCode > 99 ||
    currentTime === null
  ) {
    throw new WeatherProviderError(
      "Open-Meteo did not return usable current weather values.",
      502,
    );
  }

  const hourly = input.hourly;
  const times = hourly.time;
  const temperatures = hourly.temperature_2m;
  const probabilities = hourly.precipitation_probability;
  const precipitation = hourly.precipitation;
  const snowfall = hourly.snowfall;
  if (
    !Array.isArray(times) ||
    !Array.isArray(temperatures) ||
    !Array.isArray(probabilities) ||
    !Array.isArray(precipitation) ||
    !Array.isArray(snowfall)
  ) {
    throw new WeatherProviderError(
      "Open-Meteo did not return the hourly forecast fields.",
      502,
    );
  }

  const length = Math.min(
    times.length,
    temperatures.length,
    probabilities.length,
    precipitation.length,
    snowfall.length,
  );
  const hours: WeatherHour[] = [];
  for (let index = 0; index < length; index += 1) {
    const time = times[index];
    const temperature = finiteNumber(temperatures[index]);
    const probability = finiteNumber(probabilities[index]);
    const precipitationAmount = finiteNumber(precipitation[index]);
    const snowAmount = finiteNumber(snowfall[index]);
    if (
      typeof time !== "string" ||
      Number.isNaN(Date.parse(time)) ||
      temperature === null ||
      probability === null ||
      precipitationAmount === null ||
      snowAmount === null
    ) {
      continue;
    }
    hours.push({
      time,
      temperature,
      precipitationProbability: Math.max(0, Math.min(100, probability)),
      precipitation: Math.max(0, precipitationAmount),
      snowfall: Math.max(0, snowAmount),
    });
  }

  const currentHour = currentTime.slice(0, 13);
  const fromCurrentHour = hours.findIndex((hour) =>
    hour.time.startsWith(currentHour),
  );
  if (fromCurrentHour === -1) {
    throw new WeatherProviderError(
      "Open-Meteo returned no hourly forecast for the current time.",
      502,
    );
  }

  return {
    current: {
      time: currentTime,
      temperature: currentTemperature,
      precipitation: Math.max(0, currentPrecipitation),
      weatherCode: Math.trunc(currentCode),
    },
    hourly: hours.slice(fromCurrentHour, fromCurrentHour + 24),
    updatedAt: new Date().toISOString(),
    source: "Open-Meteo",
  };
}

async function fetchWeather(): Promise<WeatherData> {
  const [longitude, latitude] = DEMO_CENTER;
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: "temperature_2m,precipitation,weather_code",
    hourly:
      "temperature_2m,precipitation_probability,precipitation,snowfall",
    forecast_days: "2",
    timezone: "America/New_York",
  });
  try {
    const response = await fetch(
      `https://api.open-meteo.com/v1/forecast?${params.toString()}`,
      { signal: AbortSignal.timeout(15_000), next: { revalidate: 600 } },
    );
    if (!response.ok) {
      throw new WeatherProviderError(
        `Open-Meteo returned HTTP ${response.status}.`,
        response.status === 429 ? 429 : 502,
      );
    }
    return validateWeather(await response.json());
  } catch (error) {
    if (error instanceof WeatherProviderError) throw error;
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new WeatherProviderError(
        "Open-Meteo request timed out. Please try again shortly.",
        504,
      );
    }
    throw new WeatherProviderError(
      "Could not retrieve weather data from Open-Meteo.",
      503,
    );
  }
}

export async function GET() {
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.data, {
      headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=600" },
    });
  }

  pending ??= fetchWeather();
  try {
    const data = await pending;
    cached = { data, expiresAt: Date.now() + CACHE_DURATION_MS };
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=600" },
    });
  } catch (error) {
    const status = error instanceof WeatherProviderError ? error.status : 503;
    const message =
      error instanceof Error ? error.message : "Could not retrieve weather data.";
    return NextResponse.json(
      { error: message },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    pending = undefined;
  }
}
