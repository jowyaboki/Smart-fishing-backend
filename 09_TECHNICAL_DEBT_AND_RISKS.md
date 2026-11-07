# Technical Debt and Risks

- **Tight Coupling**: ViewModels directly depend on repositories and data sources.
- **Complexity**: Marine weather engine (`SmartFishingScoreEngine.kt`) is a large, complex object with significant business logic.
- **Offline Limitations**: Current offline experience relies on local caching, which needs robust sync logic for backend migration.
- **Security**: Need to ensure secure communication between Android and Backend (Authentication/Authorization).
