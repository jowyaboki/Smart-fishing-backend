import { describe, it, expect } from 'vitest';
import { SmartFishingScoreEngine } from '../src/domain/scoringEngine';

describe('SmartFishingScoreEngine', () => {
  it('calculates optimal score for prime Atlantic coastal conditions', () => {
    const result = SmartFishingScoreEngine.calculate({
      waveHeightMeters: 1.0,
      windSpeedKmh: 14,
      pressureHpa: 1016,
      tideType: 'Rising',
      solunarRating: 90,
      timeOfDayHours: 6, // Golden hour
    });

    expect(result.finalScore).toBeGreaterThanOrEqual(85);
    expect(result.safety.riskLevel).toBe('Safe');
    expect(result.safety.isSafeToFish).toBe(true);
    expect(result.breakdown.waveScore).toBe(100);
    expect(result.breakdown.tideScore).toBe(95);
  });

  it('evaluates severe conditions and triggers safety warnings', () => {
    const result = SmartFishingScoreEngine.calculate({
      waveHeightMeters: 3.5,
      windSpeedKmh: 60,
      pressureHpa: 998,
      tideType: 'Low',
      solunarRating: 30,
      timeOfDayHours: 14,
    });

    expect(result.finalScore).toBeLessThan(40);
    expect(result.safety.riskLevel).toBe('Severe');
    expect(result.safety.isSafeToFish).toBe(false);
    expect(result.safety.warnings.length).toBeGreaterThan(0);
  });

  it('rewards species preference matching', () => {
    const matching = SmartFishingScoreEngine.calculate({
      waveHeightMeters: 1.2,
      windSpeedKmh: 15,
      pressureHpa: 1015,
      tideType: 'Rising',
      solunarRating: 80,
      timeOfDayHours: 7,
      targetSpeciesOptimalTide: 'Rising',
      targetSpeciesOptimalWindMax: 25,
      waterTemperature: 18,
      targetSpeciesOptimalWaterTempMin: 15,
      targetSpeciesOptimalWaterTempMax: 22,
    });

    const mismatching = SmartFishingScoreEngine.calculate({
      waveHeightMeters: 1.2,
      windSpeedKmh: 30,
      pressureHpa: 1015,
      tideType: 'Low',
      solunarRating: 80,
      timeOfDayHours: 7,
      targetSpeciesOptimalTide: 'Rising',
      targetSpeciesOptimalWindMax: 20,
      waterTemperature: 25,
      targetSpeciesOptimalWaterTempMin: 15,
      targetSpeciesOptimalWaterTempMax: 20,
    });

    expect(matching.breakdown.speciesScore).toBeGreaterThan(mismatching.breakdown.speciesScore);
    expect(matching.finalScore).toBeGreaterThan(mismatching.finalScore);
  });
});
