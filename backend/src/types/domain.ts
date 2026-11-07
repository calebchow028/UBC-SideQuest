export const COMFORT_LEVELS = ['chill', 'adventure', 'chaos'] as const;
export type ComfortLevel = (typeof COMFORT_LEVELS)[number];

export interface UserProfile {
  /** Auth0 subject (`sub` claim). Never taken from the client. */
  id: string;
  displayName: string;
  interests: string[];
  comfortLevel: ComfortLevel;
  availableMinutes: number;
  maxBudget: number;
  createdAt: string;
  updatedAt: string;
}

export type QueueEntryStatus = 'waiting' | 'matched';

export interface QueueEntry {
  id: string;
  userId: string;
  joinedAt: string;
  status: QueueEntryStatus;
  matchId: string | null;
}

export type MatchStatus = 'generating' | 'active' | 'completed' | 'cancelled';
/** Statuses in which a user is considered "busy" and cannot be matched again. */
export const OPEN_MATCH_STATUSES = ['generating', 'active'] as const satisfies readonly MatchStatus[];

export interface MatchSession {
  id: string;
  user1Id: string;
  user2Id: string;
  status: MatchStatus;
  questId: string | null;
  createdAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
}

export type QuestSource = 'maritime' | 'fallback';

export interface Quest {
  id: string;
  matchId: string;
  title: string;
  description: string;
  location: string;
  durationMinutes: number;
  xp: number;
  source: QuestSource;
  createdAt: string;
}

export interface QuestCompletion {
  matchId: string;
  userId: string;
  confirmedAt: string;
}
