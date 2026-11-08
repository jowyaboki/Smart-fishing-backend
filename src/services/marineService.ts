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

// Re-export compatibility types for existing consumers
export {
  MarineForecastQuery,
  MarineForecastResponse,
  TidePredictionResponse,
  TideEvent,
  TideType,
};

// In-memory cache for weather / tides to avoid redundant external network hits
const cache = new Map<string, { timestamp: number; data: any }>();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

export class MarineService {
  private static forecastProvider: IMarineForecastProvider = new OpenMeteoMarineProvider();
  private static simulatedForecastProvider: IMarineForecastProvider = new SimulatedMarineProvider();
  private static tideProvider: ITidePredictionProvider = new SimulatedTideProvider();

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
   * Resets providers to default implementations
   */
  public static resetProviders(): void {
    this.forecastProvider = new OpenMeteoMarineProvider();
    this.simulatedForecastProvider = new SimulatedMarineProvider();
    this.tideProvider = new SimulatedTideProvider();
  }

  /**
   * Clears the in-memory cache
   */
  public static clearCache(): void {
    cache.clear();
  }

  /**
   * Retrieves marine weather forecast, querying external provider with fallback simulation
   */
  public static async getForecast(query: MarineForecastQuery): Promise<MarineForecastResponse> {
    const lat = Math.round(query.latitude * 100) / 100;
    const lon = Math.round(query.longitude * 100) / 100;
    const days = Math.min(7, Math.max(1, query.days || 3));
    const cacheKey = `forecast_${lat}_${lon}_${days}`;

    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }

    try {
      const normalizedForecast = await this.forecastProvider.getForecast({
        latitude: lat,
        longitude: lon,
        days,
      });

      const responseDto = mapForecastToResponse(normalizedForecast);
      cache.set(cacheKey, { timestamp: Date.now(), data: responseDto });
      return responseDto;
    } catch {
      // Fallback on network timeout or external API unreachable
    }

    // High quality simulated marine forecast fallback
    const simulated = await this.simulatedForecastProvider.getForecast({
      latitude: lat,
      longitude: lon,
      days,
    });
    const fallbackDto = mapForecastToResponse(simulated);
    cache.set(cacheKey, { timestamp: Date.now(), data: fallbackDto });
    return fallbackDto;
  }

  /**
   * Generates astronomical and tide prediction data for coastal coordinates
   */
  public static async getTides(latitude: number, longitude: number, dateStr?: string): Promise<TidePredictionResponse> {
    const targetDate = dateStr ? new Date(dateStr) : new Date();
    const isoDate = targetDate.toISOString().split('T')[0];
    const cacheKey = `tides_${latitude}_${longitude}_${isoDate}`;

    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }

    const normalizedTides = await this.tideProvider.getTidePrediction({
      latitude,
      longitude,
      targetDate,
    });

    const responseDto = mapTidesToResponse(normalizedTides);
    cache.set(cacheKey, { timestamp: Date.now(), data: responseDto });
    return responseDto;
  }
}
