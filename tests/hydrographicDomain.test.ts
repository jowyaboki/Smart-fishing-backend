import { describe, it, expect } from 'vitest';
import {
  normalizeWaterLevelToMeters,
  validateVerticalDatum,
  normalizeTimestampToUtc,
  validateWaterLevelBounds,
  HydrographicValidationError,
  SUPPORTED_VERTICAL_DATUMS,
  SUPPORTED_OBSERVATION_UNITS,
} from '../src/domain/hydrographicModels';

describe('Hydrographic Domain Model & Normalization Functions', () => {
  describe('Unit Normalization to Meters', () => {
    it('normalizes meters accurately without alteration', () => {
      expect(normalizeWaterLevelToMeters(2.45, 'm')).toBe(2.45);
      expect(normalizeWaterLevelToMeters(0.0, 'meters')).toBe(0.0);
      expect(normalizeWaterLevelToMeters(-0.12, 'meter')).toBe(-0.12);
    });

    it('normalizes centimeters to meters', () => {
      expect(normalizeWaterLevelToMeters(245, 'cm')).toBe(2.45);
      expect(normalizeWaterLevelToMeters(100, 'centimeters')).toBe(1.0);
      expect(normalizeWaterLevelToMeters(5, 'cm')).toBe(0.05);
    });

    it('normalizes millimeters to meters', () => {
      expect(normalizeWaterLevelToMeters(2450, 'mm')).toBe(2.45);
      expect(normalizeWaterLevelToMeters(1500, 'millimeters')).toBe(1.5);
    });

    it('normalizes feet to meters (1 ft = 0.3048 m)', () => {
      // 10 feet = 3.048 meters
      expect(normalizeWaterLevelToMeters(10, 'ft')).toBe(3.048);
      expect(normalizeWaterLevelToMeters(1, 'feet')).toBe(0.305);
    });

    it('throws typed HydrographicValidationError for unsupported units', () => {
      expect(() => normalizeWaterLevelToMeters(10, 'inches')).toThrowError(
        HydrographicValidationError
      );
      expect(() => normalizeWaterLevelToMeters(10, 'invalid')).toThrowError(
        /Unsupported unit/
      );
    });

    it('throws error for NaN or non-number water level values', () => {
      expect(() => normalizeWaterLevelToMeters(NaN, 'm')).toThrowError(
        HydrographicValidationError
      );
    });
  });

  describe('Vertical Datum Validation', () => {
    it('accepts all supported datums (LAT, CD, MSL, ZH) in case-insensitive fashion', () => {
      for (const datum of SUPPORTED_VERTICAL_DATUMS) {
        expect(validateVerticalDatum(datum)).toBe(datum);
        expect(validateVerticalDatum(datum.toLowerCase())).toBe(datum);
      }
    });

    it('rejects unsupported vertical datum representations', () => {
      expect(() => validateVerticalDatum('WGS84')).toThrowError(
        HydrographicValidationError
      );
      expect(() => validateVerticalDatum('')).toThrowError(/datum is required/);
      expect(() => validateVerticalDatum('UNKNOWN')).toThrowError(
        /Unsupported vertical datum/
      );
    });
  });

  describe('UTC Timestamp Normalization', () => {
    it('normalizes standard ISO 8601 strings to UTC ISO with trailing Z', () => {
      const iso = '2026-11-08T14:30:00.000Z';
      expect(normalizeTimestampToUtc(iso)).toBe(iso);
    });

    it('normalizes standard SQL hydrographic strings (YYYY-MM-DD HH:mm:ss)', () => {
      const sqlTime = '2026-11-08 14:30:00';
      expect(normalizeTimestampToUtc(sqlTime)).toBe('2026-11-08T14:30:00.000Z');
    });

    it('normalizes UNIX epoch seconds and milliseconds', () => {
      // 1731076200 = 2024-11-08T14:30:00.000Z
      const epochSec = 1731076200;
      const resSec = normalizeTimestampToUtc(epochSec);
      expect(resSec).toBe(new Date(epochSec * 1000).toISOString());

      const epochMs = epochSec * 1000;
      const resMs = normalizeTimestampToUtc(epochMs);
      expect(resMs).toBe(new Date(epochMs).toISOString());
    });

    it('normalizes JavaScript Date instances', () => {
      const date = new Date('2026-11-08T15:00:00Z');
      expect(normalizeTimestampToUtc(date)).toBe('2026-11-08T15:00:00.000Z');
    });

    it('throws HydrographicValidationError for malformed or empty timestamps', () => {
      expect(() => normalizeTimestampToUtc('')).toThrowError(
        HydrographicValidationError
      );
      expect(() => normalizeTimestampToUtc('not-a-date')).toThrowError(
        /Invalid timestamp/
      );
    });

    it('rejects dates outside plausible hydrographic bounds (1970-2100)', () => {
      expect(() => normalizeTimestampToUtc('1850-01-01T00:00:00Z')).toThrowError(
        /outside plausible hydrographic bounds/
      );
      expect(() => normalizeTimestampToUtc('2250-01-01T00:00:00Z')).toThrowError(
        /outside plausible hydrographic bounds/
      );
    });
  });

  describe('Water Level Bounds Plausibility', () => {
    it('allows physically reasonable water levels for Morocco (-2.0m to 12.0m)', () => {
      expect(() => validateWaterLevelBounds(0.0)).not.toThrow();
      expect(() => validateWaterLevelBounds(3.45)).not.toThrow();
      expect(() => validateWaterLevelBounds(-0.8)).not.toThrow();
      expect(() => validateWaterLevelBounds(5.2)).not.toThrow();
    });

    it('rejects physical outliers beyond bounds', () => {
      expect(() => validateWaterLevelBounds(-3.5)).toThrowError(
        /outside physical threshold/
      );
      expect(() => validateWaterLevelBounds(15.0)).toThrowError(
        /outside physical threshold/
      );
    });

    it('rejects NaN or non-numeric values', () => {
      expect(() => validateWaterLevelBounds(NaN)).toThrowError(
        /valid number/
      );
    });
  });
});
