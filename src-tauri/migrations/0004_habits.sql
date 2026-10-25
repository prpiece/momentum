-- Habits. goal / frequency / reminders are small JSON blobs validated in src/db/habitRows.ts.
CREATE TABLE habit_groups (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  sort_order REAL NOT NULL DEFAULT 0
);

CREATE TABLE habits (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  icon       TEXT NOT NULL DEFAULT '✅',
  color      TEXT NOT NULL DEFAULT '#5b5bd6',
  goal       TEXT NOT NULL DEFAULT '{"kind":"once"}',
  frequency  TEXT NOT NULL DEFAULT '{"kind":"daily"}',
  reminders  TEXT NOT NULL DEFAULT '[]',
  group_id   TEXT REFERENCES habit_groups(id) ON DELETE SET NULL,
  sort_order REAL NOT NULL DEFAULT 0,
  archived   INTEGER NOT NULL DEFAULT 0,
  start_date TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE habit_checkins (
  habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  date     TEXT NOT NULL,
  value    REAL NOT NULL DEFAULT 0,
  note     TEXT NOT NULL DEFAULT '',
  mood     INTEGER CHECK (mood BETWEEN 1 AND 5),
  PRIMARY KEY (habit_id, date)
);
