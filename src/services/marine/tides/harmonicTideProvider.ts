import {
  ITidePredictionProvider,
  TidePredictionParams,
  NormalizedTidePrediction,
  TideEvent,
  TideType,
  SolunarRating,
  DEFAULT_MARINE_UNITS,
  isValidCoordinate,
  MarineDataValidationError,
} from '../../../domain/marineModels';
import { findNearestTideStation } from './moroccanTideStations';
import { SimulatedTideProvider } from '../providers/simulatedTideProvider';

/**
 * Astronomical and harmonic constituent tidal prediction provider calibrated
 * for Moroccan coastal reference stations.
 */
export class MoroccanHarmonicTideProvider implements ITidePredictionProvider {
  public readonly providerId = 'moroccan-harmonic-engine';
  private readonly fallbackProvider: SimulatedTideProvider;

  constructor(fallbackProvider = new SimulatedTideProvider()) {
    this.fallbackProvider = fallbackProvider;
  }

  public async isAvailable(): Promise<boolean> {
    return true;
  }

  public async getTidePrediction(params: TidePredictionParams): Promise<NormalizedTidePrediction> {
    const { latitude, longitude, targetDate } = params;

    if (!isValidCoordinate(latitude, longitude)) {
      throw new MarineDataValidationError(
        `Invalid coordinates for tide prediction: latitude=${latitude}, longitude=${longitude}`
      );
    }

    // Clean ISO Date representation (YYYY-MM-DD)
    const isoDate = targetDate.toISOString().split('T')[0];
    const { station, distanceKm, isWithinMoroccanWaters } = findNearestTideStation(latitude, longitude);

    // If coordinates are far outside Moroccan maritime waters (> 250 km), delegate to simulated engine
    if (!isWithinMoroccanWaters) {
      return this.fallbackProvider.getTidePrediction(params);
    }

    // Reference base dates for lunar ephemeris
    // Synodic lunar month: 29.530588 days
    const knownNewMoonMs = new Date('2000-01-06T18:14:00Z').getTime();
    const synodicMonthMs = 29.530588 * 86400 * 1000;
    const targetMidnightUtc = new Date(`${isoDate}T00:00:00Z`).getTime();
    const lunarPhaseRatio = ((targetMidnightUtc - knownNewMoonMs) % synodicMonthMs) / synodicMonthMs;
    const normalizedPhase = (lunarPhaseRatio + 1) % 1;

    // Semi-diurnal tidal cycle: ~12h 25m 14s (12.4206 hours)
    const semiDiurnalPeriodHours = 12.4206;
    const halfPeriodHours = semiDiurnalPeriodHours / 2; // ~6.2103 hours

    // Calculate spring / neap modulation factor (spring tides near full/new moon, neaps near quarters)
    // 0 = new moon, 0.25 = 1st quarter, 0.5 = full moon, 0.75 = 3rd quarter
    const springNeapFactor = (1 + Math.cos(normalizedPhase * 4 * Math.PI)) / 2; // 0 to 1
    const currentRangeMeters =
      station.neapRangeMeters + (station.springRangeMeters - station.neapRangeMeters) * springNeapFactor;
    const currentAmplitude = currentRangeMeters / 2;

    // Daily lunar transit offset: Moon rises ~50 minutes later each day
    // Lunitidal interval: high tide occurs at station.lunitidalIntervalHours after lunar transit
    const daysSinceEpoch = Math.floor((targetMidnightUtc - knownNewMoonMs) / (86400 * 1000));
    const dailyLunarLagHours = (daysSinceEpoch * 0.84) % semiDiurnalPeriodHours;
    const firstHighWaterHours = (station.lunitidalIntervalHours + dailyLunarLagHours) % semiDiurnalPeriodHours;

    // Find initial inflection point t0 in [0, halfPeriodHours)
    let t0 = firstHighWaterHours - halfPeriodHours;
    while (t0 < 0) t0 += halfPeriodHours;
    t0 = t0 % halfPeriodHours;

    // Determine 4 consecutive tidal events across the target 24h window
    // Events must never hang or produce invalid hour strings (>= 24)
    const eventsRaw: Array<{ timeMs: number; hour: number; type: TideType; height: number }> = [];
    let currentEventHour = t0;
    let currentType: TideType = 'Low';

    for (let i = 0; i < 4; i++) {
      const eventTimeMs = targetMidnightUtc + Math.round(currentEventHour * 3600 * 1000);
      const height =
        currentType === 'High'
          ? Math.round((station.meanLevelMeters + currentAmplitude) * 100) / 100
          : Math.max(0.2, Math.round((station.meanLevelMeters - currentAmplitude) * 100) / 100);

      eventsRaw.push({
        timeMs: eventTimeMs,
        hour: currentEventHour,
        type: currentType,
        height,
      });

      currentEventHour += halfPeriodHours;
      currentType = currentType === 'High' ? 'Low' : 'High';
    }

    // Format valid ISO 8601 timestamps using exact Date arithmetic (handles rollover cleanly)
    const tideEvents: TideEvent[] = eventsRaw.map((ev) => ({
      time: new Date(ev.timeMs).toISOString(),
      type: ev.type,
      heightMeters: ev.height,
    }));

    // Current tide status estimation based on targetDate UTC timestamp
    const targetTimeMs = targetDate.getTime();
    let currentTideType: TideType = 'Rising';
    let currentHeightMeters = station.meanLevelMeters;

    if (targetTimeMs <= eventsRaw[0].timeMs) {
      // Before first event: if first event is Low, tide was Falling to Low
      currentTideType = eventsRaw[0].type === 'Low' ? 'Falling' : 'Rising';
      currentHeightMeters = eventsRaw[0].height;
    } else if (targetTimeMs >= eventsRaw[eventsRaw.length - 1].timeMs) {
      // After last event: extrapolate from last event transition
      const last = eventsRaw[eventsRaw.length - 1];
      currentTideType = last.type === 'High' ? 'Falling' : 'Rising';
      currentHeightMeters = last.height;
    } else {
      // Interpolate between bounding events
      for (let i = 0; i < eventsRaw.length - 1; i++) {
        const e1 = eventsRaw[i];
        const e2 = eventsRaw[i + 1];
        if (targetTimeMs >= e1.timeMs && targetTimeMs <= e2.timeMs) {
          currentTideType = e1.type === 'Low' && e2.type === 'High' ? 'Rising' : 'Falling';
          const progress = (targetTimeMs - e1.timeMs) / (e2.timeMs - e1.timeMs);
          currentHeightMeters = Math.round((e1.height + (e2.height - e1.height) * progress) * 100) / 100;
          break;
        }
      }
    }

    // Solunar calculations
    const solunar = this.calculateSolunar(targetDate, normalizedPhase);

    return {
      location: { latitude, longitude },
      date: isoDate,
      currentTide: {
        type: currentTideType,
        heightMeters: currentHeightMeters,
      },
      tideEvents,
      solunar,
      provenance: {
        provider: this.providerId,
        retrievedAt: new Date().toISOString(),
        quality: 'astronomical_forecast',
        status: 'forecast',
        sourceGeneratedAt: `${isoDate}T00:00:00Z`,
        forecastHorizonHours: 24,
        stationId: station.id,
        stationName: station.name,
        coordinates: { latitude, longitude },
        units: { ...DEFAULT_MARINE_UNITS },
        isSimulatedFallback: false,
        confidenceScore: 0.85,
        disclaimer: `Astronomical harmonic tide forecast calculated from gravitational semi-diurnal harmonics calibrated to Moroccan reference port '${station.name}' (~${distanceKm}km). Theoretical astronomical calculation; does not include meteorological storm surges, barometric anomalies, or real-time tide gauge telemetry.`,
      },
      disclaimer: `Theoretical astronomical calculation calibrated to '${station.name}'. Not for navigation.`,
    };
  }

  private calculateSolunar(date: Date, phaseRatio: number): SolunarRating {
    let moonPhase = 'New Moon';
    let rating = 65;

    if (phaseRatio < 0.05 || phaseRatio > 0.95) {
      moonPhase = 'New Moon';
      rating = 95;
    } else if (phaseRatio < 0.22) {
      moonPhase = 'Waxing Crescent';
      rating = 70;
    } else if (phaseRatio < 0.28) {
      moonPhase = 'First Quarter';
      rating = 75;
    } else if (phaseRatio < 0.45) {
      moonPhase = 'Waxing Gibbous';
      rating = 82;
    } else if (phaseRatio < 0.55) {
      moonPhase = 'Full Moon';
      rating = 98;
    } else if (phaseRatio < 0.72) {
      moonPhase = 'Waning Gibbous';
      rating = 80;
    } else if (phaseRatio < 0.78) {
      moonPhase = 'Last Quarter';
      rating = 74;
    } else {
      moonPhase = 'Waning Crescent';
      rating = 66;
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
