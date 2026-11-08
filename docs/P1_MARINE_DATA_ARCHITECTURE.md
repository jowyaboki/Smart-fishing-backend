# Smart Fishing Morocco — P1 Architecture Specification
## Marine Data Reliability & Tide Prediction Architecture

**Milestone:** P1
**Status:** Approved Architecture Blueprint
**Authors:** Principal Backend Architecture Team
**Target Systems:** Express / TypeScript Backend, Native Android Client (MVVM/Retrofit)

---

## 1. Architectural Vision & Core Principles

The marine data subsystem powers the mission-critical core of Smart Fishing Morocco. Anglers, artisanal fishermen, and coastal sports enthusiasts rely on wave forecasts, wind speeds, tidal heights, and solunar indices for trip planning and coastal safety.

The target P1 architecture replaces static, tightly coupled logic with a resilient, modular, and transparent domain architecture governed by four non-negotiable principles:

1. **Truth in Provenance (Zero Silent Deception):**
   Every piece of environmental or tidal data must declare its origin, timestamp, and quality tier. Synthetically generated or mathematically approximated data must never masquerade as verified measurements or official hydrographic predictions.
2. **Backward Compatibility Guarantee:**
   The native Android client must continue functioning without modification. All existing response properties, structures, and types in `GET /api/v1/marine/forecast` and `GET /api/v1/marine/tides` are preserved verbatim. Provenance and reliability indicators are added as non-breaking, additive fields.
3. **Resilience & Fault Isolation:**
   External provider latency, rate limiting, or network partitions must never crash the service or block client requests beyond 3.5 seconds. A circuit breaker and freshness-aware cache isolate external volatility.
4. **Zero Unnecessary Dependencies:**
   Built entirely using native TypeScript, Node.js 20+ features (`fetch`, `AbortSignal`), and existing project libraries (`express`, `zod`).

---

## 2. High-Level System Architecture

```
                       ┌─────────────────────────────────────────┐
                       │           Android Mobile App            │
                       │           (Retrofit Clients)            │
                       └────────────────────┬────────────────────┘
                                            │ HTTP / JSON
                                            ▼
                       ┌─────────────────────────────────────────┐
                       │        Express Routing Layer            │
                       │  - validateQuery (Zod Schema Validation)│
                       │  - /api/v1/marine/forecast              │
                       │  - /api/v1/marine/tides                 │
                       └────────────────────┬────────────────────┘
                                            │
                                            ▼
                       ┌─────────────────────────────────────────┐
                       │          Marine Domain Service          │
                       │  - Orchestration & Query Normalization  │
                       │  - Degradation & Provenance Enrichment  │
                       └──────────────┬──────────────────┬───────┘
                                      │                  │
                ┌─────────────────────┴──────┐    ┌──────┴────────────────────┐
                ▼                            ▼    ▼                           ▼
  ┌───────────────────────────┐ ┌──────────────────────────┐ ┌────────────────────────────┐
  │  Freshness-Aware LRU Cache│ │ Resilience Circuit Breaker│ │  Moroccan Spot Resolver    │
  │  - Fresh TTL (15m - 6h)   │ │ - CLOSED, OPEN, HALF-OPEN│ │  - Shore geo-bounding box  │
  │  - Stale TTL (up to 24h)  │ │ - Failure count & timeout│ │  - Station mapping         │
  │  - Fallback TTL (60s max) │ │ - Fast fallback trigger  │ └────────────────────────────┘
  └───────────────────────────┘ └──────────────────────────┘
                │                            │
                └──────────────┬─────────────┘
                               ▼
  ┌────────────────────────────────────────────────────────────────────────┐
  │                     Provider Adapter Subsystem                         │
  │                                                                        │
  │   ┌───────────────────────────────┐  ┌───────────────────────────────┐ │
  │   │   IMarineForecastProvider     │  │    ITidePredictionProvider    │ │
  │   └──────┬─────────────────┬──────┘  └──────┬─────────────────┬──────┘ │
  │          │                 │                │                 │        │
  │          ▼                 ▼                ▼                 ▼        │
  │  ┌───────────────┐ ┌───────────────┐┌───────────────┐ ┌──────────────┐ │
  │  │  Open-Meteo   │ │  Simulated    ││ Harmonic Tide │ │  Simulated   │ │
  │  │ Marine Adapter│ │ Marine Adapter││ Port Adapter  │ │ Tide Adapter │ │
  │  └───────┬───────┘ └───────────────┘└───────┬───────┘ └──────────────┘ │
  └──────────┼──────────────────────────────────┼──────────────────────────┘
             ▼                                  ▼
   [Open-Meteo REST APIs]             [Moroccan Ports Harmonic Tables]
   - Marine Waves Model               - Casablanca, Mohammedia, Tanger,
   - High-Res Weather Model             Agadir, Safi, Essaouira, Dakhla
```

---

## 3. Data Quality Tiers & Semantics

Every marine and tidal payload returned by the system MUST be tagged with one of five standardized `DataQualityTier` values.

```typescript
export type DataQualityTier =
  | 'observed'
  | 'astronomical_forecast'
  | 'numerical_forecast'
  | 'estimated'
  | 'simulated';
```

### 3.1 Strict Classification Rules

| Tier | Semantics & Source | Application in Smart Fishing Morocco | Strict Rules & Prohibitions |
| :--- | :--- | :--- | :--- |
| **`observed`** | Direct physical measurement from coastal telemetry, radar, buoys, or tide gauges. | Real-time coastal weather stations or physical tide gauge records. | **Never assign** to mathematical tide projections or weather model forecasts. Requires physical sensor timestamp and station ID. |
| **`astronomical_forecast`** | Gravitational predictions derived from known harmonic tidal constituents (M2, S2, N2, K1, etc.) for defined reference ports. | Harmonic tide predictions for calibrated Moroccan coastal ports (e.g., Casablanca, Tanger Med, Agadir, Dakhla). | **Must not** be labeled as `observed`. Reflects pure gravitational tide without storm surge or barometric pressure anomalies. |
| **`numerical_forecast`** | Atmospheric and hydrodynamic simulation models computed via numerical weather prediction (NWP) engines. | Open-Meteo marine wave models (ECMWF, GFS, ICON-EU) and atmospheric forecasts. | Assigned when external API succeeds and yields model calculations for offshore/coastal grids. |
| **`estimated`** | Spatial/temporal interpolation or secondary proxy calculations derived from nearby primary stations. | Tide calculations for a coastal point interpolated between two known reference ports, or stale cached data served during brief network degradation. | Must indicate the reference station distance or stale revalidation status in metadata. |
| **`simulated`** | Synthetic, algorithmic, or empirical fallback approximations generated when all authoritative providers and caches are unavailable. | Sine-wave fallback wave generators or generic semi-diurnal empirical formulas. | **MANDATORY DISCLAIMER:** Must include human-readable disclaimer and `isSimulatedFallback: true`. Must **never** be presented without explicit fallback markings. |

---

## 4. Normalized Domain Model & Provenance Schema

### 4.1 Provenance Metadata Schema

```typescript
export interface DataProvenance {
  /** Identifier of the data engine or upstream provider */
  provider: 'open-meteo' | 'moroccan-harmonic-engine' | 'synthetic-fallback-engine' | string;
  /** ISO 8601 timestamp when data was fetched or generated by backend */
  retrievedAt: string;
  /** Strict classification of data accuracy and origin */
  quality: DataQualityTier;
  /** Primary reference tidal station or buoy ID (if applicable) */
  stationId?: string;
  /** Friendly station or coastal sector name */
  stationName?: string;
  /** Geographic coordinates associated with this data point */
  coordinates: {
    latitude: number;
    longitude: number;
  };
  /** Physical units of measurement */
  units: {
    waveHeight: 'm';
    wavePeriod: 's';
    windSpeed: 'km/h';
    tideHeight: 'm';
    surfaceTemperature: 'celsius';
    pressure: 'hpa';
  };
  /** Explicit safety flag: true if synthetic fallback was used */
  isSimulatedFallback: boolean;
  /** Confidence score between 0.0 (unreliable synthetic) and 1.0 (verified high-res) */
  confidenceScore: number;
  /** True if data is served from an expired cache entry during upstream outage */
  isStale?: boolean;
  /** Human-readable disclaimer or limitation notice */
  disclaimer?: string;
}
```

### 4.2 Forecast Domain Model (100% Backward-Compatible)

```typescript
export interface HourlyCondition {
  time: string;                     // ISO 8601 string (e.g., '2026-11-08T06:00:00Z')
  waveHeightMeters: number;
  wavePeriodSeconds: number;
  waveDirectionDegrees: number;
  windSpeedKmh: number;
  windDirectionDegrees: number;
  surfaceTemperatureCelsius: number;
  pressureHpa: number;
}

export interface DailyMarineSummary {
  maxWaveHeight: number;
  minWaveHeight: number;
  avgWindSpeed: number;
  recommendedTime: string;
}

export interface MarineForecastResponse {
  /** Existing fields required by Android */
  location: {
    latitude: number;
    longitude: number;
    name?: string;
  };
  hourly: HourlyCondition[];
  dailySummary: DailyMarineSummary;

  /** New non-breaking additive metadata */
  provenance: DataProvenance;
}
```

### 4.3 Tide Domain Model (100% Backward-Compatible)

```typescript
export type TideType = 'Rising' | 'High' | 'Falling' | 'Low';

export interface TideEvent {
  time: string;                     // ISO 8601 string
  type: TideType;
  heightMeters: number;
}

export interface SolunarRating {
  moonPhase: string;
  moonIlluminationPercentage: number;
  rating: number;                   // 0 - 100 score
  majorPeriods: string[];
  minorPeriods: string[];
}

export interface TidePredictionResponse {
  /** Existing fields required by Android */
  location: {
    latitude: number;
    longitude: number;
  };
  date: string;                     // YYYY-MM-DD
  currentTide: {
    type: TideType;
    heightMeters: number;
  };
  tideEvents: TideEvent[];
  solunar: SolunarRating;

  /** New non-breaking additive metadata */
  provenance: DataProvenance;
  disclaimer?: string;
}
```

---

## 5. Provider Abstraction Subsystem

To eliminate tight coupling and allow seamless mocking in unit tests, external integrations are encapsulated behind standard TypeScript interfaces.

### 5.1 `IMarineForecastProvider` Interface

```typescript
export interface MarineForecastParams {
  latitude: number;
  longitude: number;
  days: number;
  timeoutMs?: number;
}

export interface IMarineForecastProvider {
  readonly providerId: string;
  getForecast(params: MarineForecastParams): Promise<MarineForecastResponse>;
  isAvailable(): Promise<boolean>;
}
```

#### Implemented Adapters:
1. **`OpenMeteoMarineAdapter`**:
   - Queries Open-Meteo Marine & Weather APIs in parallel with independent signal timeouts.
   - Graceful partial assembly: if wave data succeeds but atmospheric pressure fails, falls back only for missing fields rather than dumping the whole payload.
   - Sets `quality: 'numerical_forecast'`, `confidenceScore: 0.90`.
2. **`SimulatedMarineAdapter`**:
   - Algorithmic fallback producing physically plausible wave/wind cycles for the Moroccan Atlantic/Mediterranean coastline.
   - Sets `quality: 'simulated'`, `isSimulatedFallback: true`, `confidenceScore: 0.25`.
   - Mandatory disclaimer: *"Simulated estimate: Upstream atmospheric models unavailable. Do not use for navigation or cliff safety."*

### 5.2 `ITidePredictionProvider` Interface

```typescript
export interface TidePredictionParams {
  latitude: number;
  longitude: number;
  targetDate: Date;
}

export interface ITidePredictionProvider {
  readonly providerId: string;
  getTidePrediction(params: TidePredictionParams): Promise<TidePredictionResponse>;
}
```

#### Implemented Adapters:
1. **`MoroccanHarmonicTideAdapter`**:
   - Implements harmonic constituent tide predictions calibrated for major Moroccan coastal reference ports:
     - **Tanger / Mediterranean** (Micro-tidal: 0.8m - 1.4m range)
     - **Casablanca / Mohammedia** (Semi-diurnal meso-tidal: 1.2m - 3.8m range)
     - **Safi / Essaouira** (Semi-diurnal meso-tidal: 1.1m - 3.6m range)
     - **Agadir / Taghazout** (Semi-diurnal meso-tidal: 1.0m - 3.4m range)
     - **Dakhla / Western Sahara** (Semi-diurnal meso-tidal: 0.9m - 2.8m range)
   - Assigns the nearest port station based on haversine distance.
   - Computes tide heights, high/low inflection points, and current flow direction (`Rising`, `High`, `Falling`, `Low`).
   - Sets `quality: 'astronomical_forecast'`, `stationId: port.id`, `confidenceScore: 0.85`.
2. **`SimulatedTideAdapter`**:
   - Fallback when coordinates are outside calibrated zones.
   - Sets `quality: 'simulated'`, `isSimulatedFallback: true`, `confidenceScore: 0.30`.
   - Explicit disclaimer explaining that predictions are synthetic approximations.

---

## 6. Resilience, Caching, and Circuit Breaker Specification

### 6.1 Circuit Breaker Pattern

To prevent cascading timeouts, thread starvation, and thundering-herd issues when upstream providers experience degraded performance or outages:

```
          [Failure Count >= 3]
  CLOSED ────────────────────────► OPEN
    ▲                               │
    │ [Success]                     │ [Cooldown: 30s elapsed]
    │                               ▼
    └────────────────────────── HALF-OPEN
          [Probe Fails] ───► (back to OPEN)
```

#### Circuit Breaker Configuration:
- **Failure Threshold:** 3 consecutive errors (timeouts, HTTP 5xx, network socket reset).
- **Reset Timeout (Cooldown):** 30,000 ms (30 seconds).
- **Execution Timeout:** 3,500 ms per HTTP attempt via `AbortSignal.timeout(3500)`.
- **Fast-Fail in `OPEN` State:** When the circuit is OPEN, requests immediately bypass the external network and fall back to the stale cache or simulated adapter in < 1 ms.
- **Probe in `HALF-OPEN` State:** After cooldown, a single trial request is permitted through to the upstream provider. If successful, the circuit resets to `CLOSED`. If it fails, the circuit resets to `OPEN` for another 30 seconds.

### 6.2 Freshness-Aware Dual-Tier Caching

To solve the memory-leak and cache-poisoning risks identified in the audit:

1. **Bounded Storage:**
   - In-memory LRU map capped at 1,000 entries (protects Node.js heap memory).
2. **Distinct TTL Rules by Quality Tier:**
   - **Numerical Forecast (`numerical_forecast`):** Fresh TTL = 30 minutes; Stale TTL = 6 hours.
   - **Astronomical Tides (`astronomical_forecast`):** Fresh TTL = 12 hours; Stale TTL = 48 hours.
   - **Simulated Fallback (`simulated`):** Maximum TTL = **60 seconds**.
     *Crucial safety rule:* Fallbacks expire quickly so that the system restores real data immediately once the upstream provider recovers.
3. **Stale-While-Revalidate Policy:**
   - If the circuit breaker is OPEN or a live fetch fails, but an existing stale cache entry exists (< Stale TTL), the system returns the stale data with:
     ```typescript
     provenance.isStale = true;
     provenance.confidenceScore = Math.max(0.4, provenance.confidenceScore * 0.7);
     ```
   - Returning stale real-world forecast data is **far safer and more accurate** than returning synthetic sine waves!

---

## 7. Geolocation & Marine Domain Boundary Validation

Landlocked inland queries (e.g., Marrakech, Ouarzazate) should not return ocean swell data.
The domain layer integrates a Moroccan coastal bounding box check:
- Validates latitude between `21.0` and `36.0` N, longitude between `-17.5` and `-1.0` W.
- Rejects coordinates located far inland (> 60 km from the coastline) with HTTP 400 (`"Provided coordinates are inland; marine forecasts are only available for coastal waters."`), preventing wasted calls to marine APIs.

---

## 8. Android Client Verification & Contract Safety Matrix

| Client Component | API Route | Expected Types | Compatibility Impact | Verification Action |
| :--- | :--- | :--- | :--- | :--- |
| `MarineForecastScreen` | `GET /api/v1/marine/forecast` | `location`, `hourly[]`, `dailySummary` | **Zero Breaking Changes.** All fields match existing types. `provenance` is an additional root field. | Unit test with Android-identical JSON schema validator. |
| `TidePredictionScreen` | `GET /api/v1/marine/tides` | `location`, `date`, `currentTide`, `tideEvents[]`, `solunar` | **Zero Breaking Changes.** `provenance` and `disclaimer` added as additive properties. | Unit test verifying exact key set. |
| `FishingScoreEngine` | `POST /api/v1/fishing/score` | `finalScore`, `breakdown`, `safety` | **Unchanged.** Unaffected by marine refactor. | Existing `tests/scoringEngine.test.ts` passes untouched. |
