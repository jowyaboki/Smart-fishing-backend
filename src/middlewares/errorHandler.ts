import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

export function errorHandler(
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Check CORS error
  if (err && err.message === 'Not allowed by CORS') {
    res.status(403).json({ error: 'CORS policy violation: origin not allowed' });
    return;
  }

  // Check JSON payload limit error
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    res.status(413).json({ error: 'Payload too large: maximum allowed size is 1mb' });
    return;
  }

  const status = err.status || 500;
  const message = status >= 500 && config.nodeEnv === 'production'
    ? 'Internal Server Error'
    : (err.message || 'Internal Server Error');

  if (status >= 500 && config.nodeEnv !== 'test') {
    console.error('Unhandled server error:', err);
  }

  res.status(status).json({
    error: message,
    ...(config.nodeEnv === 'development' ? { stack: err.stack } : {}),
  });
}
