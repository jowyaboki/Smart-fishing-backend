import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import express from 'express';
import cors from 'cors';
import { createApp, configureCors } from '../src/app';
import { setDatabaseForTesting, closeDatabase } from '../src/data/database';
import { config } from '../src/config';
import { createAuthRateLimiter } from '../src/middlewares/rateLimiter';
import { errorHandler } from '../src/middlewares/errorHandler';

describe('Security Hardening & Authentication API Tests', () => {
  let app: any;

  beforeAll(() => {
    const testDb = new Database(':memory:');
    setDatabaseForTesting(testDb);
    app = createApp();
  });

  afterAll(() => {
    closeDatabase();
  });

  describe('Password Policy & User Registration', () => {
    it('rejects registration with a password of less than 8 characters', async () => {
      const res = await request(app).post('/api/v1/auth/register').send({
        email: 'shortpass@morocco.ma',
        password: 'pass12', // 6 chars
        name: 'Short Password User',
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
      expect(res.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'password',
            message: 'Password must be at least 8 characters',
          }),
        ])
      );
    });

    it('accepts registration with a password of at least 8 characters and normalizes email', async () => {
      const res = await request(app).post('/api/v1/auth/register').send({
        email: '  ValidSecUser@Morocco.MA  ',
        password: 'securePassword123',
        name: '  Security Tester  ',
      });

      expect(res.status).toBe(201);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.email).toBe('validsecuser@morocco.ma');
      expect(res.body.user.name).toBe('Security Tester');
      // Ensure password_hash is NEVER exposed
      expect(res.body.user.password_hash).toBeUndefined();
      expect(res.body.user.passwordHash).toBeUndefined();
    });

    it('allows login with existing accounts without strict length constraint at login endpoint', async () => {
      // Login schema only requires min(1) so old legacy users can still authenticate
      const res = await request(app).post('/api/v1/auth/login').send({
        email: 'validsecuser@morocco.ma',
        password: 'securePassword123',
      });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.password_hash).toBeUndefined();
      expect(res.body.user.passwordHash).toBeUndefined();
    });
  });

  describe('JWT Verification & Protected Routes', () => {
    it('rejects expired JWT tokens with 401 and descriptive message', async () => {
      const expiredToken = jwt.sign(
        { sub: 'user-expired-id', email: 'expired@test.ma' },
        config.jwtSecret,
        { algorithm: 'HS256', expiresIn: '-10s' }
      );

      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${expiredToken}`);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized: token has expired');
    });

    it('rejects malformed / tampered JWT tokens with 401', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer invalid.tampered.token');

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized: invalid or expired token');
    });

    it('rejects JWT signed with an untrusted algorithm (e.g. "none" attack or asymmetric key)', async () => {
      // Create a token with 'none' algorithm
      const noneToken = jwt.sign(
        { sub: 'user-none-attack', email: 'none@attack.ma' },
        '',
        { algorithm: 'none' }
      );

      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${noneToken}`);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized: invalid or expired token');
    });

    it('rejects JWT missing the "sub" claim', async () => {
      const tokenWithoutSub = jwt.sign(
        { email: 'nosub@morocco.ma' },
        config.jwtSecret,
        { algorithm: 'HS256' }
      );

      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tokenWithoutSub}`);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized: invalid token claims');
    });

    it('rejects JWT missing the "email" claim', async () => {
      const tokenWithoutEmail = jwt.sign(
        { sub: 'user-id-only' },
        config.jwtSecret,
        { algorithm: 'HS256' }
      );

      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tokenWithoutEmail}`);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized: invalid token claims');
    });

    it('rejects requests with missing or empty Bearer token', async () => {
      const res1 = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer ');
      expect(res1.status).toBe(401);

      const res2 = await request(app).get('/api/v1/auth/me');
      expect(res2.status).toBe(401);
    });

    it('rejects protected journal routes when unauthenticated', async () => {
      const res = await request(app).post('/api/v1/journal/sessions').send({
        title: 'Unauthorized attempt',
        spotName: 'Beach',
        latitude: 33.5,
        longitude: -7.5,
        startTime: new Date().toISOString(),
      });
      expect(res.status).toBe(401);
    });

    it('does not expose password_hash in GET /api/v1/auth/me', async () => {
      const loginRes = await request(app).post('/api/v1/auth/login').send({
        email: 'validsecuser@morocco.ma',
        password: 'securePassword123',
      });
      const token = loginRes.body.token;

      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.email).toBe('validsecuser@morocco.ma');
      expect(res.body.user.password_hash).toBeUndefined();
      expect(res.body.user.passwordHash).toBeUndefined();
    });
  });

  describe('Rate Limiter Behavior & IP Forwarding', () => {
    it('returns 429 when rate limit threshold is exceeded', async () => {
      const testLimiter = createAuthRateLimiter({
        windowMs: 60 * 1000,
        max: 3,
        skipInTests: false,
      });

      const rateLimitApp = express();
      rateLimitApp.use(express.json());
      rateLimitApp.post('/test-limit', testLimiter, (_req, res) => {
        res.status(200).json({ ok: true });
      });

      for (let i = 0; i < 3; i++) {
        const res = await request(rateLimitApp).post('/test-limit').send({});
        expect(res.status).toBe(200);
      }

      const blockedRes = await request(rateLimitApp).post('/test-limit').send({});
      expect(blockedRes.status).toBe(429);
      expect(blockedRes.body.error).toContain('Too many authentication attempts');
    });

    it('ignores spoofed X-Forwarded-For headers when trust proxy is disabled', async () => {
      const testLimiter = createAuthRateLimiter({
        windowMs: 60 * 1000,
        max: 2,
        skipInTests: false,
      });

      const rateLimitApp = express();
      // trust proxy is false by default
      rateLimitApp.set('trust proxy', false);
      rateLimitApp.use(express.json());
      rateLimitApp.post('/test-spoof', testLimiter, (_req, res) => {
        res.status(200).json({ ok: true });
      });

      // Attacker attempts to spoof X-Forwarded-For with varying fake IPs
      const res1 = await request(rateLimitApp)
        .post('/test-spoof')
        .set('X-Forwarded-For', '198.51.100.1');
      expect(res1.status).toBe(200);

      const res2 = await request(rateLimitApp)
        .post('/test-spoof')
        .set('X-Forwarded-For', '198.51.100.2');
      expect(res2.status).toBe(200);

      // Third request from the same socket IP should be blocked regardless of fake header
      const res3 = await request(rateLimitApp)
        .post('/test-spoof')
        .set('X-Forwarded-For', '198.51.100.3');
      expect(res3.status).toBe(429);
    });
  });

  describe('CORS, Payload and Error Handling Security', () => {
    it('allows requests without origin header (like Android mobile client)', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
    });

    it('rejects payloads exceeding 1mb limit with HTTP 413', async () => {
      const hugeString = 'a'.repeat(1024 * 1024 + 100);
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'test@example.com', password: hugeString });

      expect(res.status).toBe(413);
      expect(res.body.error).toContain('Payload too large');
    });

    it('handles malformed JSON payloads with HTTP 400', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"email": "broken-json", ');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Malformed JSON payload');
    });

    it('enforces authorized CORS origins and rejects unauthorized origins', async () => {
      const restrictedCors = configureCors('https://allowed.smartfishing.ma,https://admin.smartfishing.ma');
      const corsApp = express();
      corsApp.use(cors(restrictedCors));
      corsApp.get('/cors-test', (_req, res) => res.json({ ok: true }));
      corsApp.use(errorHandler);

      // 1. Authorized origin
      const allowedRes = await request(corsApp)
        .get('/cors-test')
        .set('Origin', 'https://allowed.smartfishing.ma');
      expect(allowedRes.status).toBe(200);

      // 2. Request without Origin (Android app)
      const noOriginRes = await request(corsApp).get('/cors-test');
      expect(noOriginRes.status).toBe(200);

      // 3. Unauthorized origin
      const blockedRes = await request(corsApp)
        .get('/cors-test')
        .set('Origin', 'https://malicious-website.com');
      expect(blockedRes.status).toBe(403);
      expect(blockedRes.body.error).toBe('CORS policy violation: origin not allowed');
    });
  });
});
