import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config';

describe('Configuration Security Hardening', () => {
  it('throws an error when starting in production without JWT_SECRET', () => {
    expect(() => {
      loadConfig({
        NODE_ENV: 'production',
        JWT_SECRET: '',
      });
    }).toThrow('JWT_SECRET is mandatory in production environment');
  });

  it('throws an error when starting in production with undefined JWT_SECRET', () => {
    expect(() => {
      loadConfig({
        NODE_ENV: 'production',
      });
    }).toThrow('JWT_SECRET is mandatory in production environment');
  });

  it('throws an error when starting in production with a short JWT_SECRET (< 32 chars)', () => {
    expect(() => {
      loadConfig({
        NODE_ENV: 'production',
        JWT_SECRET: 'short-secret-less-than-32-chars',
      });
    }).toThrow('JWT_SECRET must be at least 32 characters long in production');
  });

  it('throws an error when starting in production with a known insecure default secret', () => {
    expect(() => {
      loadConfig({
        NODE_ENV: 'production',
        JWT_SECRET: 'smart-fishing-morocco-secret-key-12345',
      });
    }).toThrow('JWT_SECRET cannot use a known default or insecure development value');

    expect(() => {
      loadConfig({
        NODE_ENV: 'production',
        JWT_SECRET: 'supersecretkey_change_in_production',
      });
    }).toThrow('JWT_SECRET cannot use a known default or insecure development value');
  });

  it('successfully loads in production with a strong random secret >= 32 characters', () => {
    const validSecret = 'strong-production-secret-key-9876543210-morocco';
    const loaded = loadConfig({
      NODE_ENV: 'production',
      JWT_SECRET: validSecret,
      PORT: '8080',
    });

    expect(loaded.nodeEnv).toBe('production');
    expect(loaded.jwtSecret).toBe(validSecret);
    expect(loaded.port).toBe(8080);
  });

  it('provides safe dev fallback in development mode with a warning', () => {
    const loaded = loadConfig({
      NODE_ENV: 'development',
      JWT_SECRET: '',
    });

    expect(loaded.nodeEnv).toBe('development');
    expect(loaded.jwtSecret).toBeDefined();
    expect(loaded.jwtSecret.length).toBeGreaterThanOrEqual(32);
  });

  it('provides test secret in test mode', () => {
    const loaded = loadConfig({
      NODE_ENV: 'test',
    });

    expect(loaded.nodeEnv).toBe('test');
    expect(loaded.jwtSecret).toBe('test-environment-jwt-secret-key-32chars!!');
  });

  it('validates invalid port numbers', () => {
    expect(() => {
      loadConfig({
        PORT: 'not-a-number',
      });
    }).toThrow('Invalid PORT value');

    expect(() => {
      loadConfig({
        PORT: '999999',
      });
    }).toThrow('Invalid PORT value');
  });
});
