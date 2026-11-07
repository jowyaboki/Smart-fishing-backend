import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
  };
}

export function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized: missing or invalid authorization header' });
    return;
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    res.status(401).json({ error: 'Unauthorized: missing or invalid authorization header' });
    return;
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret) as { sub?: string; email?: string };
    if (!payload.sub || typeof payload.sub !== 'string') {
      res.status(401).json({ error: 'Unauthorized: invalid token payload' });
      return;
    }

    req.user = {
      id: payload.sub,
      email: payload.email || '',
    };
    next();
  } catch (err: any) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: 'Unauthorized: token has expired' });
      return;
    }
    res.status(401).json({ error: 'Unauthorized: invalid or expired token' });
  }
}
