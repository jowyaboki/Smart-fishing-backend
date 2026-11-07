import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { SmartFishingScoreEngine } from '../domain/scoringEngine';
import { validateBody } from '../middlewares/validationMiddleware';

const router = Router();

const calculateScoreSchema = z.object({
  waveHeightMeters: z.number().min(0).max(30),
  windSpeedKmh: z.number().min(0).max(200),
  pressureHpa: z.number().min(800).max(1100).default(1015),
  tideType: z.enum(['Rising', 'High', 'Falling', 'Low']),
  solunarRating: z.number().min(0).max(100).default(70),
  timeOfDayHours: z.number().min(0).max(24).default(12),
  targetSpeciesOptimalTide: z.enum(['Rising', 'High', 'Falling', 'Low']).optional(),
  targetSpeciesOptimalWindMax: z.number().optional(),
  waterTemperature: z.number().optional(),
  targetSpeciesOptimalWaterTempMin: z.number().optional(),
  targetSpeciesOptimalWaterTempMax: z.number().optional(),
});

router.post('/score', validateBody(calculateScoreSchema), (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = SmartFishingScoreEngine.calculate(req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
