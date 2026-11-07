import { z } from 'zod';
import { COMFORT_LEVELS } from '../types/domain.js';

export const MIN_AVAILABLE_MINUTES = 15;
export const MAX_AVAILABLE_MINUTES = 240;

const interest = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'interest cannot be empty')
  .max(30, 'interest must be at most 30 characters');

/**
 * PUT /api/profile body. Unknown keys (e.g. a client-supplied `id` or `userId`) are stripped:
 * the profile id always comes from the verified token.
 */
export const profileInputSchema = z.object({
  displayName: z.string().trim().min(1).max(50),
  interests: z
    .array(interest)
    .min(1, 'pick at least one interest')
    .max(10, 'at most 10 interests')
    .transform((list) => [...new Set(list)]),
  comfortLevel: z.enum(COMFORT_LEVELS),
  availableMinutes: z.number().int().min(MIN_AVAILABLE_MINUTES).max(MAX_AVAILABLE_MINUTES),
  maxBudget: z.number().min(0).max(1000),
});
export type ProfileInput = z.infer<typeof profileInputSchema>;

export const matchIdParamSchema = z.object({
  matchId: z.string().trim().min(1).max(100),
});
