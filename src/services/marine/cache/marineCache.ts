/**
 * Standard TTL constants for Marine data categories (in milliseconds)
 */
export const CACHE_TTL_POLICIES = {
  FORECAST_MS: 30 * 60 * 1000,      // 30 minutes for numerical marine forecasts
  TIDES_MS: 12 * 60 * 60 * 1000,    // 12 hours for astronomical tides
  SIMULATED_MS: 60 * 1000,          // 60 seconds for simulated fallbacks (fast recovery)
} as const;

export interface CacheOptions {
  maxCapacity?: number;
  defaultTtlMs?: number;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  retrievedAt: number;
}

/**
 * Memory-bounded in-process LRU cache.
 * Implements bounded capacity, TTL eviction, and defensive structured cloning.
 */
export class BoundedMarineCache<T = any> {
  private readonly maxCapacity: number;
  private readonly defaultTtlMs: number;
  private readonly store: Map<string, CacheEntry<T>>;

  constructor(options: CacheOptions = {}) {
    this.maxCapacity = Math.max(1, options.maxCapacity ?? 500);
    this.defaultTtlMs = options.defaultTtlMs ?? CACHE_TTL_POLICIES.FORECAST_MS;
    this.store = new Map<string, CacheEntry<T>>();
  }

  /**
   * Retrieves an item from cache if it exists and has not expired.
   * Refreshes the item's LRU position. Returns a deep clone to prevent mutation.
   */
  public get(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) {
      return null;
    }

    const now = Date.now();
    if (now >= entry.expiresAt) {
      this.store.delete(key);
      return null;
    }

    // Refresh LRU ordering: delete and re-insert at end of Map
    this.store.delete(key);
    this.store.set(key, entry);

    return this.clone(entry.value);
  }

  /**
   * Stores an item with bounded capacity enforcement.
   * Evicts the oldest accessed item (front of Map iterator) if capacity is exceeded.
   */
  public set(key: string, value: T, ttlMs?: number): void {
    const now = Date.now();
    const effectiveTtl = ttlMs ?? this.defaultTtlMs;
    const expiresAt = now + effectiveTtl;

    // If key already exists, delete it first so re-insertion updates LRU position
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxCapacity) {
      // Evict least recently used (first key in map)
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }

    this.store.set(key, {
      value: this.clone(value),
      expiresAt,
      retrievedAt: now,
    });
  }

  /**
   * Checks if a key exists and is unexpired without altering LRU order.
   */
  public has(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (Date.now() >= entry.expiresAt) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Manually removes a key from the cache.
   */
  public delete(key: string): boolean {
    return this.store.delete(key);
  }

  /**
   * Clears all entries from the cache.
   */
  public clear(): void {
    this.store.clear();
  }

  /**
   * Returns current count of valid, unexpired entries in the store.
   */
  public size(): number {
    this.pruneExpired();
    return this.store.size;
  }

  /**
   * Internal pruning helper to remove expired entries.
   */
  public pruneExpired(): number {
    const now = Date.now();
    let prunedCount = 0;
    for (const [key, entry] of this.store.entries()) {
      if (now >= entry.expiresAt) {
        this.store.delete(key);
        prunedCount++;
      }
    }
    return prunedCount;
  }

  /**
   * Deep clones value via structuredClone (or JSON parse/stringify fallback).
   */
  private clone(val: T): T {
    if (val === undefined || val === null) return val;
    if (typeof structuredClone === 'function') {
      try {
        return structuredClone(val);
      } catch {
        // Fallback if structuredClone fails on non-cloneable objects
      }
    }
    return JSON.parse(JSON.stringify(val));
  }
}
