import type { Db } from '../database/db.js';

export interface OutboxRow {
  id: string;
  dedupe_key: string;
  event: string;
  payload: string;
  attempts: number;
  next_attempt_at: string;
  delivered_at: string | null;
  failed_at: string | null;
  last_error: string | null;
  created_at: string;
}

export class OutboxRepository {
  constructor(private readonly db: Db) {}

  /** Insert an event; a duplicate dedupe_key is ignored so each logical event is queued once. */
  insert(row: Pick<OutboxRow, 'id' | 'dedupe_key' | 'event' | 'payload' | 'created_at'>): boolean {
    return (
      this.db
        .prepare(
          `INSERT INTO notification_outbox (id, dedupe_key, event, payload, next_attempt_at, created_at)
           VALUES (@id, @dedupe_key, @event, @payload, @created_at, @created_at)
           ON CONFLICT(dedupe_key) DO NOTHING`,
        )
        .run(row).changes > 0
    );
  }

  listDue(now: string, limit: number): OutboxRow[] {
    return this.db
      .prepare(
        `SELECT * FROM notification_outbox
         WHERE delivered_at IS NULL AND failed_at IS NULL AND next_attempt_at <= ?
         ORDER BY created_at, rowid LIMIT ?`,
      )
      .all(now, limit) as OutboxRow[];
  }

  markDelivered(id: string, now: string): void {
    this.db
      .prepare('UPDATE notification_outbox SET delivered_at = ?, attempts = attempts + 1, last_error = NULL WHERE id = ?')
      .run(now, id);
  }

  markAttemptFailed(id: string, error: string, nextAttemptAt: string, giveUpAt: string | null): void {
    this.db
      .prepare(
        `UPDATE notification_outbox SET attempts = attempts + 1, last_error = ?, next_attempt_at = ?, failed_at = ?
         WHERE id = ?`,
      )
      .run(error, nextAttemptAt, giveUpAt, id);
  }

  all(): OutboxRow[] {
    return this.db.prepare('SELECT * FROM notification_outbox ORDER BY created_at, rowid').all() as OutboxRow[];
  }
}
