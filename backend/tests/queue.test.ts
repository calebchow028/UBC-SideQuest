import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { isOriginAllowed } from '../src/app.js';
import { createHarness, jsonResponse, VALID_AI_QUEST, type Harness } from './helpers/harness.js';

describe('queue endpoints', () => {
  let h: Harness;
  afterEach(async () => {
    await h?.close();
  });

  it('GET /health is public and returns the documented body', async () => {
    h = createHarness();
    const res = await request(h.app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', service: 'sidequest-backend' });
  });

  it('unknown routes return a JSON 404', async () => {
    h = createHarness();
    const res = await request(h.app).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
  });

  it('status is idle for a user who never joined', async () => {
    h = createHarness();
    const res = await h.as('alice').get('/api/queue/status');
    expect(res.body).toEqual({ status: 'idle', matchId: null, joinedAt: null });
  });

  it('reports "generating" while the AI is working, then "active"', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    h = createHarness({
      maritimeTimeoutMs: 5_000,
      maritimeFetch: async () => {
        await gate; // the "AI" answers only when the test says so
        return jsonResponse(VALID_AI_QUEST);
      },
    });
    await h.createProfile('alice');
    await h.createProfile('bob');
    await h.as('alice').post('/api/queue/join');
    const { matchId } = (await h.as('bob').post('/api/queue/join')).body;
    expect((await h.as('alice').get('/api/queue/status')).body).toEqual({ status: 'generating', matchId, joinedAt: null });
    expect((await h.as('alice').get(`/api/quests/${matchId}`)).body).toMatchObject({ questStatus: 'pending', quest: null });
    release();
    await h.settle();
    expect((await h.as('alice').get('/api/queue/status')).body).toEqual({ status: 'active', matchId, joinedAt: null });
    expect((await h.as('bob').get(`/api/quests/${matchId}`)).body).toMatchObject({ questStatus: 'ready', matchStatus: 'active' });
  });

  it('a match cancelled while the AI is generating never becomes active', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    h = createHarness({
      maritimeTimeoutMs: 5_000,
      maritimeFetch: async () => {
        await gate;
        return jsonResponse(VALID_AI_QUEST);
      },
    });
    await h.createProfile('alice');
    await h.createProfile('bob');
    await h.as('alice').post('/api/queue/join');
    const { matchId } = (await h.as('bob').post('/api/queue/join')).body;
    await h.as('alice').post(`/api/matches/${matchId}/cancel`);
    release();
    await h.settle();
    expect(h.services.repos.matches.findById(matchId)?.status).toBe('cancelled');
    expect(h.services.repos.quests.countForMatch(matchId)).toBe(0);
    expect((await h.as('bob').get(`/api/quests/${matchId}`)).body).toMatchObject({ questStatus: 'unavailable', matchStatus: 'cancelled' });
  });

  it('leaving while matched is refused and does not cancel the match', async () => {
    h = createHarness();
    await h.createProfile('alice');
    await h.createProfile('bob');
    await h.as('alice').post('/api/queue/join');
    const { matchId } = (await h.as('bob').post('/api/queue/join')).body;
    await h.settle();
    const res = await h.as('alice').post('/api/queue/leave');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'ALREADY_MATCHED', details: { matchId, matchStatus: 'active' } });
    expect(h.services.repos.matches.findById(matchId)?.status).toBe('active');
  });

  describe('POST /api/matches/:matchId/cancel', () => {
    it('either participant can cancel; repeat cancels are idempotent; both return to idle', async () => {
      h = createHarness();
      await h.createProfile('alice');
      await h.createProfile('bob');
      await h.as('alice').post('/api/queue/join');
      const { matchId } = (await h.as('bob').post('/api/queue/join')).body;
      await h.settle();
      const res = await h.as('bob').post(`/api/matches/${matchId}/cancel`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ matchId, matchStatus: 'cancelled' });
      expect((await h.as('alice').post(`/api/matches/${matchId}/cancel`)).status).toBe(200);
      const stored = h.services.repos.matches.findById(matchId)!;
      expect(stored).toMatchObject({ status: 'cancelled', cancelledBy: 'bob' });
      expect((await h.as('alice').get('/api/queue/status')).body.status).toBe('idle');
      expect((await h.as('bob').get('/api/queue/status')).body.status).toBe('idle');
    });

    it('non-participants get 403 and unknown matches 404', async () => {
      h = createHarness();
      await h.createProfile('alice');
      await h.createProfile('bob');
      await h.as('alice').post('/api/queue/join');
      const { matchId } = (await h.as('bob').post('/api/queue/join')).body;
      const res = await h.as('mallory').post(`/api/matches/${matchId}/cancel`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(h.services.repos.matches.findById(matchId)?.status).not.toBe('cancelled');
      expect((await h.as('alice').post('/api/matches/match_does_not_exist/cancel')).status).toBe(404);
    });

    it('completed matches cannot be cancelled', async () => {
      h = createHarness();
      await h.createProfile('alice');
      await h.createProfile('bob');
      await h.as('alice').post('/api/queue/join');
      const { matchId } = (await h.as('bob').post('/api/queue/join')).body;
      await h.settle();
      await h.as('alice').post(`/api/quests/${matchId}/complete`);
      await h.as('bob').post(`/api/quests/${matchId}/complete`);
      const res = await h.as('alice').post(`/api/matches/${matchId}/cancel`);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('MATCH_ALREADY_COMPLETED');
      expect(h.services.repos.matches.findById(matchId)?.status).toBe('completed');
    });
  });

  describe('CORS', () => {
    it('allows configured origins (exact and wildcard subdomain) and blocks others', async () => {
      h = createHarness();
      const ok = await request(h.app).options('/api/profile').set('Origin', 'https://my-app.lovable.app').set('Access-Control-Request-Method', 'PUT');
      expect(ok.headers['access-control-allow-origin']).toBe('https://my-app.lovable.app');
      const bad = await request(h.app).get('/health').set('Origin', 'https://evil.example.com');
      expect(bad.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('origin matching rules', () => {
      const allowed = ['http://localhost:5173', 'https://*.lovable.app'];
      expect(isOriginAllowed('http://localhost:5173', allowed)).toBe(true);
      expect(isOriginAllowed('https://x.lovable.app', allowed)).toBe(true);
      expect(isOriginAllowed('http://x.lovable.app', allowed)).toBe(false);
      expect(isOriginAllowed('https://lovable.app.evil.com', allowed)).toBe(false);
      expect(isOriginAllowed('https://evil-lovable.app', allowed)).toBe(false);
      expect(isOriginAllowed('not a url', ['https://*.lovable.app'])).toBe(false);
      expect(isOriginAllowed('https://anything.com', ['*'])).toBe(true);
    });
  });
});
