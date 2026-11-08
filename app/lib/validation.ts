// Small runtime guards shared by every API parser. External payloads are
// always treated as `unknown` and narrowed here; nothing is filled in.

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Trimmed non-empty string, or null. */
export function text(value: unknown, maxLength = 500): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : null;
}

export function isLatitude(value: number): boolean {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

export function isLongitude(value: number): boolean {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

/**
 * Reads `lat`/`lon` query parameters. Returns null when either is missing or
 * out of range, so routes can answer 400 instead of querying a bad place.
 */
export function coordinatesFromSearchParams(
  params: URLSearchParams,
): { latitude: number; longitude: number } | null {
  const latitudeText = params.get("lat");
  const longitudeText = params.get("lon");
  if (latitudeText === null || longitudeText === null) return null;
  const latitude = Number(latitudeText);
  const longitude = Number(longitudeText);
  if (!isLatitude(latitude) || !isLongitude(longitude)) return null;
  return { latitude, longitude };
}

/** Cache key that treats points within ~100 m as the same place. */
export function coordinateKey(latitude: number, longitude: number): string {
  return `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
}

/** Small insertion-ordered cache with expiry and a size cap. */
export class ExpiringCache<V> {
  private readonly entries = new Map<string, { expiresAt: number; value: V }>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;

  constructor(maxEntries: number, ttlMs: number) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
  }

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /** `ttlMs` overrides the default lifetime (e.g. the time left on a stored entry). */
  set(key: string, value: V, ttlMs = this.ttlMs): void {
    this.entries.delete(key);
    this.entries.set(key, { expiresAt: Date.now() + ttlMs, value });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}
