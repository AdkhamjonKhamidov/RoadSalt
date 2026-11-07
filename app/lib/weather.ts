import type { WeatherData } from "./data-types";

export type WeatherAttention = "Low" | "Moderate" | "Elevated" | "Insufficient data";

export function classifyWeatherAttention(
  weather: WeatherData | null,
): WeatherAttention {
  if (!weather || weather.hourly.length === 0) return "Insufficient data";

  let nearFreezingPrecipitation = false;
  let freezingPrecipitation = false;
  for (const hour of weather.hourly) {
    const hasPrecipitation =
      hour.precipitation >= 0.1 ||
      hour.snowfall >= 0.1 ||
      hour.precipitationProbability >= 40;
    if (!hasPrecipitation) continue;
    if (hour.temperature <= 0) {
      freezingPrecipitation = true;
    } else if (hour.temperature <= 3) {
      nearFreezingPrecipitation = true;
    }
  }

  if (freezingPrecipitation) return "Elevated";
  if (nearFreezingPrecipitation) return "Moderate";
  return "Low";
}

export function describeWeatherCode(code: number): string {
  if (code === 0) return "Clear";
  if ([1, 2, 3].includes(code)) return "Cloudy";
  if ([45, 48].includes(code)) return "Fog";
  if ([51, 53, 55, 56, 57].includes(code)) return "Drizzle";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "Rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Snow";
  if (code >= 95) return "Thunderstorm";
  return "Variable conditions";
}

export function describePrecipitation(
  weather: WeatherData,
): string {
  if (weather.current.precipitation > 0.05) return "Precipitating now";
  if (weather.hourly.some((hour) => hour.snowfall >= 0.1)) {
    return "Snow in forecast";
  }
  if (
    weather.hourly.some(
      (hour) => hour.precipitationProbability >= 40 || hour.precipitation >= 0.1,
    )
  ) {
    return "Precipitation possible";
  }
  return "No precipitation indicated";
}

export function forecastHours(weather: WeatherData) {
  const currentHour = weather.current.time.slice(0, 13);
  const start = weather.hourly.findIndex((hour) =>
    hour.time.startsWith(currentHour),
  );
  const available = start < 0 ? weather.hourly : weather.hourly.slice(start);
  return available.filter((_, index) => index % 3 === 0).slice(0, 8);
}
