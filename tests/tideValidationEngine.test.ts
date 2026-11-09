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
  detectLocalExtrema,
  DiscreteWaterLevelPoint,
  isValidCalendarUtcIso,
} from '../src/services/hydrographic/validationStatistics';
import {
  DatumVerificationBenchmarkProof,
  ValidationObservationPair,
} from '../src/domain/tideValidationModels';
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

    it('rejects non-finite inputs and arithmetic overflow in statistical metrics', () => {
      // 1. NaN in predicted water level
      expect(() =>
        calculateStatisticalMetrics([
          {
            timestampUtc: '2026-11-08T00:00:00Z',
            observedWaterLevelMeters: 2.0,
            predictedWaterLevelMeters: NaN,
            residualMeters: 0,
            verticalDatum: 'ZH',
            qualityTier: 'observed',
          },
        ])
      ).toThrow('Non-finite predicted water level');

      // 2. Infinity in observed water level
      expect(() =>
        calculateStatisticalMetrics([
          {
            timestampUtc: '2026-11-08T00:00:00Z',
            observedWaterLevelMeters: Infinity,
            predictedWaterLevelMeters: 2.0,
            residualMeters: 0,
            verticalDatum: 'ZH',
            qualityTier: 'observed',
          },
        ])
      ).toThrow('Non-finite observed water level');

      // 3. Overflow in squared error calculation (1e160 * 1e160 overflows to Infinity)
      expect(() =>
        calculateStatisticalMetrics([
          {
            timestampUtc: '2026-11-08T00:00:00Z',
            observedWaterLevelMeters: -1e160,
            predictedWaterLevelMeters: 1e160,
            residualMeters: 0,
            verticalDatum: 'ZH',
            qualityTier: 'observed',
          },
        ])
      ).toThrow('overflow in squared error');
    });

    it('validates extrema points and peak metric parameters for finite numbers and non-overflow', () => {
      // 1. Extrema detector explicitly throws on non-finite or desynchronized points
      expect(() =>
        detectLocalExtrema([
          { timestampUtc: '2026-11-08T00:00:00Z', timeMs: NaN, heightMeters: 1.0 },
          { timestampUtc: '2026-11-08T01:00:00Z', timeMs: new Date('2026-11-08T01:00:00Z').getTime(), heightMeters: 2.0 },
          { timestampUtc: '2026-11-08T02:00:00Z', timeMs: new Date('2026-11-08T02:00:00Z').getTime(), heightMeters: 1.0 },
        ])
      ).toThrow('Non-finite timeMs');

      expect(() =>
        detectLocalExtrema([
          { timestampUtc: '2026-11-08T00:00:00Z', timeMs: new Date('2026-11-08T00:00:00Z').getTime(), heightMeters: 1.0 },
          { timestampUtc: '2026-11-08T01:00:00Z', timeMs: new Date('2026-11-08T01:00:00Z').getTime(), heightMeters: Infinity },
          { timestampUtc: '2026-11-08T02:00:00Z', timeMs: new Date('2026-11-08T02:00:00Z').getTime(), heightMeters: 1.0 },
        ])
      ).toThrow('Non-finite heightMeters');

      expect(() =>
        detectLocalExtrema([
          { timestampUtc: 'invalid-date', timeMs: 0, heightMeters: 1.0 },
          { timestampUtc: '2026-11-08T01:00:00Z', timeMs: new Date('2026-11-08T01:00:00Z').getTime(), heightMeters: 2.0 },
          { timestampUtc: '2026-11-08T02:00:00Z', timeMs: new Date('2026-11-08T02:00:00Z').getTime(), heightMeters: 1.0 },
        ])
      ).toThrow('Invalid ISO 8601 UTC timestamp');

      expect(() =>
        detectLocalExtrema([
          { timestampUtc: '2026-11-08T00:00:00Z', timeMs: 9999999999, heightMeters: 1.0 }, // desynchronized!
          { timestampUtc: '2026-11-08T01:00:00Z', timeMs: new Date('2026-11-08T01:00:00Z').getTime(), heightMeters: 2.0 },
          { timestampUtc: '2026-11-08T02:00:00Z', timeMs: new Date('2026-11-08T02:00:00Z').getTime(), heightMeters: 1.0 },
        ])
      ).toThrow('Desynchronized point');

      expect(() =>
        detectLocalExtrema([
          { timestampUtc: '2026-11-08T00:00:00Z', timeMs: new Date('2026-11-08T00:00:00Z').getTime(), heightMeters: 1.0 },
          { timestampUtc: '2026-11-08T00:00:00Z', timeMs: new Date('2026-11-08T00:00:00Z').getTime(), heightMeters: 2.0 }, // duplicate!
          { timestampUtc: '2026-11-08T02:00:00Z', timeMs: new Date('2026-11-08T02:00:00Z').getTime(), heightMeters: 1.0 },
        ])
      ).toThrow('Duplicate timestamp detected');

      // Reject invalid one-point and two-point datasets before returning []
      expect(() =>
        detectLocalExtrema([
          { timestampUtc: '2026-11-08T00:00:00Z', timeMs: NaN, heightMeters: 1.0 },
        ])
      ).toThrow('Non-finite timeMs');

      expect(() =>
        detectLocalExtrema([
          { timestampUtc: '2026-11-08T00:00:00Z', timeMs: new Date('2026-11-08T00:00:00Z').getTime(), heightMeters: 1.0 },
          { timestampUtc: '2026-11-08T01:00:00Z', timeMs: new Date('2026-11-08T01:00:00Z').getTime(), heightMeters: Infinity },
        ])
      ).toThrow('Non-finite heightMeters');

      // Equivalent timestamp strings representing the exact same millisecond detected as duplicates
      expect(() =>
        detectLocalExtrema([
          { timestampUtc: '2026-11-08T00:00:00Z', timeMs: 1794096000000, heightMeters: 1.0 },
          { timestampUtc: '2026-11-08T00:00:00.000Z', timeMs: 1794096000000, heightMeters: 1.1 },
          { timestampUtc: '2026-11-08T01:00:00Z', timeMs: 1794099600000, heightMeters: 1.5 },
        ])
      ).toThrow('Duplicate timestamp detected');

      // Non-ISO timestamp strings ending in Z are strictly rejected
      expect(() =>
        detectLocalExtrema([
          { timestampUtc: 'fooZ', timeMs: new Date('fooZ').getTime(), heightMeters: 1.0 },
        ])
      ).toThrow('Invalid ISO 8601 UTC timestamp');

      expect(() =>
        detectLocalExtrema([
          { timestampUtc: '2026-11-08Z', timeMs: new Date('2026-11-08Z').getTime(), heightMeters: 1.0 },
        ])
      ).toThrow('Invalid ISO 8601 UTC timestamp');

      // PR #20: Strict calendar date validation rejects impossible calendar dates
      // 1. Impossible day in month (e.g. Feb 31)
      expect(() =>
        detectLocalExtrema([
          { timestampUtc: '2026-02-31T00:00:00Z', timeMs: new Date('2026-02-31T00:00:00Z').getTime(), heightMeters: 1.0 },
        ])
      ).toThrow('Invalid ISO 8601 UTC timestamp');

      // 2. Impossible month (e.g. Month 13)
      expect(() =>
        detectLocalExtrema([
          { timestampUtc: '2026-13-01T00:00:00Z', timeMs: new Date('2026-13-01T00:00:00Z').getTime(), heightMeters: 1.0 },
        ])
      ).toThrow('Invalid ISO 8601 UTC timestamp');

      // 3. Impossible hour (e.g. Hour 25)
      expect(() =>
        detectLocalExtrema([
          { timestampUtc: '2026-01-01T25:00:00Z', timeMs: new Date('2026-01-01T25:00:00Z').getTime(), heightMeters: 1.0 },
        ])
      ).toThrow('Invalid ISO 8601 UTC timestamp');

      // 4. Impossible minute (e.g. Minute 60)
      expect(() =>
        detectLocalExtrema([
          { timestampUtc: '2026-01-01T00:60:00Z', timeMs: new Date('2026-01-01T00:60:00Z').getTime(), heightMeters: 1.0 },
        ])
      ).toThrow('Invalid ISO 8601 UTC timestamp');

      // 5. Impossible second (e.g. Second 60)
      expect(() =>
        detectLocalExtrema([
          { timestampUtc: '2026-01-01T00:00:60Z', timeMs: new Date('2026-01-01T00:00:60Z').getTime(), heightMeters: 1.0 },
        ])
      ).toThrow('Invalid ISO 8601 UTC timestamp');

      // 6. Impossible Feb 29 in a non-leap year (2026)
      expect(() =>
        detectLocalExtrema([
          { timestampUtc: '2026-02-29T12:00:00Z', timeMs: new Date('2026-02-29T12:00:00Z').getTime(), heightMeters: 1.0 },
        ])
      ).toThrow('Invalid ISO 8601 UTC timestamp');

      // 7. Year 0000 and years 0001-0099 supported without Date.UTC(0..99) distortion
      const y0Iso = '0000-01-01T00:00:00Z';
      const y0Date = new Date(0);
      y0Date.setUTCFullYear(0, 0, 1);
      y0Date.setUTCHours(0, 0, 0, 0);
      expect(isValidCalendarUtcIso(y0Iso)).toBe(true);
      expect(
        detectLocalExtrema([
          { timestampUtc: y0Iso, timeMs: y0Date.getTime(), heightMeters: 1.0 },
        ])
      ).toEqual([]);

      const y50Iso = '0050-06-15T12:00:00Z';
      const y50Date = new Date(0);
      y50Date.setUTCFullYear(50, 5, 15);
      y50Date.setUTCHours(12, 0, 0, 0);
      expect(isValidCalendarUtcIso(y50Iso)).toBe(true);
      expect(
        detectLocalExtrema([
          { timestampUtc: y50Iso, timeMs: y50Date.getTime(), heightMeters: 1.0 },
        ])
      ).toEqual([]);

      // 8. Normal modern date
      const modernIso = '2026-11-08T14:30:00Z';
      const modernMs = new Date(modernIso).getTime();
      expect(isValidCalendarUtcIso(modernIso)).toBe(true);
      expect(
        detectLocalExtrema([
          { timestampUtc: modernIso, timeMs: modernMs, heightMeters: 1.0 },
        ])
      ).toEqual([]);

      // 9. Valid leap year date (2024-02-29)
      const leapIso = '2024-02-29T12:00:00Z';
      const leapMs = new Date(leapIso).getTime();
      expect(isValidCalendarUtcIso(leapIso)).toBe(true);
      expect(
        detectLocalExtrema([
          { timestampUtc: leapIso, timeMs: leapMs, heightMeters: 1.0 },
        ])
      ).toEqual([]);

      // 10. Fractional seconds with 1, 2, and 3 digits
      const frac1 = '2026-11-08T00:00:00.1Z';
      const frac2 = '2026-11-08T00:00:00.12Z';
      const frac3 = '2026-11-08T00:00:00.123Z';
      expect(isValidCalendarUtcIso(frac1)).toBe(true);
      expect(isValidCalendarUtcIso(frac2)).toBe(true);
      expect(isValidCalendarUtcIso(frac3)).toBe(true);
      expect(
        detectLocalExtrema([
          { timestampUtc: frac1, timeMs: new Date(frac1).getTime(), heightMeters: 1.0 },
        ])
      ).toEqual([]);
      expect(
        detectLocalExtrema([
          { timestampUtc: frac2, timeMs: new Date(frac2).getTime(), heightMeters: 1.0 },
        ])
      ).toEqual([]);
      expect(
        detectLocalExtrema([
          { timestampUtc: frac3, timeMs: new Date(frac3).getTime(), heightMeters: 1.0 },
        ])
      ).toEqual([]);

      // Empty and valid short datasets return [] after successful validation
      expect(detectLocalExtrema([])).toEqual([]);
      expect(
        detectLocalExtrema([
          { timestampUtc: '2026-11-08T00:00:00Z', timeMs: new Date('2026-11-08T00:00:00Z').getTime(), heightMeters: 1.0 },
        ])
      ).toEqual([]);
      expect(
        detectLocalExtrema([
          { timestampUtc: '2026-11-08T00:00:00Z', timeMs: new Date('2026-11-08T00:00:00Z').getTime(), heightMeters: 1.0 },
          { timestampUtc: '2026-11-08T01:00:00Z', timeMs: new Date('2026-11-08T01:00:00Z').getTime(), heightMeters: 1.5 },
        ])
      ).toEqual([]);

      // Unordered timestamps follow intentional chronological sorting policy
      const unorderedPoints: DiscreteWaterLevelPoint[] = [
        { timestampUtc: '2026-11-08T02:00:00Z', timeMs: 1794103200000, heightMeters: 1.0 },
        { timestampUtc: '2026-11-08T00:00:00Z', timeMs: 1794096000000, heightMeters: 1.2 },
        { timestampUtc: '2026-11-08T01:00:00Z', timeMs: 1794099600000, heightMeters: 3.0 },
      ];
      const detectedExtrema = detectLocalExtrema(unorderedPoints);
      expect(detectedExtrema).toHaveLength(1);
      expect(detectedExtrema[0].type).toBe('High');
      expect(detectedExtrema[0].timestampUtc).toBe('2026-11-08T01:00:00Z');

      // 2. Peak metrics rejects invalid matching window (NaN, negative, or overflowing)
      const t0 = new Date('2026-11-08T00:00:00Z').getTime();
      const validPoints: DiscreteWaterLevelPoint[] = [
        { timestampUtc: '2026-11-08T00:00:00Z', timeMs: t0, heightMeters: 1.0 },
        { timestampUtc: '2026-11-08T01:00:00Z', timeMs: t0 + 3600000, heightMeters: 2.0 },
        { timestampUtc: '2026-11-08T02:00:00Z', timeMs: t0 + 7200000, heightMeters: 1.0 },
      ];
      expect(() =>
        calculatePeakValidationMetrics(validPoints, validPoints, {
          maxMatchingWindowMinutes: NaN,
        })
      ).toThrow('Invalid maxMatchingWindowMinutes');

      expect(() =>
        calculatePeakValidationMetrics(validPoints, validPoints, {
          maxMatchingWindowMinutes: 1e10, // Overflow / unreasonably large (> 1440 min)
        })
      ).toThrow('Invalid maxMatchingWindowMinutes');

      // 3. Peak metrics rejects invalid medianObsIntervalMinutes
      expect(() =>
        calculatePeakValidationMetrics(validPoints, validPoints, {
          medianObsIntervalMinutes: -10,
        })
      ).toThrow('Invalid medianObsIntervalMinutes');
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

    it('proves no double counting: each rejected observation increments exactly one category and excludedCount', async () => {
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
            units: { waterLevel: 'm', rawUnit: 'm' },
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
            units: { waterLevel: 'm', rawUnit: 'm' },
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
            units: { waterLevel: 'm', rawUnit: 'm' },
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
            units: { waterLevel: 'm', rawUnit: 'm' },
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
            units: { waterLevel: 'm', rawUnit: 'm' },
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
            units: { waterLevel: 'm', rawUnit: 'knots' },
            isSimulatedFallback: false,
          },
        },
      ];

      repo.saveObservationsBatch(observations);

      const run = await validationEngine.validateStation({
        stationId: 'casablanca-port',
      });

      // Exactly 5 exclusions, sum of counters equals excludedCount
      expect(run.excludedCount).toBe(5);
      const totalCounted =
        run.exclusionReasons.DATUM_MISMATCH +
        run.exclusionReasons.DATUM_NOT_VERIFIED +
        run.exclusionReasons.INVALID_PROVENANCE +
        run.exclusionReasons.INVALID_UNIT +
        run.exclusionReasons.INVALID_COORDINATES +
        run.exclusionReasons.INVALID_TIMESTAMP +
        run.exclusionReasons.DUPLICATE_TIMESTAMP +
        run.exclusionReasons.OUT_OF_BOUNDS;

      expect(totalCounted).toBe(5);
      expect(run.exclusionReasons.DATUM_MISMATCH).toBe(1);
      expect(run.exclusionReasons.INVALID_PROVENANCE).toBe(1);
      expect(run.exclusionReasons.OUT_OF_BOUNDS).toBe(1);
      expect(run.exclusionReasons.INVALID_COORDINATES).toBe(1);
      expect(run.exclusionReasons.INVALID_UNIT).toBe(1);
      expect(run.suitability.observationCount).toBe(1);
    });

    it('rigorously tests all supported units (m, cm, mm, ft) and flags inconsistent conversion as INVALID_UNIT', async () => {
      const observations: HydrographicObservation[] = [
        // 1. Valid cm conversion: 250 cm -> 2.5 m
        {
          id: 'obs-cm-valid',
          stationId: 'casablanca-port',
          timestampUtc: '2026-11-08T01:00:00.000Z',
          waterLevelMeters: 2.5,
          verticalDatum: 'ZH',
          rawValue: 250,
          rawUnit: 'cm',
          qualityTier: 'observed',
          dataStatus: 'observation',
          provenance: {
            provider: 'ANP',
            retrievedAt: '2026-11-08T01:05:00Z',
            quality: 'observed',
            status: 'observation',
            coordinates: { latitude: 33.6, longitude: -7.6 },
            units: { waterLevel: 'm', rawUnit: 'cm' },
            isSimulatedFallback: false,
          },
        },
        // 2. Valid mm conversion: 2800 mm -> 2.8 m
        {
          id: 'obs-mm-valid',
          stationId: 'casablanca-port',
          timestampUtc: '2026-11-08T02:00:00.000Z',
          waterLevelMeters: 2.8,
          verticalDatum: 'ZH',
          rawValue: 2800,
          rawUnit: 'mm',
          qualityTier: 'observed',
          dataStatus: 'observation',
          provenance: {
            provider: 'ANP',
            retrievedAt: '2026-11-08T02:05:00Z',
            quality: 'observed',
            status: 'observation',
            coordinates: { latitude: 33.6, longitude: -7.6 },
            units: { waterLevel: 'm', rawUnit: 'mm' },
            isSimulatedFallback: false,
          },
        },
        // 3. Valid ft conversion: 10 ft -> 3.048 m
        {
          id: 'obs-ft-valid',
          stationId: 'casablanca-port',
          timestampUtc: '2026-11-08T03:00:00.000Z',
          waterLevelMeters: 3.048,
          verticalDatum: 'ZH',
          rawValue: 10,
          rawUnit: 'ft',
          qualityTier: 'observed',
          dataStatus: 'observation',
          provenance: {
            provider: 'ANP',
            retrievedAt: '2026-11-08T03:05:00Z',
            quality: 'observed',
            status: 'observation',
            coordinates: { latitude: 33.6, longitude: -7.6 },
            units: { waterLevel: 'm', rawUnit: 'ft' },
            isSimulatedFallback: false,
          },
        },
        // 4. Inconsistent mathematical conversion: rawValue 250 cm but waterLevelMeters = 1.0 (should be 2.5)
        {
          id: 'obs-bad-conversion',
          stationId: 'casablanca-port',
          timestampUtc: '2026-11-08T04:00:00.000Z',
          waterLevelMeters: 1.0,
          verticalDatum: 'ZH',
          rawValue: 250,
          rawUnit: 'cm',
          qualityTier: 'observed',
          dataStatus: 'observation',
          provenance: {
            provider: 'ANP',
            retrievedAt: '2026-11-08T04:05:00Z',
            quality: 'observed',
            status: 'observation',
            coordinates: { latitude: 33.6, longitude: -7.6 },
            units: { waterLevel: 'm', rawUnit: 'cm' },
            isSimulatedFallback: false,
          },
        },
        // 5. Contradictory provenance unit: rawUnit is 'm' but provenance declares rawUnit 'ft'
        {
          id: 'obs-contradictory-unit',
          stationId: 'casablanca-port',
          timestampUtc: '2026-11-08T05:00:00.000Z',
          waterLevelMeters: 2.5,
          verticalDatum: 'ZH',
          rawValue: 2.5,
          rawUnit: 'm',
          qualityTier: 'observed',
          dataStatus: 'observation',
          provenance: {
            provider: 'ANP',
            retrievedAt: '2026-11-08T05:05:00Z',
            quality: 'observed',
            status: 'observation',
            coordinates: { latitude: 33.6, longitude: -7.6 },
            units: { waterLevel: 'm', rawUnit: 'ft' }, // contradiction!
            isSimulatedFallback: false,
          },
        },
      ];

      repo.saveObservationsBatch(observations);

      const run = await validationEngine.validateStation({
        stationId: 'casablanca-port',
      });

      // 3 valid conversions passed, 2 bad unit conversions excluded as INVALID_UNIT
      expect(run.exclusionReasons.INVALID_UNIT).toBe(2);
      expect(run.suitability.observationCount).toBe(3);
    });

    it('rigorously tests non-finite coordinates (NaN, Infinity) triggering INVALID_COORDINATES', async () => {
      const baseMs = new Date('2026-11-08T00:00:00Z').getTime();
      const observations: HydrographicObservation[] = [
        // 1. NaN in latitude
        {
          id: 'obs-nan-lat',
          stationId: 'casablanca-port',
          timestampUtc: new Date(baseMs + 1 * 3600000).toISOString(),
          waterLevelMeters: 2.1,
          verticalDatum: 'ZH',
          rawValue: 2.1,
          rawUnit: 'm',
          qualityTier: 'observed',
          dataStatus: 'observation',
          provenance: {
            provider: 'ANP',
            retrievedAt: '2026-11-08T01:05:00Z',
            quality: 'observed',
            status: 'observation',
            coordinates: { latitude: NaN, longitude: -7.6 },
            units: { waterLevel: 'm', rawUnit: 'm' },
            isSimulatedFallback: false,
          },
        },
        // 2. Infinity in longitude
        {
          id: 'obs-inf-lon',
          stationId: 'casablanca-port',
          timestampUtc: new Date(baseMs + 2 * 3600000).toISOString(),
          waterLevelMeters: 2.1,
          verticalDatum: 'ZH',
          rawValue: 2.1,
          rawUnit: 'm',
          qualityTier: 'observed',
          dataStatus: 'observation',
          provenance: {
            provider: 'ANP',
            retrievedAt: '2026-11-08T02:05:00Z',
            quality: 'observed',
            status: 'observation',
            coordinates: { latitude: 33.6, longitude: Infinity },
            units: { waterLevel: 'm', rawUnit: 'm' },
            isSimulatedFallback: false,
          },
        },
      ];

      repo.saveObservationsBatch(observations);

      const run = await validationEngine.validateStation({
        stationId: 'casablanca-port',
      });

      expect(run.excludedCount).toBe(2);
      expect(run.exclusionReasons.INVALID_COORDINATES).toBe(2);
      expect(run.suitability.observationCount).toBe(0);
    });

    it('rigorously tests mandatory unit metadata completeness and non-finite values individually', async () => {
      const baseMs = new Date('2026-11-08T00:00:00Z').getTime();
      const observations: HydrographicObservation[] = [
        // 1. Missing units object entirely
        {
          id: 'obs-no-units-obj',
          stationId: 'casablanca-port',
          timestampUtc: new Date(baseMs + 1 * 3600000).toISOString(),
          waterLevelMeters: 2.1,
          verticalDatum: 'ZH',
          rawValue: 2.1,
          rawUnit: 'm',
          qualityTier: 'observed',
          dataStatus: 'observation',
          provenance: {
            provider: 'ANP',
            retrievedAt: '2026-11-08T01:05:00Z',
            quality: 'observed',
            status: 'observation',
            coordinates: { latitude: 33.6, longitude: -7.6 },
            units: null as any,
            isSimulatedFallback: false,
          },
        },
        // 2. Missing provenance.units.waterLevel
        {
          id: 'obs-missing-wl',
          stationId: 'casablanca-port',
          timestampUtc: new Date(baseMs + 2 * 3600000).toISOString(),
          waterLevelMeters: 2.1,
          verticalDatum: 'ZH',
          rawValue: 2.1,
          rawUnit: 'm',
          qualityTier: 'observed',
          dataStatus: 'observation',
          provenance: {
            provider: 'ANP',
            retrievedAt: '2026-11-08T02:05:00Z',
            quality: 'observed',
            status: 'observation',
            coordinates: { latitude: 33.6, longitude: -7.6 },
            units: { rawUnit: 'm' } as any,
            isSimulatedFallback: false,
          },
        },
        // 3. provenance.units.waterLevel is not 'm'
        {
          id: 'obs-wl-not-m',
          stationId: 'casablanca-port',
          timestampUtc: new Date(baseMs + 3 * 3600000).toISOString(),
          waterLevelMeters: 2.1,
          verticalDatum: 'ZH',
          rawValue: 2.1,
          rawUnit: 'm',
          qualityTier: 'observed',
          dataStatus: 'observation',
          provenance: {
            provider: 'ANP',
            retrievedAt: '2026-11-08T03:05:00Z',
            quality: 'observed',
            status: 'observation',
            coordinates: { latitude: 33.6, longitude: -7.6 },
            units: { waterLevel: 'ft', rawUnit: 'm' },
            isSimulatedFallback: false,
          },
        },
        // 4. Missing provenance.units.rawUnit
        {
          id: 'obs-missing-rawunit',
          stationId: 'casablanca-port',
          timestampUtc: new Date(baseMs + 4 * 3600000).toISOString(),
          waterLevelMeters: 2.1,
          verticalDatum: 'ZH',
          rawValue: 2.1,
          rawUnit: 'm',
          qualityTier: 'observed',
          dataStatus: 'observation',
          provenance: {
            provider: 'ANP',
            retrievedAt: '2026-11-08T04:05:00Z',
            quality: 'observed',
            status: 'observation',
            coordinates: { latitude: 33.6, longitude: -7.6 },
            units: { waterLevel: 'm' } as any,
            isSimulatedFallback: false,
          },
        },
        // 5. Empty unit string
        {
          id: 'obs-empty-unit',
          stationId: 'casablanca-port',
          timestampUtc: new Date(baseMs + 5 * 3600000).toISOString(),
          waterLevelMeters: 2.1,
          verticalDatum: 'ZH',
          rawValue: 2.1,
          rawUnit: '   ',
          qualityTier: 'observed',
          dataStatus: 'observation',
          provenance: {
            provider: 'ANP',
            retrievedAt: '2026-11-08T05:05:00Z',
            quality: 'observed',
            status: 'observation',
            coordinates: { latitude: 33.6, longitude: -7.6 },
            units: { waterLevel: 'm', rawUnit: '   ' },
            isSimulatedFallback: false,
          },
        },
        // 6. Non-finite waterLevelMeters (+Infinity)
        {
          id: 'obs-inf-wl',
          stationId: 'casablanca-port',
          timestampUtc: new Date(baseMs + 6 * 3600000).toISOString(),
          waterLevelMeters: Infinity,
          verticalDatum: 'ZH',
          rawValue: 2.1,
          rawUnit: 'm',
          qualityTier: 'observed',
          dataStatus: 'observation',
          provenance: {
            provider: 'ANP',
            retrievedAt: '2026-11-08T06:05:00Z',
            quality: 'observed',
            status: 'observation',
            coordinates: { latitude: 33.6, longitude: -7.6 },
            units: { waterLevel: 'm', rawUnit: 'm' },
            isSimulatedFallback: false,
          },
        },
        // 7. Non-finite waterLevelMeters (-Infinity)
        {
          id: 'obs-neginf-wl',
          stationId: 'casablanca-port',
          timestampUtc: new Date(baseMs + 7 * 3600000).toISOString(),
          waterLevelMeters: -Infinity,
          verticalDatum: 'ZH',
          rawValue: 2.1,
          rawUnit: 'm',
          qualityTier: 'observed',
          dataStatus: 'observation',
          provenance: {
            provider: 'ANP',
            retrievedAt: '2026-11-08T07:05:00Z',
            quality: 'observed',
            status: 'observation',
            coordinates: { latitude: 33.6, longitude: -7.6 },
            units: { waterLevel: 'm', rawUnit: 'm' },
            isSimulatedFallback: false,
          },
        },
      ];

      repo.saveObservationsBatch(observations);

      const run = await validationEngine.validateStation({
        stationId: 'casablanca-port',
      });

      expect(run.excludedCount).toBe(7);
      expect(run.exclusionReasons.INVALID_UNIT).toBe(7);
      expect(run.exclusionReasons.INVALID_PROVENANCE).toBe(0);
      expect(run.suitability.observationCount).toBe(0);
    });

    it('verifies exclusion accounting invariant with multiple simultaneous defects and single-assignment', async () => {
      const baseMs = new Date('2026-11-08T00:00:00Z').getTime();
      const observations: HydrographicObservation[] = [
        // Observation with MULTIPLE simultaneous defects:
        // Datum mismatch (LAT instead of ZH) AND invalid unit ('furlongs') AND bad coords AND out of bounds
        // Must be rejected at the first checkpoint and increment exactly ONE counter (DATUM_MISMATCH)
        {
          id: 'obs-multi-defect-1',
          stationId: 'casablanca-port',
          timestampUtc: new Date(baseMs + 1 * 3600000).toISOString(),
          waterLevelMeters: 55.0, // out of bounds
          verticalDatum: 'LAT', // datum mismatch
          rawValue: 55.0,
          rawUnit: 'furlongs' as any, // invalid unit
          qualityTier: 'observed',
          dataStatus: 'observation',
          provenance: {
            provider: 'ANP',
            retrievedAt: '2026-11-08T01:05:00Z',
            quality: 'observed',
            status: 'observation',
            coordinates: { latitude: 0.0, longitude: 0.0 }, // invalid coords
            units: { waterLevel: 'm', rawUnit: 'm' },
            isSimulatedFallback: false,
          },
        },
        // Observation with multiple unit & coordinate defects (different timestamp so both get persisted)
        {
          id: 'obs-multi-defect-2',
          stationId: 'casablanca-port',
          timestampUtc: new Date(baseMs + 2 * 3600000).toISOString(),
          waterLevelMeters: 2.1,
          verticalDatum: 'ZH',
          rawValue: 2.1,
          rawUnit: 'invalid' as any, // invalid unit (should be rejected as INVALID_UNIT before checking coordinates)
          qualityTier: 'observed',
          dataStatus: 'observation',
          provenance: {
            provider: 'ANP',
            retrievedAt: '2026-11-08T02:05:00Z',
            quality: 'observed',
            status: 'observation',
            coordinates: { latitude: 0.0, longitude: 0.0 }, // also invalid coordinates
            units: { waterLevel: 'm', rawUnit: 'invalid' },
            isSimulatedFallback: false,
          },
        },
      ];

      repo.saveObservationsBatch(observations);

      const run = await validationEngine.validateStation({
        stationId: 'casablanca-port',
      });

      expect(run.excludedCount).toBe(2);
      expect(run.exclusionReasons.DATUM_MISMATCH).toBe(1);
      expect(run.exclusionReasons.INVALID_UNIT).toBe(1);

      // Verify the invariant: excludedCount === sum(observation exclusion counters)
      const observationExclusionSum =
        run.exclusionReasons.DATUM_MISMATCH +
        run.exclusionReasons.DATUM_NOT_VERIFIED +
        run.exclusionReasons.INVALID_PROVENANCE +
        run.exclusionReasons.INVALID_UNIT +
        run.exclusionReasons.INVALID_COORDINATES +
        run.exclusionReasons.INVALID_TIMESTAMP +
        run.exclusionReasons.DUPLICATE_TIMESTAMP +
        run.exclusionReasons.OUT_OF_BOUNDS;

      expect(run.excludedCount).toBe(observationExclusionSum);
    });

    it('rejects promotion to INDEPENDENTLY_VERIFIED when benchmark proof is missing or incomplete (simple boolean false proof rejected)', async () => {
      const station = repo.getStation('casablanca-port');
      if (station) {
        station.metadata = {
          ...station.metadata,
          isDatumIndependentlyVerified: true, // Incomplete boolean only!
        };
        repo.saveStation(station);
      }

      const run = await validationEngine.validateStation({
        stationId: 'casablanca-port',
      });

      expect(run.suitability.datumVerificationStatus).not.toBe('INDEPENDENTLY_VERIFIED');
      expect(run.suitability.datumVerificationStatus).toBe('CONFIGURED');
      expect(run.suitability.classification).toBe('UNSUITABLE');
    });

    it('awards INDEPENDENTLY_VERIFIED only when full traceable benchmark proof is documented', async () => {
      const fullProof: DatumVerificationBenchmarkProof = {
        benchmarkCertificateId: 'BM-CERT-ANP-2026-0042',
        surveyReference: 'SURV-ATLANTIC-SHOM-2026',
        verificationAuthority: 'Agence Nationale des Ports (ANP)',
        verificationDateUtc: '2026-05-15T00:00:00Z',
        verificationDocumentReference: 'DOC-ANP-HYDRO-ZH-042',
      };

      const station = repo.getStation('casablanca-port');
      if (station) {
        station.metadata = {
          ...station.metadata,
          datumBenchmarkProof: fullProof,
        };
        repo.saveStation(station);
      }

      // 721 hourly observations spanning 30 days
      const baseMs = new Date('2026-10-01T00:00:00Z').getTime();
      const obsBatch: HydrographicObservation[] = [];

      for (let i = 0; i < 721; i++) {
        const timeIso = new Date(baseMs + i * 3600000).toISOString();
        obsBatch.push({
          id: `obs-cert-${i}`,
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
            units: { waterLevel: 'm', rawUnit: 'm' },
            isSimulatedFallback: false,
          },
        });
      }

      repo.saveObservationsBatch(obsBatch);

      const run = await validationEngine.validateStation({
        stationId: 'casablanca-port',
      });

      expect(run.suitability.datumVerificationStatus).toBe('INDEPENDENTLY_VERIFIED');
      expect(run.suitability.benchmarkProof?.benchmarkCertificateId).toBe('BM-CERT-ANP-2026-0042');
      expect(run.suitability.classification).toBe('SUITABLE');
      expect(run.status).toBe('NOT_VERIFIED');
      expect(run.isCalibrationEnabled).toBe(false);
    });

    it('blocks false positive SUITABLE: SOURCE_DECLARED with 100% completeness can NEVER be SUITABLE', async () => {
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
            units: { waterLevel: 'm', rawUnit: 'm' },
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
      expect(run.suitability.classification).toBe('MARGINAL');
      expect(run.suitability.reasons.some((r) => r.includes('lacks independent physical hydrographic benchmark'))).toBe(true);
    });

    it('calculates true grid coverage: 720 observations clustered in 10 hours yields low coverage and is NOT SUITABLE', async () => {
      const fullProof: DatumVerificationBenchmarkProof = {
        benchmarkCertificateId: 'BM-CERT-ANP-2026-0042',
        surveyReference: 'SURV-ATLANTIC-SHOM-2026',
        verificationAuthority: 'ANP',
        verificationDateUtc: '2026-05-15T00:00:00Z',
        verificationDocumentReference: 'DOC-ANP-HYDRO-ZH-042',
      };

      const station = repo.getStation('casablanca-port');
      if (station) {
        station.metadata = { ...station.metadata, datumBenchmarkProof: fullProof };
        repo.saveStation(station);
      }

      const baseMs = new Date('2026-10-01T00:00:00Z').getTime();
      const endMs = new Date('2026-10-31T00:00:00Z').getTime();
      const obsBatch: HydrographicObservation[] = [];

      for (let i = 0; i < 720; i++) {
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
            units: { waterLevel: 'm', rawUnit: 'm' },
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

      expect(run.suitability.expectedHourlySlots).toBeGreaterThan(700);
      expect(run.suitability.coveredHourlySlots).toBeLessThanOrEqual(10);
      expect(run.suitability.dataCompletenessPercentage).toBeLessThan(5.0);
      expect(run.suitability.classification).toBe('UNSUITABLE');
      expect(run.exclusionReasons.INSUFFICIENT_COVERAGE).toBeGreaterThan(700);
    });

    it('enforces strict 85.0% completeness rule: 84.9% covered slots is NOT SUITABLE, 85.0% is SUITABLE', async () => {
      const fullProof: DatumVerificationBenchmarkProof = {
        benchmarkCertificateId: 'BM-CERT-ANP-2026-0042',
        surveyReference: 'SURV-ATLANTIC-SHOM-2026',
        verificationAuthority: 'ANP',
        verificationDateUtc: '2026-05-15T00:00:00Z',
        verificationDocumentReference: 'DOC-ANP-HYDRO-ZH-042',
      };

      const station = repo.getStation('casablanca-port');
      if (station) {
        station.metadata = { ...station.metadata, datumBenchmarkProof: fullProof };
        repo.saveStation(station);
      }

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
            units: { waterLevel: 'm', rawUnit: 'm' },
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

      // Add 1 more observation to reach 850 / 1000 = 85.0% completeness
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
            units: { waterLevel: 'm', rawUnit: 'm' },
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

    it('correctly tracks hourly slots with tolerance boundary (±30m) and unaligned period start/end', async () => {
      const tStart = '2026-11-08T10:15:00.000Z';
      const tEnd = '2026-11-08T13:45:00.000Z';

      const obsBatch: HydrographicObservation[] = [
        {
          id: 'obs-tol-1',
          stationId: 'casablanca-port',
          timestampUtc: '2026-11-08T10:30:00.000Z',
          waterLevelMeters: 2.1,
          verticalDatum: 'ZH',
          rawValue: 2.1,
          rawUnit: 'm',
          qualityTier: 'observed',
          dataStatus: 'observation',
          provenance: {
            provider: 'ANP',
            retrievedAt: '2026-11-08T10:35:00Z',
            quality: 'observed',
            status: 'observation',
            coordinates: { latitude: 33.6, longitude: -7.6 },
            units: { waterLevel: 'm', rawUnit: 'm' },
            isSimulatedFallback: false,
          },
        },
        {
          id: 'obs-tol-2',
          stationId: 'casablanca-port',
          timestampUtc: '2026-11-08T12:00:00.000Z',
          waterLevelMeters: 2.2,
          verticalDatum: 'ZH',
          rawValue: 2.2,
          rawUnit: 'm',
          qualityTier: 'observed',
          dataStatus: 'observation',
          provenance: {
            provider: 'ANP',
            retrievedAt: '2026-11-08T12:05:00Z',
            quality: 'observed',
            status: 'observation',
            coordinates: { latitude: 33.6, longitude: -7.6 },
            units: { waterLevel: 'm', rawUnit: 'm' },
            isSimulatedFallback: false,
          },
        },
      ];

      repo.saveObservationsBatch(obsBatch);

      const run = await validationEngine.validateStation({
        stationId: 'casablanca-port',
        startDateUtc: tStart,
        endDateUtc: tEnd,
        hourlySlotToleranceMinutes: 30,
      });

      expect(run.suitability.expectedHourlySlots).toBe(4);
      expect(run.suitability.coveredHourlySlots).toBe(2);
      expect(run.suitability.missingHourlySlots).toBe(2);
      expect(run.suitability.dataCompletenessPercentage).toBe(50.0);
      expect(run.exclusionReasons.INSUFFICIENT_COVERAGE).toBe(2);
    });

    it('enforces prediction loop safeguards: rejects invalid predictionResolutionMinutes and excessive prediction workloads', async () => {
      // 1. Invalid prediction resolution <= 0
      await expect(
        validationEngine.validateStation({
          stationId: 'casablanca-port',
          predictionResolutionMinutes: 0,
        })
      ).rejects.toThrow();

      // 2. Non-finite prediction resolution (NaN)
      await expect(
        validationEngine.validateStation({
          stationId: 'casablanca-port',
          predictionResolutionMinutes: NaN,
        })
      ).rejects.toThrow();

      // 3. Permitted boundary workload (within 50,000 points limit) executes properly
      // A span of 100 hours with 10 min resolution = 601 prediction points <= 50,000
      const baseMs = new Date('2026-11-08T00:00:00Z').getTime();
      const validPoints: HydrographicObservation[] = [
        {
          id: 'obs-workload-ok-1',
          stationId: 'casablanca-port',
          timestampUtc: '2026-11-08T00:00:00Z',
          waterLevelMeters: 2.0,
          verticalDatum: 'ZH',
          rawValue: 2.0,
          rawUnit: 'm',
          qualityTier: 'observed',
          dataStatus: 'observation',
          provenance: {
            provider: 'ANP',
            retrievedAt: '2026-11-08T00:05:00Z',
            quality: 'observed',
            status: 'observation',
            coordinates: { latitude: 33.6, longitude: -7.6 },
            units: { waterLevel: 'm', rawUnit: 'm' },
            isSimulatedFallback: false,
          },
        },
        {
          id: 'obs-workload-ok-2',
          stationId: 'casablanca-port',
          timestampUtc: '2026-11-12T04:00:00Z', // 100 hours later
          waterLevelMeters: 2.5,
          verticalDatum: 'ZH',
          rawValue: 2.5,
          rawUnit: 'm',
          qualityTier: 'observed',
          dataStatus: 'observation',
          provenance: {
            provider: 'ANP',
            retrievedAt: '2026-11-12T04:05:00Z',
            quality: 'observed',
            status: 'observation',
            coordinates: { latitude: 33.6, longitude: -7.6 },
            units: { waterLevel: 'm', rawUnit: 'm' },
            isSimulatedFallback: false,
          },
        },
      ];
      repo.saveObservationsBatch(validPoints);

      const permittedRun = await validationEngine.validateStation({
        stationId: 'casablanca-port',
        startDateUtc: '2026-11-08T00:00:00Z',
        endDateUtc: '2026-11-12T04:00:00Z',
        predictionResolutionMinutes: 10,
      });
      expect(permittedRun.id).toBeDefined();

      // 4. Exceeding workload (> 50,000 points) is rejected BEFORE provider calls begin
      // Spy on provider to verify 0 calls during independent peak generation when limit is breached
      const mockProvider: any = {
        providerId: 'spy-provider',
        getTidePrediction: vi.fn().mockResolvedValue({
          currentTide: { heightMeters: 2.1, type: 'Rising' },
        }),
      };
      const engineWithSpy = new EmpiricalValidationEngine(repo, mockProvider);

      // Save a valid observation in 2026 so validPairs.length > 0 triggers peak detection
      const obsTime1 = '2026-01-01T00:00:00Z';
      const obsTime2 = '2026-01-15T00:00:00Z';
      repo.saveObservationsBatch([
        {
          id: 'obs-spy-workload-1',
          stationId: 'casablanca-port',
          timestampUtc: obsTime1,
          waterLevelMeters: 2.1,
          verticalDatum: 'ZH',
          rawValue: 2.1,
          rawUnit: 'm',
          qualityTier: 'observed',
          dataStatus: 'observation',
          provenance: {
            provider: 'ANP',
            retrievedAt: obsTime1,
            quality: 'observed',
            status: 'observation',
            coordinates: { latitude: 33.6, longitude: -7.6 },
            units: { waterLevel: 'm', rawUnit: 'm' },
            isSimulatedFallback: false,
          },
        },
        {
          id: 'obs-spy-workload-2',
          stationId: 'casablanca-port',
          timestampUtc: obsTime2,
          waterLevelMeters: 2.2,
          verticalDatum: 'ZH',
          rawValue: 2.2,
          rawUnit: 'm',
          qualityTier: 'observed',
          dataStatus: 'observation',
          provenance: {
            provider: 'ANP',
            retrievedAt: obsTime2,
            quality: 'observed',
            status: 'observation',
            coordinates: { latitude: 33.6, longitude: -7.6 },
            units: { waterLevel: 'm', rawUnit: 'm' },
            isSimulatedFallback: false,
          },
        },
      ]);

      // 50,001 points: 50,000 minutes = ~34.72 days with 1-min resolution
      const startMs = new Date('2026-01-01T00:00:00Z').getTime();
      const endMsExceeded = new Date(startMs + 50001 * 60 * 1000).toISOString();

      await expect(
        engineWithSpy.validateStation({
          stationId: 'casablanca-port',
          startDateUtc: '2026-01-01T00:00:00Z',
          endDateUtc: endMsExceeded,
          predictionResolutionMinutes: 1, // (50001 * 60000) / 60000 + 1 = 50,002 > 50,000
        })
      ).rejects.toThrow('Excessive prediction workload');

      // Verify that provider was only called for the 2 observations alignment, never for 50,000 peak points
      expect(mockProvider.getTidePrediction).toHaveBeenCalledTimes(2);
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
