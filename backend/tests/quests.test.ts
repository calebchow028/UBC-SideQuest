import { afterEach, describe, expect, it } from 'vitest';
import type { QuestConstraints } from '../src/domain/compatibility.js';
import { FALLBACK_QUESTS, pickFallbackQuest } from '../src/domain/fallback-quests.js';
import { QuestRejectedError, resolveApprovedLocation, validateAiQuest } from '../src/domain/quest-rules.js';
import { MaritimeClient, MaritimeError, fromMaritimeResponse, toMaritimeRequest, xpForDuration } from '../src/services/maritime.service.js';
import { VALID_AI_QUEST, createHarness, fakeFetch, hangingFetch, jsonResponse, type Harness, type HarnessOptions } from './helpers/harness.js';

/** Exactly the shape Person 3's agent returns (ai-agent/main.py). */
const AGENT_QUEST = {
  title: 'Main Mall Photo Walk',
  description: 'Walk Main Mall together and each take three photos of interesting architecture, then pick a favourite.',
  location: 'UBC Main Mall',
  cost: 0,
  duration_minutes: 20,
  vibe: 'chill',
};

const constraints = (over: Partial<QuestConstraints> = {}): QuestConstraints => ({
  durationMinutes: 30,
  maxBudget: 0,
  comfortLevel: 'chill',
  sharedInterests: ['music'],
  allInterests: ['food', 'hiking', 'music'],
  ...over,
});

describe('quest validation rules (unit)', () => {
  it('accepts a valid quest and canonicalises location aliases', () => {
    expect(validateAiQuest(VALID_AI_QUEST, constraints())).toEqual({ ...VALID_AI_QUEST, location: 'UBC Nest' });
    expect(validateAiQuest({ ...VALID_AI_QUEST, location: 'the nest' }, constraints()).location).toBe('UBC Nest');
    expect(resolveApprovedLocation('IKB')).toBe('Irving K. Barber Learning Centre');
    expect(resolveApprovedLocation('Wreck Beach')).toBeNull();
  });

  const rejects = (raw: unknown, c: QuestConstraints, reason: RegExp) => {
    expect(() => validateAiQuest(raw, c)).toThrow(QuestRejectedError);
    try {
      validateAiQuest(raw, c);
    } catch (e) {
      expect((e as QuestRejectedError).reason).toMatch(reason);
    }
  };

  it('rejects malformed objects', () => {
    rejects(null, constraints(), /invalid shape/);
    rejects({ ...VALID_AI_QUEST, xp: 'lots' }, constraints(), /invalid shape \(xp\)/);
    rejects({ title: 'Hi' }, constraints(), /invalid shape/);
  });

  it('rejects unapproved locations', () => {
    rejects({ ...VALID_AI_QUEST, location: 'Wreck Beach' }, constraints(), /location/);
    rejects({ ...VALID_AI_QUEST, location: 'UBC Nest rooftop' }, constraints(), /location/);
  });

  it('rejects quests longer than the shared availability', () => {
    rejects({ ...VALID_AI_QUEST, durationMinutes: 45 }, constraints({ durationMinutes: 30 }), /duration/);
  });

  it('rejects quests over budget or that require spending with a $0 budget', () => {
    rejects({ ...VALID_AI_QUEST, estimatedCost: 12 }, constraints({ maxBudget: 10 }), /cost/);
    rejects({ ...VALID_AI_QUEST, description: 'Go buy a bubble tea together and rate it out of ten.' }, constraints(), /spending/);
    // ...but spending is fine when both users budgeted for it.
    expect(() =>
      validateAiQuest({ ...VALID_AI_QUEST, description: 'Go buy a bubble tea together and rate it.', estimatedCost: 6 }, constraints({ maxBudget: 10 })),
    ).not.toThrow();
  });

  it.each([
    ['alcohol', 'Grab a beer at the pub and share your favourite songs.'],
    ['drugs', 'Find a quiet place to smoke and talk about music.'],
    ['trespass-danger', 'Climb onto the roof of the Nest for the best view.'],
    ['private-places', 'Head back to your dorm room and swap playlists.'],
    ['romance-intimacy', 'Share your songs, then kiss on the count of three.'],
    ['late-night', 'Meet at midnight and exchange your three favourite songs.'],
    ['personal-info', 'Exchange phone numbers and your three favourite songs.'],
  ])('rejects unsafe content: %s', (rule, description) => {
    rejects({ ...VALID_AI_QUEST, description }, constraints(), new RegExp(rule));
  });

  it('every predefined fallback quest passes the same safety rules', () => {
    for (const q of FALLBACK_QUESTS) {
      const c = constraints({ durationMinutes: 15, maxBudget: 0 });
      expect(() => validateAiQuest(q, c), q.title).not.toThrow();
    }
  });

  it('picks fallback quests deterministically from shared interests', () => {
    expect(pickFallbackQuest(constraints({ sharedInterests: ['music'] })).title).toBe('The Playlist Exchange');
    expect(pickFallbackQuest(constraints({ sharedInterests: ['books'], allInterests: ['books'] })).title).toBe('Library Recommendation Swap');
    expect(pickFallbackQuest(constraints({ sharedInterests: [], allInterests: ['hiking', 'zzz'] })).title).toBe('Rose Garden Viewpoint Hunt');
    expect(pickFallbackQuest(constraints({ sharedInterests: [], allInterests: ['zzz'] })).title).toBe('Two Truths and a Campus Tip');
  });
});

describe('Maritime adapter (unit)', () => {
  it('unwraps common agent response envelopes', () => {
    expect(fromMaritimeResponse({ quest: VALID_AI_QUEST })).toEqual(VALID_AI_QUEST);
    expect(fromMaritimeResponse({ data: VALID_AI_QUEST })).toEqual(VALID_AI_QUEST);
    expect(fromMaritimeResponse({ output: JSON.stringify(VALID_AI_QUEST) })).toEqual(VALID_AI_QUEST);
    expect(fromMaritimeResponse(VALID_AI_QUEST)).toEqual(VALID_AI_QUEST);
    expect(() => fromMaritimeResponse({ output: 'Sure! Here is a quest...' })).toThrow(MaritimeError);
  });

  it("maps Person 3's snake_case response (cost, duration_minutes, no xp) onto our quest shape", () => {
    const agentQuest = { ...AGENT_QUEST };
    expect(fromMaritimeResponse(agentQuest)).toEqual({
      title: AGENT_QUEST.title,
      description: AGENT_QUEST.description,
      location: 'UBC Main Mall',
      durationMinutes: 20,
      xp: 40,
      estimatedCost: 0,
    });
    expect(fromMaritimeResponse({ quest: agentQuest })).toMatchObject({ durationMinutes: 20, xp: 40 });
    // Mapped output passes validation, and "UBC Main Mall" is canonicalised.
    expect(validateAiQuest(fromMaritimeResponse(agentQuest), constraints())).toMatchObject({ location: 'Main Mall', xp: 40 });
    // An explicit xp from the agent wins; a non-numeric duration still fails validation.
    expect(fromMaritimeResponse({ ...agentQuest, xp: 99 })).toMatchObject({ xp: 99 });
    expect(() => validateAiQuest(fromMaritimeResponse({ ...agentQuest, duration_minutes: 'soon' }), constraints())).toThrow(QuestRejectedError);
    expect(() => validateAiQuest(fromMaritimeResponse({ ...agentQuest, cost: 8 }), constraints({ maxBudget: 5 }))).toThrow(/cost/);
  });

  it('derives xp from duration within schema bounds', () => {
    expect(xpForDuration(15)).toBe(30);
    expect(xpForDuration(20)).toBe(40);
    expect(xpForDuration(60)).toBe(120);
    expect(xpForDuration(1)).toBe(5);
    expect(xpForDuration(10_000)).toBe(500);
  });

  it("builds Person 3's request body (student_a / student_b with budget and vibe)", () => {
    expect(
      toMaritimeRequest({
        users: [
          { interests: ['photography', 'walking'], comfortLevel: 'chill', maxBudget: 10 },
          { interests: ['photography', 'nature'], comfortLevel: 'chill', maxBudget: 5 },
        ],
        durationMinutes: 30,
        maxBudget: 5,
      }),
    ).toMatchObject({
      student_a: { interests: ['photography', 'walking'], budget: 10, vibe: 'chill' },
      student_b: { interests: ['photography', 'nature'], budget: 5, vibe: 'chill' },
      max_duration_minutes: 30,
    });
  });

  const req = { users: [{ interests: ['music'], comfortLevel: 'chill' as const, maxBudget: 0 }], durationMinutes: 20, maxBudget: 0 };

  it('maps HTTP errors, timeouts, bad JSON and network failures to MaritimeError', async () => {
    const make = (fetch: ConstructorParameters<typeof MaritimeClient>[0]['fetch']) =>
      new MaritimeClient({ url: 'https://maritime.test', timeoutMs: 50, ...(fetch ? { fetch } : {}) });
    await expect(make(async () => jsonResponse({}, 503)).generateQuest(req)).rejects.toThrow(/HTTP 503/);
    await expect(make(hangingFetch).generateQuest(req)).rejects.toThrow(/timed out after 50ms/);
    await expect(make(async () => new Response('<html>oops</html>', { status: 200 })).generateQuest(req)).rejects.toThrow(/not valid JSON/);
    await expect(make(async () => { throw new TypeError('fetch failed'); }).generateQuest(req)).rejects.toThrow(/network error/);
  });
});

describe('quest generation and retrieval', () => {
  let h: Harness;
  afterEach(async () => {
    await h?.close();
  });

  /** Match alice (music, food, 30 min) with bob (music, hiking, 20 min) and wait for the quest. */
  async function matchPair(opts: HarnessOptions = {}) {
    h = createHarness(opts);
    await h.createProfile('alice', { interests: ['music', 'food'], availableMinutes: 30, maxBudget: 5 });
    await h.createProfile('bob', { interests: ['music', 'hiking'], availableMinutes: 20, maxBudget: 0, comfortLevel: 'adventure' });
    await h.as('alice').post('/api/queue/join');
    const { matchId } = (await h.as('bob').post('/api/queue/join')).body as { matchId: string };
    await h.settle();
    return matchId;
  }

  it('1. stores the AI quest after one request with both users\' combined constraints', async () => {
    const maritime = fakeFetch(() => jsonResponse(VALID_AI_QUEST));
    const matchId = await matchPair({ maritimeFetch: maritime });

    expect(maritime.calls).toHaveLength(1);
    expect(maritime.calls[0]!.headers['x-api-key']).toBe('maritime-test-key');
    expect(maritime.calls[0]!.headers.authorization).toBeUndefined();
    expect(maritime.calls[0]!.body).toMatchObject({
      student_a: { interests: ['music', 'food'], budget: 5, vibe: 'chill' },
      student_b: { interests: ['music', 'hiking'], budget: 0, vibe: 'adventure' },
      max_duration_minutes: 20,
    });
    // No personal data beyond what the agent needs.
    expect(JSON.stringify(maritime.calls[0]!.body)).not.toMatch(/alice|bob/);

    const res = await h.as('alice').get(`/api/quests/${matchId}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      matchId,
      matchStatus: 'active',
      questStatus: 'ready',
      quest: { title: 'The Playlist Exchange', location: 'UBC Nest', durationMinutes: 20, xp: 50 },
      partner: { displayName: 'bob' },
      completion: { confirmedByMe: false, partnerConfirmed: false },
    });
    expect(h.services.repos.quests.findByMatchId(matchId)?.source).toBe('maritime');
  });

  it("1b. stores a quest returned in Person 3's exact response format", async () => {
    const matchId = await matchPair({ maritimeFetch: fakeFetch(() => jsonResponse(AGENT_QUEST)) });
    const quest = h.services.repos.quests.findByMatchId(matchId)!;
    expect(quest).toMatchObject({ source: 'maritime', title: 'Main Mall Photo Walk', location: 'Main Mall', durationMinutes: 20, xp: 40 });
  });

  it('2. falls back to a predefined quest when the AI times out', async () => {
    const matchId = await matchPair({ maritimeFetch: hangingFetch, maritimeTimeoutMs: 50 });
    const quest = h.services.repos.quests.findByMatchId(matchId)!;
    expect(quest.source).toBe('fallback');
    expect(quest.title).toBe('The Playlist Exchange'); // shared interest: music
    expect(h.services.repos.matches.findById(matchId)?.status).toBe('active');
  });

  it.each([
    ['missing fields', () => jsonResponse({ title: 'Something' })],
    ['wrong types', () => jsonResponse({ ...VALID_AI_QUEST, durationMinutes: 'twenty' })],
    ['non-JSON body', () => new Response('I could not think of a quest', { status: 200 })],
    ['HTTP 500', () => jsonResponse({ error: 'boom' }, 500)],
    ['too long for the pair', () => jsonResponse({ ...VALID_AI_QUEST, durationMinutes: 25 })],
    ['unsafe content', () => jsonResponse({ ...VALID_AI_QUEST, description: 'Sneak onto the rooftop and share songs.' })],
  ])('3. invalid AI response (%s) results in a safe fallback quest', async (_label, responder) => {
    const matchId = await matchPair({ maritimeFetch: fakeFetch(responder) });
    expect(h.services.repos.quests.findByMatchId(matchId)?.source).toBe('fallback');
    expect((await h.as('alice').get(`/api/quests/${matchId}`)).body.questStatus).toBe('ready');
  });

  it('4. rejects an AI quest at an unapproved location', async () => {
    const matchId = await matchPair({ maritimeFetch: fakeFetch(() => jsonResponse({ ...VALID_AI_QUEST, location: 'Wreck Beach' })) });
    const quest = h.services.repos.quests.findByMatchId(matchId)!;
    expect(quest.source).toBe('fallback');
    expect(quest.location).not.toBe('Wreck Beach');
  });

  it('5. generates a fallback quest when Maritime is not configured at all', async () => {
    const matchId = await matchPair({ maritimeFetch: null });
    const quest = h.services.repos.quests.findByMatchId(matchId)!;
    expect(quest).toMatchObject({ source: 'fallback', title: 'The Playlist Exchange', location: 'UBC Nest' });
    expect(quest.durationMinutes).toBeLessThanOrEqual(20);
  });

  it('6. both users receive the exact same stored quest, generated once', async () => {
    const maritime = fakeFetch(() => jsonResponse(VALID_AI_QUEST));
    const matchId = await matchPair({ maritimeFetch: maritime });
    const [a, b] = await Promise.all([h.as('alice').get(`/api/quests/${matchId}`), h.as('bob').get(`/api/quests/${matchId}`)]);
    expect(a.body.quest).toEqual(b.body.quest);
    expect(a.body.quest.id).toMatch(/^quest_/);
    expect(a.body.partner.displayName).toBe('bob');
    expect(b.body.partner.displayName).toBe('alice');
    // Extra triggers never cause a second generation.
    await Promise.all([h.services.quests.ensureGeneration(matchId), h.services.quests.ensureGeneration(matchId)]);
    expect(maritime.calls).toHaveLength(1);
    expect(h.services.repos.quests.countForMatch(matchId)).toBe(1);
  });

  it('recovers a match left in "generating" (e.g. server restarted mid-request)', async () => {
    h = createHarness();
    await h.createProfile('alice');
    await h.createProfile('bob');
    // Simulate a crash: a match row exists but no quest was ever generated.
    h.services.repos.matches.insert({ id: 'match_orphan', user1Id: 'alice', user2Id: 'bob', createdAt: '2026-11-07T11:00:00.000Z' });
    h.services.quests.resumePending();
    await h.settle();
    expect((await h.as('alice').get('/api/quests/match_orphan')).body.questStatus).toBe('ready');
  });

  it('7. unrelated users cannot access the quest (403), unknown matches are 404', async () => {
    const matchId = await matchPair();
    const res = await h.as('mallory').get(`/api/quests/${matchId}`);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: { code: 'FORBIDDEN', message: 'You are not a participant in this match' } });
    expect(res.body.quest).toBeUndefined();
    expect((await h.as('mallory').post(`/api/quests/${matchId}/complete`)).status).toBe(403);
    expect((await h.as('alice').get('/api/quests/match_missing')).status).toBe(404);
  });

  it('8-10. completion: first leaves it incomplete, second completes it, duplicates are idempotent', async () => {
    const matchId = await matchPair();

    const first = await h.as('alice').post(`/api/quests/${matchId}/complete`);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ matchId, matchStatus: 'active', confirmedByMe: true, partnerConfirmed: false, waitingForPartner: true });
    expect(h.services.repos.matches.findById(matchId)?.status).toBe('active');
    expect((await h.as('bob').get(`/api/quests/${matchId}`)).body.completion).toEqual({ confirmedByMe: false, partnerConfirmed: true });

    // 10. duplicate from the same user changes nothing
    const dup = await h.as('alice').post(`/api/quests/${matchId}/complete`);
    expect(dup.body).toEqual(first.body);
    expect(h.services.repos.matches.listCompletions(matchId)).toHaveLength(1);

    // 9. partner confirms -> completed
    const second = await h.as('bob').post(`/api/quests/${matchId}/complete`);
    expect(second.body).toEqual({ matchId, matchStatus: 'completed', confirmedByMe: true, partnerConfirmed: true, waitingForPartner: false });
    const match = h.services.repos.matches.findById(matchId)!;
    expect(match.status).toBe('completed');
    expect(match.completedAt).not.toBeNull();

    // Duplicates after completion stay idempotent.
    const after = await h.as('bob').post(`/api/quests/${matchId}/complete`);
    expect(after.status).toBe(200);
    expect(after.body.matchStatus).toBe('completed');
    expect(h.services.repos.matches.listCompletions(matchId)).toHaveLength(2);

    // Both are free to queue again, and XP shows on the profile.
    expect((await h.as('alice').get('/api/queue/status')).body.status).toBe('idle');
    expect((await h.as('alice').get('/api/profile')).body.stats).toEqual({ completedQuests: 1, totalXp: 50 });
  });

  it('11. cancelled sessions cannot be completed', async () => {
    const matchId = await matchPair();
    await h.as('alice').post(`/api/quests/${matchId}/complete`);
    await h.as('bob').post(`/api/matches/${matchId}/cancel`);
    const res = await h.as('bob').post(`/api/quests/${matchId}/complete`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('MATCH_CANCELLED');
    expect(h.services.repos.matches.findById(matchId)?.status).toBe('cancelled');
    // DB trigger: a terminal status can never be changed back.
    expect(() => h.db.prepare(`UPDATE match_sessions SET status = 'completed' WHERE id = ?`).run(matchId)).toThrow(/MATCH_STATUS_TERMINAL/);
  });

  it('cannot complete while the quest is still generating', async () => {
    h = createHarness({ maritimeFetch: hangingFetch, maritimeTimeoutMs: 2_000 });
    await h.createProfile('alice');
    await h.createProfile('bob');
    await h.as('alice').post('/api/queue/join');
    const { matchId } = (await h.as('bob').post('/api/queue/join')).body;
    const res = await h.as('alice').post(`/api/quests/${matchId}/complete`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('QUEST_NOT_READY');
    await h.as('alice').post(`/api/matches/${matchId}/cancel`);
  });
});
