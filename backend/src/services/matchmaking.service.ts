import { type Db, inTransaction } from '../database/db.js';
import { pickBestCandidate } from '../domain/compatibility.js';
import type { MatchRepository } from '../repositories/match.repository.js';
import type { ProfileRepository } from '../repositories/profile.repository.js';
import type { QueueRepository } from '../repositories/queue.repository.js';
import type { MatchSession, UserProfile } from '../types/domain.js';
import type { Clock } from '../utils/clock.js';
import { AppError, conflict } from '../utils/errors.js';
import { newId } from '../utils/ids.js';
import type { NotificationService } from './notification.service.js';

export interface JoinResult {
  status: 'waiting' | 'matched';
  matchId: string | null;
}

export interface QueueStatus {
  status: 'idle' | 'waiting' | 'generating' | 'active';
  matchId: string | null;
  joinedAt: string | null;
}

export interface LeaveResult {
  status: 'idle';
  left: boolean;
}

export interface MatchmakingDeps {
  db: Db;
  profiles: ProfileRepository;
  queue: QueueRepository;
  matches: MatchRepository;
  notifier: NotificationService;
  clock: Clock;
  relaxAfterSeconds: number;
  /** Called after a new match has been committed (kicks off quest generation). */
  onMatchCreated: (match: MatchSession) => void;
}

/**
 * Queue lifecycle + pairing. Every operation that reads the queue and then writes to it
 * runs in a single IMMEDIATE transaction (see `inTransaction`), so two users can never
 * claim the same waiting partner. The DB schema additionally enforces: one waiting entry
 * per user, no self-matches, and at most one open match per user.
 */
export class MatchmakingService {
  constructor(private readonly deps: MatchmakingDeps) {}

  join(userId: string): JoinResult {
    const { result, created } = inTransaction(this.deps.db, () => {
      const open = this.deps.matches.findOpenForUser(userId);
      if (open) return { result: { status: 'matched', matchId: open.id } as JoinResult, created: null };

      const profile = this.deps.profiles.findById(userId);
      if (!profile) {
        throw conflict('PROFILE_REQUIRED', 'Create your profile with PUT /api/profile before joining the queue.');
      }
      // Idempotent: a repeat join keeps the existing entry (and its place in line).
      this.deps.queue.ensureWaiting(userId, this.deps.clock.now().toISOString());
      const match = this.tryMatchLocked(userId, profile);
      return match
        ? { result: { status: 'matched', matchId: match.id } as JoinResult, created: match }
        : { result: { status: 'waiting', matchId: null } as JoinResult, created: null };
    });
    if (created) this.afterMatchCommitted(created);
    return result;
  }

  /**
   * Current state for the user. For waiting users this also retries matching, so the
   * wait-time relaxation in the compatibility rules takes effect while the client polls.
   */
  status(userId: string): QueueStatus {
    const { result, created } = inTransaction(this.deps.db, () => {
      const open = this.deps.matches.findOpenForUser(userId);
      if (open) return { result: this.openMatchStatus(open), created: null };

      const waiting = this.deps.queue.findWaiting(userId);
      if (!waiting) return { result: { status: 'idle', matchId: null, joinedAt: null } as QueueStatus, created: null };

      const profile = this.deps.profiles.findById(userId);
      const match = profile ? this.tryMatchLocked(userId, profile) : null;
      if (match) return { result: this.openMatchStatus(match), created: match };
      return { result: { status: 'waiting', matchId: null, joinedAt: waiting.joinedAt } as QueueStatus, created: null };
    });
    if (created) this.afterMatchCommitted(created);
    return result;
  }

  /** Idempotent. Refuses (409) if the user is already in a match: use cancel for that. */
  leave(userId: string): LeaveResult {
    return inTransaction(this.deps.db, () => {
      const open = this.deps.matches.findOpenForUser(userId);
      if (open) {
        throw new AppError(409, 'ALREADY_MATCHED', 'You are already in a match. Cancel it with POST /api/matches/:matchId/cancel.', {
          matchId: open.id,
          matchStatus: open.status,
        });
      }
      return { status: 'idle', left: this.deps.queue.removeWaiting(userId) };
    });
  }

  private openMatchStatus(match: MatchSession): QueueStatus {
    return { status: match.status === 'active' ? 'active' : 'generating', matchId: match.id, joinedAt: null };
  }

  /** Must be called inside a transaction, with `userId` holding a waiting entry. */
  private tryMatchLocked(userId: string, profile: UserProfile): MatchSession | null {
    const self = this.deps.queue.findWaiting(userId);
    if (!self) return null;
    const candidates = this.deps.queue.listWaitingCandidates(userId).map((c) => ({
      userId: c.entry.userId,
      joinedAt: c.entry.joinedAt,
      seq: c.seq,
      profile: c.profile,
    }));
    const partner = pickBestCandidate({ userId, joinedAt: self.joinedAt, profile }, candidates, {
      now: this.deps.clock.now(),
      relaxAfterSeconds: this.deps.relaxAfterSeconds,
    });
    if (!partner) return null;

    // user1 = whoever waited longer.
    const match = this.deps.matches.insert({
      id: newId('match'),
      user1Id: partner.userId,
      user2Id: userId,
      createdAt: this.deps.clock.now().toISOString(),
    });
    this.deps.queue.markMatched([partner.userId, userId], match.id);
    this.deps.notifier.enqueue('match.created', match.id, [match.user1Id, match.user2Id]);
    return match;
  }

  private afterMatchCommitted(match: MatchSession): void {
    this.deps.notifier.kick();
    this.deps.onMatchCreated(match);
  }
}
