import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import { setDatabaseForTesting, closeDatabase } from '../src/data/database';
import { HydrographicRepository } from '../src/data/hydrographicRepository';
import { HydrographicObservation } from '../src/domain/hydrographicModels';

describe('HydrographicRepository Persistence & Transaction Tests', () => {
  let db: DatabaseType;
  let repo: HydrographicRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    setDatabaseForTesting(db);
    repo = new HydrographicRepository(db);
  });

  afterEach(() => {
    closeDatabase();
  });

  it('automatically seeds default Moroccan reference stations', () => {
    const stations = repo.getAllStations();
    expect(stations.length).toBe(5);

    const casablanca = repo.getStation('casablanca-port');
    expect(casablanca).not.toBeNull();
    expect(casablanca?.name).toContain('Casablanca Port');
    expect(casablanca?.verticalDatum).toBe('ZH');
    expect(casablanca?.status).toBe('ACTIVE');
  });

  it('persists observations in a transaction and enforces unique (station_id, timestamp_utc)', () => {
    const obsList: HydrographicObservation[] = [
      {
        id: 'obs-1',
        stationId: 'casablanca-port',
        timestampUtc: '2026-11-08T10:00:00.000Z',
        waterLevelMeters: 2.15,
        verticalDatum: 'ZH',
        rawValue: 2.15,
        rawUnit: 'm',
        qualityTier: 'observed',
        dataStatus: 'observation',
        provenance: {
          provider: 'ANP',
          retrievedAt: '2026-11-08T10:05:00.000Z',
          quality: 'observed',
          status: 'observation',
          coordinates: { latitude: 33.6, longitude: -7.6 },
          units: { waterLevel: 'm' },
          isSimulatedFallback: false,
          confidenceScore: 1.0,
        },
      },
      {
        id: 'obs-2',
        stationId: 'casablanca-port',
        timestampUtc: '2026-11-08T11:00:00.000Z',
        waterLevelMeters: 2.75,
        verticalDatum: 'ZH',
        rawValue: 275,
        rawUnit: 'cm',
        qualityTier: 'observed',
        dataStatus: 'observation',
        provenance: {
          provider: 'ANP',
          retrievedAt: '2026-11-08T11:05:00.000Z',
          quality: 'observed',
          status: 'observation',
          coordinates: { latitude: 33.6, longitude: -7.6 },
          units: { waterLevel: 'm' },
          isSimulatedFallback: false,
          confidenceScore: 1.0,
        },
      },
    ];

    const result1 = repo.saveObservationsBatch(obsList);
    expect(result1.insertedCount).toBe(2);
    expect(result1.duplicateCount).toBe(0);

    // Query back
    const retrieved = repo.getObservations({ stationId: 'casablanca-port' });
    expect(retrieved.length).toBe(2);
    expect(retrieved[0].waterLevelMeters).toBe(2.15);
    expect(retrieved[1].waterLevelMeters).toBe(2.75);

    // Re-inserting the exact same observations should be deduplicated (idempotency)
    const result2 = repo.saveObservationsBatch(obsList, { ignoreDuplicates: true });
    expect(result2.insertedCount).toBe(0);
    expect(result2.duplicateCount).toBe(2);

    const count = repo.getObservations({ stationId: 'casablanca-port' });
    expect(count.length).toBe(2);
  });

  it('records and retrieves ingestion batches with error reporting', () => {
    repo.recordBatch({
      batchId: 'batch-test-1',
      filename: 'anp_casa_tides.csv',
      stationId: 'casablanca-port',
      totalRows: 100,
      importedCount: 98,
      duplicateCount: 1,
      errorCount: 1,
      status: 'PARTIAL',
      startedAt: '2026-11-08T12:00:00.000Z',
      completedAt: '2026-11-08T12:00:02.000Z',
      errors: [
        {
          rowNumber: 42,
          rawRow: { time: 'invalid', height: 'abc' },
          reason: 'Invalid timestamp format',
        },
      ],
    });

    const batch = repo.getBatch('batch-test-1');
    expect(batch).not.toBeNull();
    expect(batch?.batchId).toBe('batch-test-1');
    expect(batch?.filename).toBe('anp_casa_tides.csv');
    expect(batch?.importedCount).toBe(98);
    expect(batch?.status).toBe('PARTIAL');
    expect(batch?.errors.length).toBe(1);
    expect(batch?.errors[0].rowNumber).toBe(42);
  });

  it('evaluates station quality report and calibration readiness honestly', () => {
    // Empty observations report
    const initialReport = repo.getStationQualityReport('casablanca-port');
    expect(initialReport.totalObservations).toBe(0);
    expect(initialReport.calibrationReadiness.hasSufficientObservations).toBe(false);
    expect(initialReport.calibrationReadiness.hasSufficientTimeSpan).toBe(false);
    expect(initialReport.calibrationReadiness.isCalibrationEnabled).toBe(false);
    expect(initialReport.calibrationReadiness.reasons.length).toBeGreaterThan(0);
  });
});
