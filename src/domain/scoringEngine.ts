export type TideType = 'Rising' | 'High' | 'Falling' | 'Low';

export type RiskLevel = 'Safe' | 'Moderate' | 'High' | 'Severe';

export interface ScoreFactorsInput {
  waveHeightMeters: number;
  windSpeedKmh: number;
  pressureHpa: number;
  tideType: TideType;
  solunarRating: number; // 0 - 100
  timeOfDayHours: number; // 0 - 24
  targetSpeciesOptimalTide?: TideType;
  targetSpeciesOptimalWindMax?: number;
  waterTemperature?: number;
  targetSpeciesOptimalWaterTempMin?: number;
  targetSpeciesOptimalWaterTempMax?: number;
}

export interface ScoreBreakdown {
  waveScore: number;
  windScore: number;
  tideScore: number;
  solunarScore: number;
  speciesScore: number;
}

export interface FishingScoreResult {
  finalScore: number; // 0 - 100
  breakdown: ScoreBreakdown;
  safety: {
    riskLevel: RiskLevel;
    isSafeToFish: boolean;
    warnings: string[];
  };
}

export class SmartFishingScoreEngine {
  /**
   * Final Score = (Wave * 0.25) + (Wind * 0.20) + (Tide * 0.20) + (Solunar * 0.20) + (Species * 0.15)
   */
  public static calculate(input: ScoreFactorsInput): FishingScoreResult {
    const waveScore = this.evaluateWave(input.waveHeightMeters);
    const windScore = this.evaluateWind(input.windSpeedKmh, input.pressureHpa);
    const tideScore = this.evaluateTide(input.tideType);
    const solunarScore = this.evaluateSolunar(input.solunarRating, input.timeOfDayHours);
    const speciesScore = this.evaluateSpecies(input);

    const rawScore =
      waveScore * 0.25 +
      windScore * 0.20 +
      tideScore * 0.20 +
      solunarScore * 0.20 +
      speciesScore * 0.15;

    const finalScore = Math.max(0, Math.min(100, Math.round(rawScore)));
    const safety = this.assessSafety(input.waveHeightMeters, input.windSpeedKmh);

    return {
      finalScore,
      breakdown: {
        waveScore: Math.round(waveScore),
        windScore: Math.round(windScore),
        tideScore: Math.round(tideScore),
        solunarScore: Math.round(solunarScore),
        speciesScore: Math.round(speciesScore),
      },
      safety,
    };
  }

  /**
   * Wave Score evaluation (0.5m - 1.5m optimal for surf/shore fishing in Morocco)
   */
  private static evaluateWave(waveHeight: number): number {
    if (waveHeight <= 0) return 50;
    if (waveHeight >= 0.5 && waveHeight <= 1.5) {
      // Optimal range
      return 100 - Math.abs(1.0 - waveHeight) * 20;
    }
    if (waveHeight > 1.5 && waveHeight <= 2.2) {
      return 75 - (waveHeight - 1.5) * 40;
    }
    if (waveHeight > 2.2 && waveHeight <= 3.0) {
      return 40 - (waveHeight - 2.2) * 35;
    }
    if (waveHeight > 3.0) {
      return Math.max(5, 15 - (waveHeight - 3.0) * 10);
    }
    // Very flat water (< 0.5m)
    return 60 + waveHeight * 40;
  }

  /**
   * Wind & Pressure evaluation (1013 - 1020 hPa is standard stable, light breeze 8-20 km/h)
   */
  private static evaluateWind(windKmh: number, pressureHpa: number): number {
    let windPoints = 100;
    if (windKmh < 5) {
      windPoints = 75; // Still water
    } else if (windKmh <= 18) {
      windPoints = 100; // Gentle/Moderate breeze
    } else if (windKmh <= 28) {
      windPoints = 70 - (windKmh - 18) * 2.5;
    } else if (windKmh <= 40) {
      windPoints = 40 - (windKmh - 28) * 2;
    } else {
      windPoints = 10;
    }

    // Pressure factor: 1013 to 1022 hPa is optimal
    let pressurePoints = 80;
    if (pressureHpa >= 1012 && pressureHpa <= 1020) {
      pressurePoints = 100;
    } else if (pressureHpa < 1005 || pressureHpa > 1028) {
      pressurePoints = 50;
    } else {
      pressurePoints = 75;
    }

    return windPoints * 0.7 + pressurePoints * 0.3;
  }

  /**
   * Tide Flow evaluation: Rising tide is generally premier in Moroccan coastal waters
   */
  private static evaluateTide(tideType: TideType): number {
    switch (tideType) {
      case 'Rising':
        return 95;
      case 'High':
        return 85;
      case 'Falling':
        return 65;
      case 'Low':
        return 45;
      default:
        return 70;
    }
  }

  /**
   * Solunar & Diurnal: Rating combined with Golden Hour boost (dawn 5-8am, dusk 17-20pm)
   */
  private static evaluateSolunar(solunarRating: number, timeOfDayHours: number): number {
    const isGoldenHour =
      (timeOfDayHours >= 5 && timeOfDayHours <= 8) ||
      (timeOfDayHours >= 17 && timeOfDayHours <= 20);

    const goldenHourBoost = isGoldenHour ? 15 : 0;
    return Math.min(100, Math.max(0, solunarRating * 0.85 + goldenHourBoost));
  }

  /**
   * Species alignment based on water temperature, wind limits, and tide preferences
   */
  private static evaluateSpecies(input: ScoreFactorsInput): number {
    let score = 75; // Baseline if no specific species selected

    if (input.targetSpeciesOptimalTide) {
      score += input.targetSpeciesOptimalTide === input.tideType ? 15 : -10;
    }

    if (input.targetSpeciesOptimalWindMax && input.windSpeedKmh > input.targetSpeciesOptimalWindMax) {
      score -= 20;
    }

    if (
      input.waterTemperature !== undefined &&
      input.targetSpeciesOptimalWaterTempMin !== undefined &&
      input.targetSpeciesOptimalWaterTempMax !== undefined
    ) {
      if (
        input.waterTemperature >= input.targetSpeciesOptimalWaterTempMin &&
        input.waterTemperature <= input.targetSpeciesOptimalWaterTempMax
      ) {
        score += 10;
      } else {
        score -= 15;
      }
    }

    return Math.min(100, Math.max(10, score));
  }

  /**
   * Safety Assessment based on wave height and wind
   */
  public static assessSafety(waveHeight: number, windKmh: number): FishingScoreResult['safety'] {
    const warnings: string[] = [];
    let riskLevel: RiskLevel = 'Safe';

    if (waveHeight >= 3.2 || windKmh >= 55) {
      riskLevel = 'Severe';
      warnings.push('Extreme swell or gale wind conditions: shore and boat fishing strictly unsafe.');
    } else if (waveHeight >= 2.4 || windKmh >= 40) {
      riskLevel = 'High';
      warnings.push('Rough ocean conditions: avoid slippery cliffs, rocks, and small craft.');
    } else if (waveHeight >= 1.8 || windKmh >= 28) {
      riskLevel = 'Moderate';
      warnings.push('Moderate chop and swell: exercise heightened caution on exposed jetties.');
    }

    return {
      riskLevel,
      isSafeToFish: riskLevel === 'Safe' || riskLevel === 'Moderate',
      warnings,
    };
  }
}
