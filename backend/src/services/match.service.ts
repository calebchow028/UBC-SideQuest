import { type Db, inTransaction } from '../database/db.js';
import type { MatchRepository } from '../repositories/match.repository.js';
import type { Clock } from '../utils/clock.js';
import { conflict } from '../utils/errors.js';
import type { NotificationService } from './notification.service.js';
import { requireParticipant } from './quest.service.js';

export interface CancelResult {
  matchId: string;
  matchStatus: 'cancelled';
}

export class MatchService {
  constructor(
    private readonly db: Db,
    private readonly matches: MatchRepository,
    private readonly notifier: NotificationService,
    private readonly clock: Clock,
  ) {}

  /** Either participant may cancel a generating/active match. Idempotent for cancelled matches. */
  cancel(matchId: string, userId: string): CancelResult {
    const cancelledNow = inTransaction(this.db, () => {
      const match = requireParticipant(this.matches, matchId, userId);
      if (match.status === 'cancelled') return false;
      if (match.status === 'completed') throw conflict('MATCH_ALREADY_COMPLETED', 'A completed match cannot be cancelled.');
      this.matches.cancel(matchId, userId, this.clock.now().toISOString());
      this.notifier.enqueue('match.cancelled', matchId, [match.user1Id, match.user2Id]);
      return true;
    });
    if (cancelledNow) this.notifier.kick();
    return { matchId, matchStatus: 'cancelled' };
  }
}
