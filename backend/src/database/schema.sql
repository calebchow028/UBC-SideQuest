-- UBC SideQuest schema. Idempotent: safe to run on every startup.
-- Timestamps are ISO-8601 UTC strings. Interests are stored as a JSON array.

CREATE TABLE IF NOT EXISTS user_profiles (
  id                TEXT PRIMARY KEY,                -- Auth0 `sub`
  display_name      TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 50),
  interests         TEXT NOT NULL CHECK (json_valid(interests) AND json_type(interests) = 'array'),
  comfort_level     TEXT NOT NULL CHECK (comfort_level IN ('chill', 'adventure', 'chaos')),
  available_minutes INTEGER NOT NULL CHECK (available_minutes > 0),
  max_budget        REAL NOT NULL CHECK (max_budget >= 0),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS match_sessions (
  id           TEXT PRIMARY KEY,
  user1_id     TEXT NOT NULL REFERENCES user_profiles(id),
  user2_id     TEXT NOT NULL REFERENCES user_profiles(id),
  status       TEXT NOT NULL CHECK (status IN ('generating', 'active', 'completed', 'cancelled')),
  quest_id     TEXT,
  created_at   TEXT NOT NULL,
  completed_at TEXT,
  cancelled_at TEXT,
  cancelled_by TEXT,
  CHECK (user1_id <> user2_id)                       -- nobody is matched with themselves
);
CREATE INDEX IF NOT EXISTS ix_match_user1 ON match_sessions(user1_id, status);
CREATE INDEX IF NOT EXISTS ix_match_user2 ON match_sessions(user2_id, status);

-- A user may be in at most one open (generating/active) session at a time.
CREATE TRIGGER IF NOT EXISTS trg_match_no_double_booking
BEFORE INSERT ON match_sessions
WHEN NEW.status IN ('generating', 'active')
BEGIN
  SELECT RAISE(ABORT, 'USER_ALREADY_IN_OPEN_MATCH')
  WHERE EXISTS (
    SELECT 1 FROM match_sessions m
    WHERE m.status IN ('generating', 'active')
      AND (m.user1_id IN (NEW.user1_id, NEW.user2_id) OR m.user2_id IN (NEW.user1_id, NEW.user2_id))
  );
END;

-- completed / cancelled are terminal states.
CREATE TRIGGER IF NOT EXISTS trg_match_terminal_status
BEFORE UPDATE OF status ON match_sessions
WHEN OLD.status IN ('completed', 'cancelled') AND NEW.status <> OLD.status
BEGIN
  SELECT RAISE(ABORT, 'MATCH_STATUS_TERMINAL');
END;

CREATE TABLE IF NOT EXISTS queue_entries (
  id        TEXT PRIMARY KEY,
  user_id   TEXT NOT NULL REFERENCES user_profiles(id),
  joined_at TEXT NOT NULL,
  status    TEXT NOT NULL CHECK (status IN ('waiting', 'matched')),
  match_id  TEXT REFERENCES match_sessions(id),
  CHECK ((status = 'waiting' AND match_id IS NULL) OR (status = 'matched' AND match_id IS NOT NULL))
);
-- At most one *waiting* entry per user. Matched entries are kept as history.
CREATE UNIQUE INDEX IF NOT EXISTS ux_queue_one_waiting_per_user ON queue_entries(user_id) WHERE status = 'waiting';
CREATE INDEX IF NOT EXISTS ix_queue_status_joined ON queue_entries(status, joined_at);

CREATE TABLE IF NOT EXISTS quests (
  id               TEXT PRIMARY KEY,
  match_id         TEXT NOT NULL UNIQUE REFERENCES match_sessions(id),  -- exactly one quest per match
  title            TEXT NOT NULL,
  description      TEXT NOT NULL,
  location         TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  xp               INTEGER NOT NULL CHECK (xp >= 0),
  source           TEXT NOT NULL CHECK (source IN ('maritime', 'fallback')),
  created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quest_completions (
  match_id     TEXT NOT NULL REFERENCES match_sessions(id),
  user_id      TEXT NOT NULL,
  confirmed_at TEXT NOT NULL,
  PRIMARY KEY (match_id, user_id)                    -- one confirmation per participant
);

-- Only the two participants of a match can confirm it.
CREATE TRIGGER IF NOT EXISTS trg_completion_participant
BEFORE INSERT ON quest_completions
BEGIN
  SELECT RAISE(ABORT, 'NOT_A_PARTICIPANT')
  WHERE NOT EXISTS (
    SELECT 1 FROM match_sessions m WHERE m.id = NEW.match_id AND NEW.user_id IN (m.user1_id, m.user2_id)
  );
END;

-- Transactional outbox for n8n webhook events. Rows are written in the same
-- transaction as the state change they describe, then delivered asynchronously
-- with retries. `id` doubles as the idempotency key sent to n8n.
CREATE TABLE IF NOT EXISTS notification_outbox (
  id              TEXT PRIMARY KEY,
  dedupe_key      TEXT NOT NULL UNIQUE,              -- e.g. 'match.created:match_123'
  event           TEXT NOT NULL,
  payload         TEXT NOT NULL,                     -- JSON body sent to n8n
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  delivered_at    TEXT,
  failed_at       TEXT,                              -- set when we give up after max attempts
  last_error      TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_outbox_due ON notification_outbox(delivered_at, failed_at, next_attempt_at);
