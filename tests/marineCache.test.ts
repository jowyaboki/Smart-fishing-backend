import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BoundedMarineCache, CACHE_TTL_POLICIES } from '../src/services/marine/cache/marineCache';
import { getForecastCacheKey, getTidesCacheKey, normalizeCoord } from '../src/services/marine/cache/cacheKey';

describe('BoundedMarineCache & Cache Keys', () => {
  describe('Cache Key Generator', () => {
    it('normalizes floating-point coordinates to 2 decimal places', () => {
      expect(normalizeCoord(33.581234)).toBe(33.58);
      expect(normalizeCoord(-7.609999)).toBe(-7.61);
    });

    it('generates identical keys for slight floating-point differences in the same spot', () => {
      const key1 = getForecastCacheKey(33.5801, -7.6102, 3, 'open-meteo');
      const key2 = getForecastCacheKey(33.5849, -7.6099, 3, 'open-meteo');
      expect(key1).toBe(key2);
      expect(key1).toBe('forecast:open-meteo:33.58:-7.61:3');
    });

    it('generates distinct keys for different providers, days, or coordinates', () => {
      const k1 = getForecastCacheKey(33.58, -7.61, 3, 'open-meteo');
      const k2 = getForecastCacheKey(33.58, -7.61, 5, 'open-meteo');
      const k3 = getForecastCacheKey(33.58, -7.61, 3, 'simulated-marine-engine');
      const k4 = getForecastCacheKey(30.42, -9.60, 3, 'open-meteo');

      expect(k1).not.toBe(k2);
      expect(k1).not.toBe(k3);
      expect(k1).not.toBe(k4);
    });

    it('generates collision-resistant keys for tides', () => {
      const t1 = getTidesCacheKey(33.58, -7.61, '2026-11-08T12:00:00Z', 'simulated-tide-engine');
      const t2 = getTidesCacheKey(33.58, -7.61, '2026-11-09T00:00:00Z', 'simulated-tide-engine');
      expect(t1).toBe('tides:simulated-tide-engine:33.58:-7.61:2026-11-08');
      expect(t2).toBe('tides:simulated-tide-engine:33.58:-7.61:2026-11-09');
      expect(t1).not.toBe(t2);

      // Default provider should be 'moroccan-harmonic-engine'
      const tDefault = getTidesCacheKey(33.58, -7.61, '2026-11-08');
      expect(tDefault).toBe('tides:moroccan-harmonic-engine:33.58:-7.61:2026-11-08');
    });
  });

  describe('Bounded Cache Operations', () => {
    let cache: BoundedMarineCache<any>;

    beforeEach(() => {
      cache = new BoundedMarineCache<any>({ maxCapacity: 3, defaultTtlMs: 1000 });
    });

    it('stores and retrieves entries without mutation', () => {
      const original = { test: 123, nested: { value: 'abc' } };
      cache.set('key1', original);

      const retrieved = cache.get('key1');
      expect(retrieved).toEqual(original);

      // Mutating retrieved object should not mutate cache
      retrieved.nested.value = 'mutated';
      expect(cache.get('key1').nested.value).toBe('abc');
    });

    it('enforces maximum capacity with LRU eviction', () => {
      cache.set('k1', 'val1');
      cache.set('k2', 'val2');
      cache.set('k3', 'val3');
      expect(cache.size()).toBe(3);

      // Access k1 to make it most recently used; order of use now: k2, k3, k1
      expect(cache.get('k1')).toBe('val1');

      // Adding k4 should evict the least recently used: k2
      cache.set('k4', 'val4');
      expect(cache.size()).toBe(3);
      expect(cache.get('k2')).toBeNull(); // k2 evicted
      expect(cache.get('k1')).toBe('val1');
      expect(cache.get('k3')).toBe('val3');
      expect(cache.get('k4')).toBe('val4');
    });

    it('enforces TTL expiration deterministically', () => {
      vi.useFakeTimers();
      try {
        cache.set('expKey', 'expVal', 500); // 500ms TTL
        expect(cache.get('expKey')).toBe('expVal');

        // Advance clock by 400ms (still fresh)
        vi.advanceTimersByTime(400);
        expect(cache.get('expKey')).toBe('expVal');

        // Advance past expiration
        vi.advanceTimersByTime(150);
        expect(cache.get('expKey')).toBeNull();
        expect(cache.has('expKey')).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('supports category-specific TTL constants', () => {
      expect(CACHE_TTL_POLICIES.FORECAST_MS).toBe(30 * 60 * 1000);
      expect(CACHE_TTL_POLICIES.TIDES_MS).toBe(12 * 60 * 60 * 1000);
      expect(CACHE_TTL_POLICIES.SIMULATED_MS).toBe(60 * 1000);
    });

    it('prunes expired entries accurately', () => {
      vi.useFakeTimers();
      try {
        cache.set('short1', 'v1', 200);
        cache.set('short2', 'v2', 200);
        cache.set('long1', 'v3', 2000);

        vi.advanceTimersByTime(300);
        const pruned = cache.pruneExpired();
        expect(pruned).toBe(2);
        expect(cache.size()).toBe(1);
        expect(cache.get('long1')).toBe('v3');
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
