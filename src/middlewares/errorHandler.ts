import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

export function errorHandler(
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // CORS policy error
  if (err && err.message === 'Not allowed by CORS') {
    res.status(403).json({ error: 'CORS policy violation: origin not allowed' });
    return;
  }

  // JSON payload limit error
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    res.status(413).json({ error: 'Payload too large: maximum allowed size is 1mb' });
    return;
  }

  // Malformed JSON error
  if (err instanceof SyntaxError && 'status' in err && (err as any).status === 400 && 'body' in err) {
    res.status(400).json({ error: 'Malformed JSON payload' });
    return;
  }

  const status = typeof err.status === 'number' && err.status >= 400 && err.status <= 599 ? err.status : 500;
  const isServerErr = status >= 500;

  // In production, never expose raw error messages or stack traces for internal 500 errors
  const message = isServerErr && config.nodeEnv === 'production'
    ? 'Internal Server Error'
    : (err.message || 'Internal Server Error');

  if (isServerErr && config.nodeEnv !== 'test') {
    console.error('Unhandled server error:', err);
  }

  res.status(status).json({
    error: message,
    ...(config.nodeEnv === 'development' ? { stack: err.stack } : {}),
  });
}
