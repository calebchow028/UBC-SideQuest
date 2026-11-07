import { afterEach, describe, expect, it } from 'vitest';
import { createServices } from '../src/container.js';
import { openDatabase } from '../src/database/db.js';
import { OutboxRepository } from '../src/repositories/outbox.repository.js';
import type { NotificationPayload } from '../src/services/notification.service.js';
import type { Logger } from '../src/utils/logger.js';
import { createHarness, createTempDir, createTestClock, fakeFetch, hangingFetch, jsonResponse, type Harness } from './helpers/harness.js';

describe('end-to-end flow with n8n webhooks', () => {
  let h: Harness;
  afterEach(async () => {
    await h?.close();
  });

  it('1-4. user A and B: profiles -> queue -> match -> shared quest -> both complete -> webhooks delivered', async () => {
    const n8n = fakeFetch(() => jsonResponse({ ok: true }));
    h = createHarness({ n8nFetch: n8n });
    const A = 'auth0|user-a';
    const B = 'auth0|user-b';

    // Profiles
    expect((await h.as(A).put('/api/profile', { displayName: 'Ana', interests: ['music', 'food'], comfortLevel: 'chill', availableMinutes: 30, maxBudget: 0 })).status).toBe(200);
    expect((await h.as(B).put('/api/profile', { displayName: 'Ben', interests: ['music', 'hiking'], comfortLevel: 'chill', availableMinutes: 25, maxBudget: 0 })).status).toBe(200);

    // Queue + match
    expect((await h.as(A).post('/api/queue/join')).body).toEqual({ status: 'waiting', matchId: null });
    const joined = (await h.as(B).post('/api/queue/join')).body;
    expect(joined.status).toBe('matched');
    const { matchId } = joined;
    await h.settle();

    // Quest: same for both
    const qa = (await h.as(A).get(`/api/quests/${matchId}`)).body;
    const qb = (await h.as(B).get(`/api/quests/${matchId}`)).body;
    expect(qa.questStatus).toBe('ready');
    expect(qa.quest).toEqual(qb.quest);
    expect((await h.as(A).get('/api/queue/status')).body).toEqual({ status: 'active', matchId, joinedAt: null });

    // Completion
    expect((await h.as(A).post(`/api/quests/${matchId}/complete`)).body.waitingForPartner).toBe(true);
    expect((await h.as(B).post(`/api/quests/${matchId}/complete`)).body.matchStatus).toBe('completed');
    expect((await h.as(B).get(`/api/quests/${matchId}`)).body.matchStatus).toBe('completed');
    await h.settle();
    await h.services.notifier.flush();

    // Webhooks
    const bodies = n8n.calls.map((c) => c.body as NotificationPayload);
    expect(bodies.map((b) => b.event)).toEqual(['match.created', 'quest.created', 'quest.completed']);
    for (const [i, call] of n8n.calls.entries()) {
      const body = bodies[i]!;
      expect(call.url).toBe('https://n8n.test/webhook/sidequest');
      expect(call.headers['idempotency-key']).toBe(body.eventId);
      expect(call.headers['x-sidequest-event']).toBe(body.event);
      expect(call.headers['x-sidequest-secret']).toBe('n8n-test-secret');
      expect(body.matchId).toBe(matchId);
      expect([...body.userIds].sort()).toEqual([A, B].sort());
      expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
      // No unnecessary personal information.
      expect(JSON.stringify(body)).not.toMatch(/Ana|Ben|hiking|food/);
    }
    expect(bodies[1]!.data).toMatchObject({ questId: qa.quest.id, title: qa.quest.title, location: qa.quest.location });
    expect(h.services.notifier.enabled).toBe(true);
    expect(new OutboxRepository(h.db).all().every((r) => r.delivered_at !== null)).toBe(true);
  });

  it('emits match.cancelled when a participant cancels', async () => {
    const n8n = fakeFetch(() => jsonResponse({ ok: true }));
    h = createHarness({ n8nFetch: n8n });
    await h.createProfile('a');
    await h.createProfile('b');
    await h.as('a').post('/api/queue/join');
    const { matchId } = (await h.as('b').post('/api/queue/join')).body;
    await h.settle();
    await h.as('a').post(`/api/matches/${matchId}/cancel`);
    await h.as('a').post(`/api/matches/${matchId}/cancel`); // idempotent: no duplicate event
    await h.settle();
    await h.services.notifier.flush();
    expect(n8n.calls.map((c) => (c.body as NotificationPayload).event)).toEqual(['match.created', 'quest.created', 'match.cancelled']);
  });

  it('5. n8n failures do not break matchmaking; events are retried with the same idempotency key', async () => {
    let n8nUp = false;
    const n8n = fakeFetch(() => (n8nUp ? jsonResponse({ ok: true }) : jsonResponse({ message: 'workflow inactive' }, 500)));
    const warnings: Array<{ message: string; meta?: Record<string, unknown> }> = [];
    const capture = (message: string, meta?: Record<string, unknown>) => warnings.push({ message, ...(meta ? { meta } : {}) });
    const logger: Logger = { debug: () => undefined, info: () => undefined, warn: capture, error: capture };
    h = createHarness({ n8nFetch: n8n, n8nMaxAttempts: 5, logger });

    await h.createProfile('a');
    await h.createProfile('b');
    await h.as('a').post('/api/queue/join');
    const res = await h.as('b').post('/api/queue/join');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('matched');
    await h.settle();
    await h.services.notifier.flush();

    // Matchmaking + quest unaffected.
    const { matchId } = res.body;
    expect(h.services.repos.matches.findById(matchId)?.status).toBe('active');
    expect((await h.as('a').get(`/api/quests/${matchId}`)).body.questStatus).toBe('ready');

    // Outbox recorded the failures and scheduled retries.
    const outbox = new OutboxRepository(h.db);
    let rows = outbox.all();
    expect(rows.map((r) => r.event)).toEqual(['match.created', 'quest.created']);
    expect(rows.every((r) => r.delivered_at === null && r.attempts >= 1 && r.last_error === 'HTTP 500')).toBe(true);

    // Retry is not attempted before the backoff expires...
    const callsBefore = n8n.calls.length;
    await h.services.notifier.flush();
    expect(n8n.calls.length).toBe(callsBefore);

    // ...n8n comes back, backoff elapses, events are delivered.
    n8nUp = true;
    h.clock.advance(60_000);
    expect(await h.services.notifier.flush()).toEqual({ delivered: 2, failed: 0 });
    rows = outbox.all();
    expect(rows.every((r) => r.delivered_at !== null && r.last_error === null)).toBe(true);

    // Every attempt for an event carried the same idempotency key.
    for (const row of rows) {
      const keys = n8n.calls.filter((c) => (c.body as NotificationPayload).eventId === row.id).map((c) => c.headers['idempotency-key']);
      expect(keys.length).toBeGreaterThanOrEqual(2);
      expect(new Set(keys)).toEqual(new Set([row.id]));
    }
    // Delivered events are never re-sent.
    h.clock.advance(3_600_000);
    expect(await h.services.notifier.flush()).toEqual({ delivered: 0, failed: 0 });

    // Logs: no secret, no webhook URL.
    expect(warnings.length).toBeGreaterThan(0);
    const logged = JSON.stringify(warnings);
    expect(logged).not.toContain('n8n-test-secret');
    expect(logged).not.toContain('n8n.test');
  });

  it('gives up after max attempts and handles webhook timeouts', async () => {
    h = createHarness({ n8nFetch: hangingFetch, n8nMaxAttempts: 2 });
    await h.createProfile('a');
    await h.createProfile('b');
    await h.as('a').post('/api/queue/join');
    await h.as('b').post('/api/queue/join');
    await h.settle();
    await h.services.notifier.flush();
    h.clock.advance(60_000);
    await h.services.notifier.flush();
    const rows = new OutboxRepository(h.db).all();
    expect(rows.length).toBe(2);
    for (const r of rows) {
      expect(r.attempts).toBe(2);
      expect(r.last_error).toBe('timeout');
      expect(r.failed_at).not.toBeNull();
    }
    h.clock.advance(3_600_000);
    expect(await h.services.notifier.flush()).toEqual({ delivered: 0, failed: 0 });
  });

  it('does not queue events when n8n is not configured', async () => {
    h = createHarness({ n8nFetch: null });
    await h.createProfile('a');
    await h.createProfile('b');
    await h.as('a').post('/api/queue/join');
    await h.as('b').post('/api/queue/join');
    await h.settle();
    expect(h.services.notifier.enabled).toBe(false);
    expect(new OutboxRepository(h.db).all()).toHaveLength(0);
  });

  it('6. database stays consistent when a failure happens mid-transaction', async () => {
    h = createHarness({ n8nFetch: fakeFetch(() => jsonResponse({})) });
    await h.createProfile('a');
    await h.createProfile('b');
    await h.as('a').post('/api/queue/join');

    // Make the outbox write (the last step inside the match transaction) blow up once.
    const notifier = h.services.notifier;
    const original = notifier.enqueue.bind(notifier);
    notifier.enqueue = () => {
      throw new Error('simulated crash');
    };
    const failed = await h.as('b').post('/api/queue/join');
    expect(failed.status).toBe(500);
    expect(failed.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });

    // Everything rolled back: no match, no half-claimed queue entries, no events.
    expect(h.services.repos.matches.listAll()).toHaveLength(0);
    expect(h.services.repos.queue.countForUser('a', 'waiting')).toBe(1);
    expect(h.services.repos.queue.countForUser('a', 'matched')).toBe(0);
    expect(h.services.repos.queue.countForUser('b', 'waiting')).toBe(0);
    expect(new OutboxRepository(h.db).all()).toHaveLength(0);

    // Recovery: the next attempt succeeds cleanly.
    notifier.enqueue = original;
    const ok = await h.as('b').post('/api/queue/join');
    expect(ok.body.status).toBe('matched');
    await h.settle();
    expect(h.services.repos.matches.listAll()).toHaveLength(1);
    expect(h.services.repos.quests.countForMatch(ok.body.matchId)).toBe(1);
    expect(h.db.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(h.db.pragma('foreign_key_check')).toEqual([]);
  });

  it('6b. AI and n8n both failing still yields one consistent active match with one quest', async () => {
    h = createHarness({ maritimeFetch: async () => { throw new TypeError('fetch failed'); }, n8nFetch: async () => { throw new TypeError('ECONNREFUSED'); } });
    await h.createProfile('a');
    await h.createProfile('b');
    await h.as('a').post('/api/queue/join');
    const { matchId } = (await h.as('b').post('/api/queue/join')).body;
    await h.settle();
    await h.services.notifier.flush();
    expect(h.services.repos.matches.findById(matchId)).toMatchObject({ status: 'active' });
    expect(h.services.repos.quests.findByMatchId(matchId)?.source).toBe('fallback');
    expect(h.services.repos.matches.findById(matchId)?.questId).toBe(h.services.repos.quests.findByMatchId(matchId)?.id);
    expect(new OutboxRepository(h.db).all().map((r) => r.last_error)).toEqual(['network error', 'network error']);
  });

  it('undelivered events survive a restart and are delivered by the new process', async () => {
    const tmp = createTempDir();
    const path = `${tmp.dir}/restart.db`;
    const clock = createTestClock();
    try {
      const db1 = openDatabase(path);
      const s1 = createServices({ db: db1, clock, questGenerator: null, n8n: { webhookUrl: 'https://n8n.test/hook', fetch: async () => jsonResponse({}, 503) } });
      s1.profiles.upsert('a', { displayName: 'a', interests: ['x'], comfortLevel: 'chill', availableMinutes: 30, maxBudget: 0 });
      s1.profiles.upsert('b', { displayName: 'b', interests: ['x'], comfortLevel: 'chill', availableMinutes: 30, maxBudget: 0 });
      s1.matchmaking.join('a');
      s1.matchmaking.join('b');
      await s1.whenIdle();
      await s1.notifier.flush();
      db1.close();

      clock.advance(60_000);
      const db2 = openDatabase(path);
      const delivered = fakeFetch(() => jsonResponse({ ok: true }));
      const s2 = createServices({ db: db2, clock, questGenerator: null, n8n: { webhookUrl: 'https://n8n.test/hook', fetch: delivered } });
      expect(await s2.notifier.flush()).toEqual({ delivered: 2, failed: 0 });
      db2.close();
    } finally {
      tmp.cleanup();
    }
  });
});
