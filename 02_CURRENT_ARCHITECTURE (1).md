# Current Architecture - Smart Fishing Morocco

## Presentation Layer
- **Compose Screens**: `DashboardScreen`, `AiAssistantScreen`, `CatchLogScreen`, etc.
- **Navigation**: Uses Jetpack Navigation Compose.
- **State Management**: `MainViewModel` and other screen-specific ViewModels.
- **UI Components**: Reusable components in `app/src/main/java/com/example/ui/components/`.

## Application / Domain Layer
- **Business Logic**: Located in `app/src/main/java/com/example/marine/` (Solunar, Tide, Scoring, Weather).
- **Domain Models**: Located in `app/src/main/java/com/example/data/model/`.

## Data Layer
- **Repositories**: `AiAdvisorRepository`, `FishingRepository`, `MarineMapTileRepository`.
- **Local Databases**: Room (Entities/DAOs in `app/src/main/java/com/example/data/local/`).
- **Remote Data Sources**: Retrofit services in `app/src/main/java/com/example/data/api/`.

## Infrastructure
- **Services/Workers**: Background tasks for weather and tide notifications in `app/src/main/java/com/example/marine/service/`.
- **Location**: `LocationService` for GPS.

## Architecture Diagram (Mermaid)
```mermaid
graph TD
    UI[Presentation Layer (Compose)] --> VM[ViewModels]
    VM --> Domain[Domain Layer (Marine Engine)]
    VM --> Data[Data Layer (Repositories)]
    Data --> Local[Room Database]
    Data --> Remote[Retrofit API Services]
    Domain --> Infrastructure[Infrastructure (Location, Services)]
```
