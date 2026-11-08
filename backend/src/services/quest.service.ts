import { type Db, inTransaction } from '../database/db.js';
import { buildQuestConstraints } from '../domain/compatibility.js';
import { pickFallbackQuest } from '../domain/fallback-quests.js';
import { type ValidatedQuest, validateAiQuest } from '../domain/quest-rules.js';
import type { MatchRepository } from '../repositories/match.repository.js';
import type { ProfileRepository } from '../repositories/profile.repository.js';
import type { QuestRepository } from '../repositories/quest.repository.js';
import type { MatchSession, MatchStatus, Quest, QuestSource } from '../types/domain.js';
import type { Clock } from '../utils/clock.js';
import { conflict, forbidden, notFound } from '../utils/errors.js';
import { newId } from '../utils/ids.js';
import { type Logger, describeError } from '../utils/logger.js';
import type { QuestGenerator } from './maritime.service.js';
import type { NotificationService } from './notification.service.js';

export interface QuestView {
  matchId: string;
  matchStatus: MatchStatus;
  /** pending: still generating; ready: quest available; unavailable: match cancelled before a quest existed. */
  questStatus: 'pending' | 'ready' | 'unavailable';
  quest: Omit<Quest, 'matchId' | 'source'> | null;
  partner: { displayName: string } | null;
  completion: { confirmedByMe: boolean; partnerConfirmed: boolean };
}

export interface CompletionResult {
  matchId: string;
  matchStatus: 'active' | 'completed';
  confirmedByMe: true;
  partnerConfirmed: boolean;
  /** True while the other participant still needs to confirm. */
  waitingForPartner: boolean;
}

export interface QuestServiceDeps {
  db: Db;
  matches: MatchRepository;
  quests: QuestRepository;
  profiles: ProfileRepository;
  notifier: NotificationService;
  /** null when MARITIME_AGENT_URL is not configured: every match gets a fallback quest. */
  generator: QuestGenerator | null;
  clock: Clock;
  logger: Logger;
}

/** Throws 404/403 unless `userId` is a participant of an existing match. */
export function requireParticipant(matches: MatchRepository, matchId: string, userId: string): MatchSession {
  const match = matches.findById(matchId);
  if (!match) throw notFound('MATCH_NOT_FOUND', 'Match not found');
  if (match.user1Id !== userId && match.user2Id !== userId) throw forbidden('You are not a participant in this match');
  return match;
}

export class QuestService {
  /** One in-flight generation per match, so concurrent triggers never call the AI twice. */
  private readonly inflight = new Map<string, Promise<void>>();

  constructor(private readonly deps: QuestServiceDeps) {}

  /** Start (or join) quest generation for a match. Never rejects. */
  ensureGeneration(matchId: string): Promise<void> {
    let p = this.inflight.get(matchId);
    if (!p) {
      p = this.generate(matchId)
        .catch((err: unknown) => this.deps.logger.error('quest generation failed', { matchId, error: describeError(err) }))
        .finally(() => this.inflight.delete(matchId));
      this.inflight.set(matchId, p);
    }
    return p;
  }

  /** Resume generation for matches left in `generating` (e.g. after a restart). */
  resumePending(): void {
    for (const m of this.deps.matches.listGeneratingWithoutQuest()) void this.ensureGeneration(m.id);
  }

  async whenIdle(): Promise<void> {
    while (this.inflight.size > 0) await Promise.all([...this.inflight.values()]);
  }

  private async generate(matchId: string): Promise<void> {
    const match = this.deps.matches.findById(matchId);
    if (!match || match.status !== 'generating' || this.deps.quests.findByMatchId(matchId)) return;
    const p1 = this.deps.profiles.findById(match.user1Id);
    const p2 = this.deps.profiles.findById(match.user2Id);
    if (!p1 || !p2) throw new Error('participant profile missing');

    const constraints = buildQuestConstraints(p1, p2);
    let draft: ValidatedQuest;
    let source: QuestSource;
    try {
      if (!this.deps.generator) throw new Error('Maritime not configured');
      // One request for the pair: both users always share the same quest.
      const raw = await this.deps.generator.generateQuest({
        users: [p1, p2].map((p) => ({ interests: p.interests, comfortLevel: p.comfortLevel })),
        durationMinutes: constraints.durationMinutes,
        maxBudget: constraints.maxBudget,
      });
      draft = validateAiQuest(raw, constraints);
      source = 'maritime';
    } catch (err) {
      this.deps.logger.warn('using fallback quest', { matchId, reason: describeError(err) });
      draft = pickFallbackQuest(constraints);
      source = 'fallback';
    }

    const quest: Quest = { id: newId('quest'), matchId, ...draft, source, createdAt: this.deps.clock.now().toISOString() };
    const stored = inTransaction(this.deps.db, () => {
      // Re-check: the match may have been cancelled while we waited for the AI.
      const current = this.deps.matches.findById(matchId);
      if (!current || current.status !== 'generating') return false;
      if (!this.deps.quests.insert(quest)) return false; // UNIQUE(match_id): someone else stored it first
      this.deps.matches.activate(matchId, quest.id);
      this.deps.notifier.enqueue('quest.created', matchId, [current.user1Id, current.user2Id], {
        questId: quest.id,
        title: quest.title,
        location: quest.location,
        durationMinutes: quest.durationMinutes,
        xp: quest.xp,
      });
      return true;
    });
    if (stored) this.deps.notifier.kick();
  }

  getForUser(matchId: string, userId: string): QuestView {
    const match = requireParticipant(this.deps.matches, matchId, userId);
    const quest = this.deps.quests.findByMatchId(matchId);
    const partnerId = match.user1Id === userId ? match.user2Id : match.user1Id;
    const partner = this.deps.profiles.findById(partnerId);
    const confirmed = new Set(this.deps.matches.listCompletions(matchId).map((c) => c.userId));

    // Self-heal: if a match is stuck generating with nothing in flight (e.g. after a crash), retry.
    if (match.status === 'generating' && !quest) void this.ensureGeneration(matchId);

    return {
      matchId,
      matchStatus: match.status,
      questStatus: quest ? 'ready' : match.status === 'generating' ? 'pending' : 'unavailable',
      quest: quest
        ? {
            id: quest.id,
            title: quest.title,
            description: quest.description,
            location: quest.location,
            durationMinutes: quest.durationMinutes,
            xp: quest.xp,
            createdAt: quest.createdAt,
          }
        : null,
      partner: partner ? { displayName: partner.displayName } : null,
      completion: { confirmedByMe: confirmed.has(userId), partnerConfirmed: confirmed.has(partnerId) },
    };
  }

  /** Record the user's confirmation. Idempotent; completes the match once both confirmed. */
  complete(matchId: string, userId: string): CompletionResult {
    const { result, completedNow } = inTransaction(this.deps.db, () => {
      const match = requireParticipant(this.deps.matches, matchId, userId);
      const partnerId = match.user1Id === userId ? match.user2Id : match.user1Id;

      if (match.status === 'cancelled') throw conflict('MATCH_CANCELLED', 'This match was cancelled and cannot be completed.');
      if (match.status === 'generating') throw conflict('QUEST_NOT_READY', 'The quest is still being generated.');
      if (match.status === 'completed') {
        return {
          result: { matchId, matchStatus: 'completed', confirmedByMe: true, partnerConfirmed: true, waitingForPartner: false } as CompletionResult,
          completedNow: false,
        };
      }

      const now = this.deps.clock.now().toISOString();
      this.deps.matches.addCompletion(matchId, userId, now);
      const confirmed = new Set(this.deps.matches.listCompletions(matchId).map((c) => c.userId));
      const partnerConfirmed = confirmed.has(partnerId);
      let completedNow = false;
      if (partnerConfirmed) {
        completedNow = this.deps.matches.complete(matchId, now);
        if (completedNow) {
          this.deps.notifier.enqueue('quest.completed', matchId, [match.user1Id, match.user2Id], {
            questId: match.questId,
          });
        }
      }
      return {
        result: {
          matchId,
          matchStatus: partnerConfirmed ? 'completed' : 'active',
          confirmedByMe: true,
          partnerConfirmed,
          waitingForPartner: !partnerConfirmed,
        } as CompletionResult,
        completedNow,
      };
    });
    if (completedNow) this.deps.notifier.kick();
    return result;
  }
}
