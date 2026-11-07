import { afterEach, describe, expect, it } from 'vitest';
import { join as pathJoin } from 'node:path';
import {
  buildQuestConstraints,
  compatibilityScore,
  pickBestCandidate,
  sharedInterests,
  type Candidate,
  type MatchableProfile,
} from '../src/domain/compatibility.js';
import { createServices } from '../src/container.js';
import { openDatabase } from '../src/database/db.js';
import { createHarness, createTempDir, createTestClock, type Harness } from './helpers/harness.js';

const profile = (interests: string[], availableMinutes = 30, comfortLevel: MatchableProfile['comfortLevel'] = 'chill'): MatchableProfile => ({
  interests,
  availableMinutes,
  comfortLevel,
});

describe('compatibility scoring (unit)', () => {
  it('counts shared interests, ignoring duplicates', () => {
    expect(sharedInterests(profile(['music', 'food', 'music']), profile(['food', 'music', 'art']))).toEqual(['food', 'music']);
  });

  it('scores 10/shared interest + 0..5 for time similarity + comfort bonus', () => {
    // 2 shared (20) + equal time (5) + same comfort (3)
    expect(compatibilityScore(profile(['music', 'food']), profile(['music', 'food']))).toBe(28);
    // 1 shared (10) + 15/30 time -> round(2.5)=3 + adjacent comfort (1)
    expect(compatibilityScore(profile(['music'], 15, 'chill'), profile(['music'], 30, 'adventure'))).toBe(14);
    // 0 shared + 30/60 -> 3 (round 2.5) + chill vs chaos (0)
    expect(compatibilityScore(profile(['art'], 30, 'chill'), profile(['music'], 60, 'chaos'))).toBe(3);
  });

  it('is symmetric', () => {
    const a = profile(['music', 'hiking'], 20, 'adventure');
    const b = profile(['hiking'], 90, 'chaos');
    expect(compatibilityScore(a, b)).toBe(compatibilityScore(b, a));
  });

  const now = new Date('2026-11-07T12:10:00.000Z');
  const seeker = { userId: 'me', joinedAt: '2026-11-07T12:10:00.000Z', profile: profile(['music', 'food']) };
  const cand = (userId: string, joinedAt: string, seq: number, p: MatchableProfile): Candidate => ({ userId, joinedAt, seq, profile: p });

  it('prefers the highest score over FIFO order', () => {
    const early = cand('early', '2026-11-07T12:00:00.000Z', 1, profile(['music']));
    const better = cand('better', '2026-11-07T12:09:59.000Z', 2, profile(['music', 'food']));
    expect(pickBestCandidate(seeker, [early, better], { now, relaxAfterSeconds: 45 })?.userId).toBe('better');
  });

  it('breaks score ties FIFO by joinedAt, then insertion order', () => {
    const t = '2026-11-07T12:09:59.000Z';
    const a = cand('a', t, 7, profile(['music']));
    const b = cand('b', '2026-11-07T12:09:58.000Z', 9, profile(['music']));
    const c = cand('c', t, 3, profile(['music']));
    expect(pickBestCandidate(seeker, [a, b, c], { now, relaxAfterSeconds: 45 })?.userId).toBe('b');
    expect(pickBestCandidate(seeker, [a, c], { now, relaxAfterSeconds: 45 })?.userId).toBe('c');
  });

  it('never picks the seeker themselves', () => {
    const self = cand('me', '2026-11-07T12:00:00.000Z', 1, profile(['music', 'food']));
    expect(pickBestCandidate(seeker, [self], { now, relaxAfterSeconds: 0 })).toBeNull();
  });

  it('requires a shared interest until someone has waited relaxAfterSeconds', () => {
    const recent = cand('recent', '2026-11-07T12:09:30.000Z', 1, profile(['chess']));
    expect(pickBestCandidate(seeker, [recent], { now, relaxAfterSeconds: 45 })).toBeNull();
    const longWait = cand('long', '2026-11-07T12:09:00.000Z', 2, profile(['chess']));
    expect(pickBestCandidate(seeker, [recent, longWait], { now, relaxAfterSeconds: 45 })?.userId).toBe('long');
  });

  it('derives quest constraints from the stricter user', () => {
    const c = buildQuestConstraints(
      { interests: ['music', 'food'], availableMinutes: 20, comfortLevel: 'adventure', maxBudget: 10 },
      { interests: ['music', 'hiking'], availableMinutes: 60, comfortLevel: 'chill', maxBudget: 0 },
    );
    expect(c).toEqual({
      durationMinutes: 20,
      maxBudget: 0,
      comfortLevel: 'chill',
      sharedInterests: ['music'],
      allInterests: ['food', 'hiking', 'music'],
    });
  });
});

describe('matchmaking queue', () => {
  let h: Harness;
  afterEach(async () => {
    await h?.close();
  });

  const join = (user: string) => h.as(user).post('/api/queue/join');
  const status = (user: string) => h.as(user).get('/api/queue/status');

  it('1. first user joins and waits', async () => {
    h = createHarness();
    await h.createProfile('alice');
    const res = await join('alice');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'waiting', matchId: null });
    expect((await status('alice')).body).toMatchObject({ status: 'waiting', matchId: null });
  });

  it('2. second compatible user joins and both are matched into one shared session', async () => {
    h = createHarness();
    await h.createProfile('alice');
    await h.createProfile('bob');
    await join('alice');
    const res = await join('bob');
    expect(res.body.status).toBe('matched');
    expect(res.body.matchId).toMatch(/^match_/);

    const a = (await status('alice')).body;
    const b = (await status('bob')).body;
    expect(a.matchId).toBe(res.body.matchId);
    expect(b.matchId).toBe(res.body.matchId);
    expect(['generating', 'active']).toContain(a.status);

    const match = h.services.repos.matches.findById(res.body.matchId)!;
    expect([match.user1Id, match.user2Id].sort()).toEqual(['alice', 'bob']);
    expect(match.user1Id).toBe('alice'); // longest waiter is user1
    expect(h.services.repos.queue.countForUser('alice', 'waiting')).toBe(0);
    expect(h.services.repos.queue.countForUser('bob', 'matched')).toBe(1);
  });

  it('3. a user can never be matched with themselves', async () => {
    h = createHarness({ relaxAfterSeconds: 0 });
    await h.createProfile('alice');
    await join('alice');
    h.clock.advance(60_000);
    expect((await join('alice')).body).toEqual({ status: 'waiting', matchId: null });
    expect((await status('alice')).body.status).toBe('waiting');
    expect(h.services.repos.matches.listAll()).toHaveLength(0);
    // ...and the schema rejects it even if application code were wrong.
    expect(() =>
      h.db.prepare(`INSERT INTO match_sessions (id, user1_id, user2_id, status, created_at) VALUES ('m', 'alice', 'alice', 'generating', 'x')`).run(),
    ).toThrow(/CHECK constraint/);
  });

  it('4. repeated joins do not create duplicate queue entries or lose queue position', async () => {
    h = createHarness();
    await h.createProfile('alice');
    const first = await join('alice');
    const joinedAt = (await status('alice')).body.joinedAt;
    h.clock.advance(5_000);
    await join('alice');
    await join('alice');
    expect(first.body.status).toBe('waiting');
    expect(h.services.repos.queue.countForUser('alice', 'waiting')).toBe(1);
    expect((await status('alice')).body.joinedAt).toBe(joinedAt);
    // DB-level guarantee too.
    expect(() =>
      h.db.prepare(`INSERT INTO queue_entries (id, user_id, joined_at, status) VALUES ('dup', 'alice', 'x', 'waiting')`).run(),
    ).toThrow(/UNIQUE constraint/);
  });

  it('5. leaving the queue removes the user from matchmaking', async () => {
    h = createHarness();
    await h.createProfile('alice');
    await h.createProfile('bob');
    await join('alice');
    const res = await h.as('alice').post('/api/queue/leave');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'idle', left: true });
    expect((await status('alice')).body).toMatchObject({ status: 'idle', matchId: null });
    // Bob must not be matched with someone who left.
    expect((await join('bob')).body).toEqual({ status: 'waiting', matchId: null });
  });

  it('6. repeated leaving is safe (idempotent), including when never queued', async () => {
    h = createHarness();
    await h.createProfile('alice');
    await join('alice');
    expect((await h.as('alice').post('/api/queue/leave')).body).toEqual({ status: 'idle', left: true });
    expect((await h.as('alice').post('/api/queue/leave')).body).toEqual({ status: 'idle', left: false });
    expect((await h.as('carol').post('/api/queue/leave')).body).toEqual({ status: 'idle', left: false });
  });

  it('7. FIFO breaks ties between equally compatible waiting users', async () => {
    h = createHarness();
    await h.createProfile('alice', { interests: ['music'] });
    await h.createProfile('bob', { interests: ['hiking'] });
    await h.createProfile('carol', { interests: ['music', 'hiking'] });
    expect((await join('alice')).body.status).toBe('waiting');
    expect((await join('bob')).body.status).toBe('waiting'); // no shared interest with alice
    const res = await join('carol'); // shares one interest with each: tie -> alice joined first
    const match = h.services.repos.matches.findById(res.body.matchId)!;
    expect([match.user1Id, match.user2Id]).toEqual(['alice', 'carol']);
    expect((await status('bob')).body.status).toBe('waiting');
  });

  it('7b. a more compatible user beats an earlier but weaker candidate', async () => {
    h = createHarness();
    await h.createProfile('alice', { interests: ['hiking'] });
    await h.createProfile('bob', { interests: ['music', 'food'] });
    await h.createProfile('carol', { interests: ['music', 'food', 'hiking'] });
    await join('alice');
    await join('bob');
    const match = h.services.repos.matches.findById((await join('carol')).body.matchId)!;
    expect([match.user1Id, match.user2Id]).toEqual(['bob', 'carol']);
  });

  it('relaxes the shared-interest rule after waiting, when the client polls status', async () => {
    h = createHarness({ relaxAfterSeconds: 45 });
    await h.createProfile('alice', { interests: ['chess'] });
    await h.createProfile('bob', { interests: ['surfing'] });
    await join('alice');
    expect((await join('bob')).body.status).toBe('waiting');
    expect((await status('bob')).body.status).toBe('waiting');
    h.clock.advance(46_000);
    const s = (await status('bob')).body;
    expect(['generating', 'active']).toContain(s.status);
    expect((await status('alice')).body.matchId).toBe(s.matchId);
  });

  it('8. users already in a match cannot be matched again', async () => {
    h = createHarness();
    for (const u of ['alice', 'bob', 'carol']) await h.createProfile(u);
    await join('alice');
    const matchId = (await join('bob')).body.matchId;
    // Joining again returns the existing match instead of creating another.
    expect((await join('alice')).body).toEqual({ status: 'matched', matchId });
    expect((await join('bob')).body).toEqual({ status: 'matched', matchId });
    // A third compatible user is not paired with either.
    expect((await join('carol')).body).toEqual({ status: 'waiting', matchId: null });
    expect(h.services.repos.matches.listAll()).toHaveLength(1);
    // Schema trigger refuses a second open match for alice.
    expect(() => h.services.repos.matches.insert({ id: 'match_x', user1Id: 'carol', user2Id: 'alice', createdAt: 'x' })).toThrow(
      /USER_ALREADY_IN_OPEN_MATCH/,
    );
  });

  it('a user can be matched again after their previous match ends', async () => {
    h = createHarness();
    for (const u of ['alice', 'bob', 'carol']) await h.createProfile(u);
    await join('alice');
    const first = (await join('bob')).body.matchId;
    await h.as('alice').post(`/api/matches/${first}/cancel`);
    expect((await status('alice')).body.status).toBe('idle');
    await join('carol');
    const second = (await join('alice')).body;
    expect(second.status).toBe('matched');
    expect(second.matchId).not.toBe(first);
  });

  it('requires a profile before joining', async () => {
    h = createHarness();
    const res = await join('nobody');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PROFILE_REQUIRED');
  });

  it('9. concurrent joins never double-book anyone', async () => {
    h = createHarness();
    const users = Array.from({ length: 21 }, (_, i) => `user${i}`);
    for (const u of users) await h.createProfile(u);

    // Fire every join at once, twice per user, through the HTTP layer.
    const responses = await Promise.all([...users, ...users].map((u) => join(u)));
    expect(responses.every((r) => r.status === 200)).toBe(true);

    const matches = h.services.repos.matches.listAll();
    const participants = matches.flatMap((m) => [m.user1Id, m.user2Id]);
    expect(matches).toHaveLength(10);
    expect(new Set(participants).size).toBe(participants.length); // nobody in two matches
    expect(matches.every((m) => m.user1Id !== m.user2Id)).toBe(true);
    const waiting = users.filter((u) => h.services.repos.queue.countForUser(u, 'waiting') > 0);
    expect(waiting).toHaveLength(1);
    expect(participants).not.toContain(waiting[0]);
  });

  it('9b. two independent DB connections (like two server processes) cannot claim the same user', async () => {
    const tmp = createTempDir();
    const path = pathJoin(tmp.dir, 'shared.db');
    const dbA = openDatabase(path);
    const dbB = openDatabase(path);
    const clock = createTestClock();
    const a = createServices({ db: dbA, clock, questGenerator: null });
    const b = createServices({ db: dbB, clock, questGenerator: null });
    try {
      const users = Array.from({ length: 12 }, (_, i) => `u${i}`);
      for (const u of users) a.profiles.upsert(u, { displayName: u, interests: ['music'], comfortLevel: 'chill', availableMinutes: 30, maxBudget: 0 });
      // Alternate which "process" handles each join; also replay every join on the other one.
      users.forEach((u, i) => (i % 2 === 0 ? a : b).matchmaking.join(u));
      users.forEach((u, i) => (i % 2 === 0 ? b : a).matchmaking.join(u));
      const matches = a.repos.matches.listAll();
      const participants = matches.flatMap((m) => [m.user1Id, m.user2Id]);
      expect(matches).toHaveLength(6);
      expect(new Set(participants).size).toBe(12);
      await Promise.all([a.whenIdle(), b.whenIdle()]);
    } finally {
      dbA.close();
      dbB.close();
      tmp.cleanup();
    }
  });

  it('10. matches persist and are retrievable after the service is re-initialised', async () => {
    const tmp = createTempDir();
    const dbPath = pathJoin(tmp.dir, 'persist.db');
    try {
      h = createHarness({ dbPath });
      await h.createProfile('alice');
      await h.createProfile('bob');
      await join('alice');
      const matchId = (await join('bob')).body.matchId;
      await h.settle();
      const questBefore = (await h.as('alice').get(`/api/quests/${matchId}`)).body.quest;
      await h.close();

      // Brand new DB connection, services and app on the same file.
      h = createHarness({ dbPath });
      expect((await status('alice')).body).toMatchObject({ status: 'active', matchId });
      expect((await status('bob')).body).toMatchObject({ status: 'active', matchId });
      const after = (await h.as('bob').get(`/api/quests/${matchId}`)).body;
      expect(after.quest).toEqual(questBefore);
      expect((await join('alice')).body).toEqual({ status: 'matched', matchId });
    } finally {
      await h.close();
      tmp.cleanup();
    }
  });
});
