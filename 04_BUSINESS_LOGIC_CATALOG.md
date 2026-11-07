# Business Logic Catalog - Smart Fishing Morocco

## Fishing Score Calculation (`SmartFishingScoreEngine.kt`)

### Overview
The fishing score is a weighted aggregation of five key environmental and biological factors.

### Formula
`Final Score = (Wave * 0.25) + (Wind * 0.20) + (Tide * 0.20) + (Solunar * 0.20) + (Species * 0.15)`

### Factors
1.  **Wave & Swell (25%)**: Evaluated based on height in meters.
2.  **Wind & Pressure (20%)**: Evaluated based on speed (km/h) and pressure (hPa).
3.  **Tide Flow (20%)**: Evaluated based on tide type (Rising, High, Falling, Low).
4.  **Solunar & Diurnal (20%)**: Evaluated based on solunar rating and time of day (Golden hour boost).
5.  **Species Alignment (15%)**: Evaluated based on species-specific preferences (via `SpeciesProfile.evaluateMatch`).

### Safety Assessment
Calculated independently based on wave height and wind conditions to determine risk levels (Severe, High, Moderate, Safe).
