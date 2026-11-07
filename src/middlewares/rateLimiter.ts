import rateLimit, { RateLimitRequestHandler } from 'express-rate-limit';
import { Request, Response } from 'express';

export function createAuthRateLimiter(options?: {
  windowMs?: number;
  max?: number;
  skipInTests?: boolean;
}): RateLimitRequestHandler {
  const windowMs = options?.windowMs ?? 15 * 60 * 1000; // 15 minutes
  const max = options?.max ?? 10; // 10 attempts
  const skipInTests = options?.skipInTests ?? true;

  return rateLimit({
    windowMs,
    max,
    standardHeaders: true, // Return standard `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    message: {
      error: 'Too many authentication attempts from this IP, please try again after 15 minutes',
    },
    skip: (_req: Request, _res: Response) => {
      if (skipInTests && process.env.NODE_ENV === 'test') {
        return true;
      }
      return false;
    },
  });
}

export const authRateLimiter = createAuthRateLimiter();
