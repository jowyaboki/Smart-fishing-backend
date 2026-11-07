import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AiAssistantService } from '../services/aiAssistantService';
import { validateBody } from '../middlewares/validationMiddleware';

const router = Router();

const aiAdvisorSchema = z.object({
  query: z.string().min(2, 'Query must be at least 2 characters'),
  context: z
    .object({
      location: z
        .object({
          latitude: z.number(),
          longitude: z.number(),
          name: z.string().optional(),
        })
        .optional(),
      targetSpecies: z.string().optional(),
      tide: z.string().optional(),
      weather: z.string().optional(),
    })
    .optional(),
});

router.post('/fishing-assistant', validateBody(aiAdvisorSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await AiAssistantService.askAdvisor(req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
