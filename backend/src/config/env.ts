import { z } from 'zod';
import type { LogLevel } from '../utils/logger.js';

/** Treat `KEY=` (empty string, common in .env files) as "not set". */
const optionalString = z.preprocess((v) => (v === '' ? undefined : v), z.string().optional());
const optionalUrl = z.preprocess((v) => (v === '' ? undefined : v), z.url().optional());
const intWithDefault = (def: number, min: number, max: number) =>
  z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number().int().min(min).max(max).default(def));

const envSchema = z
  .object({
    NODE_ENV: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z.enum(['development', 'test', 'production']).default('development'),
    ),
    PORT: intWithDefault(3000, 1, 65_535),
    HOST: z.preprocess((v) => (v === '' ? undefined : v), z.string().default('127.0.0.1')),
    DATABASE_PATH: z.preprocess((v) => (v === '' ? undefined : v), z.string().default('./data/sidequest.db')),
    CORS_ORIGINS: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z.string().default('http://localhost:5173,http://localhost:8080'),
    ),
    TRUST_PROXY: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['true', 'false']).default('false')),
    LOG_LEVEL: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
    ),

    AUTH_MODE: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['auth0', 'dev']).default('auth0')),
    AUTH0_ISSUER_BASE_URL: optionalUrl,
    AUTH0_AUDIENCE: optionalString,

    MARITIME_AGENT_URL: optionalUrl,
    MARITIME_API_KEY: optionalString,
    MARITIME_TIMEOUT_MS: intWithDefault(10_000, 100, 120_000),

    N8N_WEBHOOK_URL: optionalUrl,
    N8N_WEBHOOK_SECRET: optionalString,
    N8N_TIMEOUT_MS: intWithDefault(5_000, 100, 60_000),
    OUTBOX_POLL_INTERVAL_MS: intWithDefault(15_000, 1_000, 3_600_000),
    OUTBOX_MAX_ATTEMPTS: intWithDefault(8, 1, 100),

    MATCH_RELAX_AFTER_SECONDS: intWithDefault(45, 0, 3_600),
  })
  .superRefine((env, ctx) => {
    if (env.AUTH_MODE === 'auth0') {
      if (!env.AUTH0_ISSUER_BASE_URL) {
        ctx.addIssue({ code: 'custom', path: ['AUTH0_ISSUER_BASE_URL'], message: 'required when AUTH_MODE=auth0' });
      }
      if (!env.AUTH0_AUDIENCE) {
        ctx.addIssue({ code: 'custom', path: ['AUTH0_AUDIENCE'], message: 'required when AUTH_MODE=auth0' });
      }
    }
    // The dev identity mode trusts the token text as the user id. It is only allowed when
    // NODE_ENV is *explicitly* "development", so production/test (or a missing NODE_ENV
    // combined with a mistake) can never run without real JWT verification.
    if (env.AUTH_MODE === 'dev' && env.NODE_ENV !== 'development') {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_MODE'],
        message: `AUTH_MODE=dev is only allowed when NODE_ENV=development (got NODE_ENV=${env.NODE_ENV})`,
      });
    }
  });

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  host: string;
  databasePath: string;
  corsOrigins: string[];
  trustProxy: boolean;
  logLevel: LogLevel;
  auth: { mode: 'auth0'; issuerBaseURL: string; audience: string } | { mode: 'dev' };
  maritime: { url: string | undefined; apiKey: string | undefined; timeoutMs: number };
  n8n: {
    webhookUrl: string | undefined;
    secret: string | undefined;
    timeoutMs: number;
    pollIntervalMs: number;
    maxAttempts: number;
  };
  matchRelaxAfterSeconds: number;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Parse and validate configuration. Throws `ConfigError` listing every problem so a
 * misconfigured deployment fails fast at startup. Error messages contain variable
 * names only, never values (which may be secrets).
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(env)'}: ${i.message}`);
    throw new ConfigError(`Invalid environment configuration:\n${problems.join('\n')}`);
  }
  const env = parsed.data;
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    host: env.HOST,
    databasePath: env.DATABASE_PATH,
    corsOrigins: env.CORS_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    trustProxy: env.TRUST_PROXY === 'true',
    logLevel: env.LOG_LEVEL,
    auth:
      env.AUTH_MODE === 'dev'
        ? { mode: 'dev' }
        : {
            mode: 'auth0',
            // Non-null: guaranteed by superRefine above.
            issuerBaseURL: env.AUTH0_ISSUER_BASE_URL as string,
            audience: env.AUTH0_AUDIENCE as string,
          },
    maritime: { url: env.MARITIME_AGENT_URL, apiKey: env.MARITIME_API_KEY, timeoutMs: env.MARITIME_TIMEOUT_MS },
    n8n: {
      webhookUrl: env.N8N_WEBHOOK_URL,
      secret: env.N8N_WEBHOOK_SECRET,
      timeoutMs: env.N8N_TIMEOUT_MS,
      pollIntervalMs: env.OUTBOX_POLL_INTERVAL_MS,
      maxAttempts: env.OUTBOX_MAX_ATTEMPTS,
    },
    matchRelaxAfterSeconds: env.MATCH_RELAX_AFTER_SECONDS,
  };
}
