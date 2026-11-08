import type { Db } from '../database/db.js';
import type { Quest, QuestSource } from '../types/domain.js';

interface QuestRow {
  id: string;
  match_id: string;
  title: string;
  description: string;
  location: string;
  duration_minutes: number;
  xp: number;
  source: QuestSource;
  created_at: string;
}

const toQuest = (r: QuestRow): Quest => ({
  id: r.id,
  matchId: r.match_id,
  title: r.title,
  description: r.description,
  location: r.location,
  durationMinutes: r.duration_minutes,
  xp: r.xp,
  source: r.source,
  createdAt: r.created_at,
});

export class QuestRepository {
  constructor(private readonly db: Db) {}

  findByMatchId(matchId: string): Quest | null {
    const row = this.db.prepare('SELECT * FROM quests WHERE match_id = ?').get(matchId) as QuestRow | undefined;
    return row ? toQuest(row) : null;
  }

  /** Insert the match's quest. Returns false if one already exists (UNIQUE(match_id)). */
  insert(q: Quest): boolean {
    return (
      this.db
        .prepare(
          `INSERT INTO quests (id, match_id, title, description, location, duration_minutes, xp, source, created_at)
           VALUES (@id, @matchId, @title, @description, @location, @durationMinutes, @xp, @source, @createdAt)
           ON CONFLICT(match_id) DO NOTHING`,
        )
        .run(q).changes > 0
    );
  }

  countForMatch(matchId: string): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM quests WHERE match_id = ?').get(matchId) as { n: number }).n;
  }
}
