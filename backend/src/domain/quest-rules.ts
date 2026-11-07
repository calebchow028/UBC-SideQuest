import { z } from 'zod';
import type { QuestConstraints } from './compatibility.js';

/**
 * Deterministic guard-rails applied to every AI-generated quest before it is stored.
 * Anything that fails is replaced by a predefined fallback quest (see fallback-quests.ts).
 */

/** Public, free-to-enter UBC Vancouver campus spots. Quests must use one of these. */
export const APPROVED_LOCATIONS = [
  'UBC Nest',
  'Irving K. Barber Learning Centre',
  'Koerner Library',
  'Main Mall',
  'Martha Piper Plaza',
  'UBC Rose Garden',
  'Buchanan Courtyard',
  'UBC Life Building',
  'UBC Bookstore',
  'Orchard Commons',
] as const;
export type ApprovedLocation = (typeof APPROVED_LOCATIONS)[number];

const LOCATION_ALIASES: Record<string, ApprovedLocation> = {
  nest: 'UBC Nest',
  'the nest': 'UBC Nest',
  'ams nest': 'UBC Nest',
  'ams student nest': 'UBC Nest',
  ikb: 'Irving K. Barber Learning Centre',
  ikblc: 'Irving K. Barber Learning Centre',
  'irving k barber': 'Irving K. Barber Learning Centre',
  'irving k barber library': 'Irving K. Barber Learning Centre',
  'walter c koerner library': 'Koerner Library',
  'rose garden': 'UBC Rose Garden',
  'the rose garden': 'UBC Rose Garden',
  'life building': 'UBC Life Building',
  'the life building': 'UBC Life Building',
  'buchanan courtyard': 'Buchanan Courtyard',
  'ubc main mall': 'Main Mall',
};

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[.,'’()\-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const NORMALIZED_LOOKUP = new Map<string, ApprovedLocation>([
  ...APPROVED_LOCATIONS.map((l) => [normalize(l), l] as const),
  ...Object.entries(LOCATION_ALIASES).map(([alias, l]) => [normalize(alias), l] as const),
]);

/** Exact (normalised) match against the approved list or a known alias; returns the canonical name. */
export function resolveApprovedLocation(location: string): ApprovedLocation | null {
  return NORMALIZED_LOOKUP.get(normalize(location)) ?? null;
}

/**
 * Word patterns that make a quest unsuitable: substances, danger, private/off-campus
 * places, romance/intimacy, harassment, and requests for personal information.
 */
const UNSAFE_PATTERNS: ReadonlyArray<{ rule: string; pattern: RegExp }> = [
  { rule: 'alcohol', pattern: /\b(alcohol|beer|wine|vodka|liquor|booze|drunk|bar ?crawl|pub crawl|keg)\b/i },
  { rule: 'drugs', pattern: /\b(drugs?|weed|cannabis|marijuana|edibles?|vap(e|ing)|smok(e|ing)|get high)\b/i },
  { rule: 'weapons-fire', pattern: /\b(weapons?|knife|knives|guns?|fireworks?|lighter|set fire|arson|explosives?)\b/i },
  { rule: 'trespass-danger', pattern: /\b(trespass\w*|break into|roofs?|rooftops?|climb\w*|construction site|tunnels?|cliffs?|swim\w*|ocean|wreck beach)\b/i },
  { rule: 'illegal', pattern: /\b(steal\w*|shoplift\w*|vandal\w*|graffiti|illegal|gambl\w*)\b/i },
  { rule: 'private-places', pattern: /\b(dorm room|bedroom|your room|their room|residence room|apartment|house party|someone'?s (house|home|place)|off[- ]campus|in a car|drive to|uber)\b/i },
  { rule: 'romance-intimacy', pattern: /\b(kiss\w*|hook ?up|romantic|flirt\w*|naked|nude|strip(ping|per|tease)?|cuddl\w*|sexy|sexual)\b/i },
  { rule: 'late-night', pattern: /\b(midnight|after dark|late at night|at night|3 ?am)\b/i },
  { rule: 'pressure-harassment', pattern: /\b(dares?|pranks?|strangers?'? (phone|bag)|follow (someone|a stranger)|harass\w*|bully\w*|humiliat\w*)\b/i },
  { rule: 'personal-info', pattern: /\b(phone numbers?|home address|student (id|number)|passwords?|credit card|bank account|social insurance|sin number)\b/i },
];

const SPENDING_PATTERN = /\b(buy|buying|purchase|pay|paying|order (a|an|some|food|drinks?)|spend|spending|cost|costs|tickets?)\b|\$\s?\d/i;

export function findUnsafeContent(text: string): string | null {
  for (const { rule, pattern } of UNSAFE_PATTERNS) if (pattern.test(text)) return rule;
  return null;
}

/** Shape we expect from the AI service (after adapter translation). */
export const aiQuestSchema = z.object({
  title: z.string().trim().min(3).max(80),
  description: z.string().trim().min(10).max(1000),
  location: z.string().trim().min(2).max(120),
  durationMinutes: z.number().int().min(5).max(240),
  xp: z.number().int().min(5).max(500),
  /** Optional estimated cost per person in CAD. Treated as 0 if omitted. */
  estimatedCost: z.number().min(0).optional(),
});
export type AiQuest = z.infer<typeof aiQuestSchema>;

export interface ValidatedQuest {
  title: string;
  description: string;
  location: ApprovedLocation;
  durationMinutes: number;
  xp: number;
}

export class QuestRejectedError extends Error {
  constructor(public readonly reason: string) {
    super(`Quest rejected: ${reason}`);
    this.name = 'QuestRejectedError';
  }
}

/** Validate an untrusted AI payload against schema + safety + pair constraints. Throws QuestRejectedError. */
export function validateAiQuest(raw: unknown, constraints: QuestConstraints): ValidatedQuest {
  const parsed = aiQuestSchema.safeParse(raw);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.') || '(root)').join(', ');
    throw new QuestRejectedError(`invalid shape (${fields})`);
  }
  const quest = parsed.data;

  const location = resolveApprovedLocation(quest.location);
  if (!location) throw new QuestRejectedError('location not on the approved list');

  if (quest.durationMinutes > constraints.durationMinutes) {
    throw new QuestRejectedError(`duration ${quest.durationMinutes}m exceeds shared availability ${constraints.durationMinutes}m`);
  }

  const cost = quest.estimatedCost ?? 0;
  if (cost > constraints.maxBudget) throw new QuestRejectedError('estimated cost exceeds shared budget');

  const text = `${quest.title}\n${quest.description}`;
  const unsafe = findUnsafeContent(text);
  if (unsafe) throw new QuestRejectedError(`unsafe content (${unsafe})`);

  // With a $0 shared budget, the quest must not ask anyone to spend money.
  if (constraints.maxBudget === 0 && SPENDING_PATTERN.test(text)) {
    throw new QuestRejectedError('requires spending money but shared budget is $0');
  }

  return {
    title: quest.title,
    description: quest.description,
    location,
    durationMinutes: quest.durationMinutes,
    xp: quest.xp,
  };
}
