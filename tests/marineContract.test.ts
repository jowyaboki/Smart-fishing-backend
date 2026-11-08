import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createApp } from '../src/app';
import { setDatabaseForTesting, closeDatabase } from '../src/data/database';
import { MarineService } from '../src/services/marineService';

describe('Android API Marine Contract Regression Suite', () => {
  let app: any;

  beforeAll(() => {
    const testDb = new Database(':memory:');
    setDatabaseForTesting(testDb);
    app = createApp();
  });

  afterAll(() => {
    closeDatabase();
    MarineService.resetProviders();
    MarineService.clearCache();
  });

  describe('GET /api/v1/marine/forecast Android Contract', () => {
    it('strictly preserves the Android MarineForecastResponse schema', async () => {
      const res = await request(app).get('/api/v1/marine/forecast?latitude=33.58&longitude=-7.61&days=2');

      expect(res.status).toBe(200);

      // 1. location object
      expect(res.body).toHaveProperty('location');
      expect(typeof res.body.location.latitude).toBe('number');
      expect(typeof res.body.location.longitude).toBe('number');
      if (res.body.location.name !== undefined) {
        expect(typeof res.body.location.name).toBe('string');
      }

      // 2. hourly array
      expect(Array.isArray(res.body.hourly)).toBe(true);
      expect(res.body.hourly.length).toBeGreaterThan(0);
      const firstHour = res.body.hourly[0];
      expect(typeof firstHour.time).toBe('string');
      expect(typeof firstHour.waveHeightMeters).toBe('number');
      expect(typeof firstHour.wavePeriodSeconds).toBe('number');
      expect(typeof firstHour.waveDirectionDegrees).toBe('number');
      expect(typeof firstHour.windSpeedKmh).toBe('number');
      expect(typeof firstHour.windDirectionDegrees).toBe('number');
      expect(typeof firstHour.surfaceTemperatureCelsius).toBe('number');
      expect(typeof firstHour.pressureHpa).toBe('number');

      // 3. dailySummary object
      expect(res.body).toHaveProperty('dailySummary');
      expect(typeof res.body.dailySummary.maxWaveHeight).toBe('number');
      expect(typeof res.body.dailySummary.minWaveHeight).toBe('number');
      expect(typeof res.body.dailySummary.avgWindSpeed).toBe('number');
      expect(typeof res.body.dailySummary.recommendedTime).toBe('string');

      // 4. additive provenance metadata (safe for Android Gson/Moshi)
      if (res.body.provenance) {
        expect(typeof res.body.provenance.provider).toBe('string');
        expect(typeof res.body.provenance.quality).toBe('string');
        expect(typeof res.body.provenance.isSimulatedFallback).toBe('boolean');
        expect(typeof res.body.provenance.confidenceScore).toBe('number');
      }
    });
  });

  describe('GET /api/v1/marine/tides Android Contract', () => {
    it('strictly preserves the Android TidePredictionResponse schema', async () => {
      const res = await request(app).get('/api/v1/marine/tides?latitude=33.58&longitude=-7.61');

      expect(res.status).toBe(200);

      // 1. location object
      expect(res.body).toHaveProperty('location');
      expect(typeof res.body.location.latitude).toBe('number');
      expect(typeof res.body.location.longitude).toBe('number');

      // 2. date string
      expect(typeof res.body.date).toBe('string');
      expect(res.body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      // 3. currentTide object
      expect(res.body).toHaveProperty('currentTide');
      expect(['Rising', 'High', 'Falling', 'Low']).toContain(res.body.currentTide.type);
      expect(typeof res.body.currentTide.heightMeters).toBe('number');

      // 4. tideEvents array
      expect(Array.isArray(res.body.tideEvents)).toBe(true);
      expect(res.body.tideEvents.length).toBeGreaterThanOrEqual(4);
      for (const event of res.body.tideEvents) {
        expect(typeof event.time).toBe('string');
        expect(['Rising', 'High', 'Falling', 'Low']).toContain(event.type);
        expect(typeof event.heightMeters).toBe('number');
      }

      // 5. solunar object
      expect(res.body).toHaveProperty('solunar');
      expect(typeof res.body.solunar.moonPhase).toBe('string');
      expect(typeof res.body.solunar.moonIlluminationPercentage).toBe('number');
      expect(typeof res.body.solunar.rating).toBe('number');
      expect(Array.isArray(res.body.solunar.majorPeriods)).toBe(true);
      expect(Array.isArray(res.body.solunar.minorPeriods)).toBe(true);

      // 6. additive metadata
      if (res.body.provenance) {
        expect(typeof res.body.provenance.quality).toBe('string');
      }
    });
  });

  describe('POST /api/v1/fishing/score Compatibility', () => {
    it('ensures Fishing Score engine operates seamlessly with existing tide types and wave values', async () => {
      const res = await request(app).post('/api/v1/fishing/score').send({
        waveHeightMeters: 1.2,
        windSpeedKmh: 14,
        pressureHpa: 1016,
        tideType: 'Rising',
        solunarRating: 85,
        timeOfDayHours: 6,
      });

      expect(res.status).toBe(200);
      expect(res.body.finalScore).toBeDefined();
      expect(res.body.breakdown).toBeDefined();
      expect(res.body.safety.isSafeToFish).toBe(true);
    });
  });
});
