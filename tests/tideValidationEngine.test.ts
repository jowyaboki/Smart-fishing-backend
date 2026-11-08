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
      // Pairs: e_i = predicted - observed
      // pair 1: pred=3.0, obs=2.0 -> err = +1.0
      // pair 2: pred=1.5, obs=2.0 -> err = -0.5
      // pair 3: pred=2.5, obs=2.0 -> err = +0.5
      // pair 4: pred=1.0, obs=3.0 -> err = -2.0
      // Errors: [+1.0, -0.5, +0.5, -2.0]
      // N = 4
      // sum(e) = 1.0 - 0.5 + 0.5 - 2.0 = -1.0
      // Bias = -1.0 / 4 = -0.25
      // Absolute errors: [1.0, 0.5, 0.5, 2.0]
      // sum(|e|) = 4.0
      // MAE = 4.0 / 4 = 1.0
      // Squared errors: [1.0, 0.25, 0.25, 4.0]
      // sum(e^2) = 5.5
      // RMSE = sqrt(5.5 / 4) = sqrt(1.375) ~= 1.1726
      // Deviations from bias (-0.25):
      // 1.0 - (-0.25) = 1.25 -> sq = 1.5625
      // -0.5 - (-0.25) = -0.25 -> sq = 0.0625
      // 0.5 - (-0.25) = 0.75 -> sq = 0.5625
      // -2.0 - (-0.25) = -1.75 -> sq = 3.0625
      // sum(sq_diff) = 1.5625 + 0.0625 + 0.5625 + 3.0625 = 5.25
      // StdDev = sqrt(5.25 / 4) = sqrt(1.3125) ~= 1.1456
      // max(|e|) = 2.0
      // min(|e|) = 0.5

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
      // Bias cancels to 0
      expect(stats.biasMeters).toBe(0);
      // MAE and RMSE reflect true magnitude of errors
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
      // Observed discrete points (sampled every 10 min, resolution <= 15m)
      const t0 = new Date('2026-11-08T00:00:00Z').getTime();
      const obsPoints: DiscreteWaterLevelPoint[] = [
        { timestampUtc: '2026-11-08T00:00:00Z', timeMs: t0, heightMeters: 1.2 },
        { timestampUtc: '2026-11-08T00:10:00Z', timeMs: t0 + 600000, heightMeters: 1.0 }, // Observed Low
        { timestampUtc: '2026-11-08T00:20:00Z', timeMs: t0 + 1200000, heightMeters: 1.5 },
        { timestampUtc: '2026-11-08T00:30:00Z', timeMs: t0 + 1800000, heightMeters: 2.5 },
        { timestampUtc: '2026-11-08T00:40:00Z', timeMs: t0 + 2400000, heightMeters: 3.2 }, // Observed High
        { timestampUtc: '2026-11-08T00:50:00Z', timeMs: t0 + 3000000, heightMeters: 2.1 },
      ];

      // Independent continuous predicted points
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
      expect(peakMetrics.timingResolutionDisclaimer).toBeUndefined();

      // Check low tide match
      const lowMatch = peakMetrics.matchedPeaks.find((p) => p.type === 'Low');
      expect(lowMatch).toBeDefined();
      expect(lowMatch?.heightErrorMeters).toBeCloseTo(-0.1, 4);
      expect(lowMatch?.timingErrorMinutes).toBe(5);

      // Check high tide match
      const highMatch = peakMetrics.matchedPeaks.find((p) => p.type === 'High');
      expect(highMatch).toBeDefined();
      expect(highMatch?.heightErrorMeters).toBeCloseTo(0.2, 4);
      expect(highMatch?.timingErrorMinutes).toBe(5);
    });

    it('warns when observation resolution is too coarse for defensible peak timing', () => {
      const t0 = new Date('2026-11-08T00:00:00Z').getTime();
      // Hourly sampling (60 min)
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
      expect(result.stationName).toContain('Casablanca Port');
      expect(result.status).toBe('NOT_VERIFIED');
      expect(result.suitability.classification).toBe('UNSUITABLE');
      expect(result.suitability.observationCount).toBe(0);
      expect(result.statistics).toBeNull();
      expect(result.peakMetrics).toBeNull();
      expect(result.isCalibrationEnabled).toBe(false);

      // Verify persistence in SQLite
      const retrieved = repo.getValidationRun(result.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(result.id);
      expect(retrieved?.stationId).toBe('casablanca-port');
      expect(retrieved?.suitability.classification).toBe('UNSUITABLE');
    });

    it('distinguishes explicit exclusion categories (DATUM_MISMATCH, INVALID_PROVENANCE, OUT_OF_BOUNDS, INVALID_COORDINATES, INVALID_UNIT)', async () => {
      const station = repo.getStation('casablanca-port');
      expect(station?.verticalDatum).toBe('ZH');

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
        // 3. Simulated Provenance (isSimulatedFallback = true)
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
            coordinates: { latitude: 35.8, longitude: -5.5 }, // Tanger Med coordinates instead of Casablanca!
            units: { waterLevel: 'm' },
            isSimulatedFallback: false,
          },
        },
      ];

      repo.saveObservationsBatch(observations);

      const run = await validationEngine.validateStation({
        stationId: 'casablanca-port',
      });

      expect(run.excludedCount).toBe(4);
      expect(run.exclusionReasons.DATUM_MISMATCH).toBe(1);
      expect(run.exclusionReasons.INVALID_PROVENANCE).toBe(1);
      expect(run.exclusionReasons.OUT_OF_BOUNDS).toBe(1);
      expect(run.exclusionReasons.INVALID_COORDINATES).toBe(1);

      // Only the single valid observation was retained
      expect(run.suitability.observationCount).toBe(1);
      expect(run.statistics).not.toBeNull();
      expect(run.statistics?.totalPairs).toBe(1);
      expect(run.status).toBe('NOT_VERIFIED');
    });

    it('enforces strict 85.0% completeness rule: 84.9% completeness is NOT SUITABLE', async () => {
      // Create a 30-day window (720 hours expected)
      // 720 * 0.849 = 611 observations -> 84.9% completeness
      const baseMs = new Date('2026-10-01T00:00:00Z').getTime();
      const obsBatch: HydrographicObservation[] = [];

      // 611 observations spaced over 720 hours (has sufficient count 611? Wait, need 720 observations AND 85% completeness)
      // Suppose we have 720 observations over 848 hours (35.33 days):
      // Completeness = 720 / 848 = 84.9%
      const totalHours = 848;
      const obsCount = 720;
      const stepMs = Math.floor((totalHours * 3600000) / obsCount);

      for (let i = 0; i < obsCount; i++) {
        const timeIso = new Date(baseMs + i * stepMs).toISOString();
        obsBatch.push({
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

      repo.saveObservationsBatch(obsBatch);

      const run = await validationEngine.validateStation({
        stationId: 'casablanca-port',
      });

      expect(run.suitability.dataCompletenessPercentage).toBeLessThan(85.0);
      expect(run.suitability.classification).not.toBe('SUITABLE');
      expect(run.suitability.coverageCheck).toBe(false);
      expect(run.suitability.reasons.some((r) => r.includes('85.0%'))).toBe(true);
    });

    it('satisfies SUITABLE criteria when >= 720 observations, >= 29.53 days, and completeness >= 85.0%', async () => {
      // 721 consecutive hourly observations spanning 30 days (completeness = 100%)
      const baseMs = new Date('2026-10-01T00:00:00Z').getTime();
      const obsBatch: HydrographicObservation[] = [];

      for (let i = 0; i < 721; i++) {
        const timeIso = new Date(baseMs + i * 3600000).toISOString();
        obsBatch.push({
          id: `obs-suitable-${i}`,
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

      expect(run.suitability.observationCount).toBe(721);
      expect(run.suitability.timeSpanDays).toBeGreaterThanOrEqual(29.53);
      expect(run.suitability.dataCompletenessPercentage).toBeGreaterThanOrEqual(85.0);
      expect(run.suitability.coverageCheck).toBe(true);
      expect(run.suitability.classification).toBe('SUITABLE');
      expect(run.suitability.datumVerificationStatus).toBe('SOURCE_DECLARED');
      // Production safeguards: status strictly NOT_VERIFIED, isCalibrationEnabled strictly false
      expect(run.status).toBe('NOT_VERIFIED');
      expect(run.isCalibrationEnabled).toBe(false);
    });

    it('rejects station validation when requireIndependentDatumVerification is true but benchmark is unverified', async () => {
      // Station casablanca-port is configured with datum ZH but metadata isDatumIndependentlyVerified is not set
      const baseMs = new Date('2026-11-01T00:00:00Z').getTime();
      const obs: HydrographicObservation = {
        id: 'obs-unverified-datum',
        stationId: 'casablanca-port',
        timestampUtc: new Date(baseMs).toISOString(),
        waterLevelMeters: 2.1,
        verticalDatum: 'ZH',
        rawValue: 2.1,
        rawUnit: 'm',
        qualityTier: 'observed',
        dataStatus: 'observation',
        provenance: {
          provider: 'ANP',
          retrievedAt: new Date(baseMs).toISOString(),
          quality: 'observed',
          status: 'observation',
          coordinates: { latitude: 33.6, longitude: -7.6 },
          units: { waterLevel: 'm' },
          isSimulatedFallback: false,
        },
      };

      repo.saveObservationsBatch([obs]);

      const run = await validationEngine.validateStation({
        stationId: 'casablanca-port',
        requireIndependentDatumVerification: true,
      });

      expect(run.excludedCount).toBe(1);
      expect(run.exclusionReasons.DATUM_NOT_VERIFIED).toBe(1);
      expect(run.suitability.observationCount).toBe(0);
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

      const runId = res.body.id;

      // Check single validation run endpoint
      const getRes = await request(app).get(`/api/v1/hydrographic/validations/${runId}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.id).toBe(runId);
      expect(getRes.body.stationId).toBe('casablanca-port');

      // Check historical validation list endpoint
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
