# P1 Marine Data Reliability — Repository Audit Report

**Status:** Completed
**Author:** Principal Backend Architect
**Target Milestone:** P1 — Marine Data Reliability & Tide Prediction Architecture
**Scope:** `src/services/marineService.ts`, `src/routes/marineRoutes.ts`, `src/domain/scoringEngine.ts`, external integrations, caching, and Android API contracts.

---

## 1. Executive Summary

Smart Fishing Morocco relies heavily on marine conditions (wave height, wave period, wave direction, swell, wind speed, wind direction, atmospheric pressure, water temperature) and tidal cycles (high tide, low tide, tidal flow, solunar ratings) to drive its core value propositions:
1. Marine weather forecasting (`GET /api/v1/marine/forecast`).
2. Coastal tide predictions and solunar activity ratings (`GET /api/v1/marine/tides`).
3. Algorithmic fishing score calculation (`POST /api/v1/fishing/score`).
4. AI-assisted fishing recommendations (`POST /api/v1/ai/fishing-assistant`).

While the P0 security milestone successfully hardened the application configuration, authentication, JWT tokens, and rate limiting, the **marine data subsystem** remains in a fragile, prototypical state.

This audit establishes:
- The exact state of the implementation as discovered in the codebase.
- Critical architectural, reliability, and safety vulnerabilities.
- Data flow and provenance deficiencies (notably silent synthetic data substitution).
- Precise recommendations to achieve production-grade resilience without breaking backward compatibility for the native Android client.

---

## 2. End-to-End Data Flow Analysis

### 2.1 Marine Forecast (`GET /api/v1/marine/forecast`)

```
[Android Client]
      │
      ▼
Express Route: GET /api/v1/marine/forecast?latitude=..&longitude=..&days=..
      │
      ▼
validateQuery(forecastQuerySchema) [Zod: lat [-90, 90], lon [-180, 180], days [1, 7]]
      │
      ▼
MarineService.getForecast(query)
      │
      ├─► Cache Check: cache.get(`forecast_${lat}_${lon}_${days}`)
      │     └─► Hit (< 15 min TTL) ──► Return cached MarineForecastResponse
      │
      ├─► External Fetch (Promise.all):
      │     ├─► https://marine-api.open-meteo.com/v1/marine?...
      │     └─► https://api.open-meteo.com/v1/forecast?...
      │           (Signal: AbortSignal.timeout(4000))
      │
      ├─► IF (marineRes.ok && weatherRes.ok):
      │     ├─ Transform JSON into hourly array
      │     ├─ Calculate daily summary (maxWave, minWave, avgWindSpeed, recommendedTime)
      │     ├─ Resolve Moroccan spot name (resolveMoroccanSpotName)
      │     ├─ Store in Map cache
      │     └─► Return real forecast data
      │
      └─► CATCH (Network failure, timeout > 4s, HTTP 4xx/5xx, JSON parse error):
            ├─ Silently swallow exception
            ├─ Call generateSimulatedForecast(lat, lon, days)
            ├─ Store simulated forecast in Map cache for 15 minutes!
            └─► Return simulated forecast disguised as genuine forecast
```

### 2.2 Tide Predictions (`GET /api/v1/marine/tides`)

```
[Android Client]
      │
      ▼
Express Route: GET /api/v1/marine/tides?latitude=..&longitude=..&date=..
      │
      ▼
validateQuery(tidesQuerySchema) [Zod: lat [-90, 90], lon [-180, 180], date optional]
      │
      ▼
MarineService.getTides(latitude, longitude, dateStr)
      │
      ├─► Cache Check: cache.get(`tides_${lat}_${lon}_${isoDate}`)
      │     └─► Hit (< 15 min TTL) ──► Return cached TidePredictionResponse
      │
      ├─► Synthetic Tide Calculation:
      │     ├─ baseHour = (Math.abs(Math.sin(targetDate.getDate())) * 4) + 1
      │     ├─ 4 hardcoded tide events spaced at +0h, +6h, +12h, +18h
      │     ├─ Fixed heights: 0.65m (Low), 2.85m (High), 0.72m (Low), 2.90m (High)
      │     └─ Current tide inferred solely from local system getUTCHours() intervals
      │
      ├─► Solunar Calculation (calculateSolunar):
      │     ├─ Epoch reference: 2000-01-06T18:14:00Z
      │     ├─ Synodic lunar month: 29.53058770576 days
      │     ├─ Moon illumination % & moon phase name
      │     └─ Hardcoded majorPeriods and minorPeriods
      │
      └─► Store in Map cache & return TidePredictionResponse
            (NO external tide API is ever called! Pure mathematical approximation)
```

### 2.3 Fishing Score Calculation (`POST /api/v1/fishing/score`)

```
[Android Client]
      │
      ▼
Express Route: POST /api/v1/fishing/score
      │
      ▼
SmartFishingScoreEngine.calculate(factors)
      │
      ├─ evaluateWave (25%)
      ├─ evaluateWind & pressure (20%)
      ├─ evaluateTide (20%)
      ├─ evaluateSolunar & Golden Hour (20%)
      ├─ evaluateSpecies (15%)
      └─ assessSafety (Wave >= 3.2m or Wind >= 55km/h => 'Severe' / unsafe)
```

*Key Insight:* The fishing score engine is heavily dependent on tidal and marine accuracy. If `MarineService` provides purely synthetic tides or silently degraded weather data, the fishing score engine will compute deceptively confident recommendations, potentially putting anglers at physical risk in adverse sea conditions.

---

## 3. Discovered Implementation Gaps & Critical Reliability Vulnerabilities

### Gap 1: Deceptive Data Provenance & Silent Simulation Fallback (High Safety Risk)
- **Current Behavior:** When Open-Meteo times out or fails, `generateSimulatedForecast()` generates synthetic sinusoidal wave and wind data. The API returns HTTP 200 with this simulated data. The payload contains **no flag, indicator, or disclaimer** distinguishing real atmospheric models from mathematical dummy figures.
- **Tide Deception:** In `getTides()`, tide heights and times are generated using `(Math.abs(Math.sin(targetDate.getDate())) * 4) + 1`. This does not reflect real hydrographic tidal stations along Morocco's 3,500 km coastline (e.g., Casablanca vs. Tanger vs. Dakhla have vastly different tidal ranges, amphidromic points, and lunar hour offsets). It is presented as authentic tide events without any quality indicator or disclaimer.
- **Safety Impact:** Maritime safety regulations and user trust dictate that simulated data must never be presented as observed or certified astronomical predictions. Shore fishermen on rocky Moroccan ledges (e.g., Dar Bouazza, Dahomey, Taghazout) rely on high-tide timing to avoid being trapped by rising waters.

### Gap 2: In-Memory Memory-Leak-Prone Caching (`Map<string, ...>`)
- **Current Behavior:**
  ```typescript
  const cache = new Map<string, { timestamp: number; data: any }>();
  ```
- **Issues:**
  1. **Unbounded Growth:** The map is never pruned or garbage collected. Keys accumulate indefinitely as coordinates and dates vary, creating an eventual memory leak in a long-running Node.js process.
  2. **Cache Poisoning by Fallback:** When Open-Meteo fails, the simulated fallback is written into the cache with the full 15-minute TTL (`cache.set(cacheKey, { timestamp: Date.now(), data: simulated })`). Consequently, even if Open-Meteo recovers 2 seconds later, subsequent users receive simulated data for the next 15 minutes!
  3. **No Staleness Awareness:** No concept of "Stale-While-Revalidate". Either fresh (< 15 min) or a cache miss that forces a live network call.

### Gap 3: Fragile HTTP Concurrency & Lack of Circuit Breaker
- **Current Behavior:**
  ```typescript
  const [marineRes, weatherRes] = await Promise.all([
    fetch(marineUrl, { signal: AbortSignal.timeout(4000) }),
    fetch(weatherUrl, { signal: AbortSignal.timeout(4000) }),
  ]);
  ```
- **Issues:**
  1. **All-or-Nothing Coupling:** If the weather API succeeds but the marine API times out after 4001ms, both are completely discarded, and the entire payload drops to simulated fallback.
  2. **Cascading Failure (Thundering Herd):** If Open-Meteo experiences an outage or rate limit (HTTP 429), every single incoming request from users will wait the full 4000ms timeout before falling back. A traffic surge of 50 concurrent requests would exhaust Node.js event loop handles and connection sockets.
  3. **No Circuit Breaker:** There is no mechanism to trip into an `OPEN` state to fail fast when upstream providers are unhealthy, nor any `HALF-OPEN` probe to test recovery.

### Gap 4: Tightly Coupled Architecture & Zero Testability
- **Current Behavior:** All HTTP URLs, query parameter construction, JSON mapping, fallback generation, and spot naming are hardcoded into static methods inside `MarineService`.
- **Issues:**
  1. Impossible to unit-test `MarineService` without triggering live internet HTTP requests or monkey-patching global `fetch`.
  2. Inability to swap or add secondary marine providers (e.g., Stormglass, NOAA, WorldTides, Copernicus Marine Service) without completely rewriting `marineService.ts`.

### Gap 5: Inadequate Validation of Geolocation vs. Marine Domain
- **Current Behavior:**
  ```typescript
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  ```
- **Issues:**
  Coordinates anywhere on Earth (e.g., Sahara desert, Mount Everest) are accepted. Open-Meteo's marine API returns empty arrays or HTTP 400 for landlocked inland coordinates. The backend silently catches this error and returns a simulated marine forecast for the middle of the desert with spot name `Moroccan Atlantic Coastal Spot`.

### Gap 6: Test Suite Fragility & Live Network Reliance
- **Current Behavior in `tests/api.test.ts`:**
  ```typescript
  it('GET /api/v1/marine/forecast returns hourly marine conditions', async () => {
    const res = await request(app).get('/api/v1/marine/forecast?latitude=33.58&longitude=-7.61&days=2');
    expect(res.status).toBe(200);
    // ...
  });
  ```
- **Issues:**
  1. The test suite makes **live internet HTTP requests** to Open-Meteo during every CI/CD run. Notice in test logs: `GET /api/v1/marine/forecast returns hourly marine conditions 579ms`.
  2. If the CI runner lacks internet access or Open-Meteo throttles the IP, tests either silently pass via the fallback or fail unpredictably.
  3. No assertions verify whether the returned data is real or simulated.

---

## 4. Android Client Compatibility Audit

The native Android client contract (verified via `08_BACKEND_API_SPECIFICATION.md`, `tests/api.test.ts`, and response models) requires the following JSON structures:

### `MarineForecastResponse`
- `location`: `{ latitude: number, longitude: number, name?: string }`
- `hourly`: Array of `{ time, waveHeightMeters, wavePeriodSeconds, waveDirectionDegrees, windSpeedKmh, windDirectionDegrees, surfaceTemperatureCelsius, pressureHpa }`
- `dailySummary`: `{ maxWaveHeight, minWaveHeight, avgWindSpeed, recommendedTime }`

### `TidePredictionResponse`
- `location`: `{ latitude: number, longitude: number }`
- `date`: `string (YYYY-MM-DD)`
- `currentTide`: `{ type: 'Rising'|'High'|'Falling'|'Low', heightMeters: number }`
- `tideEvents`: Array of `{ time: string, type: 'Rising'|'High'|'Falling'|'Low', heightMeters: number }`
- `solunar`: `{ moonPhase: string, moonIlluminationPercentage: number, rating: number, majorPeriods: string[], minorPeriods: string[] }`

### Compatibility Principle
Android Gson/Moshi/Kotlinx serialization will parse extra unknown JSON fields without error unless configured with strict `rejectUnknownKeys`. However, **it will crash if existing fields change types, are renamed, or become null/undefined**.
Therefore:
- All new provenance and quality indicators must be added as additive properties (`provenance`, `disclaimer`, `confidenceScore`).
- Existing response shapes must be 100% maintained in both structure and data types.

---

## 5. Architectural Recommendations

1. **Formal Data Quality Tiering:**
   Introduce an explicit 5-tier classification (`observed`, `astronomical_forecast`, `numerical_forecast`, `estimated`, `simulated`) attached to every response via a top-level `provenance` block.
2. **Decoupled Provider Architecture:**
   Extract external integrations into dedicated provider adapters implementing standard TypeScript interfaces:
   - `IMarineForecastProvider` (OpenMeteo, Copernicus, Fallback).
   - `ITidePredictionProvider` (Harmonic coastal calculator, WorldTides, Fallback).
3. **Resilience & Fault Tolerance:**
   - Implement an isolated Circuit Breaker (`Closed`, `Open`, `Half-Open`) with configurable failure thresholds (e.g., 3 consecutive failures trips the breaker for 30 seconds).
   - Implement graceful partial degradation: if the marine model fails but weather succeeds, assemble what is available rather than discarding both.
   - Per-request timeouts set at 3000ms with a single retry on network blips.
4. **Freshness-Aware Dual-Tier Cache:**
   - In-memory bounded LRU / TTL store with max entries (e.g., 500 spots) to prevent memory leaks.
   - Fresh TTL (15 minutes) vs. Stale TTL (2 hours).
   - **Crucial Rule:** Simulated fallbacks must have a short TTL (e.g., 30-60 seconds) so that the system immediately recovers when upstream providers return.
5. **Hermetic Test Harness:**
   - Complete mocking of external HTTP requests in Vitest suites (`msw` or `vi.spyOn(global, 'fetch')`).
   - Dedicated unit tests for harmonic tidal calculations, circuit breaker transitions, and degradation paths.
