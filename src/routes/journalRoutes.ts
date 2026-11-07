import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { JournalService } from '../services/journalService';
import { authMiddleware, AuthenticatedRequest } from '../middlewares/authMiddleware';
import { validateBody } from '../middlewares/validationMiddleware';

const router = Router();

// Require auth for all journal & catch actions
router.use(authMiddleware);

const createSessionSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  spotName: z.string().min(1, 'Spot name is required'),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  startTime: z.string().min(1, 'Start time is required'),
  endTime: z.string().optional(),
  waterTemperature: z.number().optional(),
  notes: z.string().optional(),
});

const createCatchSchema = z.object({
  sessionId: z.string().min(1, 'Session ID is required'),
  speciesName: z.string().min(1, 'Species name is required'),
  weightKg: z.number().positive().optional(),
  lengthCm: z.number().positive().optional(),
  baitUsed: z.string().optional(),
  depthMeters: z.number().positive().optional(),
  caughtAt: z.string().optional(),
  notes: z.string().optional(),
  photoUrl: z.string().url().optional(),
});

router.post('/sessions', validateBody(createSessionSchema), (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const session = JournalService.createSession(req.user!.id, req.body);
    res.status(201).json(session);
  } catch (err) {
    next(err);
  }
});

router.get('/sessions', (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const sessions = JournalService.getSessions(req.user!.id);
    res.json({ sessions });
  } catch (err) {
    next(err);
  }
});

router.get('/sessions/:id', (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const session = JournalService.getSessionById(req.user!.id, req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Fishing session not found' });
      return;
    }
    res.json(session);
  } catch (err) {
    next(err);
  }
});

router.post('/catches', validateBody(createCatchSchema), (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const catchRecord = JournalService.addCatch(req.user!.id, req.body);
    res.status(201).json(catchRecord);
  } catch (err: any) {
    if (err.message.includes('not found') || err.message.includes('does not belong')) {
      res.status(404).json({ error: err.message });
      return;
    }
    next(err);
  }
});

router.get('/catches', (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const catches = JournalService.getCatches(req.user!.id);
    res.json({ catches });
  } catch (err) {
    next(err);
  }
});

export default router;
