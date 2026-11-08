import crypto from 'crypto';
import { HydrographicRepository } from '../../data/hydrographicRepository';
import {
  CALIBRATION_REQUIREMENTS,
  MOROCCAN_WATER_LEVEL_BOUNDS,
  validateVerticalDatum,
  validateWaterLevelBounds,
} from '../../domain/hydrographicModels';
import {
  DataSuitabilityResult,
  EmpiricalValidationStatus,
  TideValidationOptions,
  TideValidationRun,
  ValidationObservationPair,
} from '../../domain/tideValidationModels';
import { MoroccanHarmonicTideProvider } from '../marine/tides/harmonicTideProvider';
import {
  calculatePeakValidationMetrics,
  calculateStatisticalMetrics,
  DiscreteWaterLevelPoint,
} from './validationStatistics';

export class EmpiricalValidationEngine {
  private repo: HydrographicRepository;
  private tideProvider: MoroccanHarmonicTideProvider;

  constructor(
    repo?: HydrographicRepository,
    tideProvider?: MoroccanHarmonicTideProvider
  ) {
    this.repo = repo || new HydrographicRepository();
    this.tideProvider = tideProvider || new MoroccanHarmonicTideProvider();
  }

  /**
   * Executes an empirical validation run for a given station and optional date range.
   */
  public async validateStation(
    options: TideValidationOptions
  ): Promise<TideValidationRun> {
    const executedAtUtc = new Date().toISOString();
    const runId = `val-${crypto.randomUUID()}`;

    const station = this.repo.getStation(options.stationId);
    if (!station) {
      throw new Error(`Station not found: '${options.stationId}'`);
    }

    // 1. Retrieve persisted observations for the target period
    const observations = this.repo.getObservations({
      stationId: options.stationId,
      fromTimestampUtc: options.startDateUtc,
      toTimestampUtc: options.endDateUtc,
    });

    const exclusionReasons: Record<string, number> = {
      datumMismatch: 0,
      invalidProvenance: 0,
      duplicateTimestamp: 0,
      outOfBoundsWaterLevel: 0,
      invalidTimestampFormat: 0,
    };

    let excludedCount = 0;
    const validPairs: ValidationObservationPair[] = [];
    const observedPoints: DiscreteWaterLevelPoint[] = [];
    const predictedPoints: DiscreteWaterLevelPoint[] = [];

    const seenTimestamps = new Set<string>();

    // 2. Validate observations and match with astronomical harmonic predictions
    for (const obs of observations) {
      // Datum check: strictly match station vertical datum
      if (obs.verticalDatum !== station.verticalDatum) {
        exclusionReasons.datumMismatch++;
        excludedCount++;
        continue;
      }

      // Check physical water level bounds
      try {
        validateWaterLevelBounds(
          obs.waterLevelMeters,
          MOROCCAN_WATER_LEVEL_BOUNDS.MIN_METERS,
          MOROCCAN_WATER_LEVEL_BOUNDS.MAX_METERS
        );
      } catch {
        exclusionReasons.outOfBoundsWaterLevel++;
        excludedCount++;
        continue;
      }

      // Provenance check: must be observed and not simulated fallback
      if (
        obs.qualityTier !== 'observed' ||
        obs.dataStatus !== 'observation' ||
        obs.provenance?.isSimulatedFallback === true
      ) {
        exclusionReasons.invalidProvenance++;
        excludedCount++;
        continue;
      }

      // Strict timestamp ISO validation
      const date = new Date(obs.timestampUtc);
      if (isNaN(date.getTime()) || !obs.timestampUtc.endsWith('Z')) {
        exclusionReasons.invalidTimestampFormat++;
        excludedCount++;
        continue;
      }

      // Duplicate timestamp check
      if (seenTimestamps.has(obs.timestampUtc)) {
        exclusionReasons.duplicateTimestamp++;
        excludedCount++;
        continue;
      }
      seenTimestamps.add(obs.timestampUtc);

      // 3. Compute harmonic tide prediction for this exact coordinate and timestamp
      const tidePrediction = await this.tideProvider.getTidePrediction({
        latitude: station.latitude,
        longitude: station.longitude,
        targetDate: date,
      });

      const predictedHeight = tidePrediction.currentTide.heightMeters;
      const residual = Math.round((predictedHeight - obs.waterLevelMeters) * 10000) / 10000;

      validPairs.push({
        timestampUtc: obs.timestampUtc,
        observedWaterLevelMeters: obs.waterLevelMeters,
        predictedWaterLevelMeters: predictedHeight,
        residualMeters: residual,
        verticalDatum: obs.verticalDatum,
        qualityTier: obs.qualityTier,
      });

      const timeMs = date.getTime();
      observedPoints.push({
        timestampUtc: obs.timestampUtc,
        timeMs,
        heightMeters: obs.waterLevelMeters,
      });

      predictedPoints.push({
        timestampUtc: obs.timestampUtc,
        timeMs,
        heightMeters: predictedHeight,
      });
    }

    // 4. Determine temporal coverage
    let periodStartUtc = options.startDateUtc || '';
    let periodEndUtc = options.endDateUtc || '';
    let timeSpanDays = 0;

    if (validPairs.length > 0) {
      if (!periodStartUtc) periodStartUtc = validPairs[0].timestampUtc;
      if (!periodEndUtc) periodEndUtc = validPairs[validPairs.length - 1].timestampUtc;

      const startMs = new Date(periodStartUtc).getTime();
      const endMs = new Date(periodEndUtc).getTime();
      timeSpanDays = Math.max(0, Math.round(((endMs - startMs) / (86400 * 1000)) * 100) / 100);
    } else {
      if (!periodStartUtc) periodStartUtc = executedAtUtc;
      if (!periodEndUtc) periodEndUtc = executedAtUtc;
    }

    // 5. Evaluate Data Suitability Criteria
    const suitability = this.evaluateSuitability({
      stationVerticalDatum: station.verticalDatum,
      validPairsCount: validPairs.length,
      timeSpanDays,
      hasSimulatedOrInvalidData: excludedCount > 0,
    });

    // 6. Calculate statistical metrics and peak error metrics if pairs exist
    let statistics = null;
    let peakMetrics = null;

    if (validPairs.length > 0) {
      statistics = calculateStatisticalMetrics(validPairs);
      peakMetrics = calculatePeakValidationMetrics(observedPoints, predictedPoints);
    }

    // 7. Determine overall empirical validation status
    // In accordance with P2.4 specifications and architectural safeguards:
    // If software-tested or executed with synthetic/zero empirical observations:
    // status is strictly 'NOT_VERIFIED'
    const status: EmpiricalValidationStatus = 'NOT_VERIFIED';

    const validationRun: TideValidationRun = {
      id: runId,
      stationId: station.id,
      stationName: station.name,
      periodStartUtc,
      periodEndUtc,
      executedAtUtc,
      status,
      suitability,
      statistics,
      peakMetrics,
      excludedCount,
      exclusionReasons,
      isCalibrationEnabled: false, // Permanently false per instructions
      metadata: {
        engineVersion: '2.4.0',
        predictionProviderId: this.tideProvider.providerId,
        verticalDatum: station.verticalDatum,
        notes:
          'Empirical tide validation run against persisted hydrographic observation telemetry. Automated harmonic calibration is permanently disabled.',
      },
    };

    // 8. Persist validation run in SQLite
    this.repo.saveValidationRun(validationRun);

    return validationRun;
  }

  private evaluateSuitability(params: {
    stationVerticalDatum: string;
    validPairsCount: number;
    timeSpanDays: number;
    hasSimulatedOrInvalidData: boolean;
  }): DataSuitabilityResult {
    const reasons: string[] = [];

    const coverageCheck =
      params.validPairsCount >= CALIBRATION_REQUIREMENTS.MIN_OBSERVATIONS &&
      params.timeSpanDays >= CALIBRATION_REQUIREMENTS.MIN_SPAN_DAYS;

    const datumCheck = Boolean(params.stationVerticalDatum);
    const provenanceCheck = !params.hasSimulatedOrInvalidData;

    if (params.validPairsCount < CALIBRATION_REQUIREMENTS.MIN_OBSERVATIONS) {
      reasons.push(
        `Observation count (${params.validPairsCount}) is below standard minimum threshold (${CALIBRATION_REQUIREMENTS.MIN_OBSERVATIONS} hourly pairs).`
      );
    }

    if (params.timeSpanDays < CALIBRATION_REQUIREMENTS.MIN_SPAN_DAYS) {
      reasons.push(
        `Time series duration (${params.timeSpanDays} days) is less than the required synodic month (${CALIBRATION_REQUIREMENTS.MIN_SPAN_DAYS} days).`
      );
    }

    if (!datumCheck) {
      reasons.push('Station vertical datum is unvalidated or missing.');
    }

    if (!provenanceCheck) {
      reasons.push('Dataset contained excluded pairs due to provenance or format discrepancies.');
    }

    let classification: DataSuitabilityResult['classification'] = 'UNSUITABLE';
    if (coverageCheck && datumCheck && provenanceCheck) {
      classification = 'SUITABLE';
    } else if (params.validPairsCount >= 100 && params.timeSpanDays >= 5 && datumCheck) {
      classification = 'MARGINAL';
    }

    const expectedHourlyPoints = Math.max(1, Math.round(params.timeSpanDays * 24));
    const dataCompletenessPercentage =
      Math.min(100, Math.round((params.validPairsCount / expectedHourlyPoints) * 1000) / 10);

    return {
      classification,
      observationCount: params.validPairsCount,
      timeSpanDays: params.timeSpanDays,
      dataCompletenessPercentage,
      coverageCheck,
      datumCheck,
      provenanceCheck,
      reasons,
    };
  }
}
