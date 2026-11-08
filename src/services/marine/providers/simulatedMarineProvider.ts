import {
  IMarineForecastProvider,
  MarineForecastParams,
  NormalizedMarineForecast,
  HourlyMarineCondition,
  DEFAULT_MARINE_UNITS,
} from '../../../domain/marineModels';
import { MoroccanSpotResolver } from './moroccanSpotResolver';

export class SimulatedMarineProvider implements IMarineForecastProvider {
  public readonly providerId = 'simulated-marine-engine';

  public async isAvailable(): Promise<boolean> {
    return true;
  }

  public async getForecast(params: MarineForecastParams): Promise<NormalizedMarineForecast> {
    const lat = Math.round(params.latitude * 100) / 100;
    const lon = Math.round(params.longitude * 100) / 100;
    const days = Math.min(7, Math.max(1, params.days || 3));

    const hourly: HourlyMarineCondition[] = [];
    const now = new Date();
    now.setMinutes(0, 0, 0);

    const totalHours = days * 24;
    let maxWave = 1.2;
    let minWave = 1.2;
    let windSum = 0;

    for (let i = 0; i < totalHours; i++) {
      const stepDate = new Date(now.getTime() + i * 3600 * 1000);
      const wave = Math.round((1.1 + Math.sin(i / 6) * 0.4) * 10) / 10;
      const wind = Math.round((15 + Math.cos(i / 8) * 6) * 10) / 10;
      if (wave > maxWave) maxWave = wave;
      if (wave < minWave) minWave = wave;
      windSum += wind;

      hourly.push({
        time: stepDate.toISOString(),
        waveHeightMeters: wave,
        wavePeriodSeconds: 9,
        waveDirectionDegrees: 310,
        windSpeedKmh: wind,
        windDirectionDegrees: 40,
        surfaceTemperatureCelsius: 18.5,
        pressureHpa: 1016,
      });
    }

    const avgWindSpeed = Math.round((windSum / totalHours) * 10) / 10;

    return {
      location: {
        latitude: lat,
        longitude: lon,
        name: MoroccanSpotResolver.resolve(lat, lon),
      },
      hourly,
      dailySummary: {
        maxWaveHeight: maxWave,
        minWaveHeight: minWave,
        avgWindSpeed,
        recommendedTime: hourly[6]?.time || now.toISOString(),
      },
      provenance: {
        provider: this.providerId,
        retrievedAt: new Date().toISOString(),
        quality: 'simulated',
        status: 'simulated',
        sourceGeneratedAt: now.toISOString(),
        forecastHorizonHours: totalHours,
        coordinates: { latitude: lat, longitude: lon },
        units: { ...DEFAULT_MARINE_UNITS },
        isSimulatedFallback: true,
        confidenceScore: 0.25,
        disclaimer: 'Notice: Marine forecast generated via simulation fallback; real-time atmospheric data was unavailable.',
      },
    };
  }
}
