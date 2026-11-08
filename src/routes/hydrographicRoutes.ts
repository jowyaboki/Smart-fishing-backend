import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { HydrographicService } from '../services/hydrographicService';
import { validateQuery, validateBody } from '../middlewares/validationMiddleware';

const router = Router();

function getHydroService(): HydrographicService {
  return new HydrographicService();
}

const validateTideSchema = z.object({
  startDateUtc: z.string().optional(),
  endDateUtc: z.string().optional(),
  allowMarginalData: z.boolean().optional(),
});

const listValidationsSchema = z.object({
  limit: z.coerce.number().min(1).max(100).optional(),
});

/**
 * GET /api/v1/hydrographic/stations
 * List all hydrographic stations
 */
router.get('/stations', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const stations = getHydroService().getStations();
    res.json({ count: stations.length, stations });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/hydrographic/stations/:stationId
 * Get station detail
 */
router.get('/stations/:stationId', (req: Request, res: Response, next: NextFunction) => {
  try {
    const station = getHydroService().getStation(req.params.stationId);
    if (!station) {
      return res.status(404).json({ error: `Station not found: '${req.params.stationId}'` });
    }
    res.json(station);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/hydrographic/stations/:stationId/quality
 * Get station data quality and calibration readiness report
 */
router.get('/stations/:stationId/quality', (req: Request, res: Response, next: NextFunction) => {
  try {
    const report = getHydroService().getStationQualityReport(req.params.stationId);
    res.json(report);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/hydrographic/stations/:stationId/validate
 * Run empirical validation for station
 */
router.post(
  '/stations/:stationId/validate',
  validateBody(validateTideSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { stationId } = req.params;
      const { startDateUtc, endDateUtc, allowMarginalData } = req.body;

      const result = await getHydroService().runValidation({
        stationId,
        startDateUtc,
        endDateUtc,
        allowMarginalData,
      });

      res.status(200).json(result);
    } catch (err: any) {
      if (err.message && err.message.includes('Station not found')) {
        return res.status(404).json({ error: err.message });
      }
      next(err);
    }
  }
);

/**
 * GET /api/v1/hydrographic/stations/:stationId/validations
 * List historical validation runs for a station
 */
router.get(
  '/stations/:stationId/validations',
  validateQuery(listValidationsSchema),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const { stationId } = req.params;
      const limit = req.query.limit ? Number(req.query.limit) : 50;

      const runs = getHydroService().getValidationRuns(stationId, limit);
      res.json({ count: runs.length, stationId, runs });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/hydrographic/validations/:id
 * Retrieve a single validation run by ID
 */
router.get('/validations/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const run = getHydroService().getValidationRun(req.params.id);
    if (!run) {
      return res.status(404).json({ error: `Validation run not found: '${req.params.id}'` });
    }
    res.json(run);
  } catch (err) {
    next(err);
  }
});

export default router;
