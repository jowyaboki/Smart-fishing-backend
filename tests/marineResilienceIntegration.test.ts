import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MarineService } from '../src/services/marineService';
import { CircuitBreaker } from '../src/services/marine/resilience/circuitBreaker';
import {
  IMarineForecastProvider,
  MarineProviderError,
  MarineProviderTimeoutError,
  NormalizedMarineForecast,
  DEFAULT_MARINE_UNITS,
} from '../src/domain/marineModels';

describe('Marine Resilience Integration Tests', () => {
  let virtualTime = 1000;
  const mockClock = () => virtualTime;

  beforeEach(() => {
    MarineService.clearCache();
    virtualTime = 1000;
  });

  afterEach(() => {
    MarineService.resetProviders();
    MarineService.clearCache();
    vi.restoreAllMocks();
  });

  it('serves fallback when provider fails and trips circuit breaker after 3 failures', async () => {
    const breaker = new CircuitBreaker('open-meteo-test', {
      failureThreshold: 3,
      cooldownMs: 30000,
      clock: mockClock,
    });
    MarineService.setForecastCircuitBreaker(breaker);

    // Mock a failing forecast provider
    let callCount = 0;
    const failingProvider: IMarineForecastProvider = {
      providerId: 'mock-failing-provider',
      isAvailable: async () => false,
      getForecast: async () => {
        callCount++;
        throw new MarineProviderTimeoutError('mock-failing-provider', 3500);
      },
    };

    MarineService.setProviders({ forecastProvider: failingProvider });

    // Request 1: fails provider -> returns simulated fallback
    const res1 = await MarineService.getForecast({ latitude: 33.58, longitude: -7.61, days: 1 });
    expect(res1.provenance?.quality).toBe('simulated');
    expect(res1.provenance?.isSimulatedFallback).toBe(true);
    expect(breaker.getMetrics().consecutiveFailures).toBe(1);
    expect(callCount).toBe(1);

    // Clear cache to simulate another spot
    MarineService.clearCache();

    // Request 2: fails provider -> returns fallback
    const res2 = await MarineService.getForecast({ latitude: 30.42, longitude: -9.60, days: 1 });
    expect(res2.provenance?.quality).toBe('simulated');
    expect(breaker.getMetrics().consecutiveFailures).toBe(2);
    expect(callCount).toBe(2);

    MarineService.clearCache();

    // Request 3: fails provider -> trips circuit breaker to OPEN
    const res3 = await MarineService.getForecast({ latitude: 23.72, longitude: -15.93, days: 1 });
    expect(res3.provenance?.quality).toBe('simulated');
    expect(breaker.getState()).toBe('OPEN');
    expect(callCount).toBe(3);

    MarineService.clearCache();

    // Request 4: circuit is OPEN -> fast fallback without touching failingProvider!
    const res4 = await MarineService.getForecast({ latitude: 35.78, longitude: -5.81, days: 1 });
    expect(res4.provenance?.quality).toBe('simulated');
    expect(callCount).toBe(3); // Provider was NOT called!
    expect(breaker.getMetrics().totalRejections).toBe(1);
  });

  it('recovers to CLOSED state after cooldown when provider recovers', async () => {
    const breaker = new CircuitBreaker('open-meteo-recovery', {
      failureThreshold: 2,
      cooldownMs: 30000,
      clock: mockClock,
    });
    MarineService.setForecastCircuitBreaker(breaker);

    let isHealthy = false;
    let providerCalls = 0;

    const mockProvider: IMarineForecastProvider = {
      providerId: 'mock-recoverable',
      isAvailable: async () => isHealthy,
      getForecast: async (params) => {
        providerCalls++;
        if (!isHealthy) {
          throw new MarineProviderError('500 Service Down', 'mock-recoverable', 500);
        }
        return {
          location: { latitude: params.latitude, longitude: params.longitude, name: 'Recovered Spot' },
          hourly: [
            {
              time: '2026-11-08T00:00:00Z',
              waveHeightMeters: 1.5,
              wavePeriodSeconds: 9,
              waveDirectionDegrees: 310,
              windSpeedKmh: 15,
              windDirectionDegrees: 40,
              surfaceTemperatureCelsius: 18.5,
              pressureHpa: 1016,
            },
          ],
          dailySummary: {
            maxWaveHeight: 1.5,
            minWaveHeight: 1.5,
            avgWindSpeed: 15,
            recommendedTime: '2026-11-08T00:00:00Z',
          },
          provenance: {
            provider: 'mock-recoverable',
            retrievedAt: new Date().toISOString(),
            quality: 'numerical_forecast',
            status: 'forecast',
            coordinates: { latitude: params.latitude, longitude: params.longitude },
            units: { ...DEFAULT_MARINE_UNITS },
            isSimulatedFallback: false,
            confidenceScore: 0.9,
          },
        };
      },
    };

    MarineService.setProviders({ forecastProvider: mockProvider });

    // 1. Trip breaker with 2 failures
    await MarineService.getForecast({ latitude: 33.58, longitude: -7.61, days: 1 });
    MarineService.clearCache();
    await MarineService.getForecast({ latitude: 30.42, longitude: -9.60, days: 1 });
    expect(breaker.getState()).toBe('OPEN');
    expect(providerCalls).toBe(2);

    // 2. Provider recovers upstream
    isHealthy = true;

    // Advance clock past 30s cooldown
    virtualTime += 30001;
    expect(breaker.getState()).toBe('HALF_OPEN');

    // 3. Next request executes trial probe, succeeds, and closes breaker
    MarineService.clearCache();
    const recoveredRes = await MarineService.getForecast({ latitude: 33.58, longitude: -7.61, days: 1 });

    expect(recoveredRes.provenance?.quality).toBe('numerical_forecast');
    expect(recoveredRes.provenance?.isSimulatedFallback).toBe(false);
    expect(breaker.getState()).toBe('CLOSED');
    expect(providerCalls).toBe(3);
  });
});
