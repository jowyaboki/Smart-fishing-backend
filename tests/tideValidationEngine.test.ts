import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import request from 'supertest';
import { createApp } from '../src/app';
import { setDatabaseForTesting, closeDatabase } from '../src/data/database';
import { HydrographicRepository } from '../src/data/hydrographicRepository';
import { EmpiricalValidationEngine } from '../src/services/hydrographic/empiricalValidationService';
import {
  calculatePeakValidationMetrics,
  calculateStatisticalMetrics,
  DiscreteWaterLevelPoint,
} from '../src/services/hydrographic/validationStatistics';
import { ValidationObservationPair } from '../src/domain/tideValidationModels';
import { HydrographicObservation } from '../src/domain/hydrographicModels';

describe('Milestone P2.4: Empirical Tide Validation Engine Suite', () => {
  describe('Statistical Calculation Module (validationStatistics)', () => {
    it('computes statistical metrics correctly against independently calculated expected values', () => {
      // Residual convention: e_i = predicted - observed
      const testPairs: ValidationObservationPair[] = [
        {
          timestampUtc: '2026-11-08T00:00:00Z',
          observedWaterLevelMeters: 2.0,
          predictedWaterLevelMeters: 3.0,
          residualMeters: 1.0,
          verticalDatum: 'ZH',
          qualityTier: 'observed',
        },
        {
          timestampUtc: '2026-11-08T01:00:00Z',
          observedWaterLevelMeters: 2.0,
          predictedWaterLevelMeters: 1.5,
          residualMeters: -0.5,
          verticalDatum: 'ZH',
          qualityTier: 'observed',
        },
        {
          timestampUtc: '2026-11-08T02:00:00Z',
          observedWaterLevelMeters: 2.0,
          predictedWaterLevelMeters: 2.5,
          residualMeters: 0.5,
          verticalDatum: 'ZH',
          qualityTier: 'observed',
        },
        {
          timestampUtc: '2026-11-08T03:00:00Z',
          observedWaterLevelMeters: 3.0,
          predictedWaterLevelMeters: 1.0,
          residualMeters: -2.0,
          verticalDatum: 'ZH',
          qualityTier: 'observed',
        },
      ];

      const stats = calculateStatisticalMetrics(testPairs);

      expect(stats.totalPairs).toBe(4);
      expect(stats.biasMeters).toBe(-0.25);
      expect(stats.maeMeters).toBe(1.0);
      expect(stats.rmseMeters).toBeCloseTo(1.1726, 4);
      expect(stats.standardDeviationMeters).toBeCloseTo(1.1456, 4);
      expect(stats.maxAbsoluteErrorMeters).toBe(2.0);
      expect(stats.minAbsoluteErrorMeters).toBe(0.5);
    });

    it('handles perfectly matching series with zero error', () => {
      const perfectPairs: ValidationObservationPair[] = [
        {
          timestampUtc: '2026-11-08T00:00:00Z',
          observedWaterLevelMeters: 2.1,
          predictedWaterLevelMeters: 2.1,
          residualMeters: 0.0,
          verticalDatum: 'ZH',
          qualityTier: 'observed',
        },
        {
          timestampUtc: '2026-11-08T01:00:00Z',
          observedWaterLevelMeters: 2.8,
          predictedWaterLevelMeters: 2.8,
          residualMeters: 0.0,
          verticalDatum: 'ZH',
          qualityTier: 'observed',
        },
      ];

      const stats = calculateStatisticalMetrics(perfectPairs);
      expect(stats.biasMeters).toBe(0);
      expect(stats.maeMeters).toBe(0);
      expect(stats.rmseMeters).toBe(0);
      expect(stats.standardDeviationMeters).toBe(0);
      expect(stats.maxAbsoluteErrorMeters).toBe(0);
      expect(stats.minAbsoluteErrorMeters).toBe(0);
    });

    it('calculates positive and negative errors without cancelation masking in MAE and RMSE', () => {
      const opposingPairs: ValidationObservationPair[] = [
        {
          timestampUtc: '2026-11-08T00:00:00Z',
          observedWaterLevelMeters: 2.0,
          predictedWaterLevelMeters: 3.0, // +1.0
          residualMeters: 1.0,
          verticalDatum: 'ZH',
          qualityTier: 'observed',
        },
        {
          timestampUtc: '2026-11-08T01:00:00Z',
          observedWaterLevelMeters: 3.0,
          predictedWaterLevelMeters: 2.0, // -1.0
          residualMeters: -1.0,
          verticalDatum: 'ZH',
          qualityTier: 'observed',
        },
      ];

      const stats = calculateStatisticalMetrics(opposingPairs);
      expect(stats.biasMeters).toBe(0);
      expect(stats.maeMeters).toBe(1.0);
      expect(stats.rmseMeters).toBe(1.0);
      expect(stats.standardDeviationMeters).toBe(1.0);
    });

    it('throws error when computing statistics for empty pair series', () => {
      expect(() => calculateStatisticalMetrics([])).toThrow(
        'Cannot calculate statistical metrics for an empty dataset'
      );
    });

    it('detects tidal extrema peaks on independent predictive series and measures height & timing errors', () => {
      const t0 = new Date('2026-11-08T00:00:00Z').getTime();
      const obsPoints: DiscreteWaterLevelPoint[] = [
        { timestampUtc: '2026-11-08T00:00:00Z', timeMs: t0, heightMeters: 1.2 },
        { timestampUtc: '2026-11-08T00:10:00Z', timeMs: t0 + 600000, heightMeters: 1.0 }, // Observed Low
        { timestampUtc: '2026-11-08T00:20:00Z', timeMs: t0 + 1200000, heightMeters: 1.5 },
        { timestampUtc: '2026-11-08T00:30:00Z', timeMs: t0 + 1800000, heightMeters: 2.5 },
        { timestampUtc: '2026-11-08T00:40:00Z', timeMs: t0 + 2400000, heightMeters: 3.2 }, // Observed High
        { timestampUtc: '2026-11-08T00:50:00Z', timeMs: t0 + 3000000, heightMeters: 2.1 },
      ];

      const predPoints: DiscreteWaterLevelPoint[] = [
        { timestampUtc: '2026-11-08T00:00:00Z', timeMs: t0, heightMeters: 1.3 },
        { timestampUtc: '2026-11-08T00:15:00Z', timeMs: t0 + 900000, heightMeters: 0.9 }, // Predicted Low (+5 mins, -0.1m)
        { timestampUtc: '2026-11-08T00:30:00Z', timeMs: t0 + 1800000, heightMeters: 2.6 },
        { timestampUtc: '2026-11-08T00:45:00Z', timeMs: t0 + 2700000, heightMeters: 3.4 }, // Predicted High (+5 mins, +0.2m)
        { timestampUtc: '2026-11-08T01:00:00Z', timeMs: t0 + 3600000, heightMeters: 2.0 },
      ];

      const peakMetrics = calculatePeakValidationMetrics(obsPoints, predPoints, {
        maxMatchingWindowMinutes: 120,
        medianObsIntervalMinutes: 10,
      });

      expect(peakMetrics.observedPeaksDetected).toBe(2);
      expect(peakMetrics.predictedPeaksDetected).toBe(2);
      expect(peakMetrics.highTidePeaksMatched).toBe(1);
      expect(peakMetrics.lowTidePeaksMatched).toBe(1);
      expect(peakMetrics.unmatchedObservedPeaks).toBe(0);
      expect(peakMetrics.unmatchedPredictedPeaks).toBe(0);
      expect(peakMetrics.isTimingResolutionScientificallyDefensible).toBe(true);

      const lowMatch = peakMetrics.matchedPeaks.find((p) => p.type === 'Low');
      expect(lowMatch?.heightErrorMeters).toBeCloseTo(-0.1, 4);
      expect(lowMatch?.timingErrorMinutes).toBe(5);

      const highMatch = peakMetrics.matchedPeaks.find((p) => p.type === 'High');
      expect(highMatch?.heightErrorMeters).toBeCloseTo(0.2, 4);
      expect(highMatch?.timingErrorMinutes).toBe(5);
    });

    it('warns when observation resolution is too coarse for defensible peak timing', () => {
      const t0 = new Date('2026-11-08T00:00:00Z').getTime();
      const obsPoints: DiscreteWaterLevelPoint[] = [
        { timestampUtc: '2026-11-08T00:00:00Z', timeMs: t0, heightMeters: 1.2 },
        { timestampUtc: '2026-11-08T01:00:00Z', timeMs: t0 + 3600000, heightMeters: 3.2 },
        { timestampUtc: '2026-11-08T02:00:00Z', timeMs: t0 + 7200000, heightMeters: 1.5 },
      ];
      const predPoints: DiscreteWaterLevelPoint[] = [
        { timestampUtc: '2026-11-08T00:00:00Z', timeMs: t0, heightMeters: 1.2 },
        { timestampUtc: '2026-11-08T01:10:00Z', timeMs: t0 + 4200000, heightMeters: 3.3 },
        { timestampUtc: '2026-11-08T02:00:00Z', timeMs: t0 + 7200000, heightMeters: 1.4 },
      ];

      const metrics = calculatePeakValidationMetrics(obsPoints, predPoints, {
        medianObsIntervalMinutes: 60,
      });

      expect(metrics.isTimingResolutionScientificallyDefensible).toBe(false);
      expect(metrics.timingResolutionDisclaimer).toContain('exceeds recommended threshold');
    });
  });

  describe('Empirical Validation Engine & Persistence (SQLite & Service)', () => {
    let db: DatabaseType;
    let repo: HydrographicRepository;
    let validationEngine: EmpiricalValidationEngine;

    beforeEach(() => {
      db = new Database(':memory:');
      setDatabaseForTesting(db);
      repo = new HydrographicRepository(db);
      validationEngine = new EmpiricalValidationEngine(repo);
    });

    afterEach(() => {
      closeDatabase();
    });

    it('validates a station with zero authentic observations gracefully', async () => {
      const result = await validationEngine.validateStation({
        stationId: 'casablanca-port',
      });

      expect(result.id).toMatch(/^val-/);
      expect(result.stationId).toBe('casablanca-port');
      expect(result.status).toBe('NOT_VERIFIED');
      expect(result.suitability.classification).toBe('UNSUITABLE');
      expect(result.suitability.observationCount).toBe(0);
      expect(result.statistics).toBeNull();
      expect(result.peakMetrics).toBeNull();
      expect(result.isCalibrationEnabled).toBe(false);

      const retrieved = repo.getValidationRun(result.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(result.id);
      expect(retrieved?.suitability.classification).toBe('UNSUITABLE');
    });

    it('distinguishes all explicit exclusion categories without double counting', async () => {
      const observations: HydrographicObservation[] = [
        // 1. Valid observation
        {
          id: 'obs-valid-1',
          stationId: 'casablanca-port',
          timestampUtc: '2026-11-08T06:00:00.000Z',
          waterLevelMeters: 2.2,
          verticalDatum: 'ZH',
          rawValue: 2.2,
          rawUnit: 'm',
          qualityTier: 'observed',
          dataStatus: 'observation',
          provenance: {
            provider: 'ANP',
            retrievedAt: '2026-11-08T06:05:00Z',
            quality: 'observed',
            status: 'observation',
            coordinates: { latitude: 33.6, longitude: -7.6 },
            units: { waterLevel: 'm' },
            isSimulatedFallback: false,
          },
        },
        // 2. Datum Mismatch (LAT instead of ZH)
        {
          id: 'obs-invalid-datum',
          stationId: 'casablanca-port',
          timestampUtc: '2026-11-08T07:00:00.000Z',
          waterLevelMeters: 2.3,
          verticalDatum: 'LAT',
          rawValue: 2.3,
          rawUnit: 'm',
          qualityTier: 'observed',
          dataStatus: 'observation',
          provenance: {
            provider: 'ANP',
            retrievedAt: '2026-11-08T07:05:00Z',
            quality: 'observed',
            status: 'observation',
            coordinates: { latitude: 33.6, longitude: -7.6 },
            units: { waterLevel: 'm' },
            isSimulatedFallback: false,
          },
        },
        // 3. Simulated Provenance
        {
          id: 'obs-simulated-prov',
          stationId: 'casablanca-port',
          timestampUtc: '2026-11-08T08:00:00.000Z',
          waterLevelMeters: 2.4,
          verticalDatum: 'ZH',
          rawValue: 2.4,
          rawUnit: 'm',
          qualityTier: 'simulated',
          dataStatus: 'observation',
          provenance: {
            provider: 'Simulated Engine',
            retrievedAt: '2026-11-08T08:05:00Z',
            quality: 'simulated',
            status: 'forecast',
            coordinates: { latitude: 33.6, longitude: -7.6 },
            units: { waterLevel: 'm' },
            isSimulatedFallback: true,
          },
        },
        // 4. Out of bounds water level (> 12.0m)
        {
          id: 'obs-out-of-bounds',
          stationId: 'casablanca-port',
          timestampUtc: '2026-11-08T09:00:00.000Z',
          waterLevelMeters: 18.5,
          verticalDatum: 'ZH',
          rawValue: 18.5,
          rawUnit: 'm',
          qualityTier: 'observed',
          dataStatus: 'observation',
          provenance: {
            provider: 'ANP',
            retrievedAt: '2026-11-08T09:05:00Z',
            quality: 'observed',
            status: 'observation',
            coordinates: { latitude: 33.6, longitude: -7.6 },
            units: { waterLevel: 'm' },
            isSimulatedFallback: false,
          },
        },
        // 5. Incompatible Coordinates (> 0.1 degree away from station)
        {
          id: 'obs-bad-coords',
          stationId: 'casablanca-port',
          timestampUtc: '2026-11-08T10:00:00.000Z',
          waterLevelMeters: 2.5,
          verticalDatum: 'ZH',
          rawValue: 2.5,
          rawUnit: 'm',
          qualityTier: 'observed',
          dataStatus: 'observation',
          provenance: {
            provider: 'ANP',
            retrievedAt: '2026-11-08T10:05:00Z',
            quality: 'observed',
            status: 'observation',
            coordinates: { latitude: 35.8, longitude: -5.5 }, // Tanger Med coordinates instead of Casablanca
            units: { waterLevel: 'm' },
            isSimulatedFallback: false,
          },
        },
        // 6. Invalid Unit (knots instead of m/cm/mm/ft)
        {
          id: 'obs-bad-unit',
          stationId: 'casablanca-port',
          timestampUtc: '2026-11-08T11:00:00.000Z',
          waterLevelMeters: 2.0,
          verticalDatum: 'ZH',
          rawValue: 2.0,
          rawUnit: 'knots' as any,
          qualityTier: 'observed',
          dataStatus: 'observation',
          provenance: {
            provider: 'ANP',
            retrievedAt: '2026-11-08T11:05:00Z',
            quality: 'observed',
            status: 'observation',
            coordinates: { latitude: 33.6, longitude: -7.6 },
            units: { waterLevel: 'm' },
            isSimulatedFallback: false,
          },
        },
      ];

      repo.saveObservationsBatch(observations);

      const run = await validationEngine.validateStation({
        stationId: 'casablanca-port',
      });

      expect(run.excludedCount).toBe(5);
      expect(run.exclusionReasons.DATUM_MISMATCH).toBe(1);
      expect(run.exclusionReasons.INVALID_PROVENANCE).toBe(1);
      expect(run.exclusionReasons.OUT_OF_BOUNDS).toBe(1);
      expect(run.exclusionReasons.INVALID_COORDINATES).toBe(1);
      expect(run.exclusionReasons.INVALID_UNIT).toBe(1);

      // Only the single valid observation was retained
      expect(run.suitability.observationCount).toBe(1);
      expect(run.status).toBe('NOT_VERIFIED');
    });

    it('blocks false positive SUITABLE: SOURCE_DECLARED with 100% completeness can NEVER be SUITABLE', async () => {
      // 721 hourly observations spanning 30 days (100% completeness, >= 720 obs, >= 29.53 days)
      const baseMs = new Date('2026-10-01T00:00:00Z').getTime();
      const obsBatch: HydrographicObservation[] = [];

      for (let i = 0; i < 721; i++) {
        const timeIso = new Date(baseMs + i * 3600000).toISOString();
        obsBatch.push({
          id: `obs-sourcedec-${i}`,
          stationId: 'casablanca-port',
          timestampUtc: timeIso,
          waterLevelMeters: 2.1 + 0.5 * Math.sin((i * 2 * Math.PI) / 12.42),
          verticalDatum: 'ZH',
          rawValue: 2.1 + 0.5 * Math.sin((i * 2 * Math.PI) / 12.42),
          rawUnit: 'm',
          qualityTier: 'observed',
          dataStatus: 'observation',
          provenance: {
            provider: 'ANP',
            retrievedAt: timeIso,
            quality: 'observed',
            status: 'observation',
            coordinates: { latitude: 33.6, longitude: -7.6 },
            units: { waterLevel: 'm' },
            isSimulatedFallback: false,
          },
        });
      }

      repo.saveObservationsBatch(obsBatch);

      const run = await validationEngine.validateStation({
        stationId: 'casablanca-port',
      });

      expect(run.suitability.datumVerificationStatus).toBe('SOURCE_DECLARED');
      expect(run.suitability.dataCompletenessPercentage).toBeGreaterThanOrEqual(85.0);
      expect(run.suitability.observationCount).toBe(721);
      // Because datum is SOURCE_DECLARED (not INDEPENDENTLY_VERIFIED), it MUST NOT be SUITABLE!
      expect(run.suitability.classification).toBe('MARGINAL');
      expect(run.suitability.reasons.some((r) => r.includes('lacks independent physical hydrographic benchmark'))).toBe(true);
    });

    it('blocks false positive SUITABLE: CONFIGURED datum can NEVER be SUITABLE', async () => {
      const station = repo.getStation('casablanca-port');
      expect(station?.verticalDatum).toBe('ZH');
      // Station metadata does not have isDatumIndependentlyVerified
      expect((station?.metadata as any)?.isDatumIndependentlyVerified).toBeFalsy();

      const run = await validationEngine.validateStation({
        stationId: 'casablanca-port',
      });

      expect(run.suitability.datumVerificationStatus).toBe('CONFIGURED');
      expect(run.suitability.classification).toBe('UNSUITABLE');
    });

    it('awards SUITABLE only when datum is INDEPENDENTLY_VERIFIED and all criteria satisfied', async () => {
      // Mark station as independently verified by certified benchmark survey
      const station = repo.getStation('casablanca-port');
      if (station) {
        station.metadata = {
          ...station.metadata,
          isDatumIndependentlyVerified: true,
          benchmarkSurveyRef: 'SHOM-ANP-BM-2026-01',
        };
        repo.saveStation(station);
      }

      // 721 hourly observations spanning 30 days
      const baseMs = new Date('2026-10-01T00:00:00Z').getTime();
      const obsBatch: HydrographicObservation[] = [];

      for (let i = 0; i < 721; i++) {
        const timeIso = new Date(baseMs + i * 3600000).toISOString();
        obsBatch.push({
          id: `obs-verified-${i}`,
          stationId: 'casablanca-port',
          timestampUtc: timeIso,
          waterLevelMeters: 2.1 + 0.5 * Math.sin((i * 2 * Math.PI) / 12.42),
          verticalDatum: 'ZH',
          rawValue: 2.1 + 0.5 * Math.sin((i * 2 * Math.PI) / 12.42),
          rawUnit: 'm',
          qualityTier: 'observed',
          dataStatus: 'observation',
          provenance: {
            provider: 'ANP',
            retrievedAt: timeIso,
            quality: 'observed',
            status: 'observation',
            coordinates: { latitude: 33.6, longitude: -7.6 },
            units: { waterLevel: 'm' },
            isSimulatedFallback: false,
          },
        });
      }

      repo.saveObservationsBatch(obsBatch);

      const run = await validationEngine.validateStation({
        stationId: 'casablanca-port',
      });

      expect(run.suitability.datumVerificationStatus).toBe('INDEPENDENTLY_VERIFIED');
      expect(run.suitability.dataCompletenessPercentage).toBeGreaterThanOrEqual(85.0);
      expect(run.suitability.coverageCheck).toBe(true);
      expect(run.suitability.classification).toBe('SUITABLE');
      expect(run.status).toBe('NOT_VERIFIED');
      expect(run.isCalibrationEnabled).toBe(false);
    });

    it('calculates true grid coverage: 720 observations clustered in 10 hours yields low coverage and is NOT SUITABLE', async () => {
      // Mark station independently verified to isolate coverage check
      const station = repo.getStation('casablanca-port');
      if (station) {
        station.metadata = { ...station.metadata, isDatumIndependentlyVerified: true };
        repo.saveStation(station);
      }

      // Start date: 2026-10-01, End date: 2026-10-31 (30 days = ~720 hours)
      // Clustered: 720 observations packed into the first 10 hours (e.g. 72 observations per hour)
      const baseMs = new Date('2026-10-01T00:00:00Z').getTime();
      const endMs = new Date('2026-10-31T00:00:00Z').getTime();
      const obsBatch: HydrographicObservation[] = [];

      for (let i = 0; i < 720; i++) {
        // spread across 10 hours: 10 * 3600000 = 36,000,000 ms
        const timeIso = new Date(baseMs + (i % 10) * 3600000 + Math.floor(i / 10) * 1000).toISOString();
        obsBatch.push({
          id: `obs-clustered-${i}`,
          stationId: 'casablanca-port',
          timestampUtc: timeIso,
          waterLevelMeters: 2.1,
          verticalDatum: 'ZH',
          rawValue: 2.1,
          rawUnit: 'm',
          qualityTier: 'observed',
          dataStatus: 'observation',
          provenance: {
            provider: 'ANP',
            retrievedAt: timeIso,
            quality: 'observed',
            status: 'observation',
            coordinates: { latitude: 33.6, longitude: -7.6 },
            units: { waterLevel: 'm' },
            isSimulatedFallback: false,
          },
        });
      }

      repo.saveObservationsBatch(obsBatch);

      const run = await validationEngine.validateStation({
        stationId: 'casablanca-port',
        startDateUtc: new Date(baseMs).toISOString(),
        endDateUtc: new Date(endMs).toISOString(),
      });

      // Expected hourly slots ~ 721, covered slots <= 10
      expect(run.suitability.expectedHourlySlots).toBeGreaterThan(700);
      expect(run.suitability.coveredHourlySlots).toBeLessThanOrEqual(10);
      expect(run.suitability.dataCompletenessPercentage).toBeLessThan(5.0);
      expect(run.suitability.classification).toBe('UNSUITABLE');
      expect(run.exclusionReasons.INSUFFICIENT_COVERAGE).toBeGreaterThan(700);
    });

    it('enforces strict 85.0% completeness rule: 84.9% covered slots is NOT SUITABLE, 85.0% is SUITABLE', async () => {
      // Mark station independently verified to test boundary
      const station = repo.getStation('casablanca-port');
      if (station) {
        station.metadata = { ...station.metadata, isDatumIndependentlyVerified: true };
        repo.saveStation(station);
      }

      // Expected slots = 1000 hours
      // 849 covered slots -> 84.9% completeness
      const baseMs = new Date('2026-10-01T00:00:00Z').getTime();
      const endMs = new Date(baseMs + 999 * 3600000).toISOString();
      const obsBatch849: HydrographicObservation[] = [];

      for (let i = 0; i < 849; i++) {
        const timeIso = new Date(baseMs + i * 3600000).toISOString();
        obsBatch849.push({
          id: `obs-849-${i}`,
          stationId: 'casablanca-port',
          timestampUtc: timeIso,
          waterLevelMeters: 2.1,
          verticalDatum: 'ZH',
          rawValue: 2.1,
          rawUnit: 'm',
          qualityTier: 'observed',
          dataStatus: 'observation',
          provenance: {
            provider: 'ANP',
            retrievedAt: timeIso,
            quality: 'observed',
            status: 'observation',
            coordinates: { latitude: 33.6, longitude: -7.6 },
            units: { waterLevel: 'm' },
            isSimulatedFallback: false,
          },
        });
      }

      repo.saveObservationsBatch(obsBatch849);

      const run849 = await validationEngine.validateStation({
        stationId: 'casablanca-port',
        startDateUtc: new Date(baseMs).toISOString(),
        endDateUtc: endMs,
      });

      expect(run849.suitability.dataCompletenessPercentage).toBe(84.9);
      expect(run849.suitability.classification).toBe('MARGINAL');
      expect(run849.suitability.coverageCheck).toBe(false);

      // Now add 1 more observation to reach 850 / 1000 = 85.0% completeness
      const timeIso850 = new Date(baseMs + 849 * 3600000).toISOString();
      repo.saveObservationsBatch([
        {
          id: 'obs-850',
          stationId: 'casablanca-port',
          timestampUtc: timeIso850,
          waterLevelMeters: 2.1,
          verticalDatum: 'ZH',
          rawValue: 2.1,
          rawUnit: 'm',
          qualityTier: 'observed',
          dataStatus: 'observation',
          provenance: {
            provider: 'ANP',
            retrievedAt: timeIso850,
            quality: 'observed',
            status: 'observation',
            coordinates: { latitude: 33.6, longitude: -7.6 },
            units: { waterLevel: 'm' },
            isSimulatedFallback: false,
          },
        },
      ]);

      const run850 = await validationEngine.validateStation({
        stationId: 'casablanca-port',
        startDateUtc: new Date(baseMs).toISOString(),
        endDateUtc: endMs,
      });

      expect(run850.suitability.dataCompletenessPercentage).toBe(85.0);
      expect(run850.suitability.coverageCheck).toBe(true);
      expect(run850.suitability.classification).toBe('SUITABLE');
    });

    it('correctly tracks hourly slots across UTC date boundaries and missing gaps', async () => {
      // 23:00 on Day 1 to 02:00 on Day 2 (4 hours across midnight UTC)
      // Omit 01:00 slot to test gap detection
      const t23 = '2026-11-08T23:00:00.000Z';
      const t00 = '2026-11-09T00:00:00.000Z';
      const t02 = '2026-11-09T02:00:00.000Z';

      const obsBatch: HydrographicObservation[] = [
        {
          id: 'obs-t23',
          stationId: 'casablanca-port',
          timestampUtc: t23,
          waterLevelMeters: 2.0,
          verticalDatum: 'ZH',
          rawValue: 2.0,
          rawUnit: 'm',
          qualityTier: 'observed',
          dataStatus: 'observation',
          provenance: {
            provider: 'ANP',
            retrievedAt: t23,
            quality: 'observed',
            status: 'observation',
            coordinates: { latitude: 33.6, longitude: -7.6 },
            units: { waterLevel: 'm' },
            isSimulatedFallback: false,
          },
        },
        {
          id: 'obs-t00',
          stationId: 'casablanca-port',
          timestampUtc: t00,
          waterLevelMeters: 2.1,
          verticalDatum: 'ZH',
          rawValue: 2.1,
          rawUnit: 'm',
          qualityTier: 'observed',
          dataStatus: 'observation',
          provenance: {
            provider: 'ANP',
            retrievedAt: t00,
            quality: 'observed',
            status: 'observation',
            coordinates: { latitude: 33.6, longitude: -7.6 },
            units: { waterLevel: 'm' },
            isSimulatedFallback: false,
          },
        },
        {
          id: 'obs-t02',
          stationId: 'casablanca-port',
          timestampUtc: t02,
          waterLevelMeters: 2.2,
          verticalDatum: 'ZH',
          rawValue: 2.2,
          rawUnit: 'm',
          qualityTier: 'observed',
          dataStatus: 'observation',
          provenance: {
            provider: 'ANP',
            retrievedAt: t02,
            quality: 'observed',
            status: 'observation',
            coordinates: { latitude: 33.6, longitude: -7.6 },
            units: { waterLevel: 'm' },
            isSimulatedFallback: false,
          },
        },
      ];

      repo.saveObservationsBatch(obsBatch);

      const run = await validationEngine.validateStation({
        stationId: 'casablanca-port',
        startDateUtc: t23,
        endDateUtc: t02,
      });

      expect(run.suitability.expectedHourlySlots).toBe(4); // 23:00, 00:00, 01:00, 02:00
      expect(run.suitability.coveredHourlySlots).toBe(3); // 23:00, 00:00, 02:00
      expect(run.suitability.missingHourlySlots).toBe(1); // 01:00 missing
      expect(run.suitability.dataCompletenessPercentage).toBe(75.0);
      expect(run.exclusionReasons.INSUFFICIENT_COVERAGE).toBe(1);
    });
  });

  describe('Hydrographic & Validation API Integration Endpoints', () => {
    let app: any;

    beforeEach(() => {
      const testDb = new Database(':memory:');
      setDatabaseForTesting(testDb);
      app = createApp();
    });

    afterEach(() => {
      closeDatabase();
    });

    it('GET /api/v1/hydrographic/stations lists all seeded stations', async () => {
      const res = await request(app).get('/api/v1/hydrographic/stations');
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(5);
      expect(res.body.stations[0].id).toBeDefined();
    });

    it('GET /api/v1/hydrographic/stations/:stationId returns station details', async () => {
      const res = await request(app).get('/api/v1/hydrographic/stations/casablanca-port');
      expect(res.status).toBe(200);
      expect(res.body.id).toBe('casablanca-port');
      expect(res.body.verticalDatum).toBe('ZH');
    });

    it('GET /api/v1/hydrographic/stations/:stationId/quality returns station quality report', async () => {
      const res = await request(app).get('/api/v1/hydrographic/stations/casablanca-port/quality');
      expect(res.status).toBe(200);
      expect(res.body.stationId).toBe('casablanca-port');
      expect(res.body.calibrationReadiness.isCalibrationEnabled).toBe(false);
    });

    it('POST /api/v1/hydrographic/stations/:stationId/validate runs empirical validation and stores run', async () => {
      const res = await request(app)
        .post('/api/v1/hydrographic/stations/casablanca-port/validate')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.id).toBeDefined();
      expect(res.body.stationId).toBe('casablanca-port');
      expect(res.body.status).toBe('NOT_VERIFIED');
      expect(res.body.isCalibrationEnabled).toBe(false);
      expect(res.body.exclusionReasons.DATUM_MISMATCH).toBeDefined();
      expect(res.body.exclusionReasons.INSUFFICIENT_COVERAGE).toBeDefined();

      const runId = res.body.id;

      const getRes = await request(app).get(`/api/v1/hydrographic/validations/${runId}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.id).toBe(runId);
      expect(getRes.body.stationId).toBe('casablanca-port');

      const listRes = await request(app).get(
        '/api/v1/hydrographic/stations/casablanca-port/validations'
      );
      expect(listRes.status).toBe(200);
      expect(listRes.body.count).toBe(1);
      expect(listRes.body.runs[0].id).toBe(runId);
    });

    it('POST /api/v1/hydrographic/stations/:stationId/validate returns 404 for unknown station', async () => {
      const res = await request(app)
        .post('/api/v1/hydrographic/stations/unknown-port/validate')
        .send({});

      expect(res.status).toBe(404);
      expect(res.body.error).toContain("Station not found: 'unknown-port'");
    });

    it('GET /api/v1/hydrographic/validations/:id returns 404 for unknown run', async () => {
      const res = await request(app).get('/api/v1/hydrographic/validations/val-non-existent');
      expect(res.status).toBe(404);
      expect(res.body.error).toContain("Validation run not found: 'val-non-existent'");
    });
  });
});
