import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenMeteoMarineProvider } from '../src/services/marine/providers/openMeteoProvider';
import { SimulatedMarineProvider } from '../src/services/marine/providers/simulatedMarineProvider';
import { SimulatedTideProvider } from '../src/services/marine/providers/simulatedTideProvider';
import {
  MarineProviderError,
  MarineProviderTimeoutError,
  MarineDataValidationError,
} from '../src/domain/marineModels';

describe('Marine Providers Unit Tests', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('OpenMeteoMarineProvider', () => {
    const provider = new OpenMeteoMarineProvider(2000);

    it('returns normalized forecast upon successful API responses', async () => {
      const mockMarineJson = {
        hourly: {
          time: ['2026-11-08T00:00:00Z', '2026-11-08T01:00:00Z'],
          wave_height: [1.5, 1.8],
          wave_period: [9, 10],
          wave_direction: [310, 315],
        },
      };

      const mockWeatherJson = {
        hourly: {
          time: ['2026-11-08T00:00:00Z', '2026-11-08T01:00:00Z'],
          wind_speed_10m: [16, 20],
          wind_direction_10m: [40, 45],
          surface_pressure: [1016, 1015],
          temperature_2m: [18.5, 18.2],
        },
      };

      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('marine-api.open-meteo.com')) {
          return Promise.resolve(new Response(JSON.stringify(mockMarineJson), { status: 200 }));
        }
        if (url.includes('api.open-meteo.com')) {
          return Promise.resolve(new Response(JSON.stringify(mockWeatherJson), { status: 200 }));
        }
        return Promise.reject(new Error('Unknown url'));
      });

      const res = await provider.getForecast({ latitude: 33.58, longitude: -7.61, days: 1 });

      expect(res.location.name).toBe('Rabat - Casablanca Atlantic Coast');
      expect(res.hourly.length).toBe(2);
      expect(res.hourly[0].waveHeightMeters).toBe(1.5);
      expect(res.hourly[1].windSpeedKmh).toBe(20);
      expect(res.dailySummary.maxWaveHeight).toBe(1.8);
      expect(res.dailySummary.minWaveHeight).toBe(1.5);
      expect(res.provenance.quality).toBe('numerical_forecast');
      expect(res.provenance.status).toBe('forecast');
      expect(res.provenance.sourceGeneratedAt).toBeDefined();
      expect(res.provenance.forecastHorizonHours).toBe(2);
      expect(res.provenance.isSimulatedFallback).toBe(false);
      expect(res.provenance.confidenceScore).toBe(0.9);
    });

    it('preserves legitimate zero values without overwriting them', async () => {
      const mockMarineZeroJson = {
        hourly: {
          time: ['2026-11-08T00:00:00Z'],
          wave_height: [0.0], // perfectly flat sea
          wave_period: [0.0],
          wave_direction: [0],
        },
      };

      const mockWeatherZeroJson = {
        hourly: {
          time: ['2026-11-08T00:00:00Z'],
          wind_speed_10m: [0.0], // complete calm
          wind_direction_10m: [0],
          surface_pressure: [1013],
          temperature_2m: [18.0],
        },
      };

      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('marine-api.open-meteo.com')) {
          return Promise.resolve(new Response(JSON.stringify(mockMarineZeroJson), { status: 200 }));
        }
        if (url.includes('api.open-meteo.com')) {
          return Promise.resolve(new Response(JSON.stringify(mockWeatherZeroJson), { status: 200 }));
        }
        return Promise.reject(new Error('Unknown url'));
      });

      const res = await provider.getForecast({ latitude: 33.58, longitude: -7.61, days: 1 });
      expect(res.hourly[0].waveHeightMeters).toBe(0);
      expect(res.hourly[0].windSpeedKmh).toBe(0);
      expect(res.dailySummary.minWaveHeight).toBe(0);
      expect(res.dailySummary.avgWindSpeed).toBe(0);
    });

    it('rejects invalid coordinates with MarineDataValidationError', async () => {
      await expect(
        provider.getForecast({ latitude: 999, longitude: 0 })
      ).rejects.toThrow(MarineDataValidationError);
    });

    it('throws MarineProviderError on missing required measurements rather than fabricating defaults', async () => {
      const mockIncompleteMarine = {
        hourly: {
          time: ['2026-11-08T00:00:00Z'],
          wave_height: [null], // Missing measurement
          wave_period: [9],
        },
      };

      const mockWeather = {
        hourly: {
          time: ['2026-11-08T00:00:00Z'],
          wind_speed_10m: [15],
          wind_direction_10m: [45],
          surface_pressure: [1015],
          temperature_2m: [19],
        },
      };

      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('marine-api.open-meteo.com')) {
          return Promise.resolve(new Response(JSON.stringify(mockIncompleteMarine), { status: 200 }));
        }
        if (url.includes('api.open-meteo.com')) {
          return Promise.resolve(new Response(JSON.stringify(mockWeather), { status: 200 }));
        }
        return Promise.reject(new Error('Unknown url'));
      });

      await expect(
        provider.getForecast({ latitude: 33.58, longitude: -7.61, days: 1 })
      ).rejects.toThrow(MarineProviderError);
    });

    it('throws MarineProviderError on non-200 HTTP response', async () => {
      global.fetch = vi.fn().mockResolvedValue(new Response('Internal Server Error', { status: 500 }));

      await expect(
        provider.getForecast({ latitude: 33.58, longitude: -7.61, days: 1 })
      ).rejects.toThrow(MarineProviderError);
    });

    it('throws MarineProviderTimeoutError when request aborts due to timeout', async () => {
      global.fetch = vi.fn().mockImplementation(() => {
        const timeoutError = new Error('The operation was aborted due to timeout');
        timeoutError.name = 'TimeoutError';
        return Promise.reject(timeoutError);
      });

      await expect(
        provider.getForecast({ latitude: 33.58, longitude: -7.61, days: 1 })
      ).rejects.toThrow(MarineProviderTimeoutError);
    });
  });

  describe('SimulatedMarineProvider', () => {
    const provider = new SimulatedMarineProvider();

    it('generates simulated forecast tagged with simulated quality, status, and disclaimer', async () => {
      const res = await provider.getForecast({ latitude: 30.42, longitude: -9.6, days: 2 });

      expect(res.location.name).toBe('Agadir / Taghazout Coast');
      expect(res.hourly.length).toBe(48);
      expect(res.provenance.quality).toBe('simulated');
      expect(res.provenance.status).toBe('simulated');
      expect(res.provenance.forecastHorizonHours).toBe(48);
      expect(res.provenance.isSimulatedFallback).toBe(true);
      expect(res.provenance.confidenceScore).toBe(0.25);
      expect(res.provenance.disclaimer).toContain('simulation fallback');
    });
  });

  describe('SimulatedTideProvider', () => {
    const provider = new SimulatedTideProvider();

    it('generates astronomical/solunar tide predictions tagged with simulated quality and status', async () => {
      const res = await provider.getTidePrediction({
        latitude: 33.58,
        longitude: -7.61,
        targetDate: new Date('2026-11-08T12:00:00Z'),
      });

      expect(res.location.latitude).toBe(33.58);
      expect(res.date).toBe('2026-11-08');
      expect(res.tideEvents.length).toBe(4);
      expect(res.solunar.rating).toBeGreaterThan(0);
      expect(res.provenance.quality).toBe('simulated');
      expect(res.provenance.status).toBe('simulated');
      expect(res.provenance.isSimulatedFallback).toBe(true);
      expect(res.disclaimer).toBeDefined();
    });
  });
});
