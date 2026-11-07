import type { WeatherData, WeatherHour } from "./data-types";
import { finiteNumber, isRecord, text } from "./validation";

// Open-Meteo Forecast API (https://open-meteo.com), CC BY 4.0, no key.
// Called only from the /api/weather route.

export const OPEN_METEO_ENDPOINT = "https://api.open-meteo.com/v1/forecast";

export function openMeteoUrl(latitude: number, longitude: number): string {
  const params = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    current:
      "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,precipitation,weather_code",
    hourly: "temperature_2m,precipitation_probability,precipitation,snowfall",
    wind_speed_unit: "kmh",
    forecast_days: "2",
    // Times come back in the location's own time zone.
    timezone: "auto",
  });
  return `${OPEN_METEO_ENDPOINT}?${params.toString()}`;
}

function validTime(value: unknown): string | null {
  const time = text(value, 40);
  return time && !Number.isNaN(Date.parse(time)) ? time : null;
}

/**
 * Validates an Open-Meteo response and keeps the 24 hours starting at the
 * current hour. Required values missing → throws; optional current values
 * (apparent temperature, humidity, wind) missing → null, never invented.
 */
export function parseOpenMeteo(
  input: unknown,
  updatedAt = new Date().toISOString(),
): WeatherData {
  if (!isRecord(input) || !isRecord(input.current) || !isRecord(input.hourly)) {
    throw new Error("Open-Meteo returned an invalid response.");
  }
  const latitude = finiteNumber(input.latitude);
  const longitude = finiteNumber(input.longitude);
  const timezone = text(input.timezone, 80) ?? "GMT";

  const current = input.current;
  const currentTemperature = finiteNumber(current.temperature_2m);
  const currentPrecipitation = finiteNumber(current.precipitation);
  const currentCode = finiteNumber(current.weather_code);
  const currentTime = validTime(current.time);
  if (
    latitude === null ||
    longitude === null ||
    currentTemperature === null ||
    currentPrecipitation === null ||
    currentCode === null ||
    currentCode < 0 ||
    currentCode > 99 ||
    currentTime === null
  ) {
    throw new Error("Open-Meteo did not return usable current weather values.");
  }

  const hourly = input.hourly;
  const columns = [
    hourly.time,
    hourly.temperature_2m,
    hourly.precipitation_probability,
    hourly.precipitation,
    hourly.snowfall,
  ];
  if (!columns.every(Array.isArray)) {
    throw new Error("Open-Meteo did not return the hourly forecast fields.");
  }
  const [times, temperatures, probabilities, precipitation, snowfall] = columns as unknown[][];
  const length = Math.min(...columns.map((column) => (column as unknown[]).length));
  const hours: WeatherHour[] = [];
  for (let index = 0; index < length; index += 1) {
    const time = validTime(times[index]);
    const temperature = finiteNumber(temperatures[index]);
    const probability = finiteNumber(probabilities[index]);
    const amount = finiteNumber(precipitation[index]);
    const snow = finiteNumber(snowfall[index]);
    // Skip incomplete hours rather than filling gaps.
    if (time === null || temperature === null || probability === null || amount === null || snow === null) {
      continue;
    }
    hours.push({
      time,
      temperature,
      precipitationProbability: Math.max(0, Math.min(100, probability)),
      precipitation: Math.max(0, amount),
      snowfall: Math.max(0, snow),
    });
  }

  const currentHour = currentTime.slice(0, 13);
  const start = hours.findIndex((hour) => hour.time.startsWith(currentHour));
  if (start === -1) {
    throw new Error("Open-Meteo returned no hourly forecast for the current time.");
  }

  const humidity = finiteNumber(current.relative_humidity_2m);
  const wind = finiteNumber(current.wind_speed_10m);
  return {
    latitude,
    longitude,
    timezone,
    current: {
      time: currentTime,
      temperature: currentTemperature,
      apparentTemperature: finiteNumber(current.apparent_temperature),
      relativeHumidity: humidity === null ? null : Math.max(0, Math.min(100, humidity)),
      windSpeed: wind === null ? null : Math.max(0, wind),
      precipitation: Math.max(0, currentPrecipitation),
      weatherCode: Math.trunc(currentCode),
    },
    hourly: hours.slice(start, start + 24),
    updatedAt,
    source: "Open-Meteo",
  };
}
