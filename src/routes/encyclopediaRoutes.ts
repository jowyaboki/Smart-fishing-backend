import { Router, Request, Response, NextFunction } from 'express';
import { EncyclopediaService } from '../services/encyclopediaService';

const router = Router();

router.get('/species', (req: Request, res: Response, next: NextFunction) => {
  try {
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const species = EncyclopediaService.getAllSpecies(category);
    res.json({ count: species.length, species });
  } catch (err) {
    next(err);
  }
});

router.get('/species/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const species = EncyclopediaService.getSpeciesById(req.params.id);
    if (!species) {
      res.status(404).json({ error: 'Species not found' });
      return;
    }
    res.json(species);
  } catch (err) {
    next(err);
  }
});

router.get('/knots', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const knots = EncyclopediaService.getAllKnots();
    res.json({ count: knots.length, knots });
  } catch (err) {
    next(err);
  }
});

router.get('/knots/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const knot = EncyclopediaService.getKnotById(req.params.id);
    if (!knot) {
      res.status(404).json({ error: 'Knot not found' });
      return;
    }
    res.json(knot);
  } catch (err) {
    next(err);
  }
});

export default router;
