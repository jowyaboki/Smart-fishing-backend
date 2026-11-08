import {
  CsvIngestionOptions,
  HydrographicObservation,
  HydrographicQualityReport,
  HydrographicStation,
  IngestionSummary,
} from '../domain/hydrographicModels';
import { HydrographicRepository } from '../data/hydrographicRepository';
import { CsvIngestionEngine } from './hydrographic/csvIngestionService';

export class HydrographicService {
  private repo: HydrographicRepository;
  private ingestionEngine: CsvIngestionEngine;

  constructor(repo?: HydrographicRepository) {
    this.repo = repo || new HydrographicRepository();
    this.ingestionEngine = new CsvIngestionEngine(this.repo);
  }

  /**
   * Retrieves all registered hydrographic stations
   */
  public getStations(): HydrographicStation[] {
    return this.repo.getAllStations();
  }

  /**
   * Retrieves a single station by its identifier
   */
  public getStation(stationId: string): HydrographicStation | null {
    return this.repo.getStation(stationId);
  }

  /**
   * Ingests hydrographic CSV observations with configurable format options
   */
  public async ingestCsv(
    csvContent: string | Buffer,
    options: CsvIngestionOptions = {}
  ): Promise<IngestionSummary> {
    return this.ingestionEngine.ingestCsv(csvContent, options);
  }

  /**
   * Queries stored observations for a given station
   */
  public getStationObservations(params: {
    stationId: string;
    fromTimestampUtc?: string;
    toTimestampUtc?: string;
    limit?: number;
    offset?: number;
  }): HydrographicObservation[] {
    return this.repo.getObservations(params);
  }

  /**
   * Retrieves an ingestion batch log by ID
   */
  public getBatch(batchId: string): IngestionSummary | null {
    return this.repo.getBatch(batchId);
  }

  /**
   * Generates a data quality report and calibration readiness assessment for a station
   */
  public getStationQualityReport(stationId: string): HydrographicQualityReport {
    return this.repo.getStationQualityReport(stationId);
  }
}
