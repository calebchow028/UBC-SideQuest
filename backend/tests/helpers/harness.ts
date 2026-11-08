import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { type Services, createServices } from '../../src/container.js';
import { type Db, openDatabase } from '../../src/database/db.js';
import type { AuthMiddleware } from '../../src/middleware/auth.middleware.js';
import type { FetchLike } from '../../src/services/maritime.service.js';
import type { Clock } from '../../src/utils/clock.js';
import type { Logger } from '../../src/utils/logger.js';
import { unauthorized } from '../../src/utils/errors.js';

// ---------------------------------------------------------------- clock

export interface TestClock extends Clock {
  advance(ms: number): void;
}

export function createTestClock(start = '2026-11-07T12:00:00.000Z'): TestClock {
  let t = Date.parse(start);
  return {
    // Each read moves time forward 1ms so timestamps are strictly increasing, like real life.
    now: () => new Date(t++),
    advance: (ms) => {
      t += ms;
    },
  };
}

// ---------------------------------------------------------------- temp database

export function createTempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'sidequest-test-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// ---------------------------------------------------------------- test auth

/**
 * TEST-ONLY auth, injected through createApp(). It lives under tests/ so it is never part of
 * the build and cannot be enabled by configuration or by a request header in a deployment.
 * `Authorization: Bearer user:<id>` authenticates as `<id>`.
 */
export const testAuth: AuthMiddleware = (req, _res, next) => {
  const m = /^Bearer user:(.+)$/.exec(req.headers.authorization ?? '');
  if (!m?.[1]) return next(unauthorized());
  req.userId = m[1];
  next();
};

// ---------------------------------------------------------------- fake HTTP services

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export interface RecordedCall {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A fake `fetch` that records requests and answers with `responder`. */
export function fakeFetch(responder: (call: RecordedCall, init: RequestInit) => Promise<Response> | Response) {
  const calls: RecordedCall[] = [];
  const fn: FetchLike = async (url, init) => {
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const call = { url, headers, body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined };
    calls.push(call);
    return responder(call, init);
  };
  return Object.assign(fn, { calls });
}

/** A fetch that never answers until the request's AbortSignal fires (simulates a hung service). */
export const hangingFetch: FetchLike = (_url, init) =>
  new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(init.signal?.reason ?? new Error('aborted')));
  });

export const VALID_AI_QUEST = {
  title: 'The Playlist Exchange',
  description: 'Meet in a public seating area, exchange your three favorite songs, and explain why you chose them.',
  location: 'UBC Nest',
  durationMinutes: 20,
  xp: 50,
};

// ---------------------------------------------------------------- harness

export interface HarnessOptions {
  dbPath?: string;
  clock?: TestClock;
  relaxAfterSeconds?: number;
  maritimeFetch?: FetchLike | null; // null = Maritime not configured
  maritimeTimeoutMs?: number;
  n8nFetch?: FetchLike | null; // null = n8n not configured
  n8nMaxAttempts?: number;
  logger?: Logger;
}

export interface Harness {
  app: Express;
  services: Services;
  db: Db;
  clock: TestClock;
  dbPath: string;
  /** supertest helpers authenticated as `userId` */
  as(userId: string): {
    get(path: string): request.Test;
    put(path: string, body?: object): request.Test;
    post(path: string, body?: object): request.Test;
  };
  createProfile(userId: string, overrides?: Partial<ProfileBody>): Promise<void>;
  /** Wait for background quest generation and webhook delivery. */
  settle(): Promise<void>;
  /** Close the DB (and delete the temp dir if the harness created it). */
  close(): Promise<void>;
}

export interface ProfileBody {
  displayName: string;
  interests: string[];
  comfortLevel: 'chill' | 'adventure' | 'chaos';
  availableMinutes: number;
  maxBudget: number;
}

export const defaultProfile = (name: string): ProfileBody => ({
  displayName: name,
  interests: ['music', 'food'],
  comfortLevel: 'chill',
  availableMinutes: 30,
  maxBudget: 0,
});

export function createHarness(opts: HarnessOptions = {}): Harness {
  const temp = opts.dbPath ? null : createTempDir();
  const dbPath = opts.dbPath ?? join(temp!.dir, 'test.db');
  const db = openDatabase(dbPath);
  const clock = opts.clock ?? createTestClock();

  const maritimeFetch =
    opts.maritimeFetch === undefined ? fakeFetch(() => jsonResponse(VALID_AI_QUEST)) : opts.maritimeFetch;
  const n8nFetch = opts.n8nFetch === undefined ? null : opts.n8nFetch;

  const services = createServices({
    db,
    clock,
    ...(opts.logger ? { logger: opts.logger } : {}),
    matchRelaxAfterSeconds: opts.relaxAfterSeconds ?? 45,
    maritime: maritimeFetch
      ? { url: 'https://maritime.test/agents/quest', apiKey: 'maritime-test-key', timeoutMs: opts.maritimeTimeoutMs ?? 200, fetch: maritimeFetch }
      : {},
    n8n: n8nFetch
      ? { webhookUrl: 'https://n8n.test/webhook/sidequest', secret: 'n8n-test-secret', timeoutMs: 200, maxAttempts: opts.n8nMaxAttempts ?? 3, fetch: n8nFetch }
      : {},
  });
  const app = createApp({ services, auth: testAuth, corsOrigins: ['http://localhost:5173', 'https://*.lovable.app'] });

  const auth = (userId: string) => `Bearer user:${userId}`;
  let closed = false;
  const harness: Harness = {
    app,
    services,
    db,
    clock,
    dbPath,
    as: (userId) => ({
      get: (path) => request(app).get(path).set('Authorization', auth(userId)),
      put: (path, body) => request(app).put(path).set('Authorization', auth(userId)).send(body ?? {}),
      post: (path, body) => request(app).post(path).set('Authorization', auth(userId)).send(body ?? {}),
    }),
    async createProfile(userId, overrides = {}) {
      const res = await harness.as(userId).put('/api/profile', { ...defaultProfile(userId), ...overrides });
      if (res.status !== 200) throw new Error(`createProfile failed: ${res.status} ${JSON.stringify(res.body)}`);
    },
    settle: () => services.whenIdle(),
    async close() {
      if (closed) return;
      closed = true;
      await services.whenIdle();
      db.close();
      temp?.cleanup();
    },
  };
  return harness;
}
