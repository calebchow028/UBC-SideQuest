import type { ComfortLevel, UserProfile } from '../types/domain.js';

/**
 * Matchmaking compatibility
 * =========================
 *
 * score(a, b) = 10 × (number of shared interests)
 *             +  5 × (shorter available time ÷ longer available time), rounded   → 0..5
 *             +  3 if comfort levels are equal, 1 if adjacent (chill↔adventure, adventure↔chaos), else 0
 *
 * Eligibility (hard rule): a pair is eligible if they share at least one interest, OR if
 * either user has been waiting at least `relaxAfterSeconds`. The relaxation stops people with
 * niche interests from waiting forever when the queue is small.
 *
 * Selection: among eligible waiting candidates, pick the highest score; ties go to whoever
 * joined the queue first (FIFO), then to insertion order.
 */

export type MatchableProfile = Pick<UserProfile, 'interests' | 'availableMinutes' | 'comfortLevel'>;

const COMFORT_RANK: Record<ComfortLevel, number> = { chill: 0, adventure: 1, chaos: 2 };

export const SHARED_INTEREST_WEIGHT = 10;
export const MAX_TIME_SCORE = 5;

export function sharedInterests(a: MatchableProfile, b: MatchableProfile): string[] {
  const other = new Set(b.interests);
  return [...new Set(a.interests)].filter((i) => other.has(i)).sort();
}

export function compatibilityScore(a: MatchableProfile, b: MatchableProfile): number {
  const interestScore = SHARED_INTEREST_WEIGHT * sharedInterests(a, b).length;
  const shorter = Math.min(a.availableMinutes, b.availableMinutes);
  const longer = Math.max(a.availableMinutes, b.availableMinutes);
  const timeScore = longer > 0 ? Math.round((MAX_TIME_SCORE * shorter) / longer) : 0;
  const comfortGap = Math.abs(COMFORT_RANK[a.comfortLevel] - COMFORT_RANK[b.comfortLevel]);
  const comfortScore = comfortGap === 0 ? 3 : comfortGap === 1 ? 1 : 0;
  return interestScore + timeScore + comfortScore;
}

export interface Candidate {
  userId: string;
  joinedAt: string;
  /** Monotonic insertion order; final tie-breaker when timestamps are equal. */
  seq: number;
  profile: MatchableProfile;
}

export interface Seeker {
  userId: string;
  joinedAt: string;
  profile: MatchableProfile;
}

export interface PickOptions {
  now: Date;
  relaxAfterSeconds: number;
}

const waitedSeconds = (joinedAt: string, now: Date) => (now.getTime() - Date.parse(joinedAt)) / 1000;

export function isEligiblePair(seeker: Seeker, candidate: Candidate, opts: PickOptions): boolean {
  if (seeker.userId === candidate.userId) return false;
  if (sharedInterests(seeker.profile, candidate.profile).length > 0) return true;
  const longestWait = Math.max(waitedSeconds(seeker.joinedAt, opts.now), waitedSeconds(candidate.joinedAt, opts.now));
  return longestWait >= opts.relaxAfterSeconds;
}

/** Deterministically choose the best partner for `seeker`, or null if nobody is eligible. */
export function pickBestCandidate<C extends Candidate>(seeker: Seeker, candidates: C[], opts: PickOptions): C | null {
  let best: { candidate: C; score: number } | null = null;
  for (const candidate of candidates) {
    if (!isEligiblePair(seeker, candidate, opts)) continue;
    const score = compatibilityScore(seeker.profile, candidate.profile);
    if (
      best === null ||
      score > best.score ||
      (score === best.score && compareFifo(candidate, best.candidate) < 0)
    ) {
      best = { candidate, score };
    }
  }
  return best?.candidate ?? null;
}

function compareFifo(a: Candidate, b: Candidate): number {
  const t = Date.parse(a.joinedAt) - Date.parse(b.joinedAt);
  return t !== 0 ? t : a.seq - b.seq;
}

/** The constraints a quest for this pair must respect: the stricter of the two users' settings. */
export interface QuestConstraints {
  durationMinutes: number;
  maxBudget: number;
  comfortLevel: ComfortLevel;
  sharedInterests: string[];
  allInterests: string[];
}

export function buildQuestConstraints(a: MatchableProfile & Pick<UserProfile, 'maxBudget'>, b: MatchableProfile & Pick<UserProfile, 'maxBudget'>): QuestConstraints {
  const comfortLevel = COMFORT_RANK[a.comfortLevel] <= COMFORT_RANK[b.comfortLevel] ? a.comfortLevel : b.comfortLevel;
  return {
    durationMinutes: Math.min(a.availableMinutes, b.availableMinutes),
    maxBudget: Math.min(a.maxBudget, b.maxBudget),
    comfortLevel,
    sharedInterests: sharedInterests(a, b),
    allInterests: [...new Set([...a.interests, ...b.interests])].sort(),
  };
}
