import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import express from 'express';
import { createApp } from '../src/app';
import { setDatabaseForTesting, closeDatabase } from '../src/data/database';
import { config } from '../src/config';
import { createAuthRateLimiter } from '../src/middlewares/rateLimiter';

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
        { expiresIn: '-10s' }
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
      // First log in to get a valid token
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

  describe('Rate Limiter Behavior', () => {
    it('returns 429 when rate limit threshold is exceeded', async () => {
      // Create an isolated mini app using createAuthRateLimiter with skipInTests = false
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

      // Send 3 allowed requests
      for (let i = 0; i < 3; i++) {
        const res = await request(rateLimitApp).post('/test-limit').send({});
        expect(res.status).toBe(200);
      }

      // 4th request must be rejected with 429
      const blockedRes = await request(rateLimitApp).post('/test-limit').send({});
      expect(blockedRes.status).toBe(429);
      expect(blockedRes.body.error).toContain('Too many authentication attempts');
    });
  });

  describe('CORS and Payload Security', () => {
    it('allows requests without origin header (like Android mobile client)', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
    });

    it('rejects payloads exceeding 1mb limit', async () => {
      // Generate a payload > 1mb
      const hugeString = 'a'.repeat(1024 * 1024 + 100);
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'test@example.com', password: hugeString });

      expect(res.status).toBe(413);
      expect(res.body.error).toContain('Payload too large');
    });
  });
});
