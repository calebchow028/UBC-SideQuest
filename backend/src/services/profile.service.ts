import { ProfileRepository } from '../repositories/profile.repository.js';
import type { ProfileInput } from '../schemas/api.schemas.js';
import type { UserProfile } from '../types/domain.js';
import type { Clock } from '../utils/clock.js';
import { notFound } from '../utils/errors.js';

export interface ProfileView extends UserProfile {
  stats: { completedQuests: number; totalXp: number };
}

export class ProfileService {
  constructor(
    private readonly profiles: ProfileRepository,
    private readonly clock: Clock,
  ) {}

  get(userId: string): ProfileView {
    const profile = this.profiles.findById(userId);
    if (!profile) throw notFound('PROFILE_NOT_FOUND', 'No profile yet. Create one with PUT /api/profile.');
    return { ...profile, stats: this.profiles.stats(userId) };
  }

  /** `userId` must be the verified token subject, never a value from the request body. */
  upsert(userId: string, input: ProfileInput): ProfileView {
    this.profiles.upsert(userId, input, this.clock.now().toISOString());
    return this.get(userId);
  }
}
