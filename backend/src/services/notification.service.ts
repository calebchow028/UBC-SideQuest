import type { Db } from '../database/db.js';
import { OutboxRepository, type OutboxRow } from '../repositories/outbox.repository.js';
import type { Clock } from '../utils/clock.js';
import { newId } from '../utils/ids.js';
import type { Logger } from '../utils/logger.js';
import type { FetchLike } from './maritime.service.js';

export type NotificationEventName = 'match.created' | 'quest.created' | 'quest.completed' | 'match.cancelled';

/**
 * Body POSTed to the n8n webhook. Deliberately minimal: Auth0 user ids only (n8n can look
 * up emails via the Auth0 Management API), no display names, interests or other profile data.
 */
export interface NotificationPayload {
  event: NotificationEventName;
  eventId: string;
  matchId: string;
  userIds: string[];
  timestamp: string;
  data?: Record<string, string | number | boolean | null>;
}

export interface NotificationServiceOptions {
  db: Db;
  webhookUrl: string | undefined;
  secret: string | undefined;
  timeoutMs: number;
  maxAttempts: number;
  clock: Clock;
  logger: Logger;
  fetch?: FetchLike;
}

export interface FlushResult {
  delivered: number;
  failed: number;
}

const BASE_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 10 * 60_000;
const BATCH_SIZE = 20;

/**
 * Transactional outbox for n8n.
 *
 * 1. `enqueue()` is called *inside* the same DB transaction as the state change, so an event
 *    exists if and only if the change committed.
 * 2. `flush()` delivers due events with a timeout. Failures are recorded and retried with
 *    exponential backoff (5s, 10s, 20s ... capped at 10 min) up to `maxAttempts`.
 * 3. Each event has a stable `eventId`, sent as the `Idempotency-Key` header, so n8n can
 *    drop duplicates if a delivery succeeded but our acknowledgement was lost.
 *
 * Delivery never throws into callers, so a broken webhook cannot affect matchmaking.
 */
export class NotificationService {
  private readonly outbox: OutboxRepository;
  private readonly fetchImpl: FetchLike;
  private current: Promise<FlushResult> | null = null;

  constructor(private readonly opts: NotificationServiceOptions) {
    this.outbox = new OutboxRepository(opts.db);
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
  }

  get enabled(): boolean {
    return Boolean(this.opts.webhookUrl);
  }

  /** Queue an event. Must be called inside the caller's transaction. No-op when n8n is not configured. */
  enqueue(event: NotificationEventName, matchId: string, userIds: string[], data?: NotificationPayload['data']): void {
    if (!this.enabled) return;
    const now = this.opts.clock.now().toISOString();
    const eventId = newId('evt');
    const payload: NotificationPayload = { event, eventId, matchId, userIds, timestamp: now, ...(data ? { data } : {}) };
    // dedupe_key makes each logical event (e.g. "match X was created") unique even if code paths retry.
    this.outbox.insert({ id: eventId, dedupe_key: `${event}:${matchId}`, event, payload: JSON.stringify(payload), created_at: now });
  }

  /** Start a background flush without waiting for it. */
  kick(): void {
    if (!this.enabled) return;
    this.flush().catch((err: unknown) => this.opts.logger.error('outbox flush crashed', { error: String(err) }));
  }

  /** Deliver all due events. Concurrent callers share the same in-progress flush. */
  flush(): Promise<FlushResult> {
    if (!this.enabled) return Promise.resolve({ delivered: 0, failed: 0 });
    this.current ??= this.runFlush().finally(() => {
      this.current = null;
    });
    return this.current;
  }

  /** Resolves once any in-progress flush finishes (used for graceful shutdown and tests). */
  async whenIdle(): Promise<void> {
    if (this.current) await this.current.catch(() => undefined);
  }

  private async runFlush(): Promise<FlushResult> {
    const result: FlushResult = { delivered: 0, failed: 0 };
    const attempted = new Set<string>();
    for (;;) {
      const due = this.outbox
        .listDue(this.opts.clock.now().toISOString(), BATCH_SIZE)
        .filter((row) => !attempted.has(row.id));
      if (due.length === 0) return result;
      for (const row of due) {
        attempted.add(row.id);
        if (await this.deliver(row)) result.delivered++;
        else result.failed++;
      }
    }
  }

  private async deliver(row: OutboxRow): Promise<boolean> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'idempotency-key': row.id,
      'x-sidequest-event': row.event,
    };
    // Shared secret for n8n "Header Auth". Never logged.
    if (this.opts.secret) headers['x-sidequest-secret'] = this.opts.secret;

    let error: string | null = null;
    try {
      const res = await this.fetchImpl(this.opts.webhookUrl as string, {
        method: 'POST',
        headers,
        body: row.payload,
        signal: AbortSignal.timeout(this.opts.timeoutMs),
      });
      // Drain the body so the connection can be reused.
      await res.arrayBuffer().catch(() => undefined);
      if (!res.ok) error = `HTTP ${res.status}`;
    } catch (err) {
      error = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError') ? 'timeout' : 'network error';
    }

    const now = this.opts.clock.now();
    if (error === null) {
      this.outbox.markDelivered(row.id, now.toISOString());
      return true;
    }
    const attempts = row.attempts + 1;
    const giveUp = attempts >= this.opts.maxAttempts;
    const backoff = Math.min(BASE_BACKOFF_MS * 2 ** (attempts - 1), MAX_BACKOFF_MS);
    this.outbox.markAttemptFailed(
      row.id,
      error,
      new Date(now.getTime() + backoff).toISOString(),
      giveUp ? now.toISOString() : null,
    );
    // Log the event id and reason only: no URL, secret, or payload.
    this.opts.logger.warn('n8n webhook delivery failed', { eventId: row.id, event: row.event, attempts, error, gaveUp: giveUp });
    return false;
  }
}
