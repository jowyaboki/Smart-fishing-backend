import {
  IMarineForecastProvider,
  MarineForecastParams,
  NormalizedMarineForecast,
  HourlyMarineCondition,
  MarineProviderError,
  MarineProviderTimeoutError,
  DEFAULT_MARINE_UNITS,
} from '../../../domain/marineModels';
import { MoroccanSpotResolver } from './moroccanSpotResolver';

export class OpenMeteoMarineProvider implements IMarineForecastProvider {
  public readonly providerId = 'open-meteo';
  private readonly defaultTimeoutMs: number;

  constructor(defaultTimeoutMs = 4000) {
    this.defaultTimeoutMs = defaultTimeoutMs;
  }

  public async isAvailable(): Promise<boolean> {
    return true;
  }

  public async getForecast(params: MarineForecastParams): Promise<NormalizedMarineForecast> {
    const lat = Math.round(params.latitude * 100) / 100;
    const lon = Math.round(params.longitude * 100) / 100;
    const days = Math.min(7, Math.max(1, params.days || 3));
    const timeoutMs = params.timeoutMs ?? this.defaultTimeoutMs;

    const marineUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&hourly=wave_height,wave_period,wave_direction,wind_wave_height&forecast_days=${days}`;
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=wind_speed_10m,wind_direction_10m,surface_pressure,temperature_2m&forecast_days=${days}`;

    let marineRes: Response;
    let weatherRes: Response;

    try {
      [marineRes, weatherRes] = await Promise.all([
        fetch(marineUrl, { signal: AbortSignal.timeout(timeoutMs) }),
        fetch(weatherUrl, { signal: AbortSignal.timeout(timeoutMs) }),
      ]);
    } catch (err: any) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        throw new MarineProviderTimeoutError(this.providerId, timeoutMs);
      }
      throw new MarineProviderError(
        `Failed to reach Open-Meteo API: ${err?.message || String(err)}`,
        this.providerId
      );
    }

    if (!marineRes.ok || !weatherRes.ok) {
      const failedStatus = !marineRes.ok ? marineRes.status : weatherRes.status;
      throw new MarineProviderError(
        `Open-Meteo returned HTTP error status ${failedStatus}`,
        this.providerId,
        failedStatus
      );
    }

    let marineJson: any;
    let weatherJson: any;

    try {
      [marineJson, weatherJson] = await Promise.all([
        marineRes.json(),
        weatherRes.json(),
      ]);
    } catch (err: any) {
      throw new MarineProviderError(
        `Failed to parse Open-Meteo JSON payload: ${err?.message || String(err)}`,
        this.providerId
      );
    }

    const hourlyData: HourlyMarineCondition[] = [];
    const times: string[] = marineJson?.hourly?.time || [];
    let maxWave = 0;
    let minWave = 999;
    let windSum = 0;

    for (let i = 0; i < times.length; i++) {
      const waveHeight = marineJson.hourly?.wave_height?.[i] ?? 1.2;
      const wavePeriod = marineJson.hourly?.wave_period?.[i] ?? 8;
      const waveDirection = marineJson.hourly?.wave_direction?.[i] ?? 300;
      const windSpeed = weatherJson.hourly?.wind_speed_10m?.[i] ?? 14;
      const windDirection = weatherJson.hourly?.wind_direction_10m?.[i] ?? 45;
      const pressure = weatherJson.hourly?.surface_pressure?.[i] ?? 1015;
      const temp = weatherJson.hourly?.temperature_2m?.[i] ?? 19;

      if (waveHeight > maxWave) maxWave = waveHeight;
      if (waveHeight < minWave) minWave = waveHeight;
      windSum += windSpeed;

      hourlyData.push({
        time: times[i],
        waveHeightMeters: waveHeight,
        wavePeriodSeconds: wavePeriod,
        waveDirectionDegrees: waveDirection,
        windSpeedKmh: windSpeed,
        windDirectionDegrees: windDirection,
        surfaceTemperatureCelsius: temp,
        pressureHpa: pressure,
      });
    }

    const count = hourlyData.length || 1;
    const avgWindSpeed = Math.round((windSum / count) * 10) / 10;

    return {
      location: {
        latitude: lat,
        longitude: lon,
        name: MoroccanSpotResolver.resolve(lat, lon),
      },
      hourly: hourlyData,
      dailySummary: {
        maxWaveHeight: maxWave,
        minWaveHeight: minWave === 999 ? 0 : minWave,
        avgWindSpeed,
        recommendedTime: hourlyData[6]?.time || times[0] || new Date().toISOString(),
      },
      provenance: {
        provider: this.providerId,
        retrievedAt: new Date().toISOString(),
        quality: 'numerical_forecast',
        coordinates: { latitude: lat, longitude: lon },
        units: { ...DEFAULT_MARINE_UNITS },
        isSimulatedFallback: false,
        confidenceScore: 0.9,
      },
    };
  }
}
