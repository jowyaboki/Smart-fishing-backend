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
  'replace_with_a_secure_random_32_chars_secret_in_production',
]);

const envSchema = z
  .object({
    PORT: z
      .string()
      .default('3000')
      .transform((val, ctx) => {
        const port = parseInt(val, 10);
        if (isNaN(port) || port <= 0 || port > 65535) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Invalid PORT value: ${val}. Must be an integer between 1 and 65535.`,
          });
          return z.NEVER;
        }
        return port;
      }),
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    JWT_SECRET: z.string().optional(),
    JWT_EXPIRES_IN: z
      .string()
      .default('7d')
      .refine((val) => /^(\d+([smhdwy])|\d+)$/.test(val.trim()), {
        message: 'Invalid JWT_EXPIRES_IN format (expected e.g. 7d, 24h, 15m, 3600)',
      }),
    DATABASE_PATH: z.string().min(1).default('smart_fishing.db'),
    GEMINI_API_KEY: z.string().default(''),
    CORS_ORIGIN: z.string().default('*'),
    TRUST_PROXY: z
      .string()
      .default('false')
      .transform((val) => {
        const trimmed = val.trim().toLowerCase();
        if (trimmed === 'true') return true;
        if (trimmed === 'false') return false;
        const num = parseInt(trimmed, 10);
        if (!isNaN(num) && num >= 0) return num;
        return val.trim();
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

      if (KNOWN_INSECURE_SECRETS.has(secret.trim())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_SECRET'],
          message: 'JWT_SECRET cannot use a known default or insecure development value',
        });
      }

      // In production, CORS_ORIGIN cannot be unrestricted wildcard '*'
      if (data.CORS_ORIGIN.trim() === '*') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CORS_ORIGIN'],
          message: 'Unrestricted wildcard CORS_ORIGIN ("*") is prohibited in production. Specify exact trusted origin(s).',
        });
      }
    } else if (isTest) {
      // In test mode, allow whatever is provided or fallback to isolated test key
    } else {
      // Development mode
      if (!secret || secret.trim() === '') {
        console.warn(
          '[SECURITY WARNING] JWT_SECRET is not set in development mode. Using a temporary dev secret. DO NOT USE IN PRODUCTION!'
        );
      } else if (KNOWN_INSECURE_SECRETS.has(secret.trim()) || secret.length < 32) {
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
