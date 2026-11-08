/**
 * Deterministic, normalized cache key generation for marine requests
 */

export function normalizeCoord(val: number): number {
  return Math.round(val * 100) / 100;
}

export function getForecastCacheKey(
  latitude: number,
  longitude: number,
  days: number,
  providerId = 'open-meteo'
): string {
  const lat = normalizeCoord(latitude);
  const lon = normalizeCoord(longitude);
  const d = Math.min(7, Math.max(1, Math.round(days)));
  return `forecast:${providerId}:${lat}:${lon}:${d}`;
}

export function getTidesCacheKey(
  latitude: number,
  longitude: number,
  isoDate: string,
  providerId = 'moroccan-harmonic-engine'
): string {
  const lat = normalizeCoord(latitude);
  const lon = normalizeCoord(longitude);
  const cleanDate = isoDate.split('T')[0];
  return `tides:${providerId}:${lat}:${lon}:${cleanDate}`;
}
