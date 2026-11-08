import {
  ITidePredictionProvider,
  TidePredictionParams,
  NormalizedTidePrediction,
  TideEvent,
  TideType,
  SolunarRating,
  DEFAULT_MARINE_UNITS,
} from '../../../domain/marineModels';

export class SimulatedTideProvider implements ITidePredictionProvider {
  public readonly providerId = 'simulated-tide-engine';

  public async isAvailable(): Promise<boolean> {
    return true;
  }

  public async getTidePrediction(params: TidePredictionParams): Promise<NormalizedTidePrediction> {
    const { latitude, longitude, targetDate } = params;
    const isoDate = targetDate.toISOString().split('T')[0];

    // Atlantic & Mediterranean tide cycles (approx 12h 25m semi-diurnal)
    const baseHour = (Math.abs(Math.sin(targetDate.getDate())) * 4) + 1;
    const tideEvents: TideEvent[] = [
      {
        time: `${isoDate}T${String(Math.floor(baseHour)).padStart(2, '0')}:15:00Z`,
        type: 'Low',
        heightMeters: 0.65,
      },
      {
        time: `${isoDate}T${String(Math.floor(baseHour + 6)).padStart(2, '0')}:28:00Z`,
        type: 'High',
        heightMeters: 2.85,
      },
      {
        time: `${isoDate}T${String(Math.floor(baseHour + 12)).padStart(2, '0')}:40:00Z`,
        type: 'Low',
        heightMeters: 0.72,
      },
      {
        time: `${isoDate}T${String(Math.min(23, Math.floor(baseHour + 18))).padStart(2, '0')}:55:00Z`,
        type: 'High',
        heightMeters: 2.9,
      },
    ];

    // Current hour estimation
    const currentHour = new Date().getUTCHours();
    let currentTide: { type: TideType; heightMeters: number } = { type: 'Rising', heightMeters: 1.8 };
    if (currentHour >= 4 && currentHour <= 8) {
      currentTide = { type: 'Rising', heightMeters: 2.1 };
    } else if (currentHour > 8 && currentHour <= 12) {
      currentTide = { type: 'High', heightMeters: 2.8 };
    } else if (currentHour > 12 && currentHour <= 17) {
      currentTide = { type: 'Falling', heightMeters: 1.5 };
    } else {
      currentTide = { type: 'Low', heightMeters: 0.7 };
    }

    const solunar = this.calculateSolunar(targetDate);

    return {
      location: { latitude, longitude },
      date: isoDate,
      currentTide,
      tideEvents,
      solunar,
      provenance: {
        provider: this.providerId,
        retrievedAt: new Date().toISOString(),
        quality: 'simulated',
        status: 'simulated',
        sourceGeneratedAt: targetDate.toISOString(),
        forecastHorizonHours: 24,
        coordinates: { latitude, longitude },
        units: { ...DEFAULT_MARINE_UNITS },
        isSimulatedFallback: true,
        confidenceScore: 0.3,
        disclaimer: 'Notice: Tide predictions for these coordinates are approximate semi-diurnal estimations and not hydrographic tidal gauge measurements.',
      },
      disclaimer: 'Approximate astronomical estimation. Not for navigation.',
    };
  }

  private calculateSolunar(date: Date): SolunarRating {
    const knownNewMoon = new Date('2000-01-06T18:14:00Z').getTime();
    const lunarCycleMs = 29.53058770576 * 86400 * 1000;
    const diff = (date.getTime() - knownNewMoon) % lunarCycleMs;
    const phaseRatio = diff / lunarCycleMs;

    let moonPhase = 'New Moon';
    let rating = 65;

    if (phaseRatio < 0.05 || phaseRatio > 0.95) {
      moonPhase = 'New Moon';
      rating = 92;
    } else if (phaseRatio < 0.22) {
      moonPhase = 'Waxing Crescent';
      rating = 68;
    } else if (phaseRatio < 0.28) {
      moonPhase = 'First Quarter';
      rating = 75;
    } else if (phaseRatio < 0.45) {
      moonPhase = 'Waxing Gibbous';
      rating = 82;
    } else if (phaseRatio < 0.55) {
      moonPhase = 'Full Moon';
      rating = 95;
    } else if (phaseRatio < 0.72) {
      moonPhase = 'Waning Gibbous';
      rating = 78;
    } else if (phaseRatio < 0.78) {
      moonPhase = 'Last Quarter';
      rating = 72;
    } else {
      moonPhase = 'Waning Crescent';
      rating = 64;
    }

    const moonIlluminationPercentage = Math.round(
      ((1 - Math.cos(phaseRatio * 2 * Math.PI)) / 2) * 100
    );

    return {
      moonPhase,
      moonIlluminationPercentage,
      rating,
      majorPeriods: ['06:15 - 08:15', '18:45 - 20:45'],
      minorPeriods: ['00:30 - 01:30', '12:30 - 13:30'],
    };
  }
}
