import type { QuestConstraints } from './compatibility.js';
import type { ApprovedLocation, ValidatedQuest } from './quest-rules.js';

/**
 * Hand-written, free, low-pressure quests used when the AI service is unavailable or
 * returns something we reject. Every entry is covered by a test asserting it passes the
 * same safety rules as AI output. Durations are <= 15 min, the minimum a profile allows,
 * so any fallback fits any pair.
 */
interface FallbackTemplate {
  tags: string[];
  title: string;
  description: string;
  location: ApprovedLocation;
  durationMinutes: number;
  xp: number;
}

export const FALLBACK_QUESTS: readonly FallbackTemplate[] = [
  {
    tags: ['music', 'concerts', 'singing', 'dance'],
    title: 'The Playlist Exchange',
    description:
      'Meet in a public seating area at the Nest. Each of you shares three favourite songs and explains why you picked them. Finish by agreeing on one song for a shared "SideQuest" playlist.',
    location: 'UBC Nest',
    durationMinutes: 15,
    xp: 50,
  },
  {
    tags: ['food', 'cooking', 'baking', 'coffee'],
    title: 'Dream Food Truck',
    description:
      'Grab a table at the Nest and design an imaginary food truck together: pick a name, three menu items, and a slogan. Bonus XP vibes if you can agree on a signature dessert.',
    location: 'UBC Nest',
    durationMinutes: 15,
    xp: 45,
  },
  {
    tags: ['hiking', 'nature', 'outdoors', 'gardening', 'environment'],
    title: 'Rose Garden Viewpoint Hunt',
    description:
      'Meet at the UBC Rose Garden. Together, find the spot with the best view of the mountains and take one landscape photo of it. Share your favourite trail or park you would recommend to each other.',
    location: 'UBC Rose Garden',
    durationMinutes: 15,
    xp: 45,
  },
  {
    tags: ['reading', 'books', 'writing', 'studying', 'poetry'],
    title: 'Library Recommendation Swap',
    description:
      'Meet at the Koerner Library entrance. Each of you picks a book, author, or podcast you think the other should try and pitches it in under a minute. Find one shelf section neither of you has explored.',
    location: 'Koerner Library',
    durationMinutes: 15,
    xp: 40,
  },
  {
    tags: ['art', 'photography', 'design', 'architecture', 'film'],
    title: 'Main Mall Detail Detective',
    description:
      'Walk a stretch of Main Mall together and each photograph three small architectural or artistic details most people walk past (no photos of people). Compare and pick the most interesting one.',
    location: 'Main Mall',
    durationMinutes: 15,
    xp: 45,
  },
  {
    tags: ['games', 'gaming', 'trivia', 'puzzles', 'board games', 'tech', 'coding'],
    title: 'Campus Trivia Duel',
    description:
      'Find a public table at the Irving K. Barber Learning Centre. Each write three trivia questions about your favourite game, show, or hobby, then quiz each other. Loser explains the answer they found hardest.',
    location: 'Irving K. Barber Learning Centre',
    durationMinutes: 15,
    xp: 45,
  },
  {
    tags: [],
    title: 'Two Truths and a Campus Tip',
    description:
      'Meet at Martha Piper Plaza by the fountain. Play two truths and a lie about your UBC experience so far, then each share one campus tip the other did not know.',
    location: 'Martha Piper Plaza',
    durationMinutes: 15,
    xp: 40,
  },
];

/**
 * Deterministic choice: the template whose tags overlap most with the pair's *shared*
 * interests, then with *all* their interests; ties go to list order. Falls back to the
 * generic last entry.
 */
export function pickFallbackQuest(constraints: QuestConstraints): ValidatedQuest {
  const overlap = (tags: string[], interests: string[]) => tags.filter((t) => interests.includes(t)).length;
  let best = FALLBACK_QUESTS[FALLBACK_QUESTS.length - 1] as FallbackTemplate;
  let bestScore = [0, 0];
  for (const t of FALLBACK_QUESTS) {
    const score = [overlap(t.tags, constraints.sharedInterests), overlap(t.tags, constraints.allInterests)] as const;
    if (score[0] > (bestScore[0] ?? 0) || (score[0] === bestScore[0] && score[1] > (bestScore[1] ?? 0))) {
      best = t;
      bestScore = [...score];
    }
  }
  return {
    title: best.title,
    description: best.description,
    location: best.location,
    durationMinutes: Math.min(best.durationMinutes, constraints.durationMinutes),
    xp: best.xp,
  };
}
