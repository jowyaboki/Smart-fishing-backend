import { TideType } from './scoringEngine';

export { TideType };

/**
 * 5 Standard Data Quality Tiers for marine and tidal information
 */
export type DataQualityTier =
  | 'observed'
  | 'astronomical_forecast'
  | 'numerical_forecast'
  | 'estimated'
  | 'simulated';

/**
 * Standard units used across the Smart Fishing domain model
 */
export interface MarineUnits {
  waveHeight: 'm';
  wavePeriod: 's';
  waveDirection: 'degrees';
  windSpeed: 'km/h';
  windDirection: 'degrees';
  surfaceTemperature: 'celsius';
  pressure: 'hpa';
  tideHeight: 'm';
}

export const DEFAULT_MARINE_UNITS: MarineUnits = {
  waveHeight: 'm',
  wavePeriod: 's',
  waveDirection: 'degrees',
  windSpeed: 'km/h',
  windDirection: 'degrees',
  surfaceTemperature: 'celsius',
  pressure: 'hpa',
  tideHeight: 'm',
};

/**
 * Data provenance metadata attached to normalized domain results
 */
export interface DataProvenance {
  provider: string;
  retrievedAt: string; // ISO 8601
  quality: DataQualityTier;
  stationId?: string;
  stationName?: string;
  coordinates: {
    latitude: number;
    longitude: number;
  };
  units: Record<string, string>;
  isSimulatedFallback: boolean;
  confidenceScore: number; // 0.0 - 1.0
  isStale?: boolean;
  disclaimer?: string;
}

/**
 * Hourly environmental condition normalized domain model
 */
export interface HourlyMarineCondition {
  time: string; // ISO 8601
  waveHeightMeters: number;
  wavePeriodSeconds: number;
  waveDirectionDegrees: number;
  windSpeedKmh: number;
  windDirectionDegrees: number;
  surfaceTemperatureCelsius: number;
  pressureHpa: number;
}

/**
 * Daily aggregated marine summary
 */
export interface DailyMarineSummary {
  maxWaveHeight: number;
  minWaveHeight: number;
  avgWindSpeed: number;
  recommendedTime: string;
}

/**
 * Normalized domain model for marine forecasts
 */
export interface NormalizedMarineForecast {
  location: {
    latitude: number;
    longitude: number;
    name?: string;
  };
  hourly: HourlyMarineCondition[];
  dailySummary: DailyMarineSummary;
  provenance: DataProvenance;
}

/**
 * Tide event (High or Low inflection point)
 */
export interface TideEvent {
  time: string; // ISO 8601
  type: TideType;
  heightMeters: number;
}

/**
 * Solunar cycle and fishing rating information
 */
export interface SolunarRating {
  moonPhase: string;
  moonIlluminationPercentage: number;
  rating: number; // 0 - 100
  majorPeriods: string[];
  minorPeriods: string[];
}

/**
 * Normalized domain model for tide and solunar predictions
 */
export interface NormalizedTidePrediction {
  location: {
    latitude: number;
    longitude: number;
  };
  date: string; // YYYY-MM-DD
  currentTide: {
    type: TideType;
    heightMeters: number;
  };
  tideEvents: TideEvent[];
  solunar: SolunarRating;
  provenance: DataProvenance;
  disclaimer?: string;
}

/**
 * Query parameters for fetching marine forecasts
 */
export interface MarineForecastParams {
  latitude: number;
  longitude: number;
  days?: number;
  timeoutMs?: number;
}

/**
 * Query parameters for fetching tide predictions
 */
export interface TidePredictionParams {
  latitude: number;
  longitude: number;
  targetDate: Date;
  timeoutMs?: number;
}

/**
 * Provider interface for external/internal marine forecasts
 */
export interface IMarineForecastProvider {
  readonly providerId: string;
  getForecast(params: MarineForecastParams): Promise<NormalizedMarineForecast>;
  isAvailable(): Promise<boolean>;
}

/**
 * Provider interface for external/internal tide predictions
 */
export interface ITidePredictionProvider {
  readonly providerId: string;
  getTidePrediction(params: TidePredictionParams): Promise<NormalizedTidePrediction>;
  isAvailable(): Promise<boolean>;
}

/**
 * Standard typed domain errors for provider operations
 */
export class MarineProviderError extends Error {
  public readonly providerId: string;
  public readonly statusCode?: number;

  constructor(message: string, providerId: string, statusCode?: number) {
    super(`[${providerId}] ${message}`);
    this.name = 'MarineProviderError';
    this.providerId = providerId;
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, MarineProviderError.prototype);
  }
}

export class MarineProviderTimeoutError extends MarineProviderError {
  constructor(providerId: string, timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`, providerId, 408);
    this.name = 'MarineProviderTimeoutError';
    Object.setPrototypeOf(this, MarineProviderTimeoutError.prototype);
  }
}

/**
 * Public compatibility DTOs matching current Android client expectations
 */
export interface MarineForecastQuery {
  latitude: number;
  longitude: number;
  days?: number;
}

export interface MarineForecastResponse {
  location: {
    latitude: number;
    longitude: number;
    name?: string;
  };
  hourly: Array<{
    time: string;
    waveHeightMeters: number;
    wavePeriodSeconds: number;
    waveDirectionDegrees: number;
    windSpeedKmh: number;
    windDirectionDegrees: number;
    surfaceTemperatureCelsius: number;
    pressureHpa: number;
  }>;
  dailySummary: {
    maxWaveHeight: number;
    minWaveHeight: number;
    avgWindSpeed: number;
    recommendedTime: string;
  };
  provenance?: DataProvenance;
}

export interface TidePredictionResponse {
  location: {
    latitude: number;
    longitude: number;
  };
  date: string;
  currentTide: {
    type: TideType;
    heightMeters: number;
  };
  tideEvents: TideEvent[];
  solunar: {
    moonPhase: string;
    moonIlluminationPercentage: number;
    rating: number;
    majorPeriods: string[];
    minorPeriods: string[];
  };
  provenance?: DataProvenance;
  disclaimer?: string;
}

/**
 * Mapping helper functions between Domain Models and Public API DTOs
 */
export function mapForecastToResponse(forecast: NormalizedMarineForecast): MarineForecastResponse {
  return {
    location: forecast.location,
    hourly: forecast.hourly,
    dailySummary: forecast.dailySummary,
    provenance: forecast.provenance,
  };
}

export function mapTidesToResponse(tides: NormalizedTidePrediction): TidePredictionResponse {
  return {
    location: tides.location,
    date: tides.date,
    currentTide: tides.currentTide,
    tideEvents: tides.tideEvents,
    solunar: tides.solunar,
    provenance: tides.provenance,
    disclaimer: tides.disclaimer,
  };
}
