import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { getDatabase } from '../data/database';
import { config } from '../config';
import { User } from '../domain/models';

export interface RegisterDTO {
  email: string;
  password: string;
  name: string;
  preferredRegion?: string;
}

export interface LoginDTO {
  email: string;
  password: string;
}

export interface AuthTokens {
  token: string;
  user: {
    id: string;
    email: string;
    name: string;
    preferredRegion?: string;
    createdAt: string;
  };
}

export class AuthService {
  public static async register(data: RegisterDTO): Promise<AuthTokens> {
    const db = getDatabase();
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(data.email.toLowerCase().trim());
    if (existing) {
      throw new Error('Email already registered');
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(data.password, salt);
    const id = randomUUID();
    const createdAt = new Date().toISOString();

    const insert = db.prepare(`
      INSERT INTO users (id, email, password_hash, name, preferred_region, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    insert.run(
      id,
      data.email.toLowerCase().trim(),
      passwordHash,
      data.name.trim(),
      data.preferredRegion || null,
      createdAt
    );

    const token = this.generateToken(id, data.email);

    return {
      token,
      user: {
        id,
        email: data.email.toLowerCase().trim(),
        name: data.name.trim(),
        preferredRegion: data.preferredRegion,
        createdAt,
      },
    };
  }

  public static async login(data: LoginDTO): Promise<AuthTokens> {
    const db = getDatabase();
    const row = db
      .prepare('SELECT id, email, password_hash, name, preferred_region, created_at FROM users WHERE email = ?')
      .get(data.email.toLowerCase().trim()) as
      | {
          id: string;
          email: string;
          password_hash: string;
          name: string;
          preferred_region: string | null;
          created_at: string;
        }
      | undefined;

    if (!row) {
      throw new Error('Invalid email or password');
    }

    const isMatch = await bcrypt.compare(data.password, row.password_hash);
    if (!isMatch) {
      throw new Error('Invalid email or password');
    }

    const token = this.generateToken(row.id, row.email);

    return {
      token,
      user: {
        id: row.id,
        email: row.email,
        name: row.name,
        preferredRegion: row.preferred_region || undefined,
        createdAt: row.created_at,
      },
    };
  }

  public static getUserById(userId: string): Omit<User, 'passwordHash'> | null {
    const db = getDatabase();
    const row = db
      .prepare('SELECT id, email, name, preferred_region, created_at FROM users WHERE id = ?')
      .get(userId) as
      | {
          id: string;
          email: string;
          name: string;
          preferred_region: string | null;
          created_at: string;
        }
      | undefined;

    if (!row) return null;

    return {
      id: row.id,
      email: row.email,
      name: row.name,
      preferredRegion: row.preferred_region || undefined,
      createdAt: row.created_at,
    };
  }

  private static generateToken(userId: string, email: string): string {
    return jwt.sign({ sub: userId, email }, config.jwtSecret, {
      expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'],
    });
  }
}
