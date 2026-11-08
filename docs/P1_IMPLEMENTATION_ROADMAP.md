# P1 Marine Data Reliability — Granular Implementation Roadmap

**Milestone:** P1 — Marine Data Reliability & Tide Prediction Architecture
**Document Status:** Implementation-Ready Engineering Blueprint
**Target Completion:** P1 Delivery Cycle
**Execution Constraints:**
- Zero breaking changes to Android client contracts.
- Zero new external runtime dependencies (native Node 20+ and TypeScript standard patterns).
- Test-driven validation with hermetic mocks before touching live traffic.

---

## 1. Roadmap Overview & Phasing Strategy

The implementation is partitioned into six sequentially decoupled phases. Each phase is independently testable and verifiable, guaranteeing that existing functionality remains undisturbed throughout development.

```
┌─────────────────────────────────────────────────────────────┐
│ Phase 1: Domain Models, Provenance & Provider Contracts     │
│ (src/domain/marineModels.ts)                                │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 2: Provider Adapters (OpenMeteo & Simulated Fallback) │
│ (src/services/marine/providers/*)                           │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 3: Resilience Layer (Circuit Breaker & Bounded Cache) │
│ (src/services/marine/resilience/*)                          │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 4: Astronomical Harmonic Tide Engine Calibration      │
│ (src/services/marine/tides/*)                               │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 5: Marine Orchestrator Refactoring & Route Integration│
│ (src/services/marineService.ts, src/routes/marineRoutes.ts) │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ Phase 6: Automated Test Suites & Android Parity Verification│
│ (tests/marine/*, tests/api.test.ts)                         │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Granular Phase Breakdown

### Phase 1: Domain Models, Provenance & Provider Contracts
**Objective:** Define strict TypeScript domain models, data quality tiers, provenance schemas, and provider contracts without altering runtime behavior.

- **Impacted Files:**
  - Create: `src/domain/marineModels.ts`
- **Detailed Tasks:**
  1. Define `DataQualityTier` union type: `'observed' | 'astronomical_forecast' | 'numerical_forecast' | 'estimated' | 'simulated'`.
  2. Define `DataProvenance` interface with strict fields: `provider`, `retrievedAt`, `quality`, `stationId`, `coordinates`, `units`, `isSimulatedFallback`, `confidenceScore`, `isStale`, `disclaimer`.
  3. Define `HourlyCondition`, `DailyMarineSummary`, and `MarineForecastResponse` preserving all legacy fields.
  4. Define `TideEvent`, `SolunarRating`, and `TidePredictionResponse` preserving all legacy fields.
  5. Define provider abstraction interfaces:
     - `IMarineForecastProvider` (`getForecast`, `isAvailable`).
     - `ITidePredictionProvider` (`getTidePrediction`).
- **Dependencies:** None.
- **Acceptance Criteria:**
  - `src/domain/marineModels.ts` compiles cleanly with `tsc --noEmit`.
  - Type definitions match legacy response contracts while extending them with optional/additive provenance fields.
- **Rollback Strategy:** Delete `src/domain/marineModels.ts`. No production code is impacted.

---

### Phase 2: Provider Adapters (OpenMeteo & Simulated Fallbacks)
**Objective:** Decouple external network HTTP calls from business logic into isolated provider adapters.

- **Impacted Files:**
  - Create: `src/services/marine/providers/openMeteoProvider.ts`
  - Create: `src/services/marine/providers/simulatedMarineProvider.ts`
  - Create: `src/services/marine/providers/moroccanSpotResolver.ts`
- **Detailed Tasks:**
  1. Extract Open-Meteo REST calls from `MarineService` into `OpenMeteoProvider` implementing `IMarineForecastProvider`.
     - Implement independent `AbortSignal.timeout(3500)` per sub-request (marine waves and atmospheric weather).
     - Graceful field assembly: map HTTP JSON to `HourlyCondition` with `quality: 'numerical_forecast'`.
     - Throw typed `ProviderNetworkError` or `ProviderTimeoutError` on failure without swallowing silently.
  2. Implement `SimulatedMarineProvider` implementing `IMarineForecastProvider`.
     - Port sinusoidal simulation math with explicit provenance: `quality: 'simulated'`, `isSimulatedFallback: true`, `confidenceScore: 0.25`, and safety disclaimer.
  3. Extract Moroccan coastal spot geocoding into `MoroccanSpotResolver` (supporting Tanger, Casablanca, Mohammedia, Essaouira, Agadir, Dakhla).
- **Dependencies:** Phase 1.
- **Acceptance Criteria:**
  - Unit tests verify `OpenMeteoProvider` maps valid JSON responses into `MarineForecastResponse`.
  - Unit tests verify `OpenMeteoProvider` throws typed errors on HTTP 500 or timeout.
  - `SimulatedMarineProvider` outputs valid forecast structures tagged with `simulated` quality and disclaimer.
- **Rollback Strategy:** Delete new provider files in `src/services/marine/providers/`.

---

### Phase 3: Resilience Layer (Circuit Breaker & Bounded Cache)
**Objective:** Protect the system against external provider outages, cascading timeouts, and unbounded memory consumption.

- **Impacted Files:**
  - Create: `src/services/marine/resilience/circuitBreaker.ts`
  - Create: `src/services/marine/resilience/marineCache.ts`
- **Detailed Tasks:**
  1. Implement `CircuitBreaker` class:
     - Three states: `CLOSED`, `OPEN`, `HALF-OPEN`.
     - Track consecutive failures (threshold: 3).
     - Reset timeout cooldown: 30 seconds.
     - Provide `execute<T>(fn: () => Promise<T>, fallbackFn: () => Promise<T>): Promise<T>`.
     - Immediate fail-fast to fallback when in `OPEN` state.
     - Single trial probe in `HALF-OPEN` state.
  2. Implement `MarineCache` class:
     - Bounded in-memory store (max 500 keys, LRU eviction) to eliminate Node.js heap leak risks.
     - Tiered TTL support:
       - Numerical forecast: 30 minutes fresh, 6 hours stale.
       - Astronomical tides: 12 hours fresh, 48 hours stale.
       - Simulated fallback: **60 seconds maximum**.
     - Support Stale-While-Revalidate: retrieve stale data tagged with `isStale: true` when upstream fails.
- **Dependencies:** Phase 1.
- **Acceptance Criteria:**
  - Unit tests verify circuit transitions from CLOSED -> OPEN after 3 failures.
  - Unit tests verify fast fallback (< 5ms) when OPEN without invoking external fetch.
  - Unit tests verify LRU eviction when key capacity is exceeded.
  - Unit tests verify fallback entries expire after 60 seconds.
- **Rollback Strategy:** Delete resilience classes.

---

### Phase 4: Astronomical Harmonic Tide Engine Calibration
**Objective:** Replace naive sinusoidal date-based tide formulas with calibrated astronomical predictions for Moroccan coastal sectors.

- **Impacted Files:**
  - Create: `src/services/marine/tides/moroccanTideStations.ts`
  - Create: `src/services/marine/tides/harmonicTideProvider.ts`
  - Create: `src/services/marine/tides/simulatedTideProvider.ts`
  - Create: `src/services/marine/tides/solunarCalculator.ts`
- **Detailed Tasks:**
  1. Define calibrated Moroccan reference tidal stations (`moroccanTideStations.ts`):
     - Casablanca (Atlantic Central)
     - Tanger Med (Strait of Gibraltar)
     - Essaouira (Atlantic South-Central)
     - Agadir (Souss Coast)
     - Dakhla (Sahara Atlantic)
  2. Implement `HarmonicTideProvider` implementing `ITidePredictionProvider`:
     - Select nearest reference port by haversine distance.
     - Compute astronomical semi-diurnal tidal curves based on lunar hour angle and calibrated local lunitidal intervals.
     - Generate realistic 4 daily tide events (Low/High/Low/High) with local amplitude variations.
     - Tag output with `quality: 'astronomical_forecast'`, `stationId`, and `confidenceScore: 0.85`.
  3. Extract and refine `SolunarCalculator`:
     - Astronomical lunar phase, illumination percentage, and solunar fishing ratings.
  4. Implement `SimulatedTideProvider` for uncalibrated coordinates:
     - Tag with `quality: 'simulated'`, `isSimulatedFallback: true`, and warning disclaimer.
- **Dependencies:** Phase 1.
- **Acceptance Criteria:**
  - Verified against Moroccan tide reference tables for Casablanca and Tanger.
  - Mediterranean spots (Tanger) exhibit micro-tidal ranges (~1m) while Atlantic spots (Casablanca) exhibit meso-tidal ranges (2.5m - 3.8m).
  - Provenance correctly tags reference station name and coordinates.
- **Rollback Strategy:** Revert new tide engine files.

---

### Phase 5: Marine Orchestrator Refactoring & Route Integration
**Objective:** Connect new provider adapters, cache, circuit breaker, and tide engine into `MarineService`, maintaining 100% backward compatibility for `/api/v1/marine/forecast` and `/api/v1/marine/tides`.

- **Impacted Files:**
  - Refactor: `src/services/marineService.ts`
  - Refactor: `src/routes/marineRoutes.ts`
- **Detailed Tasks:**
  1. Refactor `MarineService` to delegate to:
     - `OpenMeteoProvider` wrapped by `CircuitBreaker`.
     - `MarineCache` with Stale-While-Revalidate and fallback cascade.
     - `HarmonicTideProvider` and `SolunarCalculator`.
  2. Implement coastal bounding-box check:
     - Detect coordinates deep inland (> 60 km from coast).
     - Return appropriate validation error or clear coastal indication.
  3. Ensure all return signatures match `MarineForecastResponse` and `TidePredictionResponse`.
  4. Ensure existing query schema in `marineRoutes.ts` (`forecastQuerySchema`, `tidesQuerySchema`) remains completely compatible.
- **Dependencies:** Phases 1, 2, 3, 4.
- **Acceptance Criteria:**
  - `GET /api/v1/marine/forecast` returns valid response containing all original fields plus non-breaking `provenance`.
  - `GET /api/v1/marine/tides` returns valid response containing all original fields plus non-breaking `provenance` and `disclaimer`.
  - Upstream provider outage triggers fallback in < 100ms when circuit is open, without 500 error.
- **Rollback Strategy:** Restore original `src/services/marineService.ts` via `git checkout`.

---

### Phase 6: Automated Test Suites & Android Parity Verification
**Objective:** Establish comprehensive automated test coverage with hermetic mocks, validating normal operations, degradation modes, and Android contract stability.

- **Impacted Files:**
  - Create: `tests/marine/circuitBreaker.test.ts`
  - Create: `tests/marine/cache.test.ts`
  - Create: `tests/marine/tideEngine.test.ts`
  - Create: `tests/marine/providers.test.ts`
  - Refactor: `tests/api.test.ts` (replace live internet HTTP requests with Vitest mock handlers)
- **Detailed Tasks:**
  1. Unit tests for `CircuitBreaker`:
     - Test CLOSED -> OPEN state transition on 3 consecutive errors.
     - Test fast-fallback execution without touching provider.
     - Test cooldown expiry and HALF-OPEN probe success/failure.
  2. Unit tests for `MarineCache`:
     - Test TTL expiration.
     - Test LRU eviction when capacity is reached.
     - Test short 60s TTL for simulated data vs 30m for real forecasts.
  3. Unit tests for `HarmonicTideProvider`:
     - Test Casablanca coordinates match Atlantic meso-tidal profile.
     - Test Tanger coordinates match Strait micro-tidal profile.
     - Test Solunar calculator ratings and moon phases.
  4. Unit tests for `OpenMeteoProvider`:
     - Mock fetch responses (success, 429 rate limit, 500 error, network timeout).
     - Test partial data assembly when one endpoint fails.
  5. Integration & Contract Regression Tests:
     - Verify `tests/api.test.ts` runs 100% hermetically offline (zero internet traffic).
     - Verify Android contract schema: ensure no expected field is renamed or missing.
- **Dependencies:** Phases 1, 2, 3, 4, 5.
- **Acceptance Criteria:**
  - 100% passing tests via `npm test`.
  - Marine subsystem unit test coverage >= 90%.
  - Total test run completes in < 3 seconds offline.
- **Rollback Strategy:** Revert new test files.

---

## 3. Risks & Rollback Considerations

| Risk Category | Potential Impact | Mitigation Strategy | Rollback Action |
| :--- | :--- | :--- | :--- |
| **Android Contract Regression** | Client app crashes on response parsing if field names change. | Additive-only schema design. Contract validation tests mirroring Android DTO types. | Revert `src/services/marineService.ts` to legacy static response mapper. |
| **Circuit Breaker False Positives** | Circuit trips on minor network blips and serves fallback prematurely. | Minimum 3 consecutive failures required. Independent timeouts (3500ms) with retry. | Increase failure threshold or disable circuit via feature flag. |
| **Memory Leak in Cache** | Bounded cache grows uncontrollably under high unique coordinate load. | Strict LRU eviction capped at 1,000 entries. Periodic pruning of expired keys. | Flush cache map or reduce max entries. |
| **Performance Overhead of Harmonic Math** | High CPU utilization calculating trigonometric constituents. | Pre-calculated daily tidal event tables cached for 12 hours per spot. | Serve pre-computed station lookup tables. |
