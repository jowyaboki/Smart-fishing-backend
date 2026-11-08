import { describe, it, expect } from 'vitest';
import {
  DataQualityTier,
  DEFAULT_MARINE_UNITS,
  HourlyMarineCondition,
  NormalizedMarineForecast,
  NormalizedTidePrediction,
  MarineProviderError,
  MarineProviderTimeoutError,
  mapForecastToResponse,
  mapTidesToResponse,
} from '../src/domain/marineModels';

describe('Marine Domain Models & Contracts', () => {
  it('validates 5 distinct DataQualityTiers', () => {
    const validTiers: DataQualityTier[] = [
      'observed',
      'astronomical_forecast',
      'numerical_forecast',
      'estimated',
      'simulated',
    ];
    expect(validTiers.length).toBe(5);
  });

  it('provides standard immutable marine units', () => {
    expect(DEFAULT_MARINE_UNITS.waveHeight).toBe('m');
    expect(DEFAULT_MARINE_UNITS.wavePeriod).toBe('s');
    expect(DEFAULT_MARINE_UNITS.windSpeed).toBe('km/h');
    expect(DEFAULT_MARINE_UNITS.pressure).toBe('hpa');
    expect(DEFAULT_MARINE_UNITS.surfaceTemperature).toBe('celsius');
    expect(DEFAULT_MARINE_UNITS.tideHeight).toBe('m');
  });

  it('correctly instantiates NormalizedMarineForecast and maps to legacy response DTO', () => {
    const hourly: HourlyMarineCondition[] = [
      {
        time: '2026-11-08T06:00:00Z',
        waveHeightMeters: 1.4,
        wavePeriodSeconds: 10,
        waveDirectionDegrees: 315,
        windSpeedKmh: 18,
        windDirectionDegrees: 45,
        surfaceTemperatureCelsius: 19.2,
        pressureHpa: 1016,
      },
      {
        time: '2026-11-08T07:00:00Z',
        waveHeightMeters: 1.6,
        wavePeriodSeconds: 11,
        waveDirectionDegrees: 320,
        windSpeedKmh: 20,
        windDirectionDegrees: 50,
        surfaceTemperatureCelsius: 19.3,
        pressureHpa: 1015,
      },
    ];

    const normalizedForecast: NormalizedMarineForecast = {
      location: {
        latitude: 33.58,
        longitude: -7.61,
        name: 'Rabat - Casablanca Atlantic Coast',
      },
      hourly,
      dailySummary: {
        maxWaveHeight: 1.6,
        minWaveHeight: 1.4,
        avgWindSpeed: 19,
        recommendedTime: '2026-11-08T06:00:00Z',
      },
      provenance: {
        provider: 'open-meteo',
        retrievedAt: '2026-11-08T05:00:00Z',
        quality: 'numerical_forecast',
        coordinates: { latitude: 33.58, longitude: -7.61 },
        units: { ...DEFAULT_MARINE_UNITS },
        isSimulatedFallback: false,
        confidenceScore: 0.9,
      },
    };

    const responseDto = mapForecastToResponse(normalizedForecast);
    expect(responseDto.location.name).toBe('Rabat - Casablanca Atlantic Coast');
    expect(responseDto.hourly.length).toBe(2);
    expect(responseDto.dailySummary.maxWaveHeight).toBe(1.6);
    expect(responseDto.provenance?.quality).toBe('numerical_forecast');
    expect(responseDto.provenance?.isSimulatedFallback).toBe(false);
  });

  it('correctly maps NormalizedTidePrediction to legacy response DTO', () => {
    const normalizedTides: NormalizedTidePrediction = {
      location: { latitude: 33.58, longitude: -7.61 },
      date: '2026-11-08',
      currentTide: { type: 'Rising', heightMeters: 2.1 },
      tideEvents: [
        { time: '2026-11-08T04:15:00Z', type: 'Low', heightMeters: 0.65 },
        { time: '2026-11-08T10:28:00Z', type: 'High', heightMeters: 2.85 },
      ],
      solunar: {
        moonPhase: 'New Moon',
        moonIlluminationPercentage: 98,
        rating: 92,
        majorPeriods: ['06:15 - 08:15', '18:45 - 20:45'],
        minorPeriods: ['00:30 - 01:30', '12:30 - 13:30'],
      },
      provenance: {
        provider: 'simulated-tide-engine',
        retrievedAt: '2026-11-08T05:00:00Z',
        quality: 'simulated',
        coordinates: { latitude: 33.58, longitude: -7.61 },
        units: { ...DEFAULT_MARINE_UNITS },
        isSimulatedFallback: true,
        confidenceScore: 0.3,
        disclaimer: 'Notice: approximate astronomical estimation',
      },
      disclaimer: 'Approximate astronomical estimation. Not for navigation.',
    };

    const responseDto = mapTidesToResponse(normalizedTides);
    expect(responseDto.location.latitude).toBe(33.58);
    expect(responseDto.currentTide.type).toBe('Rising');
    expect(responseDto.tideEvents.length).toBe(2);
    expect(responseDto.solunar.rating).toBe(92);
    expect(responseDto.provenance?.isSimulatedFallback).toBe(true);
    expect(responseDto.disclaimer).toBeDefined();
  });

  it('properly instantiates MarineProviderError and MarineProviderTimeoutError', () => {
    const error = new MarineProviderError('Server error', 'open-meteo', 502);
    expect(error.name).toBe('MarineProviderError');
    expect(error.providerId).toBe('open-meteo');
    expect(error.statusCode).toBe(502);
    expect(error.message).toContain('[open-meteo] Server error');

    const timeoutErr = new MarineProviderTimeoutError('open-meteo', 4000);
    expect(timeoutErr.name).toBe('MarineProviderTimeoutError');
    expect(timeoutErr.statusCode).toBe(408);
    expect(timeoutErr.message).toContain('Request timed out after 4000ms');
  });
});
