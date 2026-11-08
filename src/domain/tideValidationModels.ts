import { VerticalDatum } from './hydrographicModels';
import { DataQualityTier } from './marineModels';

/**
 * Empirical validation status classification
 */
export type EmpiricalValidationStatus =
  | 'NOT_VERIFIED'
  | 'SOFTWARE_TESTED'
  | 'INTEGRATION_VERIFIED'
  | 'EMPIRICALLY_VALIDATED';

/**
 * Data suitability classification for empirical tidal validation
 */
export type DataSuitabilityClassification = 'SUITABLE' | 'MARGINAL' | 'UNSUITABLE';

/**
 * Vertical Datum verification status
 * CONFIGURED: datum populated from station configuration metadata
 * SOURCE_DECLARED: datum declared by data provider/source header
 * INDEPENDENTLY_VERIFIED: datum confirmed by certified physical hydrographic benchmark telemetry
 */
export type DatumVerificationStatus =
  | 'CONFIGURED'
  | 'SOURCE_DECLARED'
  | 'INDEPENDENTLY_VERIFIED';

/**
 * Explicit exclusion breakdown categories
 */
export interface ValidationExclusionCounters {
  DATUM_MISMATCH: number;
  DATUM_NOT_VERIFIED: number;
  INVALID_PROVENANCE: number;
  INVALID_UNIT: number;
  INVALID_COORDINATES: number;
  INVALID_TIMESTAMP: number;
  DUPLICATE_TIMESTAMP: number;
  OUT_OF_BOUNDS: number;
  INSUFFICIENT_COVERAGE: number;
}

/**
 * Represents an aligned comparison between an empirical observation and an astronomical prediction
 */
export interface ValidationObservationPair {
  timestampUtc: string;
  observedWaterLevelMeters: number;
  predictedWaterLevelMeters: number;
  residualMeters: number; // predicted - observed (Convention: predicted - observed gives model bias)
  verticalDatum: VerticalDatum;
  qualityTier: DataQualityTier;
}

/**
 * Key error statistics computed on residual series (predicted - observed)
 */
export interface StatisticalMetrics {
  totalPairs: number;
  biasMeters: number; // Mean Error (ME): sum(predicted - observed) / N
  maeMeters: number; // Mean Absolute Error: sum(|predicted - observed|) / N
  rmseMeters: number; // Root Mean Square Error: sqrt(sum((predicted - observed)^2) / N)
  standardDeviationMeters: number; // Sample/Population standard deviation of errors: sqrt(sum((e_i - bias)^2) / N)
  maxAbsoluteErrorMeters: number; // max(|predicted - observed|)
  minAbsoluteErrorMeters: number; // min(|predicted - observed|)
}

/**
 * Individual matched tidal peak (High or Low water)
 */
export interface MatchedTidalPeak {
  type: 'High' | 'Low';
  observedTimeUtc: string;
  observedHeightMeters: number;
  predictedTimeUtc: string;
  predictedHeightMeters: number;
  heightErrorMeters: number; // predicted - observed
  timingErrorMinutes: number; // (predictedTime - observedTime) in minutes
}

/**
 * Peak height and timing validation metrics
 */
export interface PeakValidationMetrics {
  totalPeaksDetected: number;
  observedPeaksDetected: number;
  predictedPeaksDetected: number;
  highTidePeaksMatched: number;
  lowTidePeaksMatched: number;
  unmatchedObservedPeaks: number;
  unmatchedPredictedPeaks: number;
  meanPeakHeightErrorMeters: number;
  peakHeightRmseMeters: number;
  meanPeakTimingErrorMinutes: number;
  peakTimingRmseMinutes: number;
  observationSamplingIntervalMinutes: number;
  isTimingResolutionScientificallyDefensible: boolean;
  timingResolutionDisclaimer?: string;
  matchedPeaks: MatchedTidalPeak[];
}

/**
 * Criteria evaluation results for data suitability
 */
export interface DataSuitabilityResult {
  classification: DataSuitabilityClassification;
  observationCount: number;
  timeSpanDays: number;
  dataCompletenessPercentage: number;
  coverageCheck: boolean;
  datumCheck: boolean;
  datumVerificationStatus: DatumVerificationStatus;
  provenanceCheck: boolean;
  reasons: string[];
}

/**
 * Options for running a validation analysis
 */
export interface TideValidationOptions {
  stationId: string;
  startDateUtc?: string;
  endDateUtc?: string;
  allowMarginalData?: boolean;
  predictionResolutionMinutes?: number; // Configurable independent predicted series resolution (default 10 mins)
  requireIndependentDatumVerification?: boolean;
}

/**
 * Complete empirical tide validation run result
 */
export interface TideValidationRun {
  id: string; // Unique UUID
  stationId: string;
  stationName: string;
  periodStartUtc: string;
  periodEndUtc: string;
  executedAtUtc: string;
  status: EmpiricalValidationStatus;
  suitability: DataSuitabilityResult;
  statistics: StatisticalMetrics | null;
  peakMetrics: PeakValidationMetrics | null;
  excludedCount: number;
  exclusionReasons: ValidationExclusionCounters;
  isCalibrationEnabled: false; // Safeguard strictly locked to false
  metadata: {
    engineVersion: string;
    predictionProviderId: string;
    verticalDatum: VerticalDatum;
    datumVerificationStatus: DatumVerificationStatus;
    predictionResolutionMinutes: number;
    notes: string;
  };
}
