import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const KNOWN_INSECURE_SECRETS = new Set([
  'smart-fishing-morocco-secret-key-12345',
  'supersecretkey_change_in_production',
  'secret',
  'jwt_secret',
  'changeme',
  'password',
  '12345678',
  '1234567890',
]);

const envSchema = z
  .object({
    PORT: z.string().default('3000').transform((val) => {
      const port = parseInt(val, 10);
      if (isNaN(port) || port <= 0 || port > 65535) {
        throw new Error(`Invalid PORT value: ${val}`);
      }
      return port;
    }),
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    JWT_SECRET: z.string().optional(),
    JWT_EXPIRES_IN: z.string().default('7d'),
    DATABASE_PATH: z.string().default('smart_fishing.db'),
    GEMINI_API_KEY: z.string().default(''),
    CORS_ORIGIN: z.string().default('*'),
    TRUST_PROXY: z.string().default('false').transform((val) => {
      if (val === 'true' || val === '1') return true;
      if (val === 'false' || val === '0') return false;
      const num = parseInt(val, 10);
      if (!isNaN(num)) return num;
      return val;
    }),
  })
  .superRefine((data, ctx) => {
    const isProd = data.NODE_ENV === 'production';
    const isTest = data.NODE_ENV === 'test';
    const secret = data.JWT_SECRET;

    if (isProd) {
      if (!secret || secret.trim() === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_SECRET'],
          message: 'JWT_SECRET is mandatory in production environment',
        });
        return;
      }

      if (secret.length < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_SECRET'],
          message: 'JWT_SECRET must be at least 32 characters long in production',
        });
      }

      if (KNOWN_INSECURE_SECRETS.has(secret)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_SECRET'],
          message: 'JWT_SECRET cannot use a known default or insecure development value',
        });
      }
    } else if (isTest) {
      // In test mode, allow whatever is provided or a default test secret
    } else {
      // Development mode
      if (!secret || secret.trim() === '') {
        console.warn(
          '[SECURITY WARNING] JWT_SECRET is not set in development mode. Using a temporary dev secret. DO NOT USE IN PRODUCTION!'
        );
      } else if (KNOWN_INSECURE_SECRETS.has(secret) || secret.length < 32) {
        console.warn(
          '[SECURITY WARNING] Using a weak or well-known JWT_SECRET in development mode. Please set a strong secret.'
        );
      }
    }
  });

export type AppConfig = {
  port: number;
  nodeEnv: 'development' | 'test' | 'production';
  jwtSecret: string;
  jwtExpiresIn: string;
  databasePath: string;
  geminiApiKey: string;
  corsOrigin: string;
  trustProxy: boolean | number | string;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const errorDetails = result.error.errors
      .map((err) => `  - ${err.path.join('.') || 'configuration'}: ${err.message}`)
      .join('\n');
    throw new Error(`Configuration validation failed:\n${errorDetails}`);
  }

  const data = result.data;
  let finalSecret = data.JWT_SECRET;

  if (!finalSecret || finalSecret.trim() === '') {
    if (data.NODE_ENV === 'test') {
      finalSecret = 'test-environment-jwt-secret-key-32chars!!';
    } else {
      finalSecret = 'dev-temporary-jwt-secret-do-not-use-in-prod-32chars!';
    }
  }

  return {
    port: data.PORT,
    nodeEnv: data.NODE_ENV,
    jwtSecret: finalSecret,
    jwtExpiresIn: data.JWT_EXPIRES_IN,
    databasePath: data.DATABASE_PATH,
    geminiApiKey: data.GEMINI_API_KEY,
    corsOrigin: data.CORS_ORIGIN,
    trustProxy: data.TRUST_PROXY,
  };
}

export const config = loadConfig();
