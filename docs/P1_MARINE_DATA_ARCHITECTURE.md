# Smart Fishing Morocco — P1 Architecture Proposal & Implementation Plan
## Marine Data Reliability & Tide Prediction Architecture

---

## 1. Context & Identified Shortcomings in Current Implementation

Actuellement, les services marins (`src/services/marineService.ts`) présentent plusieurs fragilités :
1. **Couplage fort & Absence de séparation de couches** : Les appels API HTTP vers les fournisseurs externes (Open-Meteo) sont mêlés à la logique de transformation et aux valeurs de secours statiques.
2. **Ambiguïté sur la provenance des données de marées** :
   - Le calcul des marées et des heures de marée haute/basse repose sur une modélisation semi-empirique / sinusoïdale simplifiée (`calculateTides`).
   - L'API retourne ces données sous le format habituel sans mention explicite de leur nature estimée ou simulée.
   - Les pêcheurs professionnels et amateurs risquent d'interpréter des marées approximées comme des mesures ou prédictions astronomiques vérifiées.
3. **Résilience et observabilité limitées** : En cas de coupure réseau ou d'indisponibilité du fournisseur externe, la stratégie de cache, de timeout et de retry n'est pas standardisée.

---

## 2. P1 Target Architecture

```
                    +------------------------------------------+
                    |          Express Route Handlers          |
                    |         (/api/v1/marine/*)               |
                    +------------------------------------------+
                                         |
                                         v
                    +------------------------------------------+
                    |          Marine Domain Service           |
                    |  (Orchestration, Provenance Normalization)|
                    +------------------------------------------+
                               /                   \
                              v                     v
              +--------------------------+  +--------------------------+
              |   Marine Data Provider   |  |   Tide Data Provider     |
              |   (e.g., Open-Meteo)     |  |   (Astronomical/Harmonic)|
              +--------------------------+  +--------------------------+
                              \                     /
                               v                   v
                    +------------------------------------------+
                    |        Resilience & Quality Layer        |
                    |  (Cache, Retry, Circuit Breaker, Stale)  |
                    +------------------------------------------+
```

### 2.1 Normalized Marine & Tide Data Model
Chaque mesure ou prédiction marine est encapsulée avec des métadonnées de traçabilité (`provenance`) :

```typescript
export type DataQualityTier = 'observed' | 'astronomical_forecast' | 'numerical_forecast' | 'estimated' | 'simulated';

export interface DataProvenance {
  provider: string;               // e.g., 'open-meteo', 'noaa-coops', 'shom', 'fallback-engine'
  retrievedAt: string;            // ISO timestamp
  quality: DataQualityTier;       // Explicit distinction between verified, forecast, estimated, and simulated
  stationId?: string;             // Reference tide station or buoy ID if applicable
  coordinates: {
    latitude: number;
    longitude: number;
  };
  units: Record<string, string>;   // e.g., { waveHeight: 'm', windSpeed: 'km/h', tideHeight: 'm' }
  isSimulatedFallback: boolean;   // Explicit boolean flag
  confidenceScore?: number;       // 0.0 to 1.0 confidence index
}

export interface NormalizedMarineForecast {
  provenance: DataProvenance;
  location: {
    latitude: number;
    longitude: number;
    timezone: string;
  };
  hourly: HourlyMarineCondition[];
  dailySummary: DailyMarineSummary;
}

export interface NormalizedTidePrediction {
  provenance: DataProvenance;
  currentTide: {
    type: 'High' | 'Low' | 'Rising' | 'Falling';
    heightMeters: number;
    trend: 'Rising' | 'Falling' | 'Slack';
  };
  tideEvents: TideEvent[];
  solunar: SolunarRating;
  disclaimer?: string;            // Human-readable warning if quality is 'simulated' or 'estimated'
}
```

### 2.2 Provider Abstraction & Pluggability
Création d'interfaces découplées :
- `IMarineForecastProvider` : Contrat standardisé pour la météo marine (vagues, houle, vent, température d'eau).
- `ITidePredictionProvider` : Contrat dédié aux marées astronomiques et stations côtières marocaines (Casablanca, Tanger, Agadir, Dakhla, etc.).
- Implémentation d'un `SimulatedTideProvider` strictement typé avec `quality: 'simulated'`, accompagné d'un message d'avertissement ("Notice: Tide predictions for this coordinate are approximate astronomical estimations and not hydrographic tidal gauge measurements").

### 2.3 Résilience, Caching et Retry
1. **Cache TTL à double niveau** :
   - In-memory / KV cache avec durée de validité (ex: 30 minutes pour les prévisions horaires, 6 heures pour les marées).
   - "Stale-While-Revalidate" : Si le fournisseur externe échoue temporairement, servir la dernière donnée en cache en annotant `provenance.stale = true`.
2. **Circuit Breaker & Timeouts stricts** : Timeout HTTP de 4 secondes maximum sur les fournisseurs externes pour ne jamais bloquer l'application Android.

---

## 3. Prioritized Implementation Roadmap

| Phase | Description | Durée estimée | Risques & Complexité |
|---|---|---|---|
| **Phase 1** | Création du modèle de provenance et de normalisation (`domain/marineModels.ts`) | 1 jour | Faible : rétrocompatibilité des champs JSON existants |
| **Phase 2** | Refactorisation de `MarineService` avec injection de dépendance (`IMarineProvider`, `ITideProvider`) | 1-2 jours | Moyen : préserver les contrats d'API Android existants |
| **Phase 3** | Câblage de la distinction explicite `observed`/`forecast` vs `estimated`/`simulated` et flag de disclaimer | 1 jour | Faible : validation frontend requise pour affichage UI |
| **Phase 4** | Ajout de la couche de résilience (Circuit Breaker, retries avec backoff exponentiel, cache TTL) | 1-2 jours | Moyen : gestion fine des timeouts sous charge |
| **Phase 5** | Suite de tests d'intégration (mocks des pannes réseau, vérification de provenance, tests de régression) | 1 jour | Faible : tests automatisés Vitest |

---

## 4. Critères d'Acceptation P1

1. **Aucune simulation déguisée** : Les réponses de `/api/v1/marine/tides` et `/api/v1/marine/forecast` contiennent obligatoirement l'objet `provenance`.
2. **Rétrocompatibilité Android** : Tous les champs attendus par l'application Android (`currentTide`, `tideEvents`, `hourly`, `dailySummary`) restent présents aux mêmes types et formats.
3. **Résilience réseau** : Une panne ou lenteur de l'API externe Open-Meteo renvoie des données en cache ou un fallback étiqueté `simulated` sous 5 secondes sans crash serveur (500).
4. **Couverture de tests >= 90%** sur la couche marine.
