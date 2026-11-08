import crypto from 'crypto';
import { HydrographicRepository } from '../../data/hydrographicRepository';
import {
  CALIBRATION_REQUIREMENTS,
  MOROCCAN_WATER_LEVEL_BOUNDS,
  validateWaterLevelBounds,
} from '../../domain/hydrographicModels';
import {
  DataSuitabilityResult,
  DatumVerificationBenchmarkProof,
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

/**
 * Checks whether a benchmark proof object contains all 5 required traceable fields
 */
function isValidBenchmarkProof(proof: unknown): proof is DatumVerificationBenchmarkProof {
  if (!proof || typeof proof !== 'object') return false;
  const p = proof as Record<string, unknown>;
  return (
    typeof p.benchmarkCertificateId === 'string' &&
    p.benchmarkCertificateId.trim().length > 0 &&
    typeof p.surveyReference === 'string' &&
    p.surveyReference.trim().length > 0 &&
    typeof p.verificationAuthority === 'string' &&
    p.verificationAuthority.trim().length > 0 &&
    typeof p.verificationDateUtc === 'string' &&
    p.verificationDateUtc.endsWith('Z') &&
    !isNaN(new Date(p.verificationDateUtc).getTime()) &&
    typeof p.verificationDocumentReference === 'string' &&
    p.verificationDocumentReference.trim().length > 0
  );
}

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
    const hourlySlotToleranceMinutes = Math.max(5, options.hourlySlotToleranceMinutes || 30);

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

    // Determine datum verification proof from station metadata
    const stationMeta = (station.metadata || {}) as Record<string, unknown>;
    const rawProof = stationMeta.datumBenchmarkProof;
    const hasValidProof = isValidBenchmarkProof(rawProof);
    const benchmarkProof: DatumVerificationBenchmarkProof | undefined = hasValidProof
      ? (rawProof as DatumVerificationBenchmarkProof)
      : undefined;

    // 2. Validate observations with strict and granular exclusion classification
    for (const obs of observations) {
      // Timestamp format validation
      if (!obs.timestampUtc || typeof obs.timestampUtc !== 'string' || !obs.timestampUtc.endsWith('Z')) {
        exclusionReasons.INVALID_TIMESTAMP++;
        excludedCount++;
        continue;
      }

      const date = new Date(obs.timestampUtc);
      if (isNaN(date.getTime())) {
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

      // Datum check: strictly match station vertical datum
      if (obs.verticalDatum !== station.verticalDatum) {
        exclusionReasons.DATUM_MISMATCH++;
        excludedCount++;
        continue;
      }

      // Check vertical datum verification requirements
      if (options.requireIndependentDatumVerification) {
        if (!hasValidProof) {
          exclusionReasons.DATUM_NOT_VERIFIED++;
          excludedCount++;
          continue;
        }
      }

      // Comprehensive Unit Consistency & Numeric Finite Validation:
      // 1. Validate rawUnit presence and supported values ('m', 'cm', 'mm', 'ft')
      const rawUnitClean = typeof obs.rawUnit === 'string' ? obs.rawUnit.trim().toLowerCase() : '';
      if (!['m', 'cm', 'mm', 'ft'].includes(rawUnitClean)) {
        exclusionReasons.INVALID_UNIT++;
        excludedCount++;
        continue;
      }

      // 2. Mandatory provenance unit metadata completeness
      const prov = obs.provenance;
      const provUnits = prov?.units;
      if (!provUnits || typeof provUnits !== 'object') {
        exclusionReasons.INVALID_UNIT++;
        excludedCount++;
        continue;
      }

      // provenance.units.waterLevel must be explicitly present and equal to 'm'
      if (typeof provUnits.waterLevel !== 'string' || provUnits.waterLevel.trim() !== 'm') {
        exclusionReasons.INVALID_UNIT++;
        excludedCount++;
        continue;
      }

      // provenance.units.rawUnit must be explicitly present and match normalized rawUnit
      if (
        typeof provUnits.rawUnit !== 'string' ||
        provUnits.rawUnit.trim() === '' ||
        provUnits.rawUnit.trim().toLowerCase() !== rawUnitClean
      ) {
        exclusionReasons.INVALID_UNIT++;
        excludedCount++;
        continue;
      }

      // 3. Reject non-finite numeric values (NaN, Infinity, -Infinity)
      if (
        typeof obs.rawValue !== 'number' ||
        !Number.isFinite(obs.rawValue) ||
        typeof obs.waterLevelMeters !== 'number' ||
        !Number.isFinite(obs.waterLevelMeters)
      ) {
        exclusionReasons.INVALID_UNIT++;
        excludedCount++;
        continue;
      }

      // 4. Mathematical conversion verification within numerical tolerance
      let expectedMeters = obs.rawValue;
      if (rawUnitClean === 'cm') expectedMeters = obs.rawValue / 100;
      else if (rawUnitClean === 'mm') expectedMeters = obs.rawValue / 1000;
      else if (rawUnitClean === 'ft') expectedMeters = obs.rawValue * 0.3048;

      if (Math.abs(expectedMeters - obs.waterLevelMeters) > 0.005) {
        exclusionReasons.INVALID_UNIT++;
        excludedCount++;
        continue;
      }

      // Coordinates validation: observation provenance coordinates must be numeric, in range, and match station within ~0.1 deg (~10km)
      const provCoords = prov?.coordinates;
      if (
        !provCoords ||
        typeof provCoords.latitude !== 'number' ||
        typeof provCoords.longitude !== 'number' ||
        isNaN(provCoords.latitude) ||
        isNaN(provCoords.longitude) ||
        provCoords.latitude < -90 ||
        provCoords.latitude > 90 ||
        provCoords.longitude < -180 ||
        provCoords.longitude > 180
      ) {
        exclusionReasons.INVALID_COORDINATES++;
        excludedCount++;
        continue;
      }

      const latDiff = Math.abs(provCoords.latitude - station.latitude);
      const lonDiff = Math.abs(provCoords.longitude - station.longitude);
      if (latDiff > 0.1 || lonDiff > 0.1) {
        exclusionReasons.INVALID_COORDINATES++;
        excludedCount++;
        continue;
      }

      // Water level physical plausibility bounds check
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

      // Rigorous Provenance Validation:
      // provider non-empty, retrievedAt valid UTC, qualityTier === observed, dataStatus === observation, no fallback/simulated
      if (
        !prov ||
        !prov.provider ||
        typeof prov.provider !== 'string' ||
        prov.provider.trim() === '' ||
        !prov.retrievedAt ||
        typeof prov.retrievedAt !== 'string' ||
        !prov.retrievedAt.endsWith('Z') ||
        isNaN(new Date(prov.retrievedAt).getTime()) ||
        obs.qualityTier !== 'observed' ||
        obs.dataStatus !== 'observation' ||
        prov.quality === 'simulated' ||
        prov.isSimulatedFallback === true
      ) {
        exclusionReasons.INVALID_PROVENANCE++;
        excludedCount++;
        continue;
      }

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
      // Sort valid pairs chronologically
      validPairs.sort((a, b) => new Date(a.timestampUtc).getTime() - new Date(b.timestampUtc).getTime());

      if (!periodStartUtc) periodStartUtc = validPairs[0].timestampUtc;
      if (!periodEndUtc) periodEndUtc = validPairs[validPairs.length - 1].timestampUtc;

      // Actual observation timespan is between first and last valid observation
      const firstObsMs = new Date(validPairs[0].timestampUtc).getTime();
      const lastObsMs = new Date(validPairs[validPairs.length - 1].timestampUtc).getTime();
      timeSpanDays = Math.max(0, Math.round(((lastObsMs - firstObsMs) / (86400 * 1000)) * 100) / 100);
    } else {
      if (!periodStartUtc) periodStartUtc = executedAtUtc;
      if (!periodEndUtc) periodEndUtc = executedAtUtc;
    }

    // 5. Evaluate Data Suitability Criteria with true hourly slot coverage
    // Datum verification status distinction:
    // CONFIGURED: datum populated from station configuration metadata
    // SOURCE_DECLARED: datum declared by data source
    // INDEPENDENTLY_VERIFIED: confirmed by certified physical hydrographic benchmark survey (requires full valid proof)
    let datumVerificationStatus: DatumVerificationStatus = 'CONFIGURED';
    if (hasValidProof) {
      datumVerificationStatus = 'INDEPENDENTLY_VERIFIED';
    } else if (validPairs.length > 0 && validPairs[0].verticalDatum) {
      datumVerificationStatus = 'SOURCE_DECLARED';
    }

    const suitability = this.evaluateSuitability({
      stationVerticalDatum: station.verticalDatum,
      datumVerificationStatus,
      benchmarkProof,
      validPairs,
      timeSpanDays,
      hasSimulatedOrInvalidData: excludedCount > 0,
      periodStartUtc,
      periodEndUtc,
      slotToleranceMinutes: hourlySlotToleranceMinutes,
    });

    // Populate INSUFFICIENT_COVERAGE with missing hourly slots count
    exclusionReasons.INSUFFICIENT_COVERAGE = suitability.missingHourlySlots;

    // 6. Calculate statistical metrics on aligned pairs
    let statistics = null;
    let peakMetrics = null;

    if (validPairs.length > 0) {
      statistics = calculateStatisticalMetrics(validPairs);

      // 7. Peak Detection on an Independent Predictive Series
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
    // Strictly NOT_VERIFIED: in the absence of certified field physical sensor telemetry,
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
        engineVersion: '2.4.3',
        predictionProviderId: this.tideProvider.providerId,
        verticalDatum: station.verticalDatum,
        datumVerificationStatus,
        benchmarkProof,
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
    benchmarkProof?: DatumVerificationBenchmarkProof;
    validPairs: ValidationObservationPair[];
    timeSpanDays: number;
    hasSimulatedOrInvalidData: boolean;
    periodStartUtc: string;
    periodEndUtc: string;
    slotToleranceMinutes: number;
  }): DataSuitabilityResult {
    const reasons: string[] = [];

    // True Temporal Grid Slot Construction:
    // Builds an explicit array of top-of-hour UTC slot timestamps between periodStartUtc and periodEndUtc
    const startMs = new Date(params.periodStartUtc).getTime();
    const endMs = new Date(params.periodEndUtc).getTime();

    let expectedHourlySlots = 0;
    let coveredHourlySlots = 0;
    let missingHourlySlots = 0;
    let dataCompletenessPercentage = 0;

    if (params.validPairs.length === 0 || endMs <= startMs) {
      expectedHourlySlots = 0;
      coveredHourlySlots = 0;
      missingHourlySlots = 0;
      dataCompletenessPercentage = 0;
    } else {
      // Find starting hour floor (YYYY-MM-DDTHH:00:00.000Z)
      const startDate = new Date(startMs);
      const startSlotMs = Date.UTC(
        startDate.getUTCFullYear(),
        startDate.getUTCMonth(),
        startDate.getUTCDate(),
        startDate.getUTCHours(),
        0,
        0,
        0
      );

      const toleranceMs = params.slotToleranceMinutes * 60 * 1000;
      const slotMap = new Map<number, boolean>();

      // Generate expected hourly slots
      for (let slotTime = startSlotMs; slotTime <= endMs; slotTime += 3600 * 1000) {
        slotMap.set(slotTime, false);
      }
      expectedHourlySlots = slotMap.size;

      // Assign valid observations to discrete hourly slots
      for (const pair of params.validPairs) {
        const obsTime = new Date(pair.timestampUtc).getTime();
        // Check which slot this observation falls into within tolerance
        for (const [slotTime, isCovered] of slotMap.entries()) {
          if (!isCovered && Math.abs(obsTime - slotTime) <= toleranceMs) {
            slotMap.set(slotTime, true);
            break; // One observation covers one slot
          }
        }
      }

      for (const isCovered of slotMap.values()) {
        if (isCovered) {
          coveredHourlySlots++;
        } else {
          missingHourlySlots++;
        }
      }

      dataCompletenessPercentage =
        expectedHourlySlots > 0
          ? Math.round((coveredHourlySlots / expectedHourlySlots) * 1000) / 10
          : 0;
    }

    // Strict 85.0% temporal completeness rule
    const hasSufficientCompleteness = dataCompletenessPercentage >= 85.0;
    const hasSufficientObservations = params.validPairs.length >= CALIBRATION_REQUIREMENTS.MIN_OBSERVATIONS;
    const hasSufficientTimeSpan = params.timeSpanDays >= CALIBRATION_REQUIREMENTS.MIN_SPAN_DAYS;

    const coverageCheck = hasSufficientObservations && hasSufficientTimeSpan && hasSufficientCompleteness;
    const datumCheck = Boolean(params.stationVerticalDatum);
    const provenanceCheck = !params.hasSimulatedOrInvalidData;

    // Strict rule: SUITABLE strictly requires INDEPENDENTLY_VERIFIED
    const isDatumIndependentlyVerified = params.datumVerificationStatus === 'INDEPENDENTLY_VERIFIED';

    if (!hasSufficientObservations) {
      reasons.push(
        `Observation count (${params.validPairs.length}) is below standard minimum threshold (${CALIBRATION_REQUIREMENTS.MIN_OBSERVATIONS} hourly pairs).`
      );
    }

    if (!hasSufficientTimeSpan) {
      reasons.push(
        `Time series duration (${params.timeSpanDays} days) is less than the required synodic month (${CALIBRATION_REQUIREMENTS.MIN_SPAN_DAYS} days).`
      );
    }

    if (!hasSufficientCompleteness) {
      reasons.push(
        `Temporal grid completeness (${dataCompletenessPercentage}%, ${coveredHourlySlots}/${expectedHourlySlots} slots) is below the minimum required threshold of 85.0% for SUITABLE classification.`
      );
    }

    if (!datumCheck) {
      reasons.push('Station vertical datum is unvalidated or missing.');
    }

    if (!isDatumIndependentlyVerified) {
      reasons.push(
        `Vertical datum is '${params.datumVerificationStatus}' and lacks independent physical hydrographic benchmark verification. SUITABLE classification requires INDEPENDENTLY_VERIFIED datum with traceable certificate proof.`
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
    // - valid vertical datum AND INDEPENDENTLY_VERIFIED (with full benchmarkProof)
    // - valid provenance (no excluded rows)
    if (coverageCheck && datumCheck && isDatumIndependentlyVerified && provenanceCheck) {
      classification = 'SUITABLE';
    } else if (
      params.validPairs.length >= 100 &&
      params.timeSpanDays >= 5.0 &&
      datumCheck &&
      dataCompletenessPercentage >= 50.0
    ) {
      // CONFIGURED or SOURCE_DECLARED with >= 100 obs and >= 5 days can at most reach MARGINAL
      classification = 'MARGINAL';
    }

    return {
      classification,
      observationCount: params.validPairs.length,
      timeSpanDays: params.timeSpanDays,
      expectedHourlySlots,
      coveredHourlySlots,
      missingHourlySlots,
      dataCompletenessPercentage,
      coverageCheck,
      datumCheck,
      datumVerificationStatus: params.datumVerificationStatus,
      benchmarkProof: params.benchmarkProof,
      provenanceCheck,
      reasons,
    };
  }
}
