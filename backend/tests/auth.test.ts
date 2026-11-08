import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SignJWT, exportJWK, generateKeyPair, type CryptoKey } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { ConfigError, loadConfig } from '../src/config/env.js';
import { createServices } from '../src/container.js';
import { openDatabase, type Db } from '../src/database/db.js';
import { createAuth0Middleware, createDevAuthMiddleware } from '../src/middleware/auth.middleware.js';
import { createTempDir, defaultProfile } from './helpers/harness.js';

/**
 * These tests run the production Auth0 middleware (express-oauth2-jwt-bearer) against a
 * locally generated RSA key pair served from a local JWKS endpoint. No Auth0 tenant is used.
 */
const ISSUER = 'https://sidequest-test.auth0.local/';
const AUDIENCE = 'https://api.sidequest.test';

let jwksServer: Server;
let privateKey: CryptoKey;
let otherPrivateKey: CryptoKey;
let app: ReturnType<typeof createApp>;
let db: Db;
let services: ReturnType<typeof createServices>;
let cleanup: () => void;

async function sign(sub: string | undefined, opts: { key?: CryptoKey; iss?: string; aud?: string; exp?: string | number } = {}) {
  const jwt = new SignJWT({ scope: 'openid' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(opts.iss ?? ISSUER)
    .setAudience(opts.aud ?? AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '5m');
  if (sub !== undefined) jwt.setSubject(sub);
  return jwt.sign(opts.key ?? privateKey);
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  otherPrivateKey = (await generateKeyPair('RS256')).privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };

  jwksServer = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>((resolve) => jwksServer.listen(0, '127.0.0.1', resolve));
  const { port } = jwksServer.address() as AddressInfo;

  const tmp = createTempDir();
  cleanup = tmp.cleanup;
  db = openDatabase(`${tmp.dir}/auth.db`);
  services = createServices({ db, questGenerator: null });
  app = createApp({
    services,
    auth: createAuth0Middleware({ issuer: ISSUER, jwksUri: `http://127.0.0.1:${port}/.well-known/jwks.json`, audience: AUDIENCE }),
  });
});

afterAll(async () => {
  await services.whenIdle();
  db.close();
  cleanup();
  await new Promise((r) => jwksServer.close(r));
});

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('Auth0 JWT authentication', () => {
  it('1. missing token returns 401 with a JSON error', async () => {
    for (const [method, path] of [
      ['get', '/api/profile'],
      ['put', '/api/profile'],
      ['post', '/api/queue/join'],
      ['post', '/api/queue/leave'],
      ['get', '/api/queue/status'],
      ['get', '/api/quests/match_x'],
      ['post', '/api/quests/match_x/complete'],
      ['post', '/api/matches/match_x/cancel'],
    ] as const) {
      const res = await request(app)[method](path);
      expect(res.status, `${method} ${path}`).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    }
  });

  it('2. invalid JWTs return 401: garbage, bad signature, wrong issuer, wrong audience, expired, no sub', async () => {
    const tokens = [
      'not-a-jwt',
      await sign('auth0|eve', { key: otherPrivateKey }),
      await sign('auth0|eve', { iss: 'https://evil.auth0.com/' }),
      await sign('auth0|eve', { aud: 'https://some-other-api' }),
      await sign('auth0|eve', { exp: Math.floor(Date.now() / 1000) - 60 }),
      await sign(undefined),
    ];
    for (const t of tokens) {
      const res = await request(app).get('/api/profile').set(bearer(t));
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    }
    // Tampered payload with the original signature.
    const valid = await sign('auth0|alice');
    const [h, , s] = valid.split('.');
    const forged = `${h}.${Buffer.from(JSON.stringify({ sub: 'auth0|admin', iss: ISSUER, aud: AUDIENCE, exp: 9999999999 })).toString('base64url')}.${s}`;
    expect((await request(app).get('/api/profile').set(bearer(forged))).status).toBe(401);
  });

  it('3. a valid token succeeds and the profile id is the token subject (body ids ignored)', async () => {
    const token = await sign('auth0|alice');
    const res = await request(app)
      .put('/api/profile')
      .set(bearer(token))
      .send({ ...defaultProfile('Alice'), id: 'auth0|someone-else' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('auth0|alice');
    expect((await request(app).get('/api/profile').set(bearer(token))).body.displayName).toBe('Alice');
  });

  it("4. users cannot access another user's match (403)", async () => {
    const [alice, bob, eve] = await Promise.all([sign('auth0|alice'), sign('auth0|bob'), sign('auth0|eve')]);
    await request(app).put('/api/profile').set(bearer(bob)).send(defaultProfile('Bob'));
    await request(app).put('/api/profile').set(bearer(eve)).send(defaultProfile('Eve'));
    await request(app).post('/api/queue/join').set(bearer(alice));
    const { matchId } = (await request(app).post('/api/queue/join').set(bearer(bob))).body;
    expect(matchId).toBeTruthy();
    await services.whenIdle();

    expect((await request(app).get(`/api/quests/${matchId}`).set(bearer(alice))).status).toBe(200);
    for (const res of [
      await request(app).get(`/api/quests/${matchId}`).set(bearer(eve)),
      await request(app).post(`/api/quests/${matchId}/complete`).set(bearer(eve)),
      await request(app).post(`/api/matches/${matchId}/cancel`).set(bearer(eve)),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    expect(services.repos.matches.findById(matchId)?.status).toBe('active');
  });

  it('the health endpoint stays public', async () => {
    expect((await request(app).get('/health')).status).toBe(200);
  });
});

describe('5. configuration: test/dev authentication can never be enabled in production', () => {
  const auth0Env = { AUTH0_ISSUER_BASE_URL: 'https://tenant.auth0.com/', AUTH0_AUDIENCE: 'https://api.sidequest' };

  it('rejects AUTH_MODE=dev with NODE_ENV=production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', AUTH_MODE: 'dev' })).toThrow(ConfigError);
    expect(() => loadConfig({ NODE_ENV: 'production', AUTH_MODE: 'dev', ...auth0Env })).toThrow(/AUTH_MODE=dev is only allowed/);
  });

  it('rejects AUTH_MODE=dev unless NODE_ENV is explicitly development', () => {
    expect(() => loadConfig({ NODE_ENV: 'test', AUTH_MODE: 'dev' })).toThrow(ConfigError);
    expect(() => loadConfig({ AUTH_MODE: 'dev' })).not.toThrow(); // NODE_ENV defaults to development
    expect(loadConfig({ NODE_ENV: 'development', AUTH_MODE: 'dev' }).auth).toEqual({ mode: 'dev' });
  });

  it('production requires Auth0 issuer and audience', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/AUTH0_ISSUER_BASE_URL[\s\S]*AUTH0_AUDIENCE/);
    const cfg = loadConfig({ NODE_ENV: 'production', ...auth0Env });
    expect(cfg.auth).toEqual({ mode: 'auth0', issuerBaseURL: auth0Env.AUTH0_ISSUER_BASE_URL, audience: auth0Env.AUTH0_AUDIENCE });
  });

  it('config errors name the variable but never echo secret values', () => {
    try {
      loadConfig({ NODE_ENV: 'production', ...auth0Env, N8N_WEBHOOK_URL: 'not a url with secret-abc123' });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toContain('N8N_WEBHOOK_URL');
      expect((e as Error).message).not.toContain('secret-abc123');
    }
  });

  it('parses defaults and treats empty values as unset', () => {
    const cfg = loadConfig({ ...auth0Env, MARITIME_AGENT_URL: '', CORS_ORIGINS: 'https://a.com, https://*.lovable.app', PORT: '8080' });
    expect(cfg.maritime.url).toBeUndefined();
    expect(cfg.corsOrigins).toEqual(['https://a.com', 'https://*.lovable.app']);
    expect(cfg.port).toBe(8080);
    expect(cfg.n8n.timeoutMs).toBe(5000);
  });

  it('the dev middleware only accepts "dev:<name>" and namespaces the identity', async () => {
    const tmp = createTempDir();
    const devDb = openDatabase(`${tmp.dir}/dev.db`);
    try {
      const devApp = createApp({ services: createServices({ db: devDb, questGenerator: null }), auth: createDevAuthMiddleware() });
      expect((await request(devApp).get('/api/profile')).status).toBe(401);
      expect((await request(devApp).get('/api/profile').set(bearer('auth0|alice'))).status).toBe(401);
      expect((await request(devApp).get('/api/profile').set({ Authorization: 'Basic dev:alice' })).status).toBe(401);
      const res = await request(devApp).put('/api/profile').set(bearer('dev:alice')).send(defaultProfile('Alice'));
      expect(res.body.id).toBe('dev|alice');
    } finally {
      devDb.close();
      tmp.cleanup();
    }
  });
});
