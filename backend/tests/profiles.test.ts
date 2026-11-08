import { afterEach, describe, expect, it } from 'vitest';
import { createHarness, defaultProfile, type Harness } from './helpers/harness.js';

describe('profiles', () => {
  let h: Harness;
  afterEach(async () => {
    await h?.close();
  });

  const valid = {
    displayName: 'Steven',
    interests: ['music', 'food', 'hiking'],
    comfortLevel: 'chill',
    availableMinutes: 30,
    maxBudget: 0,
  };

  it('returns 404 before a profile exists', async () => {
    h = createHarness();
    const res = await h.as('auth0|steven').get('/api/profile');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PROFILE_NOT_FOUND');
  });

  it('1. creates a valid profile keyed by the token subject', async () => {
    h = createHarness();
    const res = await h.as('auth0|steven').put('/api/profile', valid);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'auth0|steven', ...valid, stats: { completedQuests: 0, totalXp: 0 } });
    expect(res.body.createdAt).toBe(res.body.updatedAt);
    const get = await h.as('auth0|steven').get('/api/profile');
    expect(get.status).toBe(200);
    expect(get.body).toEqual(res.body);
  });

  it('normalises interests: trims, lower-cases and de-duplicates', async () => {
    h = createHarness();
    const res = await h.as('u1').put('/api/profile', { ...valid, interests: [' Music ', 'music', 'FOOD'] });
    expect(res.body.interests).toEqual(['music', 'food']);
  });

  it('2. updates an existing profile without changing createdAt', async () => {
    h = createHarness();
    const created = (await h.as('u1').put('/api/profile', valid)).body;
    h.clock.advance(60_000);
    const updated = await h.as('u1').put('/api/profile', { ...valid, displayName: 'Steve', comfortLevel: 'chaos', availableMinutes: 90, maxBudget: 15 });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ id: 'u1', displayName: 'Steve', comfortLevel: 'chaos', availableMinutes: 90, maxBudget: 15 });
    expect(updated.body.createdAt).toBe(created.createdAt);
    expect(updated.body.updatedAt > created.updatedAt).toBe(true);
    expect(h.db.prepare('SELECT COUNT(*) AS n FROM user_profiles').get()).toEqual({ n: 1 });
  });

  const expectValidationError = async (body: object, field: string) => {
    const res = await h.as('u1').put('/api/profile', body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain(field);
    expect(h.services.repos.profiles.findById('u1')).toBeNull();
  };

  it('3. rejects invalid comfort levels', async () => {
    h = createHarness();
    await expectValidationError({ ...valid, comfortLevel: 'extreme' }, 'comfortLevel');
  });

  it('4. rejects negative budgets', async () => {
    h = createHarness();
    await expectValidationError({ ...valid, maxBudget: -5 }, 'maxBudget');
  });

  it('5. rejects invalid time availability', async () => {
    h = createHarness();
    await expectValidationError({ ...valid, availableMinutes: 0 }, 'availableMinutes');
    await expectValidationError({ ...valid, availableMinutes: -10 }, 'availableMinutes');
    await expectValidationError({ ...valid, availableMinutes: 10 }, 'availableMinutes'); // below 15-min minimum
    await expectValidationError({ ...valid, availableMinutes: 1000 }, 'availableMinutes');
    await expectValidationError({ ...valid, availableMinutes: 22.5 }, 'availableMinutes');
    await expectValidationError({ ...valid, availableMinutes: '30' }, 'availableMinutes');
  });

  it('6. rejects missing required fields', async () => {
    h = createHarness();
    for (const field of Object.keys(valid)) {
      const body: Record<string, unknown> = { ...valid };
      delete body[field];
      await expectValidationError(body, field);
    }
    await expectValidationError({ ...valid, interests: [] }, 'interests');
    await expectValidationError({ ...valid, displayName: '   ' }, 'displayName');
  });

  it('rejects malformed JSON with a consistent error', async () => {
    h = createHarness();
    const res = await h.as('u1').put('/api/profile').set('Content-Type', 'application/json').send('{"displayName": ');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('7. users cannot overwrite another user\'s profile, even by sending an id in the body', async () => {
    h = createHarness();
    await h.as('victim').put('/api/profile', { ...defaultProfile('Victim') });
    const res = await h.as('attacker').put('/api/profile', { ...valid, displayName: 'Hacked', id: 'victim', userId: 'victim' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('attacker');
    expect(h.services.repos.profiles.findById('victim')?.displayName).toBe('Victim');
    expect(h.services.repos.profiles.findById('attacker')?.displayName).toBe('Hacked');
    // GET only ever returns your own profile.
    expect((await h.as('attacker').get('/api/profile')).body.id).toBe('attacker');
  });
});
