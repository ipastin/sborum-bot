-- sborum-bot D1 schema (logical schema version 3).
-- Booleans are stored as INTEGER (0/1). Dates/times are compared as strings in
-- the app (YYYY-MM-DD, ISO-8601 UTC), so they are stored as TEXT. chat_id and
-- user_id are TEXT because the code consistently coerces them with String().

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO meta (key, value) VALUES ('schema_version', '3');

CREATE TABLE events (
  id                  TEXT PRIMARY KEY,
  type                TEXT NOT NULL,            -- 'one_time' | 'recurring'
  chat_id             TEXT NOT NULL,
  message_thread_id   INTEGER,                  -- Telegram topic id, nullable
  created_by          TEXT NOT NULL,
  title               TEXT NOT NULL,
  start_date          TEXT NOT NULL,            -- 'YYYY-MM-DD'
  interval_days       INTEGER,                  -- NULL for one_time
  publish_days_before INTEGER NOT NULL,
  publish_time        TEXT NOT NULL,            -- 'HH:MM'
  poll_duration_hours REAL NOT NULL,            -- may be fractional
  quorum_count        INTEGER NOT NULL,
  timezone            TEXT NOT NULL,            -- IANA tz
  active              INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL,            -- ISO
  updated_at          TEXT NOT NULL             -- ISO
);
CREATE INDEX idx_events_active ON events(active);
CREATE INDEX idx_events_chat   ON events(chat_id);

CREATE TABLE polls (
  poll_id             TEXT PRIMARY KEY,         -- Telegram poll id
  event_id            TEXT,                     -- nullable if the event was deleted
  message_id          INTEGER NOT NULL,         -- poll message id (for stopPoll / replies)
  reminder_message_id INTEGER,
  chat_id             TEXT NOT NULL,
  message_thread_id   INTEGER,
  event_date          TEXT NOT NULL,            -- 'YYYY-MM-DD'
  created_at          TEXT NOT NULL,            -- ISO
  close_at            TEXT NOT NULL,            -- ISO
  closed              INTEGER NOT NULL DEFAULT 0,
  closed_at           TEXT,
  quorum_state        TEXT NOT NULL DEFAULT 'below',
  manual              INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL
);
CREATE INDEX idx_polls_open      ON polls(closed, close_at);
CREATE INDEX idx_polls_chat_open ON polls(chat_id, closed, created_at);

CREATE TABLE poll_votes (
  poll_id      TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  option_id    INTEGER NOT NULL,                -- 0=✅ Буду, 1=❌ Не смогу, 2=🤔 Пока не знаю
  display_name TEXT NOT NULL,
  updated_at   TEXT NOT NULL,                   -- ISO
  PRIMARY KEY (poll_id, user_id),
  FOREIGN KEY (poll_id) REFERENCES polls(poll_id) ON DELETE CASCADE
);

CREATE TABLE published_events (
  event_id     TEXT NOT NULL,
  event_date   TEXT NOT NULL,                   -- 'YYYY-MM-DD'
  poll_id      TEXT,                            -- NULL while a publish is claimed but not yet sent
  published_at TEXT NOT NULL,                   -- ISO
  PRIMARY KEY (event_id, event_date)            -- the `${eventId}:${date}` dedup key / publish mutex
);

CREATE TABLE sessions (
  session_key       TEXT PRIMARY KEY,           -- `${chatId}:${userId}`
  mode              TEXT NOT NULL,              -- 'create' | 'edit' | 'change_type_to_recurring'
  event_type        TEXT,
  user_id           TEXT NOT NULL,
  chat_id           TEXT NOT NULL,
  thread_id         INTEGER,
  fields_json       TEXT,                       -- JSON array of wizard field names (create mode)
  values_json       TEXT,                       -- JSON object of collected values (create mode)
  idx               INTEGER,                    -- current wizard step index (create mode)
  event_id          TEXT,                       -- target event (edit / change_type modes)
  field             TEXT,                       -- field currently being asked
  prompt_message_id INTEGER,                    -- force_reply correlation token
  updated_at        TEXT NOT NULL               -- ISO, for TTL cleanup
);
CREATE INDEX idx_sessions_updated ON sessions(updated_at);
