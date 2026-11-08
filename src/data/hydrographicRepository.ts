import { Database as DatabaseType } from 'better-sqlite3';
import { getDatabase } from './database';
import {
  HydrographicObservation,
  HydrographicStation,
  IngestionSummary,
  HydrographicQualityReport,
  CALIBRATION_REQUIREMENTS,
  VerticalDatum,
} from '../domain/hydrographicModels';
import { MOROCCAN_TIDE_STATIONS } from '../services/marine/tides/moroccanTideStations';

/**
 * Seed definition for baseline Moroccan hydrographic reference stations
 */
export const SEED_HYDROGRAPHIC_STATIONS: HydrographicStation[] = MOROCCAN_TIDE_STATIONS.map((st) => ({
  id: st.id,
  name: st.name,
  region: st.region,
  latitude: st.latitude,
  longitude: st.longitude,
  verticalDatum: 'ZH' as VerticalDatum, // Zéro Hydrographique (Standard Moroccan nautical reference)
  referenceOffsetMeters: 0.0,
  sensorType: 'Tide Gauge Sensor / Radar Telemetry',
  status: 'ACTIVE',
  metadata: {
    meanLevelMeters: st.meanLevelMeters,
    springRangeMeters: st.springRangeMeters,
    neapRangeMeters: st.neapRangeMeters,
    lunitidalIntervalHours: st.lunitidalIntervalHours,
  },
}));

export class HydrographicRepository {
  private db: DatabaseType;

  constructor(customDb?: DatabaseType) {
    this.db = customDb || getDatabase();
    this.seedDefaultStations();
  }

  /**
   * Seeds reference stations if hydrographic_stations table is empty
   */
  public seedDefaultStations(): void {
    const countRow = this.db.prepare('SELECT COUNT(*) as count FROM hydrographic_stations').get() as {
      count: number;
    };

    if (countRow.count === 0) {
      const insert = this.db.prepare(`
        INSERT INTO hydrographic_stations (
          id, name, region, latitude, longitude, vertical_datum,
          reference_offset_meters, sensor_type, status, metadata,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `);

      const insertMany = this.db.transaction((stations: HydrographicStation[]) => {
        for (const st of stations) {
          insert.run(
            st.id,
            st.name,
            st.region,
            st.latitude,
            st.longitude,
            st.verticalDatum,
            st.referenceOffsetMeters ?? 0.0,
            st.sensorType ?? null,
            st.status,
            st.metadata ? JSON.stringify(st.metadata) : null
          );
        }
      });

      insertMany(SEED_HYDROGRAPHIC_STATIONS);
    }
  }

  /**
   * Retrieves a station by ID
   */
  public getStation(stationId: string): HydrographicStation | null {
    const row = this.db.prepare('SELECT * FROM hydrographic_stations WHERE id = ?').get(stationId) as
      | {
          id: string;
          name: string;
          region: string;
          latitude: number;
          longitude: number;
          vertical_datum: VerticalDatum;
          reference_offset_meters: number;
          sensor_type: string | null;
          status: string;
          metadata: string | null;
          created_at: string;
          updated_at: string;
        }
      | undefined;

    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      region: row.region as HydrographicStation['region'],
      latitude: row.latitude,
      longitude: row.longitude,
      verticalDatum: row.vertical_datum,
      referenceOffsetMeters: row.reference_offset_meters,
      sensorType: row.sensor_type || undefined,
      status: row.status as HydrographicStation['status'],
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Lists all hydrographic stations
   */
  public getAllStations(): HydrographicStation[] {
    const rows = this.db.prepare('SELECT * FROM hydrographic_stations ORDER BY name ASC').all() as Array<{
      id: string;
      name: string;
      region: string;
      latitude: number;
      longitude: number;
      vertical_datum: VerticalDatum;
      reference_offset_meters: number;
      sensor_type: string | null;
      status: string;
      metadata: string | null;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      region: row.region as HydrographicStation['region'],
      latitude: row.latitude,
      longitude: row.longitude,
      verticalDatum: row.vertical_datum,
      referenceOffsetMeters: row.reference_offset_meters,
      sensorType: row.sensor_type || undefined,
      status: row.status as HydrographicStation['status'],
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Saves or updates a station
   */
  public saveStation(station: HydrographicStation): void {
    const stmt = this.db.prepare(`
      INSERT INTO hydrographic_stations (
        id, name, region, latitude, longitude, vertical_datum,
        reference_offset_meters, sensor_type, status, metadata,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        region = excluded.region,
        latitude = excluded.latitude,
        longitude = excluded.longitude,
        vertical_datum = excluded.vertical_datum,
        reference_offset_meters = excluded.reference_offset_meters,
        sensor_type = excluded.sensor_type,
        status = excluded.status,
        metadata = excluded.metadata,
        updated_at = CURRENT_TIMESTAMP
    `);

    stmt.run(
      station.id,
      station.name,
      station.region,
      station.latitude,
      station.longitude,
      station.verticalDatum,
      station.referenceOffsetMeters ?? 0.0,
      station.sensorType ?? null,
      station.status,
      station.metadata ? JSON.stringify(station.metadata) : null
    );
  }

  /**
   * Inserts a batch of observations inside a database transaction.
   * Handles deduplication via ignoreDuplicates option.
   */
  public saveObservationsBatch(
    observations: HydrographicObservation[],
    options: { ignoreDuplicates?: boolean } = {}
  ): { insertedCount: number; duplicateCount: number } {
    if (observations.length === 0) {
      return { insertedCount: 0, duplicateCount: 0 };
    }

    const ignoreDuplicates = options.ignoreDuplicates ?? true;

    const sql = ignoreDuplicates
      ? `INSERT OR IGNORE INTO hydrographic_observations (
           id, station_id, timestamp_utc, water_level_meters, vertical_datum,
           raw_value, raw_unit, quality_tier, data_status, provenance,
           import_batch_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
      : `INSERT INTO hydrographic_observations (
           id, station_id, timestamp_utc, water_level_meters, vertical_datum,
           raw_value, raw_unit, quality_tier, data_status, provenance,
           import_batch_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`;

    const stmt = this.db.prepare(sql);

    let inserted = 0;
    let duplicates = 0;

    const runBatch = this.db.transaction((obsList: HydrographicObservation[]) => {
      for (const obs of obsList) {
        const info = stmt.run(
          obs.id,
          obs.stationId,
          obs.timestampUtc,
          obs.waterLevelMeters,
          obs.verticalDatum,
          obs.rawValue,
          obs.rawUnit,
          obs.qualityTier,
          obs.dataStatus,
          JSON.stringify(obs.provenance),
          obs.importBatchId ?? null
        );

        if (info.changes > 0) {
          inserted++;
        } else {
          duplicates++;
        }
      }
    });

    runBatch(observations);
    return { insertedCount: inserted, duplicateCount: duplicates };
  }

  /**
   * Queries observations for a specific station within an optional date range
   */
  public getObservations(params: {
    stationId: string;
    fromTimestampUtc?: string;
    toTimestampUtc?: string;
    limit?: number;
    offset?: number;
  }): HydrographicObservation[] {
    let query = 'SELECT * FROM hydrographic_observations WHERE station_id = ?';
    const queryParams: unknown[] = [params.stationId];

    if (params.fromTimestampUtc) {
      query += ' AND timestamp_utc >= ?';
      queryParams.push(params.fromTimestampUtc);
    }
    if (params.toTimestampUtc) {
      query += ' AND timestamp_utc <= ?';
      queryParams.push(params.toTimestampUtc);
    }

    query += ' ORDER BY timestamp_utc ASC';

    if (params.limit !== undefined) {
      query += ' LIMIT ?';
      queryParams.push(params.limit);
      if (params.offset !== undefined) {
        query += ' OFFSET ?';
        queryParams.push(params.offset);
      }
    }

    const rows = this.db.prepare(query).all(...queryParams) as Array<{
      id: string;
      station_id: string;
      timestamp_utc: string;
      water_level_meters: number;
      vertical_datum: VerticalDatum;
      raw_value: number;
      raw_unit: HydrographicObservation['rawUnit'];
      quality_tier: HydrographicObservation['qualityTier'];
      data_status: HydrographicObservation['dataStatus'];
      provenance: string;
      import_batch_id: string | null;
      created_at: string;
    }>;

    return rows.map((r) => ({
      id: r.id,
      stationId: r.station_id,
      timestampUtc: r.timestamp_utc,
      waterLevelMeters: r.water_level_meters,
      verticalDatum: r.vertical_datum,
      rawValue: r.raw_value,
      rawUnit: r.raw_unit,
      qualityTier: r.quality_tier,
      dataStatus: r.data_status,
      provenance: JSON.parse(r.provenance),
      importBatchId: r.import_batch_id || undefined,
      createdAt: r.created_at,
    }));
  }

  /**
   * Records or updates an ingestion batch record
   */
  public recordBatch(summary: IngestionSummary): void {
    const stmt = this.db.prepare(`
      INSERT INTO ingestion_batches (
        id, filename, station_id, total_rows, imported_count,
        duplicate_count, error_count, status, started_at, completed_at,
        errors, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        total_rows = excluded.total_rows,
        imported_count = excluded.imported_count,
        duplicate_count = excluded.duplicate_count,
        error_count = excluded.error_count,
        status = excluded.status,
        completed_at = excluded.completed_at,
        errors = excluded.errors
    `);

    stmt.run(
      summary.batchId,
      summary.filename ?? null,
      summary.stationId ?? null,
      summary.totalRows,
      summary.importedCount,
      summary.duplicateCount,
      summary.errorCount,
      summary.status,
      summary.startedAt,
      summary.completedAt,
      summary.errors.length > 0 ? JSON.stringify(summary.errors) : null
    );
  }

  /**
   * Retrieves an ingestion batch by ID
   */
  public getBatch(batchId: string): IngestionSummary | null {
    const row = this.db.prepare('SELECT * FROM ingestion_batches WHERE id = ?').get(batchId) as
      | {
          id: string;
          filename: string | null;
          station_id: string | null;
          total_rows: number;
          imported_count: number;
          duplicate_count: number;
          error_count: number;
          status: string;
          started_at: string;
          completed_at: string;
          errors: string | null;
        }
      | undefined;

    if (!row) return null;

    return {
      batchId: row.id,
      filename: row.filename || undefined,
      stationId: row.station_id || undefined,
      totalRows: row.total_rows,
      importedCount: row.imported_count,
      duplicateCount: row.duplicate_count,
      errorCount: row.error_count,
      status: row.status as IngestionSummary['status'],
      startedAt: row.started_at,
      completedAt: row.completed_at,
      errors: row.errors ? JSON.parse(row.errors) : [],
    };
  }

  /**
   * Generates a comprehensive Hydrographic Quality Report for a station
   * Checking observation metrics and calibration readiness
   */
  public getStationQualityReport(stationId: string): HydrographicQualityReport {
    const station = this.getStation(stationId);
    if (!station) {
      throw new Error(`Station not found: '${stationId}'`);
    }

    const stats = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        MIN(timestamp_utc) as first_obs,
        MAX(timestamp_utc) as last_obs,
        MIN(water_level_meters) as min_val,
        MAX(water_level_meters) as max_val,
        AVG(water_level_meters) as avg_val
      FROM hydrographic_observations
      WHERE station_id = ?
    `).get(stationId) as {
      total: number;
      first_obs: string | null;
      last_obs: string | null;
      min_val: number | null;
      max_val: number | null;
      avg_val: number | null;
    };

    let spanDays = 0;
    if (stats.first_obs && stats.last_obs) {
      const startMs = new Date(stats.first_obs).getTime();
      const endMs = new Date(stats.last_obs).getTime();
      spanDays = Math.round(((endMs - startMs) / (1000 * 60 * 60 * 24)) * 100) / 100;
    }

    const hasSufficientObservations = stats.total >= CALIBRATION_REQUIREMENTS.MIN_OBSERVATIONS;
    const hasSufficientTimeSpan = spanDays >= CALIBRATION_REQUIREMENTS.MIN_SPAN_DAYS;
    const isDatumValidated = Boolean(station.verticalDatum);

    const reasons: string[] = [];
    if (!hasSufficientObservations) {
      reasons.push(
        `Insufficient observations: ${stats.total} found, minimum required is ${CALIBRATION_REQUIREMENTS.MIN_OBSERVATIONS}`
      );
    }
    if (!hasSufficientTimeSpan) {
      reasons.push(
        `Insufficient timespan: ${spanDays} days found, minimum required is ${CALIBRATION_REQUIREMENTS.MIN_SPAN_DAYS} days (synodic month)`
      );
    }
    if (!isDatumValidated) {
      reasons.push('Vertical datum is not validated against station benchmark');
    }

    reasons.push(
      'Automated harmonic calibration is permanently disabled pending hydrographic authority empirical certification'
    );

    return {
      stationId: station.id,
      stationName: station.name,
      verticalDatum: station.verticalDatum,
      totalObservations: stats.total,
      firstObservationUtc: stats.first_obs,
      lastObservationUtc: stats.last_obs,
      observationSpanDays: spanDays,
      minWaterLevelMeters: stats.min_val !== null ? Math.round(stats.min_val * 1000) / 1000 : null,
      maxWaterLevelMeters: stats.max_val !== null ? Math.round(stats.max_val * 1000) / 1000 : null,
      averageWaterLevelMeters: stats.avg_val !== null ? Math.round(stats.avg_val * 1000) / 1000 : null,
      calibrationReadiness: {
        hasSufficientObservations,
        hasSufficientTimeSpan,
        isDatumValidated,
        isCalibrationEnabled: false, // Strictly false per guidelines
        reasons,
      },
    };
  }
}
