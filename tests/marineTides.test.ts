import { describe, it, expect } from 'vitest';
import { MoroccanHarmonicTideProvider } from '../src/services/marine/tides/harmonicTideProvider';
import {
  findNearestTideStation,
  calculateDistanceKm,
} from '../src/services/marine/tides/moroccanTideStations';
import { MarineService } from '../src/services/marineService';

describe('Moroccan Harmonic Tide Engine Unit & Scientific Validation', () => {
  const provider = new MoroccanHarmonicTideProvider();

  describe('Station Calibration & Geodesic Distance', () => {
    it('accurately calculates Haversine distance between coastal coordinates', () => {
      // Distance between Casablanca (33.60, -7.60) and Mohammedia (33.71, -7.38) is ~24 km
      const dist = calculateDistanceKm(33.60, -7.60, 33.71, -7.38);
      expect(dist).toBeGreaterThan(20);
      expect(dist).toBeLessThan(30);
    });

    it('matches coordinates to nearest calibrated reference stations', () => {
      // Dar Bouazza (33.52, -7.81) -> should match Casablanca
      const casaMatch = findNearestTideStation(33.52, -7.81);
      expect(casaMatch.station.id).toBe('casablanca-port');
      expect(casaMatch.isWithinMoroccanWaters).toBe(true);

      // Cap Spartel (35.79, -5.92) -> should match Tanger Med
      const tangerMatch = findNearestTideStation(35.79, -5.92);
      expect(tangerMatch.station.id).toBe('tanger-med');
      expect(tangerMatch.isWithinMoroccanWaters).toBe(true);

      // Taghazout (30.54, -9.71) -> should match Agadir Port
      const agadirMatch = findNearestTideStation(30.54, -9.71);
      expect(agadirMatch.station.id).toBe('agadir-port');
      expect(agadirMatch.isWithinMoroccanWaters).toBe(true);
    });

    it('flags coordinates far outside Moroccan waters (> 250 km) as outside coverage', () => {
      // Coordinates in Southern France (Marseille: 43.3, 5.4)
      const nonMorocco = findNearestTideStation(43.3, 5.4);
      expect(nonMorocco.isWithinMoroccanWaters).toBe(false);
      expect(nonMorocco.distanceKm).toBeGreaterThan(500);
    });

    it('accurately evaluates boundary behavior at exactly 250 km threshold', () => {
      // Station Tanger Med at (35.89, -5.50)
      // Exactly 250 km check: a point at distance <= 250 is covered, > 250 is not
      const justInside = findNearestTideStation(35.89, -2.75); // ~248.8 km
      expect(justInside.distanceKm).toBeLessThanOrEqual(250);
      expect(justInside.isWithinMoroccanWaters).toBe(true);

      const justOutside = findNearestTideStation(35.89, -2.70); // ~253.3 km
      expect(justOutside.distanceKm).toBeGreaterThan(250);
      expect(justOutside.isWithinMoroccanWaters).toBe(false);
    });
  });

  describe('Scientific Tide Height & Micro-tidal vs Meso-tidal Profiles', () => {
    it('produces meso-tidal range (2.0m - 3.8m) for Casablanca Atlantic waters', async () => {
      const res = await provider.getTidePrediction({
        latitude: 33.58,
        longitude: -7.61,
        targetDate: new Date('2026-11-08T12:00:00Z'),
      });

      expect(res.provenance.quality).toBe('astronomical_forecast');
      expect(res.provenance.status).toBe('forecast');
      expect(res.provenance.stationId).toBe('casablanca-port');
      expect(res.provenance.isSimulatedFallback).toBe(false);
      expect(res.provenance.confidenceScore).toBe(0.85);

      // Check tide range: high tide > 2.5m, low tide < 1.2m
      const highEvents = res.tideEvents.filter((e) => e.type === 'High');
      const lowEvents = res.tideEvents.filter((e) => e.type === 'Low');
      expect(highEvents.length).toBeGreaterThan(0);
      expect(lowEvents.length).toBeGreaterThan(0);

      expect(highEvents[0].heightMeters).toBeGreaterThan(2.5);
      expect(lowEvents[0].heightMeters).toBeLessThan(1.2);
    });

    it('produces micro-tidal range (0.8m - 1.8m) for Tanger Med Mediterranean waters', async () => {
      const res = await provider.getTidePrediction({
        latitude: 35.89,
        longitude: -5.50,
        targetDate: new Date('2026-11-08T12:00:00Z'),
      });

      expect(res.provenance.quality).toBe('astronomical_forecast');
      expect(res.provenance.stationId).toBe('tanger-med');

      const highEvents = res.tideEvents.filter((e) => e.type === 'High');
      const lowEvents = res.tideEvents.filter((e) => e.type === 'Low');

      // Tanger Mediterranean tidal range is much narrower than Atlantic
      expect(highEvents[0].heightMeters).toBeLessThan(1.85);
      expect(highEvents[0].heightMeters).toBeGreaterThan(1.1);
      expect(lowEvents[0].heightMeters).toBeLessThan(0.9);
      expect(lowEvents[0].heightMeters).toBeGreaterThan(0.2);
    });
  });

  describe('Chronological Event Consistency & Alternating Sequence', () => {
    it('ensures strictly increasing timestamps and alternating Low / High sequence', async () => {
      const res = await provider.getTidePrediction({
        latitude: 31.51,
        longitude: -9.77,
        targetDate: new Date('2026-11-08T00:00:00Z'),
      });

      expect(res.tideEvents.length).toBe(4);

      for (let i = 0; i < res.tideEvents.length - 1; i++) {
        const curr = res.tideEvents[i];
        const next = res.tideEvents[i + 1];

        // 1. Timestamp strictly increasing
        const currTime = new Date(curr.time).getTime();
        const nextTime = new Date(next.time).getTime();
        expect(nextTime).toBeGreaterThan(currTime);

        // 2. Types alternate
        expect(curr.type).not.toBe(next.type);
      }
    });

    it('safely handles date edge cases without infinite loops or invalid hour formatting', async () => {
      // Test 30 consecutive dates across month boundary and varying t0 offsets
      for (let day = 1; day <= 30; day++) {
        const dateStr = `2026-11-${String(day).padStart(2, '0')}T14:30:00Z`;
        const res = await provider.getTidePrediction({
          latitude: 33.58,
          longitude: -7.61,
          targetDate: new Date(dateStr),
        });

        expect(res.tideEvents.length).toBe(4);
        for (const ev of res.tideEvents) {
          expect(ev.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
          expect(isNaN(new Date(ev.time).getTime())).toBe(false);
        }
      }
    });

    it('delegates to simulated provider with explicit disclaimer when outside Moroccan waters', async () => {
      const res = await provider.getTidePrediction({
        latitude: 45.0,
        longitude: 10.0, // North Italy
        targetDate: new Date('2026-11-08T12:00:00Z'),
      });

      expect(res.provenance.quality).toBe('simulated');
      expect(res.provenance.isSimulatedFallback).toBe(true);
      expect(res.disclaimer).toBeDefined();
    });
  });

  describe('Integration with MarineService End-to-End', () => {
    it('returns astronomical predictions via MarineService.getTides with 12h cache', async () => {
      MarineService.clearCache();

      const res = await MarineService.getTides(33.58, -7.61, '2026-11-08');
      expect(res.location.latitude).toBe(33.58);
      expect(res.tideEvents.length).toBe(4);
      expect(res.provenance?.quality).toBe('astronomical_forecast');
      expect(res.provenance?.stationId).toBe('casablanca-port');
      expect(res.solunar.rating).toBeGreaterThan(0);
      expect(MarineService.getCacheSize()).toBe(1);
    });
  });
});
