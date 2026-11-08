import type { Db } from '../database/db.js';
import type { ComfortLevel, UserProfile } from '../types/domain.js';

export interface ProfileRow {
  id: string;
  display_name: string;
  interests: string;
  comfort_level: ComfortLevel;
  available_minutes: number;
  max_budget: number;
  created_at: string;
  updated_at: string;
}

export const toProfile = (r: ProfileRow): UserProfile => ({
  id: r.id,
  displayName: r.display_name,
  interests: JSON.parse(r.interests) as string[],
  comfortLevel: r.comfort_level,
  availableMinutes: r.available_minutes,
  maxBudget: r.max_budget,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export type ProfileFields = Omit<UserProfile, 'id' | 'createdAt' | 'updatedAt'>;

export class ProfileRepository {
  constructor(private readonly db: Db) {}

  findById(id: string): UserProfile | null {
    const row = this.db.prepare('SELECT * FROM user_profiles WHERE id = ?').get(id) as ProfileRow | undefined;
    return row ? toProfile(row) : null;
  }

  upsert(id: string, fields: ProfileFields, now: string): UserProfile {
    this.db
      .prepare(
        `INSERT INTO user_profiles (id, display_name, interests, comfort_level, available_minutes, max_budget, created_at, updated_at)
         VALUES (@id, @displayName, @interests, @comfortLevel, @availableMinutes, @maxBudget, @now, @now)
         ON CONFLICT(id) DO UPDATE SET
           display_name = excluded.display_name,
           interests = excluded.interests,
           comfort_level = excluded.comfort_level,
           available_minutes = excluded.available_minutes,
           max_budget = excluded.max_budget,
           updated_at = excluded.updated_at`,
      )
      .run({ id, ...fields, interests: JSON.stringify(fields.interests), now });
    return this.findById(id) as UserProfile;
  }

  /** Completed-quest stats for the profile screen. */
  stats(id: string): { completedQuests: number; totalXp: number } {
    return this.db
      .prepare(
        `SELECT COUNT(*) AS completedQuests, COALESCE(SUM(q.xp), 0) AS totalXp
         FROM match_sessions m JOIN quests q ON q.match_id = m.id
         WHERE m.status = 'completed' AND (m.user1_id = @id OR m.user2_id = @id)`,
      )
      .get({ id }) as { completedQuests: number; totalXp: number };
  }
}
