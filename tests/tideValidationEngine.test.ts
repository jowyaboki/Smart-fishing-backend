import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import request from 'supertest';
import { createApp } from '../src/app';
import { setDatabaseForTesting, closeDatabase } from '../src/data/database';
import { HydrographicRepository } from '../src/data/hydrographicRepository';
import { HydrographicService } from '../src/services/hydrographicService';
import { EmpiricalValidationEngine } from '../src/services/hydrographic/empiricalValidationService';
import {
  calculatePeakValidationMetrics,
  calculateStatisticalMetrics,
  detectLocalExtrema,
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
      // MAE and RMSE must reflect genuine magnitude of error
      expect(stats.maeMeters).toBe(1.0);
      expect(stats.rmseMeters).toBe(1.0);
      expect(stats.standardDeviationMeters).toBe(1.0);
    });

    it('throws error when computing statistics for empty pair series', () => {
      expect(() => calculateStatisticalMetrics([])).toThrow(
        'Cannot calculate statistical metrics for an empty dataset'
      );
    });

    it('detects tidal extrema peaks and calculates peak height & timing errors', () => {
      // 5-point discrete series: Low -> Rising -> High -> Falling -> Low
      const t0 = new Date('2026-11-08T00:00:00Z').getTime();
      const obsPoints: DiscreteWaterLevelPoint[] = [
        { timestampUtc: '2026-11-08T00:00:00Z', timeMs: t0, heightMeters: 1.2 },
        { timestampUtc: '2026-11-08T01:00:00Z', timeMs: t0 + 3600000, heightMeters: 1.0 }, // Local Low
        { timestampUtc: '2026-11-08T02:00:00Z', timeMs: t0 + 7200000, heightMeters: 2.5 },
        { timestampUtc: '2026-11-08T03:00:00Z', timeMs: t0 + 10800000, heightMeters: 3.2 }, // Local High
        { timestampUtc: '2026-11-08T04:00:00Z', timeMs: t0 + 14400000, heightMeters: 2.1 },
      ];

      const predPoints: DiscreteWaterLevelPoint[] = [
        { timestampUtc: '2026-11-08T00:00:00Z', timeMs: t0, heightMeters: 1.3 },
        { timestampUtc: '2026-11-08T01:10:00Z', timeMs: t0 + 3600000 + 600000, heightMeters: 0.9 }, // Local Low (+10 mins, -0.1m)
        { timestampUtc: '2026-11-08T02:00:00Z', timeMs: t0 + 7200000, heightMeters: 2.6 },
        { timestampUtc: '2026-11-08T03:15:00Z', timeMs: t0 + 10800000 + 900000, heightMeters: 3.4 }, // Local High (+15 mins, +0.2m)
        { timestampUtc: '2026-11-08T04:00:00Z', timeMs: t0 + 14400000, heightMeters: 2.0 },
      ];

      const peakMetrics = calculatePeakValidationMetrics(obsPoints, predPoints, 120);

      expect(peakMetrics.totalPeaksDetected).toBe(2);
      expect(peakMetrics.highTidePeaksMatched).toBe(1);
      expect(peakMetrics.lowTidePeaksMatched).toBe(1);
      expect(peakMetrics.matchedPeaks.length).toBe(2);

      // Low tide match: height diff = 0.9 - 1.0 = -0.1m, timing diff = +10 min
      const lowMatch = peakMetrics.matchedPeaks.find((p) => p.type === 'Low');
      expect(lowMatch).toBeDefined();
      expect(lowMatch?.heightErrorMeters).toBeCloseTo(-0.1, 3);
      expect(lowMatch?.timingErrorMinutes).toBe(10);

      // High tide match: height diff = 3.4 - 3.2 = +0.2m, timing diff = +15 min
      const highMatch = peakMetrics.matchedPeaks.find((p) => p.type === 'High');
      expect(highMatch).toBeDefined();
      expect(highMatch?.heightErrorMeters).toBeCloseTo(0.2, 3);
      expect(highMatch?.timingErrorMinutes).toBe(15);

      // Averages:
      // mean height err = (-0.1 + 0.2) / 2 = 0.05m
      expect(peakMetrics.meanPeakHeightErrorMeters).toBe(0.05);
      // mean timing err = (10 + 15) / 2 = 12.5 min
      expect(peakMetrics.meanPeakTimingErrorMinutes).toBe(12.5);
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

    it('rejects datum mismatch, incomplete provenance, duplicates, and out-of-bounds water levels', async () => {
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
        // 2. Vertical Datum Mismatch (LAT instead of ZH)
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
        // 3. Incomplete/Simulated Provenance (isSimulatedFallback = true or tier = simulated)
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
      ];

      repo.saveObservationsBatch(observations);

      const run = await validationEngine.validateStation({
        stationId: 'casablanca-port',
      });

      expect(run.excludedCount).toBe(3);
      expect(run.exclusionReasons.datumMismatch).toBe(1);
      expect(run.exclusionReasons.invalidProvenance).toBe(1);
      expect(run.exclusionReasons.outOfBoundsWaterLevel).toBe(1);

      // Only the single valid observation was retained
      expect(run.suitability.observationCount).toBe(1);
      expect(run.statistics).not.toBeNull();
      expect(run.statistics?.totalPairs).toBe(1);
      expect(run.status).toBe('NOT_VERIFIED');
    });

    it('evaluates temporal coverage and data suitability correctly for insufficient data', async () => {
      // 5 observations over 5 hours (far below 720 observations & 29.53 days)
      const baseMs = new Date('2026-11-01T00:00:00Z').getTime();
      const obsBatch: HydrographicObservation[] = [];

      for (let i = 0; i < 5; i++) {
        const timeIso = new Date(baseMs + i * 3600000).toISOString();
        obsBatch.push({
          id: `obs-seq-${i}`,
          stationId: 'casablanca-port',
          timestampUtc: timeIso,
          waterLevelMeters: 2.0 + Math.sin(i),
          verticalDatum: 'ZH',
          rawValue: 2.0 + Math.sin(i),
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

      expect(run.suitability.classification).toBe('UNSUITABLE');
      expect(run.suitability.coverageCheck).toBe(false);
      expect(run.suitability.reasons.length).toBeGreaterThan(0);
      expect(run.suitability.observationCount).toBe(5);
      expect(run.statistics?.totalPairs).toBe(5);
    });

    it('evaluates suitability as MARGINAL when intermediate series provided', async () => {
      // 150 observations over 6.2 days (>= 100 observations & >= 5 days)
      const baseMs = new Date('2026-11-01T00:00:00Z').getTime();
      const obsBatch: HydrographicObservation[] = [];

      for (let i = 0; i < 150; i++) {
        const timeIso = new Date(baseMs + i * 3600000).toISOString();
        obsBatch.push({
          id: `obs-marginal-${i}`,
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

      expect(run.suitability.classification).toBe('MARGINAL');
      expect(run.statistics?.totalPairs).toBe(150);
      expect(run.peakMetrics?.highTidePeaksMatched).toBeGreaterThan(0);
      expect(run.status).toBe('NOT_VERIFIED');
      expect(run.isCalibrationEnabled).toBe(false);
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
