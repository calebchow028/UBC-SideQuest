import type { Db } from '../database/db.js';
import type { MatchSession, MatchStatus, QuestCompletion } from '../types/domain.js';

interface MatchRow {
  id: string;
  user1_id: string;
  user2_id: string;
  status: MatchStatus;
  quest_id: string | null;
  created_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
}

const toMatch = (r: MatchRow): MatchSession => ({
  id: r.id,
  user1Id: r.user1_id,
  user2Id: r.user2_id,
  status: r.status,
  questId: r.quest_id,
  createdAt: r.created_at,
  completedAt: r.completed_at,
  cancelledAt: r.cancelled_at,
  cancelledBy: r.cancelled_by,
});

export class MatchRepository {
  constructor(private readonly db: Db) {}

  findById(id: string): MatchSession | null {
    const row = this.db.prepare('SELECT * FROM match_sessions WHERE id = ?').get(id) as MatchRow | undefined;
    return row ? toMatch(row) : null;
  }

  /** The user's open (generating/active) match, if any. The schema guarantees at most one. */
  findOpenForUser(userId: string): MatchSession | null {
    const row = this.db
      .prepare(
        `SELECT * FROM match_sessions
         WHERE status IN ('generating', 'active') AND (user1_id = @u OR user2_id = @u)
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get({ u: userId }) as MatchRow | undefined;
    return row ? toMatch(row) : null;
  }

  listGeneratingWithoutQuest(): MatchSession[] {
    const rows = this.db
      .prepare(
        `SELECT m.* FROM match_sessions m
         WHERE m.status = 'generating' AND NOT EXISTS (SELECT 1 FROM quests q WHERE q.match_id = m.id)
         ORDER BY m.created_at`,
      )
      .all() as MatchRow[];
    return rows.map(toMatch);
  }

  listAll(): MatchSession[] {
    return (this.db.prepare('SELECT * FROM match_sessions ORDER BY created_at, rowid').all() as MatchRow[]).map(toMatch);
  }

  insert(match: Pick<MatchSession, 'id' | 'user1Id' | 'user2Id' | 'createdAt'>): MatchSession {
    this.db
      .prepare(`INSERT INTO match_sessions (id, user1_id, user2_id, status, created_at) VALUES (?, ?, ?, 'generating', ?)`)
      .run(match.id, match.user1Id, match.user2Id, match.createdAt);
    return this.findById(match.id) as MatchSession;
  }

  /** generating -> active. Returns false if the match is no longer generating (e.g. cancelled). */
  activate(matchId: string, questId: string): boolean {
    return (
      this.db
        .prepare(`UPDATE match_sessions SET status = 'active', quest_id = ? WHERE id = ? AND status = 'generating'`)
        .run(questId, matchId).changes > 0
    );
  }

  complete(matchId: string, now: string): boolean {
    return (
      this.db
        .prepare(`UPDATE match_sessions SET status = 'completed', completed_at = ? WHERE id = ? AND status = 'active'`)
        .run(now, matchId).changes > 0
    );
  }

  cancel(matchId: string, byUserId: string, now: string): boolean {
    return (
      this.db
        .prepare(
          `UPDATE match_sessions SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?
           WHERE id = ? AND status IN ('generating', 'active')`,
        )
        .run(now, byUserId, matchId).changes > 0
    );
  }

  /** Insert a confirmation; returns false if this user already confirmed (idempotent). */
  addCompletion(matchId: string, userId: string, now: string): boolean {
    return (
      this.db
        .prepare(`INSERT INTO quest_completions (match_id, user_id, confirmed_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`)
        .run(matchId, userId, now).changes > 0
    );
  }

  listCompletions(matchId: string): QuestCompletion[] {
    const rows = this.db
      .prepare('SELECT match_id, user_id, confirmed_at FROM quest_completions WHERE match_id = ? ORDER BY confirmed_at')
      .all(matchId) as Array<{ match_id: string; user_id: string; confirmed_at: string }>;
    return rows.map((r) => ({ matchId: r.match_id, userId: r.user_id, confirmedAt: r.confirmed_at }));
  }
}
