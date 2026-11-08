import { DataProvenance, DataQualityTier, DataStatus } from './marineModels';

/**
 * Supported Vertical Datums in Hydrographic Observations
 * LAT: Lowest Astronomical Tide (common international hydrographic standard)
 * CD: Chart Datum (local port hydrographic soundings zero)
 * MSL: Mean Sea Level
 * ZH: Zéro Hydrographique (French/Moroccan SHOM/ANP standard reference)
 */
export type VerticalDatum = 'LAT' | 'CD' | 'MSL' | 'ZH';

export const SUPPORTED_VERTICAL_DATUMS: readonly VerticalDatum[] = [
  'LAT',
  'CD',
  'MSL',
  'ZH',
] as const;

/**
 * Permitted observation measurement units
 */
export type ObservationUnit = 'm' | 'cm' | 'ft' | 'mm';

export const SUPPORTED_OBSERVATION_UNITS: readonly ObservationUnit[] = [
  'm',
  'cm',
  'ft',
  'mm',
] as const;

/**
 * Status of a hydrographic tidal monitoring station
 */
export type StationOperationalStatus = 'ACTIVE' | 'INACTIVE' | 'DECOMMISSIONED';

/**
 * Hydrographic station representing a coastal tide gauge location
 */
export interface HydrographicStation {
  id: string;
  name: string;
  region: 'Mediterranean' | 'Atlantic North' | 'Atlantic Central' | 'Atlantic South' | 'Sahara';
  latitude: number;
  longitude: number;
  verticalDatum: VerticalDatum;
  referenceOffsetMeters?: number; // Offset from MSL or national benchmark in meters
  sensorType?: string; // e.g. 'Radar', 'Pressure Gauge', 'Acoustic', 'Stilling Well'
  status: StationOperationalStatus;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Normalized hydrographic sea level observation domain model
 */
export interface HydrographicObservation {
  id: string; // Unique UUID or deterministic hash
  stationId: string;
  timestampUtc: string; // Normalized ISO 8601 UTC string (e.g. 2026-11-08T12:00:00.000Z)
  waterLevelMeters: number; // Normalized water level in standard meters
  verticalDatum: VerticalDatum; // Datum relative to which water level is measured
  rawValue: number; // Raw recorded numeric value before unit normalization
  rawUnit: ObservationUnit; // Raw recorded unit
  qualityTier: DataQualityTier; // Strictly 'observed' for physical telemetry
  dataStatus: DataStatus; // Strictly 'observation'
  provenance: DataProvenance;
  importBatchId?: string; // Tracking ID of the ingestion batch
  createdAt?: string;
}

/**
 * Ingestion Options configuring the CSV ingestion engine
 */
export interface CsvIngestionOptions {
  stationId?: string; // Fallback stationId if not in CSV columns
  delimiter?: string; // Delimiter character: ',', ';', '\t' (auto-detected if omitted)
  timestampColumn?: string; // Header name for timestamp (e.g. 'timestamp', 'time', 'date')
  waterLevelColumn?: string; // Header name for water level (e.g. 'water_level', 'height', 'hauteur')
  stationIdColumn?: string; // Optional header name for station ID
  verticalDatumColumn?: string; // Optional header name for vertical datum
  unitColumn?: string; // Optional header name for unit
  defaultVerticalDatum?: VerticalDatum; // Fallback datum if not present in row
  defaultUnit?: ObservationUnit; // Fallback unit if not present in row (default: 'm')
  sourceProvider?: string; // Name of external data provider/agency (e.g. 'ANP', 'Marine Royale', 'IOC')
  dateFormat?: 'iso' | 'auto' | 'sql' | 'dmy' | 'mdy'; // Datetime parsing strategy
  ignoreDuplicates?: boolean; // If true, ignore rows matching (stationId, timestampUtc) instead of failing
  continueOnError?: boolean; // If true, collect row errors and continue processing
  minWaterLevelMeters?: number; // Physical threshold filter (default -2.0m)
  maxWaterLevelMeters?: number; // Physical threshold filter (default +12.0m)
}

/**
 * Result of a single row validation/normalization
 */
export interface NormalizedObservationRow {
  stationId: string;
  timestampUtc: string;
  waterLevelMeters: number;
  verticalDatum: VerticalDatum;
  rawValue: number;
  rawUnit: ObservationUnit;
  qualityTier: DataQualityTier;
  dataStatus: DataStatus;
}

/**
 * Error detail for an invalid row encountered during CSV ingestion
 */
export interface IngestionRowError {
  rowNumber: number;
  rawRow: Record<string, string>;
  reason: string;
  field?: string;
}

/**
 * Comprehensive summary of an ingestion batch execution
 */
export interface IngestionSummary {
  batchId: string;
  filename?: string;
  stationId?: string;
  totalRows: number;
  importedCount: number;
  duplicateCount: number;
  errorCount: number;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  startedAt: string;
  completedAt: string;
  errors: IngestionRowError[];
}

/**
 * Data Quality Analysis Report for a Hydrographic Station
 */
export interface HydrographicQualityReport {
  stationId: string;
  stationName: string;
  verticalDatum: VerticalDatum;
  totalObservations: number;
  firstObservationUtc: string | null;
  lastObservationUtc: string | null;
  observationSpanDays: number;
  minWaterLevelMeters: number | null;
  maxWaterLevelMeters: number | null;
  averageWaterLevelMeters: number | null;
  /**
   * Calibration readiness check: requires >= 720 valid hourly observations
   * spanning at least 29.53 days (synodic lunar month)
   */
  calibrationReadiness: {
    hasSufficientObservations: boolean; // >= 720
    hasSufficientTimeSpan: boolean; // >= 29.53 days
    isDatumValidated: boolean;
    isCalibrationEnabled: false; // Strictly false: calibration remains disabled until validated
    reasons: string[];
  };
}

/**
 * Minimum and maximum plausible astronomical water level thresholds for Moroccan coastal waters
 */
export const MOROCCAN_WATER_LEVEL_BOUNDS = {
  MIN_METERS: -2.0,
  MAX_METERS: 12.0,
};

/**
 * Minimum observations and duration required for tidal harmonic calibration
 */
export const CALIBRATION_REQUIREMENTS = {
  MIN_OBSERVATIONS: 720, // 30 days * 24 hours
  MIN_SPAN_DAYS: 29.53, // Synodic lunar month
};

export class HydrographicValidationError extends Error {
  public readonly field?: string;
  constructor(message: string, field?: string) {
    super(`[HydrographicValidation] ${message}`);
    this.name = 'HydrographicValidationError';
    this.field = field;
    Object.setPrototypeOf(this, HydrographicValidationError.prototype);
  }
}

/**
 * Validates and converts any supported measurement unit to standard meters
 */
export function normalizeWaterLevelToMeters(value: number, unit: string): number {
  if (typeof value !== 'number' || isNaN(value)) {
    throw new HydrographicValidationError(`Invalid numeric water level: ${value}`, 'waterLevel');
  }

  const normalizedUnit = unit.trim().toLowerCase();

  switch (normalizedUnit) {
    case 'm':
    case 'meter':
    case 'meters':
    case 'metre':
    case 'metres':
      return Math.round(value * 1000) / 1000;
    case 'cm':
    case 'centimeter':
    case 'centimeters':
      return Math.round((value / 100) * 1000) / 1000;
    case 'mm':
    case 'millimeter':
    case 'millimeters':
      return Math.round((value / 1000) * 1000) / 1000;
    case 'ft':
    case 'feet':
    case 'foot':
      // 1 foot = 0.3048 meters
      return Math.round((value * 0.3048) * 1000) / 1000;
    default:
      throw new HydrographicValidationError(
        `Unsupported unit: '${unit}'. Supported units: ${SUPPORTED_OBSERVATION_UNITS.join(', ')}`,
        'unit'
      );
  }
}

/**
 * Validates vertical datum against supported datums
 */
export function validateVerticalDatum(datum: string): VerticalDatum {
  if (!datum || typeof datum !== 'string') {
    throw new HydrographicValidationError('Vertical datum is required', 'verticalDatum');
  }
  const cleanDatum = datum.trim().toUpperCase() as VerticalDatum;
  if (!SUPPORTED_VERTICAL_DATUMS.includes(cleanDatum)) {
    throw new HydrographicValidationError(
      `Unsupported vertical datum: '${datum}'. Supported datums: ${SUPPORTED_VERTICAL_DATUMS.join(', ')}`,
      'verticalDatum'
    );
  }
  return cleanDatum;
}

/**
 * Strict UTC timestamp normalizer
 * Parses ISO 8601, UNIX timestamps (s/ms), or standard hydrographic strings (YYYY-MM-DD HH:mm:ss)
 * and produces a verified UTC ISO string with trailing 'Z'.
 */
export function normalizeTimestampToUtc(rawTimestamp: string | number | Date): string {
  if (rawTimestamp === null || rawTimestamp === undefined || rawTimestamp === '') {
    throw new HydrographicValidationError('Timestamp cannot be empty', 'timestamp');
  }

  let date: Date;

  if (rawTimestamp instanceof Date) {
    date = rawTimestamp;
  } else if (typeof rawTimestamp === 'number') {
    // If epoch seconds vs milliseconds
    if (rawTimestamp < 1e11) {
      date = new Date(rawTimestamp * 1000);
    } else {
      date = new Date(rawTimestamp);
    }
  } else if (typeof rawTimestamp === 'string') {
    const trimmed = rawTimestamp.trim();

    // Check if numeric string
    if (/^\d{10}(\d{3})?$/.test(trimmed)) {
      const num = Number(trimmed);
      return normalizeTimestampToUtc(num);
    }

    // Standard SQL hydrographic format: "2026-11-08 14:30:00" -> treat as UTC unless offset specified
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(trimmed)) {
      const isoStandard = trimmed.replace(' ', 'T') + 'Z';
      date = new Date(isoStandard);
    } else {
      date = new Date(trimmed);
    }
  } else {
    throw new HydrographicValidationError('Unsupported timestamp type', 'timestamp');
  }

  if (isNaN(date.getTime())) {
    throw new HydrographicValidationError(`Invalid timestamp format: '${rawTimestamp}'`, 'timestamp');
  }

  // Range validation: sensible historical to near-future observation range (1970 to 2100)
  const year = date.getUTCFullYear();
  if (year < 1970 || year > 2100) {
    throw new HydrographicValidationError(
      `Timestamp year ${year} is outside plausible hydrographic bounds (1970-2100)`,
      'timestamp'
    );
  }

  return date.toISOString();
}

/**
 * Validates water level physical plausibility for Moroccan coastal regimes
 */
export function validateWaterLevelBounds(
  waterLevelMeters: number,
  min: number = MOROCCAN_WATER_LEVEL_BOUNDS.MIN_METERS,
  max: number = MOROCCAN_WATER_LEVEL_BOUNDS.MAX_METERS
): void {
  if (typeof waterLevelMeters !== 'number' || isNaN(waterLevelMeters)) {
    throw new HydrographicValidationError(`Water level must be a valid number: ${waterLevelMeters}`, 'waterLevel');
  }

  if (waterLevelMeters < min || waterLevelMeters > max) {
    throw new HydrographicValidationError(
      `Water level ${waterLevelMeters}m is outside physical threshold [${min}m, ${max}m]`,
      'waterLevel'
    );
  }
}
