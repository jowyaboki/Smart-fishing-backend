import { randomUUID } from 'crypto';
import { getDatabase } from '../data/database';
import { CatchRecord, FishingSession } from '../domain/models';

export interface CreateSessionDTO {
  title: string;
  spotName: string;
  latitude: number;
  longitude: number;
  startTime: string;
  endTime?: string;
  waterTemperature?: number;
  notes?: string;
}

export interface CreateCatchDTO {
  sessionId: string;
  speciesName: string;
  weightKg?: number;
  lengthCm?: number;
  baitUsed?: string;
  depthMeters?: number;
  caughtAt?: string;
  notes?: string;
  photoUrl?: string;
}

export class JournalService {
  public static createSession(userId: string, data: CreateSessionDTO): FishingSession {
    const db = getDatabase();
    const id = randomUUID();
    const createdAt = new Date().toISOString();

    const stmt = db.prepare(`
      INSERT INTO fishing_sessions (
        id, user_id, title, spot_name, latitude, longitude,
        start_time, end_time, water_temperature, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      userId,
      data.title,
      data.spotName,
      data.latitude,
      data.longitude,
      data.startTime,
      data.endTime || null,
      data.waterTemperature || null,
      data.notes || null,
      createdAt
    );

    return {
      id,
      userId,
      title: data.title,
      spotName: data.spotName,
      latitude: data.latitude,
      longitude: data.longitude,
      startTime: data.startTime,
      endTime: data.endTime,
      waterTemperature: data.waterTemperature,
      notes: data.notes,
      createdAt,
    };
  }

  public static getSessions(userId: string): FishingSession[] {
    const db = getDatabase();
    const rows = db
      .prepare('SELECT * FROM fishing_sessions WHERE user_id = ? ORDER BY start_time DESC')
      .all(userId) as any[];

    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      title: r.title,
      spotName: r.spot_name,
      latitude: r.latitude,
      longitude: r.longitude,
      startTime: r.start_time,
      endTime: r.end_time || undefined,
      waterTemperature: r.water_temperature !== null ? r.water_temperature : undefined,
      notes: r.notes || undefined,
      createdAt: r.created_at,
    }));
  }

  public static getSessionById(userId: string, sessionId: string): (FishingSession & { catches: CatchRecord[] }) | null {
    const db = getDatabase();
    const session = db
      .prepare('SELECT * FROM fishing_sessions WHERE id = ? AND user_id = ?')
      .get(sessionId, userId) as any;

    if (!session) return null;

    const catches = db
      .prepare('SELECT * FROM catch_records WHERE session_id = ? ORDER BY caught_at ASC')
      .all(sessionId) as any[];

    return {
      id: session.id,
      userId: session.user_id,
      title: session.title,
      spotName: session.spot_name,
      latitude: session.latitude,
      longitude: session.longitude,
      startTime: session.start_time,
      endTime: session.end_time || undefined,
      waterTemperature: session.water_temperature !== null ? session.water_temperature : undefined,
      notes: session.notes || undefined,
      createdAt: session.created_at,
      catches: catches.map((c) => ({
        id: c.id,
        sessionId: c.session_id,
        userId: c.user_id,
        speciesName: c.species_name,
        weightKg: c.weight_kg !== null ? c.weight_kg : undefined,
        lengthCm: c.length_cm !== null ? c.length_cm : undefined,
        baitUsed: c.bait_used || undefined,
        depthMeters: c.depth_meters !== null ? c.depth_meters : undefined,
        caughtAt: c.caught_at,
        notes: c.notes || undefined,
        photoUrl: c.photo_url || undefined,
        createdAt: c.created_at,
      })),
    };
  }

  public static addCatch(userId: string, data: CreateCatchDTO): CatchRecord {
    const db = getDatabase();
    // Validate session ownership
    const session = db
      .prepare('SELECT id FROM fishing_sessions WHERE id = ? AND user_id = ?')
      .get(data.sessionId, userId);

    if (!session) {
      throw new Error('Session not found or does not belong to user');
    }

    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const caughtAt = data.caughtAt || createdAt;

    const stmt = db.prepare(`
      INSERT INTO catch_records (
        id, session_id, user_id, species_name, weight_kg, length_cm,
        bait_used, depth_meters, caught_at, notes, photo_url, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      data.sessionId,
      userId,
      data.speciesName,
      data.weightKg || null,
      data.lengthCm || null,
      data.baitUsed || null,
      data.depthMeters || null,
      caughtAt,
      data.notes || null,
      data.photoUrl || null,
      createdAt
    );

    return {
      id,
      sessionId: data.sessionId,
      userId,
      speciesName: data.speciesName,
      weightKg: data.weightKg,
      lengthCm: data.lengthCm,
      baitUsed: data.baitUsed,
      depthMeters: data.depthMeters,
      caughtAt,
      notes: data.notes,
      photoUrl: data.photoUrl,
      createdAt,
    };
  }

  public static getCatches(userId: string): CatchRecord[] {
    const db = getDatabase();
    const rows = db
      .prepare('SELECT * FROM catch_records WHERE user_id = ? ORDER BY caught_at DESC')
      .all(userId) as any[];

    return rows.map((c) => ({
      id: c.id,
      sessionId: c.session_id,
      userId: c.user_id,
      speciesName: c.species_name,
      weightKg: c.weight_kg !== null ? c.weight_kg : undefined,
      lengthCm: c.length_cm !== null ? c.length_cm : undefined,
      baitUsed: c.bait_used || undefined,
      depthMeters: c.depth_meters !== null ? c.depth_meters : undefined,
      caughtAt: c.caught_at,
      notes: c.notes || undefined,
      photoUrl: c.photo_url || undefined,
      createdAt: c.created_at,
    }));
  }
}
