import crypto from 'crypto';
import {
  CsvIngestionOptions,
  HydrographicObservation,
  IngestionRowError,
  IngestionSummary,
  ObservationUnit,
  VerticalDatum,
  normalizeTimestampToUtc,
  normalizeWaterLevelToMeters,
  validateVerticalDatum,
  validateWaterLevelBounds,
  HydrographicValidationError,
} from '../../domain/hydrographicModels';
import { HydrographicRepository } from '../../data/hydrographicRepository';

/**
 * Standard candidate column header names for auto-detection
 */
const TIMESTAMP_CANDIDATES = ['timestamp', 'timestamp_utc', 'time', 'date', 'datetime', 'heure', 'date_heure'];
const WATER_LEVEL_CANDIDATES = ['water_level', 'water_level_meters', 'height', 'tide_height', 'hauteur', 'level', 'valeur', 'val'];
const STATION_ID_CANDIDATES = ['station_id', 'station', 'code_station', 'port', 'port_id'];
const DATUM_CANDIDATES = ['datum', 'vertical_datum', 'datum_vertical', 'reference', 'ref'];
const UNIT_CANDIDATES = ['unit', 'units', 'unite'];

/**
 * Auto-detects delimiter from header row
 */
export function detectDelimiter(headerLine: string): string {
  const counts: Record<string, number> = {
    ',': (headerLine.match(/,/g) || []).length,
    ';': (headerLine.match(/;/g) || []).length,
    '\t': (headerLine.match(/\t/g) || []).length,
  };

  let bestDelimiter = ',';
  let maxCount = -1;

  for (const [del, count] of Object.entries(counts)) {
    if (count > maxCount) {
      maxCount = count;
      bestDelimiter = del;
    }
  }

  return maxCount > 0 ? bestDelimiter : ',';
}

/**
 * Robust CSV Line Parser taking into account quotes and escaped characters
 */
export function parseCsvLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        currentField += '"';
        i++; // skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      fields.push(currentField.trim());
      currentField = '';
    } else {
      currentField += char;
    }
  }

  fields.push(currentField.trim());
  return fields;
}

/**
 * Finds the matching header name from candidate list (case-insensitive)
 */
function findHeaderMatch(headers: string[], candidates: string[]): string | undefined {
  const normalizedHeaders = headers.map((h) => h.toLowerCase().replace(/[\s_-]/g, ''));
  for (const candidate of candidates) {
    const cleanCand = candidate.toLowerCase().replace(/[\s_-]/g, '');
    const idx = normalizedHeaders.indexOf(cleanCand);
    if (idx !== -1) {
      return headers[idx];
    }
  }
  return undefined;
}

export class CsvIngestionEngine {
  private repo: HydrographicRepository;

  constructor(repo?: HydrographicRepository) {
    this.repo = repo || new HydrographicRepository();
  }

  /**
   * Ingests CSV data from string or buffer
   */
  public async ingestCsv(
    csvContent: string | Buffer,
    options: CsvIngestionOptions = {}
  ): Promise<IngestionSummary> {
    const startedAt = new Date().toISOString();
    const batchId = `batch-${crypto.randomUUID()}`;
    const errors: IngestionRowError[] = [];

    const rawString = typeof csvContent === 'string' ? csvContent : csvContent.toString('utf-8');
    const lines = rawString
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#')); // ignore empty lines and comment lines

    if (lines.length < 2) {
      const summary: IngestionSummary = {
        batchId,
        stationId: options.stationId,
        totalRows: 0,
        importedCount: 0,
        duplicateCount: 0,
        errorCount: 1,
        status: 'FAILED',
        startedAt,
        completedAt: new Date().toISOString(),
        errors: [
          {
            rowNumber: 0,
            rawRow: {},
            reason: 'CSV file is empty or missing headers',
          },
        ],
      };
      this.repo.recordBatch(summary);
      return summary;
    }

    const headerLine = lines[0];
    const delimiter = options.delimiter || detectDelimiter(headerLine);
    const headers = parseCsvLine(headerLine, delimiter);

    // Identify columns
    const timeCol = options.timestampColumn || findHeaderMatch(headers, TIMESTAMP_CANDIDATES);
    const valCol = options.waterLevelColumn || findHeaderMatch(headers, WATER_LEVEL_CANDIDATES);
    const stCol = options.stationIdColumn || findHeaderMatch(headers, STATION_ID_CANDIDATES);
    const datumCol = options.verticalDatumColumn || findHeaderMatch(headers, DATUM_CANDIDATES);
    const unitCol = options.unitColumn || findHeaderMatch(headers, UNIT_CANDIDATES);

    if (!timeCol || !valCol) {
      const summary: IngestionSummary = {
        batchId,
        stationId: options.stationId,
        totalRows: 0,
        importedCount: 0,
        duplicateCount: 0,
        errorCount: 1,
        status: 'FAILED',
        startedAt,
        completedAt: new Date().toISOString(),
        errors: [
          {
            rowNumber: 1,
            rawRow: { header: headerLine },
            reason: `Required columns could not be identified. Missing: ${!timeCol ? 'timestamp' : ''} ${!valCol ? 'waterLevel' : ''}`,
          },
        ],
      };
      this.repo.recordBatch(summary);
      return summary;
    }

    const validObservations: HydrographicObservation[] = [];
    let duplicateCount = 0;

    // Track seen in current batch for in-memory deduplication
    const seenInBatch = new Set<string>();

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const rowNumber = i + 1; // 1-indexed (line 1 is header)
      const values = parseCsvLine(line, delimiter);

      const rowMap: Record<string, string> = {};
      headers.forEach((h, idx) => {
        rowMap[h] = values[idx] ?? '';
      });

      try {
        const stationId = (stCol ? rowMap[stCol] : options.stationId)?.trim();
        if (!stationId) {
          throw new HydrographicValidationError(
            'Missing stationId. Either provide stationId in CSV column or options.',
            'stationId'
          );
        }

        // Validate station exists in repository
        const station = this.repo.getStation(stationId);
        if (!station) {
          throw new HydrographicValidationError(
            `Target station '${stationId}' does not exist in hydrographic registry.`,
            'stationId'
          );
        }

        const rawTimestamp = rowMap[timeCol];
        const timestampUtc = normalizeTimestampToUtc(rawTimestamp);

        const rawValueStr = rowMap[valCol];
        const rawValue = parseFloat(rawValueStr);
        if (isNaN(rawValue)) {
          throw new HydrographicValidationError(
            `Non-numeric water level value: '${rawValueStr}'`,
            'waterLevel'
          );
        }

        const rawUnitStr = (unitCol && rowMap[unitCol]) || options.defaultUnit || 'm';
        const waterLevelMeters = normalizeWaterLevelToMeters(rawValue, rawUnitStr);

        // Physical plausibility threshold check
        validateWaterLevelBounds(
          waterLevelMeters,
          options.minWaterLevelMeters,
          options.maxWaterLevelMeters
        );

        // Vertical datum validation
        const rawDatumStr = (datumCol && rowMap[datumCol]) || options.defaultVerticalDatum || station.verticalDatum;
        const verticalDatum = validateVerticalDatum(rawDatumStr);

        // Strict vertical datum check against station datum
        if (verticalDatum !== station.verticalDatum) {
          throw new HydrographicValidationError(
            `Vertical datum mismatch: row datum is '${verticalDatum}' while station '${station.id}' reference is '${station.verticalDatum}'`,
            'verticalDatum'
          );
        }

        // Intra-batch duplicate check
        const uniqueKey = `${stationId}:${timestampUtc}`;
        if (seenInBatch.has(uniqueKey)) {
          duplicateCount++;
          continue;
        }
        seenInBatch.add(uniqueKey);

        const observationId = `obs-${crypto
          .createHash('sha256')
          .update(uniqueKey)
          .digest('hex')
          .slice(0, 16)}`;

        validObservations.push({
          id: observationId,
          stationId,
          timestampUtc,
          waterLevelMeters,
          verticalDatum,
          rawValue,
          rawUnit: rawUnitStr.toLowerCase() as ObservationUnit,
          qualityTier: 'observed', // Strictly 'observed' physical telemetry
          dataStatus: 'observation',
          provenance: {
            provider: options.sourceProvider || 'Hydrographic Observation Ingestion',
            retrievedAt: startedAt,
            quality: 'observed',
            status: 'observation',
            stationId: station.id,
            stationName: station.name,
            coordinates: {
              latitude: station.latitude,
              longitude: station.longitude,
            },
            units: {
              waterLevel: 'm',
              rawUnit: rawUnitStr,
            },
            isSimulatedFallback: false,
            confidenceScore: 1.0,
            disclaimer:
              'Empirical hydrographic observation ingested via standardized protocol. Does not constitute automated astronomical calibration.',
          },
          importBatchId: batchId,
        });
      } catch (err: unknown) {
        const errorReason = err instanceof Error ? err.message : String(err);
        const errorField = err instanceof HydrographicValidationError ? err.field : undefined;
        errors.push({
          rowNumber,
          rawRow: rowMap,
          reason: errorReason,
          field: errorField,
        });

        if (options.continueOnError === false) {
          break;
        }
      }
    }

    // Ensure batch record is created first so FOREIGN KEY (import_batch_id) succeeds
    const initialBatchSummary: IngestionSummary = {
      batchId,
      stationId: options.stationId,
      totalRows: lines.length - 1,
      importedCount: 0,
      duplicateCount: 0,
      errorCount: errors.length,
      status: 'PARTIAL',
      startedAt,
      completedAt: new Date().toISOString(),
      errors,
    };
    this.repo.recordBatch(initialBatchSummary);

    // Persist valid observations in transaction with database deduplication
    const persistResult = this.repo.saveObservationsBatch(validObservations, {
      ignoreDuplicates: options.ignoreDuplicates ?? true,
    });

    duplicateCount += persistResult.duplicateCount;

    let status: IngestionSummary['status'] = 'SUCCESS';
    if (errors.length > 0 && persistResult.insertedCount > 0) {
      status = 'PARTIAL';
    } else if (errors.length > 0 && persistResult.insertedCount === 0) {
      status = 'FAILED';
    }

    const summary: IngestionSummary = {
      batchId,
      stationId: options.stationId,
      totalRows: lines.length - 1,
      importedCount: persistResult.insertedCount,
      duplicateCount,
      errorCount: errors.length,
      status,
      startedAt,
      completedAt: new Date().toISOString(),
      errors,
    };

    this.repo.recordBatch(summary);
    return summary;
  }
}
