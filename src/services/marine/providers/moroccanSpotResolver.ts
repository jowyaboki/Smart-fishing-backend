/**
 * Resolves Moroccan coastal spots and landmark coastal sectors from coordinates
 */
export class MoroccanSpotResolver {
  public static resolve(lat: number, lon: number): string {
    if (lat >= 35.5 && lon <= -5.5) return 'Tangier / Strait of Gibraltar';
    if (lat >= 33.3 && lat <= 34.2 && lon <= -6.5) return 'Rabat - Casablanca Atlantic Coast';
    if (lat >= 31.0 && lat <= 32.0 && lon <= -9.5) return 'Essaouira Bay';
    if (lat >= 30.0 && lat <= 30.8 && lon <= -9.5) return 'Agadir / Taghazout Coast';
    if (lat <= 24.5 && lon <= -15.5) return 'Dakhla Peninsula';
    return 'Moroccan Atlantic Coastal Spot';
  }
}
