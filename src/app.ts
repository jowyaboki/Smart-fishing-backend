import express, { Express } from 'express';
import cors, { CorsOptions } from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { getDatabase } from './data/database';
import { config } from './config';
import authRoutes from './routes/authRoutes';
import marineRoutes from './routes/marineRoutes';
import fishingRoutes from './routes/fishingRoutes';
import journalRoutes from './routes/journalRoutes';
import aiRoutes from './routes/aiRoutes';
import encyclopediaRoutes from './routes/encyclopediaRoutes';
import { errorHandler } from './middlewares/errorHandler';

export function configureCors(): CorsOptions {
  return {
    origin: (origin, callback) => {
      // Allow requests with no origin (like native Android mobile apps, curl, server-to-server)
      if (!origin) {
        return callback(null, true);
      }

      // If set to wildcard '*', allow all
      if (config.corsOrigin === '*') {
        return callback(null, true);
      }

      // Split comma-separated origins if multiple
      const allowedOrigins = config.corsOrigin
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  };
}

export function createApp(): Express {
  // Ensure database initialization
  getDatabase();

  const app = express();

  // Trust proxy configuration
  if (config.trustProxy !== false) {
    app.set('trust proxy', config.trustProxy);
  }

  // Security headers with Helmet
  app.use(helmet());

  // CORS configuration
  app.use(cors(configureCors()));

  // Payload limitation
  app.use(express.json({ limit: '1mb' }));

  if (config.nodeEnv !== 'test') {
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
