import type { ComfortLevel } from '../types/domain.js';
import { APPROVED_LOCATIONS } from '../domain/quest-rules.js';

/**
 * Adapter for Person 3's Maritime quest-generation agent.
 *
 * Everything that depends on Maritime's actual wire format lives in `toMaritimeRequest`
 * and `fromMaritimeResponse` below. If the agent's API differs, change only those two
 * functions; the rest of the backend works with `QuestGenerationRequest` and validates the
 * returned object with `validateAiQuest` (domain/quest-rules.ts).
 */

export interface QuestGenerationRequest {
  /** The two matched users, in match order. `maxBudget` is that user's own budget (CAD). */
  users: Array<{ interests: string[]; comfortLevel: ComfortLevel; maxBudget: number }>;
  /** Shared availability: the quest must not take longer than this. */
  durationMinutes: number;
  /** Shared budget in CAD per person: the quest must not cost more than this. */
  maxBudget: number;
}

export interface QuestGenerator {
  /** Returns the untrusted quest object (still to be validated by the caller). */
  generateQuest(request: QuestGenerationRequest): Promise<unknown>;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export class MaritimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MaritimeError';
  }
}

/**
 * Translate our request into the agent's request body.
 *
 * Person 3's agent (ai-agent/api.py, `POST /generate-quest`) expects
 * `{ student_a: { interests, budget, vibe }, student_b: { ... } }`. Our comfort level is sent as `vibe`.
 * `max_duration_minutes` and `allowed_locations` are extra hints: the agent's Pydantic model ignores
 * unknown fields, and our own validation enforces both rules regardless.
 */
export function toMaritimeRequest(req: QuestGenerationRequest): Record<string, unknown> {
  const student = (u: QuestGenerationRequest['users'][number] | undefined) =>
    u ? { interests: u.interests, budget: u.maxBudget, vibe: u.comfortLevel } : undefined;
  return {
    student_a: student(req.users[0]),
    student_b: student(req.users[1]),
    max_duration_minutes: req.durationMinutes,
    allowed_locations: [...APPROVED_LOCATIONS],
  };
}

/** XP is not produced by the agent; derive it from duration so longer quests are worth more. */
export function xpForDuration(minutes: number): number {
  return Math.min(500, Math.max(5, Math.round((minutes * 2) / 5) * 5));
}

/** Map the agent's snake_case quest (`cost`, `duration_minutes`, no `xp`) onto our quest shape. */
function normalizeQuest(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const q = raw as Record<string, unknown>;
  const durationMinutes = q.durationMinutes ?? q.duration_minutes;
  const estimatedCost = q.estimatedCost ?? q.cost;
  return {
    title: q.title,
    description: q.description,
    location: q.location,
    durationMinutes,
    xp: q.xp ?? (typeof durationMinutes === 'number' && Number.isFinite(durationMinutes) ? xpForDuration(durationMinutes) : undefined),
    ...(estimatedCost !== undefined ? { estimatedCost } : {}),
  };
}

/**
 * Translate the agent's response body into `{ title, description, location, durationMinutes, xp, estimatedCost? }`.
 * Accepts the agent's flat object, and also unwraps `{ quest: {...} }`, `{ data: {...} }`, or
 * `{ output: "<json string>" }` since agent platforms commonly wrap results.
 * The result is still untrusted: the caller validates it with `validateAiQuest`.
 */
export function fromMaritimeResponse(body: unknown): unknown {
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    for (const key of ['quest', 'data'] as const) {
      if (obj[key] && typeof obj[key] === 'object') return normalizeQuest(obj[key]);
    }
    if (typeof obj.output === 'string') {
      try {
        return normalizeQuest(JSON.parse(obj.output) as unknown);
      } catch {
        throw new MaritimeError('agent output was not valid JSON');
      }
    }
  }
  return normalizeQuest(body);
}

export interface MaritimeClientOptions {
  url: string;
  apiKey?: string | undefined;
  timeoutMs: number;
  fetch?: FetchLike;
}

export class MaritimeClient implements QuestGenerator {
  private readonly fetchImpl: FetchLike;

  constructor(private readonly opts: MaritimeClientOptions) {
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
  }

  async generateQuest(request: QuestGenerationRequest): Promise<unknown> {
    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' };
    // Server-side only: the key never leaves the backend.
    if (this.opts.apiKey) headers['x-api-key'] = this.opts.apiKey;

    let response: Response;
    let body: unknown;
    // One deadline covers connecting, headers and reading the body.
    const signal = AbortSignal.timeout(this.opts.timeoutMs);
    try {
      response = await this.fetchImpl(this.opts.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(toMaritimeRequest(request)),
        signal,
      });
      if (!response.ok) throw new MaritimeError(`agent responded with HTTP ${response.status}`);
      body = await response.json();
    } catch (err) {
      if (err instanceof MaritimeError) throw err;
      if (signal.aborted) throw new MaritimeError(`agent timed out after ${this.opts.timeoutMs}ms`);
      if (err instanceof SyntaxError) throw new MaritimeError('agent response was not valid JSON');
      throw new MaritimeError(`network error calling agent (${err instanceof Error ? err.name : 'unknown'})`);
    }
    return fromMaritimeResponse(body);
  }
}
