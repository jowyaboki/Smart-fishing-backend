import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { MarineService } from '../services/marineService';
import { validateQuery } from '../middlewares/validationMiddleware';

const router = Router();

const forecastQuerySchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  days: z.coerce.number().min(1).max(7).optional(),
});

const tidesQuerySchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  date: z.string().optional(),
});

router.get('/forecast', validateQuery(forecastQuerySchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const forecast = await MarineService.getForecast(req.query as any);
    res.json(forecast);
  } catch (err) {
    next(err);
  }
});

router.get('/tides', validateQuery(tidesQuerySchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { latitude, longitude, date } = req.query as any;
    const tides = await MarineService.getTides(latitude, longitude, date);
    res.json(tides);
  } catch (err) {
    next(err);
  }
});

export default router;
