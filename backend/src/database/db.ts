import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Db = Database.Database;

// Resolved relative to this module so it works from both src/ (tsx, vitest) and dist/ (after build).
const SCHEMA_PATH = fileURLToPath(new URL('./schema.sql', import.meta.url));

export function openDatabase(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // If another process holds the write lock, wait up to 5s instead of failing immediately.
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
  return db;
}

/**
 * Run `fn` inside a `BEGIN IMMEDIATE` transaction. IMMEDIATE takes SQLite's write lock up
 * front, so read-then-write logic (e.g. "find a waiting user, then claim them") cannot
 * interleave with another writer — even from another process. better-sqlite3 is
 * synchronous, so within one process nothing else runs until the transaction ends.
 * Nested calls become savepoints.
 */
export function inTransaction<T>(db: Db, fn: () => T): T {
  return db.transaction(fn).immediate();
}
