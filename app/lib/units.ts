// Display-unit conversion. Data stays metric internally (as the APIs return
// it); only presentation converts. US customary units are the default.

export type UnitSystem = "imperial" | "metric";
export const DEFAULT_UNITS: UnitSystem = "imperial";
export const UNIT_STORAGE_KEY = "roadsalt:units";

export function celsiusToFahrenheit(celsius: number): number {
  return (celsius * 9) / 5 + 32;
}

export function fahrenheitToCelsius(fahrenheit: number): number {
  return ((fahrenheit - 32) * 5) / 9;
}

/** Temperature from °C. `null` (not reported) stays visible as such. */
export function formatTemperature(
  celsius: number | null,
  units: UnitSystem,
  digits = 0,
): string {
  if (celsius === null) return "Not reported";
  return units === "imperial"
    ? `${celsiusToFahrenheit(celsius).toFixed(digits)} °F`
    : `${celsius.toFixed(digits)} °C`;
}

/** Short temperature for compact places like the forecast strip. */
export function shortTemperature(celsius: number, units: UnitSystem): string {
  const value = units === "imperial" ? celsiusToFahrenheit(celsius) : celsius;
  return `${Math.round(value)}°`;
}

export function formatSpeed(kmh: number | null, units: UnitSystem): string {
  if (kmh === null) return "Not reported";
  return units === "imperial" ? `${(kmh * 0.621371).toFixed(0)} mph` : `${kmh.toFixed(0)} km/h`;
}

/** Liquid precipitation from millimetres. */
export function formatPrecipitation(mm: number | null, units: UnitSystem): string {
  if (mm === null) return "Not reported";
  return units === "imperial" ? `${(mm / 25.4).toFixed(2)} in` : `${mm.toFixed(1)} mm`;
}

/** Snowfall from centimetres (Open-Meteo reports snowfall in cm). */
export function formatSnowfall(cm: number, units: UnitSystem): string {
  return units === "imperial" ? `${(cm / 2.54).toFixed(1)} in snow` : `${cm.toFixed(1)} cm snow`;
}

export function formatVisibility(meters: number | null, units: UnitSystem): string {
  if (meters === null) return "Not reported";
  return units === "imperial"
    ? `${(meters / 1609.344).toFixed(1)} mi`
    : `${(meters / 1000).toFixed(1)} km`;
}

/** Short distances (proximity). Below 1 m reads as touching or crossing. */
export function formatDistance(meters: number, units: UnitSystem): string {
  if (meters < 1) return "touching or crossing";
  if (units === "imperial") {
    const feet = meters * 3.28084;
    return feet < 1000 ? `${Math.round(feet)} ft` : `${(meters / 1609.344).toFixed(1)} mi`;
  }
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

export function parseUnitSystem(value: unknown): UnitSystem | null {
  return value === "imperial" || value === "metric" ? value : null;
}
