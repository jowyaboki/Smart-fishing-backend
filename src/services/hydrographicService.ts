import {
  CsvIngestionOptions,
  HydrographicObservation,
  HydrographicQualityReport,
  HydrographicStation,
  IngestionSummary,
} from '../domain/hydrographicModels';
import { HydrographicRepository } from '../data/hydrographicRepository';
import { CsvIngestionEngine } from './hydrographic/csvIngestionService';
import { EmpiricalValidationEngine } from './hydrographic/empiricalValidationService';
import { TideValidationOptions, TideValidationRun } from '../domain/tideValidationModels';

export class HydrographicService {
  private repo: HydrographicRepository;
  private ingestionEngine: CsvIngestionEngine;
  private validationEngine: EmpiricalValidationEngine;

  constructor(repo?: HydrographicRepository, validationEngine?: EmpiricalValidationEngine) {
    this.repo = repo || new HydrographicRepository();
    this.ingestionEngine = new CsvIngestionEngine(this.repo);
    this.validationEngine = validationEngine || new EmpiricalValidationEngine(this.repo);
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

  /**
   * Runs an empirical tide validation analysis against persisted observations
   */
  public async runValidation(options: TideValidationOptions): Promise<TideValidationRun> {
    return this.validationEngine.validateStation(options);
  }

  /**
   * Retrieves past validation runs for a station or all stations
   */
  public getValidationRuns(stationId?: string, limit?: number): TideValidationRun[] {
    return this.repo.getValidationRuns(stationId, limit);
  }

  /**
   * Retrieves a single validation run by ID
   */
  public getValidationRun(id: string): TideValidationRun | null {
    return this.repo.getValidationRun(id);
  }
}
