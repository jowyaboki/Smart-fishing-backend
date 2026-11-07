import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createApp } from '../src/app';
import { setDatabaseForTesting, closeDatabase } from '../src/data/database';

describe('Smart Fishing Backend API Endpoints', () => {
  let app: any;

  beforeAll(() => {
    // In-memory isolated database for tests
    const testDb = new Database(':memory:');
    setDatabaseForTesting(testDb);
    app = createApp();
  });

  afterAll(() => {
    closeDatabase();
  });

  it('GET /health returns 200 and ok status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('smart-fishing-backend');
  });

  describe('Auth API (/api/v1/auth)', () => {
    const testUser = {
      email: 'fisherman@morocco.ma',
      password: 'password123',
      name: 'Amine Fisherman',
      preferredRegion: 'Casablanca',
    };

    let authToken: string;

    it('POST /api/v1/auth/register registers a new user', async () => {
      const res = await request(app).post('/api/v1/auth/register').send(testUser);
      expect(res.status).toBe(201);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.email).toBe(testUser.email);
      authToken = res.body.token;
    });

    it('POST /api/v1/auth/register returns 409 for duplicate email', async () => {
      const res = await request(app).post('/api/v1/auth/register').send(testUser);
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('Email already registered');
    });

    it('POST /api/v1/auth/login logs in with valid credentials', async () => {
      const res = await request(app).post('/api/v1/auth/login').send({
        email: testUser.email,
        password: testUser.password,
      });
      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.email).toBe(testUser.email);
    });

    it('POST /api/v1/auth/login rejects invalid credentials', async () => {
      const res = await request(app).post('/api/v1/auth/login').send({
        email: testUser.email,
        password: 'wrongpassword',
      });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid email or password');
    });

    it('GET /api/v1/auth/me returns current user profile with token', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${authToken}`);
      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe(testUser.email);
      expect(res.body.user.name).toBe(testUser.name);
    });

    it('GET /api/v1/auth/me rejects missing or invalid token', async () => {
      const res = await request(app).get('/api/v1/auth/me');
      expect(res.status).toBe(401);
    });
  });

  describe('Marine API (/api/v1/marine)', () => {
    it('GET /api/v1/marine/forecast returns hourly marine conditions', async () => {
      const res = await request(app).get('/api/v1/marine/forecast?latitude=33.58&longitude=-7.61&days=2');
      expect(res.status).toBe(200);
      expect(res.body.location).toBeDefined();
      expect(res.body.hourly.length).toBeGreaterThan(0);
      expect(res.body.dailySummary).toBeDefined();
    });

    it('GET /api/v1/marine/tides returns tide predictions and solunar rating', async () => {
      const res = await request(app).get('/api/v1/marine/tides?latitude=33.58&longitude=-7.61');
      expect(res.status).toBe(200);
      expect(res.body.currentTide).toBeDefined();
      expect(res.body.tideEvents.length).toBeGreaterThanOrEqual(4);
      expect(res.body.solunar).toBeDefined();
      expect(res.body.solunar.rating).toBeGreaterThan(0);
    });

    it('GET /api/v1/marine/forecast returns 400 for invalid coordinates', async () => {
      const res = await request(app).get('/api/v1/marine/forecast?latitude=999&longitude=0');
      expect(res.status).toBe(400);
    });
  });

  describe('Fishing Score API (/api/v1/fishing)', () => {
    it('POST /api/v1/fishing/score returns calculation with 5 weighted factors and safety', async () => {
      const res = await request(app).post('/api/v1/fishing/score').send({
        waveHeightMeters: 1.3,
        windSpeedKmh: 16,
        pressureHpa: 1018,
        tideType: 'Rising',
        solunarRating: 85,
        timeOfDayHours: 7,
      });

      expect(res.status).toBe(200);
      expect(res.body.finalScore).toBeDefined();
      expect(res.body.breakdown).toBeDefined();
      expect(res.body.breakdown.waveScore).toBeDefined();
      expect(res.body.breakdown.windScore).toBeDefined();
      expect(res.body.breakdown.tideScore).toBeDefined();
      expect(res.body.breakdown.solunarScore).toBeDefined();
      expect(res.body.breakdown.speciesScore).toBeDefined();
      expect(res.body.safety).toBeDefined();
    });
  });

  describe('Journal & Catch Log API (/api/v1/journal)', () => {
    let token: string;
    let sessionId: string;

    beforeAll(async () => {
      const authRes = await request(app).post('/api/v1/auth/register').send({
        email: 'journaler@morocco.ma',
        password: 'password123',
        name: 'Journaler User',
      });
      token = authRes.body.token;
    });

    it('POST /api/v1/journal/sessions creates a new session', async () => {
      const res = await request(app)
        .post('/api/v1/journal/sessions')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Morning Surfcasting at Dar Bouazza',
          spotName: 'Dar Bouazza Reef',
          latitude: 33.52,
          longitude: -7.81,
          startTime: new Date().toISOString(),
          waterTemperature: 18.2,
          notes: 'High wave foam, gentle wind.',
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.spotName).toBe('Dar Bouazza Reef');
      sessionId = res.body.id;
    });

    it('POST /api/v1/journal/catches adds a catch to the session', async () => {
      const res = await request(app)
        .post('/api/v1/journal/catches')
        .set('Authorization', `Bearer ${token}`)
        .send({
          sessionId,
          speciesName: 'European Seabass (Loubina)',
          weightKg: 2.4,
          lengthCm: 58,
          baitUsed: 'Live Sardine',
          depthMeters: 3.5,
          notes: 'Caught in the shore break.',
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.speciesName).toBe('European Seabass (Loubina)');
    });

    it('GET /api/v1/journal/sessions/:id returns session with catches', async () => {
      const res = await request(app)
        .get(`/api/v1/journal/sessions/${sessionId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(sessionId);
      expect(res.body.catches.length).toBe(1);
      expect(res.body.catches[0].speciesName).toBe('European Seabass (Loubina)');
    });

    it('GET /api/v1/journal/catches returns all catches for user', async () => {
      const res = await request(app)
        .get('/api/v1/journal/catches')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.catches.length).toBe(1);
    });
  });

  describe('AI Assistant API (/api/v1/ai)', () => {
    it('POST /api/v1/ai/fishing-assistant provides expert advice and gear recommendations', async () => {
      const res = await request(app).post('/api/v1/ai/fishing-assistant').send({
        query: 'What is the best bait for catching Loubina in Casablanca?',
        context: {
          targetSpecies: 'European Seabass',
          tide: 'Rising',
        },
      });

      expect(res.status).toBe(200);
      expect(res.body.answer).toBeDefined();
      expect(res.body.tips.length).toBeGreaterThan(0);
      expect(res.body.recommendedGear).toBeDefined();
    });
  });

  describe('Encyclopedia API (/api/v1/encyclopedia)', () => {
    it('GET /api/v1/encyclopedia/species returns seeded Moroccan species', async () => {
      const res = await request(app).get('/api/v1/encyclopedia/species');
      expect(res.status).toBe(200);
      expect(res.body.count).toBeGreaterThanOrEqual(5);
      expect(res.body.species[0].moroccanName).toBeDefined();
    });

    it('GET /api/v1/encyclopedia/knots returns fishing knots instructions', async () => {
      const res = await request(app).get('/api/v1/encyclopedia/knots');
      expect(res.status).toBe(200);
      expect(res.body.count).toBeGreaterThanOrEqual(3);
      expect(res.body.knots[0].instructions.length).toBeGreaterThan(0);
    });

    it('GET /api/v1/encyclopedia/species/:id returns specific species details', async () => {
      const res = await request(app).get('/api/v1/encyclopedia/species/sea-bass');
      expect(res.status).toBe(200);
      expect(res.body.commonName).toBe('European Seabass');
    });

    it('GET /api/v1/encyclopedia/species/unknown returns 404', async () => {
      const res = await request(app).get('/api/v1/encyclopedia/species/non-existent-fish');
      expect(res.status).toBe(404);
    });
  });
});
