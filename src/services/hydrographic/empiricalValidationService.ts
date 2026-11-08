import crypto from 'crypto';
import { HydrographicRepository } from '../../data/hydrographicRepository';
import {
  CALIBRATION_REQUIREMENTS,
  MOROCCAN_WATER_LEVEL_BOUNDS,
  validateWaterLevelBounds,
} from '../../domain/hydrographicModels';
import {
  DataSuitabilityResult,
  DatumVerificationStatus,
  EmpiricalValidationStatus,
  TideValidationOptions,
  TideValidationRun,
  ValidationExclusionCounters,
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
    const predictionResolutionMinutes = Math.max(1, options.predictionResolutionMinutes || 10);

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

    const exclusionReasons: ValidationExclusionCounters = {
      DATUM_MISMATCH: 0,
      DATUM_NOT_VERIFIED: 0,
      INVALID_PROVENANCE: 0,
      INVALID_UNIT: 0,
      INVALID_COORDINATES: 0,
      INVALID_TIMESTAMP: 0,
      DUPLICATE_TIMESTAMP: 0,
      OUT_OF_BOUNDS: 0,
      INSUFFICIENT_COVERAGE: 0,
    };

    let excludedCount = 0;
    const validPairs: ValidationObservationPair[] = [];
    const observedPoints: DiscreteWaterLevelPoint[] = [];

    const seenTimestamps = new Set<string>();

    // 2. Validate observations with detailed exclusion classification
    for (const obs of observations) {
      // Datum check: strictly match station vertical datum
      if (obs.verticalDatum !== station.verticalDatum) {
        exclusionReasons.DATUM_MISMATCH++;
        excludedCount++;
        continue;
      }

      // Check vertical datum verification requirements
      if (options.requireIndependentDatumVerification) {
        // Station metadata check: is datum independently verified by physical benchmark survey?
        const isVerified = (station.metadata as any)?.isDatumIndependentlyVerified === true;
        if (!isVerified) {
          exclusionReasons.DATUM_NOT_VERIFIED++;
          excludedCount++;
          continue;
        }
      }

      // Unit check: raw unit must be supported
      if (!['m', 'cm', 'mm', 'ft'].includes(obs.rawUnit?.toLowerCase())) {
        exclusionReasons.INVALID_UNIT++;
        excludedCount++;
        continue;
      }

      // Coordinates validation: observation provenance coordinates must match station within reasonable tolerance (~0.05 deg / ~5km)
      if (obs.provenance?.coordinates) {
        const { latitude, longitude } = obs.provenance.coordinates;
        const latDiff = Math.abs(latitude - station.latitude);
        const lonDiff = Math.abs(longitude - station.longitude);
        if (latDiff > 0.1 || lonDiff > 0.1) {
          exclusionReasons.INVALID_COORDINATES++;
          excludedCount++;
          continue;
        }
      }

      // Check physical water level bounds
      try {
        validateWaterLevelBounds(
          obs.waterLevelMeters,
          MOROCCAN_WATER_LEVEL_BOUNDS.MIN_METERS,
          MOROCCAN_WATER_LEVEL_BOUNDS.MAX_METERS
        );
      } catch {
        exclusionReasons.OUT_OF_BOUNDS++;
        excludedCount++;
        continue;
      }

      // Provenance check: must be authentic observed physical telemetry and not simulated fallback
      const prov = obs.provenance;
      if (
        obs.qualityTier !== 'observed' ||
        obs.dataStatus !== 'observation' ||
        prov?.isSimulatedFallback === true ||
        prov?.quality === 'simulated' ||
        !prov?.provider ||
        !prov?.retrievedAt
      ) {
        exclusionReasons.INVALID_PROVENANCE++;
        excludedCount++;
        continue;
      }

      // Strict timestamp ISO validation
      const date = new Date(obs.timestampUtc);
      if (isNaN(date.getTime()) || !obs.timestampUtc.endsWith('Z')) {
        exclusionReasons.INVALID_TIMESTAMP++;
        excludedCount++;
        continue;
      }

      // Duplicate timestamp check
      if (seenTimestamps.has(obs.timestampUtc)) {
        exclusionReasons.DUPLICATE_TIMESTAMP++;
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
    }

    // 4. Determine temporal coverage and duration
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
    // Datum verification status distinction:
    // CONFIGURED: datum populated from station configuration metadata
    // SOURCE_DECLARED: datum declared by data source
    // INDEPENDENTLY_VERIFIED: confirmed by certified physical hydrographic benchmark survey
    let datumVerificationStatus: DatumVerificationStatus = 'CONFIGURED';
    if ((station.metadata as any)?.isDatumIndependentlyVerified === true) {
      datumVerificationStatus = 'INDEPENDENTLY_VERIFIED';
    } else if (validPairs.length > 0 && validPairs[0].verticalDatum) {
      datumVerificationStatus = 'SOURCE_DECLARED';
    }

    const suitability = this.evaluateSuitability({
      stationVerticalDatum: station.verticalDatum,
      datumVerificationStatus,
      validPairsCount: validPairs.length,
      timeSpanDays,
      hasSimulatedOrInvalidData: excludedCount > 0,
      periodStartUtc,
      periodEndUtc,
    });

    // 6. Calculate statistical metrics on aligned pairs
    let statistics = null;
    let peakMetrics = null;

    if (validPairs.length > 0) {
      statistics = calculateStatisticalMetrics(validPairs);

      // 7. Peak Detection on an Independent Predictive Series
      // Rather than sampling predictions only at observation instants, we generate
      // a continuous/high-resolution independent predicted series across the observation window.
      const startMs = new Date(periodStartUtc).getTime();
      const endMs = new Date(periodEndUtc).getTime();
      const stepMs = predictionResolutionMinutes * 60 * 1000;

      const independentPredictedPoints: DiscreteWaterLevelPoint[] = [];

      for (let t = startMs; t <= endMs; t += stepMs) {
        const pointDate = new Date(t);
        const pred = await this.tideProvider.getTidePrediction({
          latitude: station.latitude,
          longitude: station.longitude,
          targetDate: pointDate,
        });

        independentPredictedPoints.push({
          timestampUtc: pointDate.toISOString(),
          timeMs: t,
          heightMeters: pred.currentTide.heightMeters,
        });
      }

      peakMetrics = calculatePeakValidationMetrics(observedPoints, independentPredictedPoints, {
        maxMatchingWindowMinutes: 180,
      });
    }

    // 8. Overall Empirical Validation Status
    // Safely defaults to NOT_VERIFIED: in the absence of certified field physical sensor telemetry,
    // empirical validation cannot claim EMPIRICALLY_VALIDATED.
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
      isCalibrationEnabled: false, // Safeguard strictly locked to false
      metadata: {
        engineVersion: '2.4.1',
        predictionProviderId: this.tideProvider.providerId,
        verticalDatum: station.verticalDatum,
        datumVerificationStatus,
        predictionResolutionMinutes,
        notes:
          'Empirical tide validation run against persisted hydrographic observation telemetry. Automated harmonic calibration is permanently disabled.',
      },
    };

    // 9. Persist validation run in SQLite
    this.repo.saveValidationRun(validationRun);

    return validationRun;
  }

  private evaluateSuitability(params: {
    stationVerticalDatum: string;
    datumVerificationStatus: DatumVerificationStatus;
    validPairsCount: number;
    timeSpanDays: number;
    hasSimulatedOrInvalidData: boolean;
    periodStartUtc: string;
    periodEndUtc: string;
  }): DataSuitabilityResult {
    const reasons: string[] = [];

    // Temporal grid completeness calculation:
    // Expected hourly count = (duration in hours) + 1
    const startMs = new Date(params.periodStartUtc).getTime();
    const endMs = new Date(params.periodEndUtc).getTime();
    const durationHours = Math.max(1, Math.round((endMs - startMs) / (3600 * 1000)));
    const expectedHourlyObservations = durationHours + 1;

    const dataCompletenessPercentage =
      Math.min(100, Math.round((params.validPairsCount / expectedHourlyObservations) * 1000) / 10);

    // Strict 85.0% temporal completeness rule for SUITABLE
    const hasSufficientCompleteness = dataCompletenessPercentage >= 85.0;
    const hasSufficientObservations = params.validPairsCount >= CALIBRATION_REQUIREMENTS.MIN_OBSERVATIONS;
    const hasSufficientTimeSpan = params.timeSpanDays >= CALIBRATION_REQUIREMENTS.MIN_SPAN_DAYS;

    const coverageCheck = hasSufficientObservations && hasSufficientTimeSpan && hasSufficientCompleteness;
    const datumCheck = Boolean(params.stationVerticalDatum);
    const provenanceCheck = !params.hasSimulatedOrInvalidData;

    if (!hasSufficientObservations) {
      reasons.push(
        `Observation count (${params.validPairsCount}) is below standard minimum threshold (${CALIBRATION_REQUIREMENTS.MIN_OBSERVATIONS} hourly pairs).`
      );
    }

    if (!hasSufficientTimeSpan) {
      reasons.push(
        `Time series duration (${params.timeSpanDays} days) is less than the required synodic month (${CALIBRATION_REQUIREMENTS.MIN_SPAN_DAYS} days).`
      );
    }

    if (!hasSufficientCompleteness) {
      reasons.push(
        `Temporal grid completeness (${dataCompletenessPercentage}%) is below the minimum required threshold of 85.0% for SUITABLE classification.`
      );
    }

    if (!datumCheck) {
      reasons.push('Station vertical datum is unvalidated or missing.');
    }

    if (params.datumVerificationStatus !== 'INDEPENDENTLY_VERIFIED') {
      reasons.push(
        `Vertical datum is '${params.datumVerificationStatus}' but lacks independent physical benchmark survey verification.`
      );
    }

    if (!provenanceCheck) {
      reasons.push('Dataset contained excluded observations due to provenance, format, or threshold discrepancies.');
    }

    let classification: DataSuitabilityResult['classification'] = 'UNSUITABLE';

    // Criteria for SUITABLE:
    // - >= 720 observations
    // - >= 29.53 days
    // - completeness >= 85.0%
    // - valid vertical datum
    // - valid provenance (no excluded corrupted/synthetic rows)
    if (coverageCheck && datumCheck && provenanceCheck) {
      classification = 'SUITABLE';
    } else if (
      params.validPairsCount >= 100 &&
      params.timeSpanDays >= 5.0 &&
      datumCheck
    ) {
      classification = 'MARGINAL';
    }

    return {
      classification,
      observationCount: params.validPairsCount,
      timeSpanDays: params.timeSpanDays,
      dataCompletenessPercentage,
      coverageCheck,
      datumCheck,
      datumVerificationStatus: params.datumVerificationStatus,
      provenanceCheck,
      reasons,
    };
  }
}
