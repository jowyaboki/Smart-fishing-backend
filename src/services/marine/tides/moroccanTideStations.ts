/**
 * Calibrated Moroccan coastal reference tidal stations
 * Based on hydrographic survey constituents along Morocco's coastline.
 */

export interface MoroccanTideStation {
  id: string;
  name: string;
  region: 'Mediterranean' | 'Atlantic North' | 'Atlantic Central' | 'Atlantic South' | 'Sahara';
  latitude: number;
  longitude: number;
  /** Mean tide level in meters above chart datum */
  meanLevelMeters: number;
  /** Semi-diurnal amplitude in meters (half of tidal range) */
  meanAmplitudeMeters: number;
  /** Spring tidal range in meters */
  springRangeMeters: number;
  /** Neap tidal range in meters */
  neapRangeMeters: number;
  /** High water lunitidal interval in decimal hours */
  lunitidalIntervalHours: number;
}

export const MOROCCAN_TIDE_STATIONS: MoroccanTideStation[] = [
  {
    id: 'tanger-med',
    name: 'Tanger Med / Strait of Gibraltar',
    region: 'Mediterranean',
    latitude: 35.89,
    longitude: -5.50,
    meanLevelMeters: 1.10,
    meanAmplitudeMeters: 0.50,
    springRangeMeters: 1.35,
    neapRangeMeters: 0.70,
    lunitidalIntervalHours: 1.25,
  },
  {
    id: 'casablanca-port',
    name: 'Casablanca Port / Central Atlantic',
    region: 'Atlantic Central',
    latitude: 33.60,
    longitude: -7.60,
    meanLevelMeters: 2.10,
    meanAmplitudeMeters: 1.40,
    springRangeMeters: 3.70,
    neapRangeMeters: 1.60,
    lunitidalIntervalHours: 2.10,
  },
  {
    id: 'essaouira-bay',
    name: 'Essaouira Bay / Atlantic South-Central',
    region: 'Atlantic Central',
    latitude: 31.51,
    longitude: -9.77,
    meanLevelMeters: 2.00,
    meanAmplitudeMeters: 1.30,
    springRangeMeters: 3.40,
    neapRangeMeters: 1.50,
    lunitidalIntervalHours: 2.30,
  },
  {
    id: 'agadir-port',
    name: 'Agadir Port / Souss Coast',
    region: 'Atlantic South',
    latitude: 30.42,
    longitude: -9.62,
    meanLevelMeters: 1.95,
    meanAmplitudeMeters: 1.20,
    springRangeMeters: 3.20,
    neapRangeMeters: 1.40,
    lunitidalIntervalHours: 2.45,
  },
  {
    id: 'dakhla-bay',
    name: 'Dakhla Peninsula / Sahara Coast',
    region: 'Sahara',
    latitude: 23.72,
    longitude: -15.93,
    meanLevelMeters: 1.70,
    meanAmplitudeMeters: 1.00,
    springRangeMeters: 2.70,
    neapRangeMeters: 1.20,
    lunitidalIntervalHours: 2.80,
  },
];

/**
 * Calculates Great-Circle distance between two coordinates in kilometers using Haversine formula
 */
export function calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

export interface NearestStationResult {
  station: MoroccanTideStation;
  distanceKm: number;
  isWithinMoroccanWaters: boolean;
}

/**
 * Finds the nearest Moroccan reference tide station to the given coordinates
 */
export function findNearestTideStation(latitude: number, longitude: number): NearestStationResult {
  let nearest = MOROCCAN_TIDE_STATIONS[0];
  let minDistance = Infinity;

  for (const station of MOROCCAN_TIDE_STATIONS) {
    const dist = calculateDistanceKm(latitude, longitude, station.latitude, station.longitude);
    if (dist < minDistance) {
      minDistance = dist;
      nearest = station;
    }
  }

  // Moroccan coastal coverage radius is considered within 250 km of our calibrated reference ports
  const isWithinMoroccanWaters = minDistance <= 250;

  return {
    station: nearest,
    distanceKm: minDistance,
    isWithinMoroccanWaters,
  };
}
