import {
  MarineForecastQuery,
  MarineForecastResponse,
  TidePredictionResponse,
  TideEvent,
  TideType,
  IMarineForecastProvider,
  ITidePredictionProvider,
  mapForecastToResponse,
  mapTidesToResponse,
} from '../domain/marineModels';
import { OpenMeteoMarineProvider } from './marine/providers/openMeteoProvider';
import { SimulatedMarineProvider } from './marine/providers/simulatedMarineProvider';
import { SimulatedTideProvider } from './marine/providers/simulatedTideProvider';
import { MoroccanHarmonicTideProvider } from './marine/tides/harmonicTideProvider';
import { BoundedMarineCache, CACHE_TTL_POLICIES } from './marine/cache/marineCache';
import { RequestDeduplicator } from './marine/cache/requestDeduplicator';
import { getForecastCacheKey, getTidesCacheKey } from './marine/cache/cacheKey';
import { CircuitBreaker, CircuitMetrics } from './marine/resilience/circuitBreaker';

// Re-export compatibility types for existing consumers
export {
  MarineForecastQuery,
  MarineForecastResponse,
  TidePredictionResponse,
  TideEvent,
  TideType,
};

export class MarineService {
  private static forecastProvider: IMarineForecastProvider = new OpenMeteoMarineProvider();
  private static simulatedForecastProvider: IMarineForecastProvider = new SimulatedMarineProvider();
  // Calibrated Moroccan Harmonic Tide engine as default tide provider
  private static tideProvider: ITidePredictionProvider = new MoroccanHarmonicTideProvider();

  // Bounded LRU Cache instance (max 500 entries)
  private static readonly cache = new BoundedMarineCache<any>({ maxCapacity: 500 });

  // In-flight request deduplicator instance
  private static readonly deduplicator = new RequestDeduplicator();

  // Circuit breaker isolated specifically for the external Open-Meteo forecast provider
  private static forecastCircuitBreaker = new CircuitBreaker('open-meteo', {
    failureThreshold: 3,
    cooldownMs: 30000,
    maxHalfOpenProbes: 1,
  });

  /**
   * Allows injecting custom providers (useful for testing or future provider swaps)
   */
  public static setProviders(providers: {
    forecastProvider?: IMarineForecastProvider;
    simulatedForecastProvider?: IMarineForecastProvider;
    tideProvider?: ITidePredictionProvider;
  }): void {
    if (providers.forecastProvider) this.forecastProvider = providers.forecastProvider;
    if (providers.simulatedForecastProvider) this.simulatedForecastProvider = providers.simulatedForecastProvider;
    if (providers.tideProvider) this.tideProvider = providers.tideProvider;
  }

  /**
   * Resets providers and circuit breakers to default implementations
   */
  public static resetProviders(): void {
    this.forecastProvider = new OpenMeteoMarineProvider();
    this.simulatedForecastProvider = new SimulatedMarineProvider();
    this.tideProvider = new MoroccanHarmonicTideProvider();
    this.forecastCircuitBreaker.reset();
  }

  /**
   * Clears the bounded cache and in-flight deduplicator
   */
  public static clearCache(): void {
    this.cache.clear();
    this.deduplicator.clear();
  }

  /**
   * Returns current bounded cache size
   */
  public static getCacheSize(): number {
    return this.cache.size();
  }

  /**
   * Configures or swaps the forecast circuit breaker (e.g. for testing with custom clock)
   */
  public static setForecastCircuitBreaker(breaker: CircuitBreaker): void {
    this.forecastCircuitBreaker = breaker;
  }

  /**
   * Returns observability metrics for the forecast circuit breaker
   */
  public static getForecastCircuitMetrics(): CircuitMetrics {
    return this.forecastCircuitBreaker.getMetrics();
  }

  /**
   * Resets all circuit breakers
   */
  public static resetCircuitBreakers(): void {
    this.forecastCircuitBreaker.reset();
  }

  /**
   * Retrieves marine weather forecast with bounded caching, request deduplication,
   * circuit breaker fault isolation, and fallback simulation.
   */
  public static async getForecast(query: MarineForecastQuery): Promise<MarineForecastResponse> {
    const lat = Math.round(query.latitude * 100) / 100;
    const lon = Math.round(query.longitude * 100) / 100;
    const days = Math.min(7, Math.max(1, query.days || 3));
    const cacheKey = getForecastCacheKey(lat, lon, days, this.forecastProvider.providerId);

    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Deduplicate in-flight operations for identical coordinates and days
    return this.deduplicator.execute(cacheKey, async () => {
      // Recheck cache inside deduplicator lock
      const rechecked = this.cache.get(cacheKey);
      if (rechecked) {
        return rechecked;
      }

      // 1. Attempt protected execution via CircuitBreaker
      try {
        const normalizedForecast = await this.forecastCircuitBreaker.execute(async () => {
          return await this.forecastProvider.getForecast({
            latitude: lat,
            longitude: lon,
            days,
          });
        });

        const responseDto = mapForecastToResponse(normalizedForecast);
        // Cache real numerical forecast with 30m TTL
        this.cache.set(cacheKey, responseDto, CACHE_TTL_POLICIES.FORECAST_MS);
        return responseDto;
      } catch {
        // CircuitBreakerOpenError or external provider error -> proceed to fallback
      }

      // 2. High-quality simulated marine forecast fallback
      const simulated = await this.simulatedForecastProvider.getForecast({
        latitude: lat,
        longitude: lon,
        days,
      });
      const fallbackDto = mapForecastToResponse(simulated);
      // Cache simulated fallback with short 60s TTL for fast recovery
      this.cache.set(cacheKey, fallbackDto, CACHE_TTL_POLICIES.SIMULATED_MS);
      return fallbackDto;
    });
  }

  /**
   * Generates astronomical and tide prediction data with bounded caching and request deduplication
   */
  public static async getTides(latitude: number, longitude: number, dateStr?: string): Promise<TidePredictionResponse> {
    const targetDate = dateStr ? new Date(dateStr) : new Date();
    const isoDate = targetDate.toISOString().split('T')[0];
    const cacheKey = getTidesCacheKey(latitude, longitude, isoDate, this.tideProvider.providerId);

    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    return this.deduplicator.execute(cacheKey, async () => {
      const rechecked = this.cache.get(cacheKey);
      if (rechecked) {
        return rechecked;
      }

      const normalizedTides = await this.tideProvider.getTidePrediction({
        latitude,
        longitude,
        targetDate,
      });

      const responseDto = mapTidesToResponse(normalizedTides);
      const isSimulated = normalizedTides.provenance.quality === 'simulated';
      const ttl = isSimulated ? CACHE_TTL_POLICIES.SIMULATED_MS : CACHE_TTL_POLICIES.TIDES_MS;

      this.cache.set(cacheKey, responseDto, ttl);
      return responseDto;
    });
  }
}
