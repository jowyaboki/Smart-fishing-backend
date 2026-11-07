# Data Model Analysis - Smart Fishing Morocco

## Persistence Strategies
- **Room Database**: Structured local storage (Catch logs, Fishing knots, Map tiles, Fish species).
- **Firebase Firestore**: Cloud synchronization for user-authored records (Catch logs, alerts).
- **Shared Preferences/DataStore**: Application settings and user preferences.

## Key Data Models
- `CatchLog`: Represents a fishing session and catch.
- `FishingKnot`: Information on different knots.
- `FishSpecies`: Encyclopedia information.
- `MarineConditions`: Aggregated weather/sea conditions.

*Suggested Backend Database (PostgreSQL/PostGIS):*
- Tables mirroring Room entities with added relations for multi-user capabilities.
- PostGIS for geographical indexing of `FishingSpot` and `MarineMapTile`.
