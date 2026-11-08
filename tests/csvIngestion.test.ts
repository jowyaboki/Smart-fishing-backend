import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import { setDatabaseForTesting, closeDatabase } from '../src/data/database';
import { HydrographicRepository } from '../src/data/hydrographicRepository';
import { CsvIngestionEngine, detectDelimiter, parseCsvLine } from '../src/services/hydrographic/csvIngestionService';
import { HydrographicService } from '../src/services/hydrographicService';

describe('CSV Ingestion Engine & Hydrographic Service Integration', () => {
  let db: DatabaseType;
  let repo: HydrographicRepository;
  let service: HydrographicService;

  beforeEach(() => {
    db = new Database(':memory:');
    setDatabaseForTesting(db);
    repo = new HydrographicRepository(db);
    service = new HydrographicService(repo);
  });

  afterEach(() => {
    closeDatabase();
  });

  describe('CSV Parsing & Delimiter Detection', () => {
    it('detects commas, semicolons, and tabs accurately', () => {
      expect(detectDelimiter('time,water_level,station')).toBe(',');
      expect(detectDelimiter('time;water_level;station')).toBe(';');
      expect(detectDelimiter('time\twater_level\tstation')).toBe('\t');
    });

    it('parses quoted fields with commas and escaped quotes', () => {
      const line = '2026-11-08T12:00:00Z,"2.45","Casablanca, Port",ZH';
      const fields = parseCsvLine(line, ',');
      expect(fields.length).toBe(4);
      expect(fields[0]).toBe('2026-11-08T12:00:00Z');
      expect(fields[1]).toBe('2.45');
      expect(fields[2]).toBe('Casablanca, Port');
      expect(fields[3]).toBe('ZH');
    });
  });

  describe('Standard CSV Ingestion Execution', () => {
    it('ingests valid comma-separated observation rows with auto-detected headers', async () => {
      const csv = `timestamp,water_level,station_id,vertical_datum,unit
2026-11-08 00:00:00,1.85,casablanca-port,ZH,m
2026-11-08 01:00:00,2.15,casablanca-port,ZH,m
2026-11-08 02:00:00,2.75,casablanca-port,ZH,m
`;

      const summary = await service.ingestCsv(csv);

      expect(summary.status).toBe('SUCCESS');
      expect(summary.totalRows).toBe(3);
      expect(summary.importedCount).toBe(3);
      expect(summary.errorCount).toBe(0);
      expect(summary.duplicateCount).toBe(0);

      const observations = service.getStationObservations({ stationId: 'casablanca-port' });
      expect(observations.length).toBe(3);
      expect(observations[0].timestampUtc).toBe('2026-11-08T00:00:00.000Z');
      expect(observations[0].waterLevelMeters).toBe(1.85);
      expect(observations[0].qualityTier).toBe('observed');
      expect(observations[0].dataStatus).toBe('observation');
      expect(observations[0].provenance.confidenceScore).toBe(1.0);
    });

    it('ingests semicolon-delimited French hydrographic CSV (e.g. ANP / Marine Royale format)', async () => {
      const csv = `Date_Heure;Hauteur;Station;Ref
2026-11-08T06:00:00Z;210;casablanca-port;ZH
2026-11-08T07:00:00Z;285;casablanca-port;ZH
`;

      const summary = await service.ingestCsv(csv, {
        defaultUnit: 'cm', // values are in cm
        sourceProvider: 'ANP Hydrographic Survey',
      });

      expect(summary.status).toBe('SUCCESS');
      expect(summary.importedCount).toBe(2);

      const obs = service.getStationObservations({ stationId: 'casablanca-port' });
      expect(obs[0].waterLevelMeters).toBe(2.1);
      expect(obs[1].waterLevelMeters).toBe(2.85);
      expect(obs[0].rawUnit).toBe('cm');
      expect(obs[0].provenance.provider).toBe('ANP Hydrographic Survey');
    });

    it('enforces strict vertical datum validation and rejects mismatched datum', async () => {
      // Station 'casablanca-port' is configured with datum 'ZH'
      const csv = `timestamp,water_level,station_id,vertical_datum
2026-11-08T00:00:00Z,2.0,casablanca-port,MSL
`;

      const summary = await service.ingestCsv(csv);

      expect(summary.status).toBe('FAILED');
      expect(summary.importedCount).toBe(0);
      expect(summary.errorCount).toBe(1);
      expect(summary.errors[0].reason).toContain('Vertical datum mismatch');
    });

    it('performs intra-batch and database deduplication idempotently', async () => {
      const csv = `timestamp,water_level,station_id
2026-11-08T00:00:00Z,2.0,casablanca-port
2026-11-08T00:00:00Z,2.0,casablanca-port
2026-11-08T01:00:00Z,2.4,casablanca-port
`;

      // 1. First run: row 2 is a duplicate of row 1 within the same CSV
      const run1 = await service.ingestCsv(csv);
      expect(run1.status).toBe('SUCCESS');
      expect(run1.importedCount).toBe(2);
      expect(run1.duplicateCount).toBe(1);

      // 2. Second run with the same file: all 3 rows are duplicates now
      const run2 = await service.ingestCsv(csv);
      expect(run2.status).toBe('SUCCESS');
      expect(run2.importedCount).toBe(0);
      expect(run2.duplicateCount).toBe(3);

      const totalObs = service.getStationObservations({ stationId: 'casablanca-port' });
      expect(totalObs.length).toBe(2);
    });

    it('handles partial ingestion with error continuation when some rows are malformed', async () => {
      const csv = `timestamp,water_level,station_id
2026-11-08T00:00:00Z,2.0,casablanca-port
invalid-date,2.5,casablanca-port
2026-11-08T02:00:00Z,not-a-number,casablanca-port
2026-11-08T03:00:00Z,2.7,casablanca-port
`;

      const summary = await service.ingestCsv(csv, { continueOnError: true });

      expect(summary.status).toBe('PARTIAL');
      expect(summary.importedCount).toBe(2);
      expect(summary.errorCount).toBe(2);
      expect(summary.errors.length).toBe(2);
      expect(summary.errors[0].rowNumber).toBe(3);
      expect(summary.errors[1].rowNumber).toBe(4);
    });

    it('rejects physical outlier water levels (-2.0m to 12.0m)', async () => {
      const csv = `timestamp,water_level,station_id
2026-11-08T00:00:00Z,45.0,casablanca-port
`;

      const summary = await service.ingestCsv(csv);
      expect(summary.status).toBe('FAILED');
      expect(summary.errors[0].reason).toContain('outside physical threshold');
    });

    it('rejects observation ingestion for unknown station IDs', async () => {
      const csv = `timestamp,water_level,station_id
2026-11-08T00:00:00Z,2.0,unknown-station
`;

      const summary = await service.ingestCsv(csv);
      expect(summary.status).toBe('FAILED');
      expect(summary.errors[0].reason).toContain('does not exist in hydrographic registry');
    });
  });

  describe('Station Quality Report & Calibration Safeguards', () => {
    it('evaluates quality report and keeps calibration permanently disabled', async () => {
      // Ingest 725 hourly rows spanning 31 days to simulate a month of observations
      const rows: string[] = ['timestamp,water_level,station_id'];
      const baseTime = new Date('2026-10-01T00:00:00Z').getTime();

      for (let h = 0; h < 730; h++) {
        const timeIso = new Date(baseTime + h * 3600 * 1000).toISOString();
        const height = (2.0 + Math.sin(h / 6) * 1.2).toFixed(2);
        rows.push(`${timeIso},${height},casablanca-port`);
      }

      const summary = await service.ingestCsv(rows.join('\n'));
      expect(summary.status).toBe('SUCCESS');
      expect(summary.importedCount).toBe(730);

      const report = service.getStationQualityReport('casablanca-port');
      expect(report.totalObservations).toBe(730);
      expect(report.observationSpanDays).toBeGreaterThan(29.53);
      expect(report.calibrationReadiness.hasSufficientObservations).toBe(true);
      expect(report.calibrationReadiness.hasSufficientTimeSpan).toBe(true);
      expect(report.calibrationReadiness.isDatumValidated).toBe(true);

      // CRITICAL: Calibration MUST remain strictly false
      expect(report.calibrationReadiness.isCalibrationEnabled).toBe(false);
      expect(report.calibrationReadiness.reasons).toContain(
        'Automated harmonic calibration is permanently disabled pending hydrographic authority empirical certification'
      );
    });
  });
});
