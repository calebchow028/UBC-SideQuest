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
  users: Array<{ interests: string[]; comfortLevel: ComfortLevel }>;
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

/** Translate our request into the agent's request body. */
export function toMaritimeRequest(req: QuestGenerationRequest): Record<string, unknown> {
  return {
    users: req.users.map((u) => ({ interests: u.interests, comfortLevel: u.comfortLevel })),
    durationMinutes: req.durationMinutes,
    maxBudget: req.maxBudget,
    // Extra hints so the agent can satisfy our validation rules up front.
    allowedLocations: [...APPROVED_LOCATIONS],
  };
}

/**
 * Translate the agent's response body into `{ title, description, location, durationMinutes, xp }`.
 * Accepts the documented flat object, and also unwraps `{ quest: {...} }`, `{ data: {...} }`, or
 * `{ output: "<json string>" }` since agent platforms commonly wrap results.
 */
export function fromMaritimeResponse(body: unknown): unknown {
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    for (const key of ['quest', 'data'] as const) {
      if (obj[key] && typeof obj[key] === 'object') return obj[key];
    }
    if (typeof obj.output === 'string') {
      try {
        return JSON.parse(obj.output) as unknown;
      } catch {
        throw new MaritimeError('agent output was not valid JSON');
      }
    }
  }
  return body;
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
    if (this.opts.apiKey) headers.authorization = `Bearer ${this.opts.apiKey}`;

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
