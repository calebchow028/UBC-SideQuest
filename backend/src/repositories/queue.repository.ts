import type { Db } from '../database/db.js';
import type { QueueEntry, QueueEntryStatus, UserProfile } from '../types/domain.js';
import { newId } from '../utils/ids.js';
import { type ProfileRow, toProfile } from './profile.repository.js';

interface QueueRow {
  id: string;
  user_id: string;
  joined_at: string;
  status: QueueEntryStatus;
  match_id: string | null;
}

const toEntry = (r: QueueRow): QueueEntry => ({
  id: r.id,
  userId: r.user_id,
  joinedAt: r.joined_at,
  status: r.status,
  matchId: r.match_id,
});

/** A waiting user plus what the matcher needs to score them. */
export interface WaitingCandidate {
  entry: QueueEntry;
  /** Insertion order (SQLite rowid); breaks ties between identical timestamps. */
  seq: number;
  profile: UserProfile;
}

type CandidateRow = ProfileRow & {
  q_id: string;
  q_user_id: string;
  q_joined_at: string;
  q_status: QueueEntryStatus;
  q_seq: number;
};

export class QueueRepository {
  constructor(private readonly db: Db) {}

  findWaiting(userId: string): QueueEntry | null {
    const row = this.db
      .prepare(`SELECT * FROM queue_entries WHERE user_id = ? AND status = 'waiting'`)
      .get(userId) as QueueRow | undefined;
    return row ? toEntry(row) : null;
  }

  /** Insert a waiting entry unless one already exists (keeps the original FIFO position). */
  ensureWaiting(userId: string, now: string): QueueEntry {
    this.db
      .prepare(
        `INSERT INTO queue_entries (id, user_id, joined_at, status) VALUES (?, ?, ?, 'waiting')
         ON CONFLICT(user_id) WHERE status = 'waiting' DO NOTHING`,
      )
      .run(newId('queue'), userId, now);
    return this.findWaiting(userId) as QueueEntry;
  }

  /** Returns true if a waiting entry was removed. */
  removeWaiting(userId: string): boolean {
    return this.db.prepare(`DELETE FROM queue_entries WHERE user_id = ? AND status = 'waiting'`).run(userId).changes > 0;
  }

  markMatched(userIds: string[], matchId: string): void {
    const stmt = this.db.prepare(
      `UPDATE queue_entries SET status = 'matched', match_id = ? WHERE user_id = ? AND status = 'waiting'`,
    );
    for (const id of userIds) stmt.run(matchId, id);
  }

  /** All waiting users except `excludeUserId` who are not already in an open match, in FIFO order. */
  listWaitingCandidates(excludeUserId: string): WaitingCandidate[] {
    const rows = this.db
      .prepare(
        `SELECT q.id AS q_id, q.user_id AS q_user_id, q.joined_at AS q_joined_at, q.status AS q_status,
                q.rowid AS q_seq, p.*
         FROM queue_entries q JOIN user_profiles p ON p.id = q.user_id
         WHERE q.status = 'waiting' AND q.user_id <> @exclude
           AND NOT EXISTS (
             SELECT 1 FROM match_sessions m
             WHERE m.status IN ('generating', 'active') AND q.user_id IN (m.user1_id, m.user2_id)
           )
         ORDER BY q.joined_at ASC, q.rowid ASC`,
      )
      .all({ exclude: excludeUserId }) as CandidateRow[];
    return rows.map((r) => ({
      entry: { id: r.q_id, userId: r.q_user_id, joinedAt: r.q_joined_at, status: r.q_status, matchId: null },
      seq: r.q_seq,
      profile: toProfile(r),
    }));
  }

  countForUser(userId: string, status: QueueEntryStatus): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM queue_entries WHERE user_id = ? AND status = ?')
      .get(userId, status) as { n: number };
    return row.n;
  }
}
