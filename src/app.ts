import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { getDatabase } from './data/database';
import authRoutes from './routes/authRoutes';
import marineRoutes from './routes/marineRoutes';
import fishingRoutes from './routes/fishingRoutes';
import journalRoutes from './routes/journalRoutes';
import aiRoutes from './routes/aiRoutes';
import encyclopediaRoutes from './routes/encyclopediaRoutes';
import { errorHandler } from './middlewares/errorHandler';

export function createApp(): Express {
  // Ensure database initialization
  getDatabase();

  const app = express();

  // Standard middleware
  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  if (process.env.NODE_ENV !== 'test') {
    app.use(morgan('dev'));
  }

  // Health check
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'smart-fishing-backend',
      timestamp: new Date().toISOString(),
    });
  });

  // API v1 Routes
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/marine', marineRoutes);
  app.use('/api/v1/fishing', fishingRoutes);
  app.use('/api/v1/journal', journalRoutes);
  app.use('/api/v1/ai', aiRoutes);
  app.use('/api/v1/encyclopedia', encyclopediaRoutes);

  // 404 handler
  app.use((_req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
  });

  // Global Error Handler
  app.use(errorHandler);

  return app;
}
