import Database, { Database as DatabaseType } from 'better-sqlite3';
import { config } from '../config';
import { SEED_KNOTS, SEED_SPECIES } from './seedData';

let dbInstance: DatabaseType | null = null;

export function getDatabase(dbPath: string = config.databasePath): DatabaseType {
  if (dbInstance) {
    return dbInstance;
  }

  dbInstance = new Database(dbPath);
  dbInstance.pragma('journal_mode = WAL');
  dbInstance.pragma('foreign_keys = ON');

  initializeSchema(dbInstance);
  seedInitialData(dbInstance);

  return dbInstance;
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

export function setDatabaseForTesting(db: DatabaseType): void {
  dbInstance = db;
  initializeSchema(dbInstance);
  seedInitialData(dbInstance);
}

function initializeSchema(db: DatabaseType): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      preferred_region TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS fishing_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      spot_name TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT,
      water_temperature REAL,
      notes TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS catch_records (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      species_name TEXT NOT NULL,
      weight_kg REAL,
      length_cm REAL,
      bait_used TEXT,
      depth_meters REAL,
      caught_at TEXT NOT NULL,
      notes TEXT,
      photo_url TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES fishing_sessions (id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS fish_species (
      id TEXT PRIMARY KEY,
      common_name TEXT NOT NULL,
      scientific_name TEXT NOT NULL,
      moroccan_name TEXT,
      category TEXT NOT NULL,
      preferred_bait TEXT NOT NULL,
      optimal_tide TEXT NOT NULL,
      optimal_water_temp_min REAL NOT NULL,
      optimal_water_temp_max REAL NOT NULL,
      optimal_wind_max_kmh REAL NOT NULL,
      description TEXT NOT NULL,
      min_legal_size_cm REAL
    );

    CREATE TABLE IF NOT EXISTS fishing_knots (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      purpose TEXT NOT NULL,
      difficulty TEXT NOT NULL,
      strength_percentage INTEGER NOT NULL,
      instructions TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON fishing_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_catches_session ON catch_records(session_id);
    CREATE INDEX IF NOT EXISTS idx_catches_user ON catch_records(user_id);

    -- Milestone P2.2: Hydrographic Tide Stations, Observations & Ingestion Batches
    CREATE TABLE IF NOT EXISTS hydrographic_stations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      region TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      vertical_datum TEXT NOT NULL,
      reference_offset_meters REAL DEFAULT 0.0,
      sensor_type TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS hydrographic_observations (
      id TEXT PRIMARY KEY,
      station_id TEXT NOT NULL,
      timestamp_utc TEXT NOT NULL,
      water_level_meters REAL NOT NULL,
      vertical_datum TEXT NOT NULL,
      raw_value REAL NOT NULL,
      raw_unit TEXT NOT NULL,
      quality_tier TEXT NOT NULL DEFAULT 'observed',
      data_status TEXT NOT NULL DEFAULT 'observation',
      provenance TEXT NOT NULL,
      import_batch_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (station_id) REFERENCES hydrographic_stations (id) ON DELETE CASCADE,
      FOREIGN KEY (import_batch_id) REFERENCES ingestion_batches (id) ON DELETE SET NULL,
      CONSTRAINT uq_station_timestamp UNIQUE (station_id, timestamp_utc)
    );

    CREATE TABLE IF NOT EXISTS ingestion_batches (
      id TEXT PRIMARY KEY,
      filename TEXT,
      station_id TEXT,
      total_rows INTEGER NOT NULL DEFAULT 0,
      imported_count INTEGER NOT NULL DEFAULT 0,
      duplicate_count INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      errors TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (station_id) REFERENCES hydrographic_stations (id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_observations_station_time ON hydrographic_observations(station_id, timestamp_utc DESC);
    CREATE INDEX IF NOT EXISTS idx_observations_batch ON hydrographic_observations(import_batch_id);
    CREATE INDEX IF NOT EXISTS idx_batches_station ON ingestion_batches(station_id);
  `);
}

function seedInitialData(db: DatabaseType): void {
  const speciesCount = db.prepare('SELECT COUNT(*) as count FROM fish_species').get() as { count: number };
  if (speciesCount.count === 0) {
    const insertSpecies = db.prepare(`
      INSERT INTO fish_species (
        id, common_name, scientific_name, moroccan_name, category,
        preferred_bait, optimal_tide, optimal_water_temp_min,
        optimal_water_temp_max, optimal_wind_max_kmh, description, min_legal_size_cm
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertManySpecies = db.transaction((speciesList) => {
      for (const sp of speciesList) {
        insertSpecies.run(
          sp.id,
          sp.commonName,
          sp.scientificName,
          sp.moroccanName || null,
          sp.category,
          JSON.stringify(sp.preferredBait),
          sp.optimalTide,
          sp.optimalWaterTempMin,
          sp.optimalWaterTempMax,
          sp.optimalWindMaxKmh,
          sp.description,
          sp.minLegalSizeCm || null
        );
      }
    });
    insertManySpecies(SEED_SPECIES);
  }

  const knotsCount = db.prepare('SELECT COUNT(*) as count FROM fishing_knots').get() as { count: number };
  if (knotsCount.count === 0) {
    const insertKnot = db.prepare(`
      INSERT INTO fishing_knots (
        id, name, purpose, difficulty, strength_percentage, instructions
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insertManyKnots = db.transaction((knotsList) => {
      for (const knot of knotsList) {
        insertKnot.run(
          knot.id,
          knot.name,
          knot.purpose,
          knot.difficulty,
          knot.strengthPercentage,
          JSON.stringify(knot.instructions)
        );
      }
    });
    insertManyKnots(SEED_KNOTS);
  }
}
