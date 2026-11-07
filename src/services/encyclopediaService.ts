import { getDatabase } from '../data/database';
import { FishingKnot, FishSpecies } from '../domain/models';

export class EncyclopediaService {
  public static getAllSpecies(category?: string): FishSpecies[] {
    const db = getDatabase();
    let query = 'SELECT * FROM fish_species';
    const params: any[] = [];

    if (category) {
      query += ' WHERE category = ?';
      params.push(category);
    }
    query += ' ORDER BY common_name ASC';

    const rows = db.prepare(query).all(...params) as any[];

    return rows.map((r) => ({
      id: r.id,
      commonName: r.common_name,
      scientificName: r.scientific_name,
      moroccanName: r.moroccan_name || undefined,
      category: r.category,
      preferredBait: JSON.parse(r.preferred_bait || '[]'),
      optimalTide: r.optimal_tide,
      optimalWaterTempMin: r.optimal_water_temp_min,
      optimalWaterTempMax: r.optimal_water_temp_max,
      optimalWindMaxKmh: r.optimal_wind_max_kmh,
      description: r.description,
      minLegalSizeCm: r.min_legal_size_cm !== null ? r.min_legal_size_cm : undefined,
    }));
  }

  public static getSpeciesById(id: string): FishSpecies | null {
    const db = getDatabase();
    const r = db.prepare('SELECT * FROM fish_species WHERE id = ?').get(id) as any;
    if (!r) return null;

    return {
      id: r.id,
      commonName: r.common_name,
      scientificName: r.scientific_name,
      moroccanName: r.moroccan_name || undefined,
      category: r.category,
      preferredBait: JSON.parse(r.preferred_bait || '[]'),
      optimalTide: r.optimal_tide,
      optimalWaterTempMin: r.optimal_water_temp_min,
      optimalWaterTempMax: r.optimal_water_temp_max,
      optimalWindMaxKmh: r.optimal_wind_max_kmh,
      description: r.description,
      minLegalSizeCm: r.min_legal_size_cm !== null ? r.min_legal_size_cm : undefined,
    };
  }

  public static getAllKnots(): FishingKnot[] {
    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM fishing_knots ORDER BY name ASC').all() as any[];

    return rows.map((k) => ({
      id: k.id,
      name: k.name,
      purpose: k.purpose,
      difficulty: k.difficulty,
      strengthPercentage: k.strength_percentage,
      instructions: JSON.parse(k.instructions || '[]'),
    }));
  }

  public static getKnotById(id: string): FishingKnot | null {
    const db = getDatabase();
    const k = db.prepare('SELECT * FROM fishing_knots WHERE id = ?').get(id) as any;
    if (!k) return null;

    return {
      id: k.id,
      name: k.name,
      purpose: k.purpose,
      difficulty: k.difficulty,
      strengthPercentage: k.strength_percentage,
      instructions: JSON.parse(k.instructions || '[]'),
    };
  }
}
