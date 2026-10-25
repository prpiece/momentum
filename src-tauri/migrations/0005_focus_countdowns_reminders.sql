CREATE TABLE countdowns (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  date       TEXT NOT NULL,
  direction  TEXT NOT NULL DEFAULT 'until' CHECK (direction IN ('until', 'since')),
  repeat     TEXT NOT NULL DEFAULT 'none' CHECK (repeat IN ('none', 'monthly', 'yearly')),
  emoji      TEXT NOT NULL DEFAULT '⏳',
  color      TEXT NOT NULL DEFAULT '#5b5bd6',
  pinned     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE focus_sessions (
  id       TEXT PRIMARY KEY,
  task_id  TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  mode     TEXT NOT NULL CHECK (mode IN ('pomodoro', 'stopwatch')),
  start_at TEXT NOT NULL,
  end_at   TEXT NOT NULL,
  seconds  INTEGER NOT NULL
);

-- One row per reminder that has fired, so each fires once (also across restarts), plus snoozes.
CREATE TABLE reminder_log (
  key          TEXT PRIMARY KEY,
  fired_at     TEXT NOT NULL,
  snooze_until TEXT,
  payload      TEXT NOT NULL
);
