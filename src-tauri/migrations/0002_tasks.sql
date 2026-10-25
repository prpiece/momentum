-- Tasks core. Small nested collections (tags, checklist, reminders, exdates) are JSON columns:
-- every query runs in memory over the Zustand store, so normalising them buys nothing.

CREATE TABLE folders (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  sort_order REAL NOT NULL DEFAULT 0,
  collapsed  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE lists (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  color      TEXT,
  emoji      TEXT,
  folder_id  TEXT REFERENCES folders(id) ON DELETE SET NULL,
  pinned     INTEGER NOT NULL DEFAULT 0,
  archived   INTEGER NOT NULL DEFAULT 0,
  tint       INTEGER NOT NULL DEFAULT 0,
  layout     TEXT NOT NULL DEFAULT 'list' CHECK (layout IN ('list', 'kanban', 'timeline')),
  sort_order REAL NOT NULL DEFAULT 0
);

INSERT INTO lists (id, name, sort_order) VALUES ('inbox', 'Inbox', -1);

CREATE TABLE sections (
  id         TEXT PRIMARY KEY,
  list_id    TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  sort_order REAL NOT NULL DEFAULT 0
);

CREATE TABLE tags (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE COLLATE NOCASE,
  color TEXT
);

CREATE TABLE tasks (
  id                   TEXT PRIMARY KEY,
  title                TEXT NOT NULL,
  description          TEXT NOT NULL DEFAULT '',
  list_id              TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  parent_id            TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  section_id           TEXT REFERENCES sections(id) ON DELETE SET NULL,
  status               TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'wont_do')),
  priority             INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 3),
  -- schedule: none (all null) | day (due_date) | timed (start_at + end_at, UTC ISO)
  due_date             TEXT,
  start_at             TEXT,
  end_at               TEXT,
  rrule                TEXT,
  exdates              TEXT NOT NULL DEFAULT '[]',
  recurrence_parent_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  tags                 TEXT NOT NULL DEFAULT '[]',
  checklist            TEXT NOT NULL DEFAULT '[]',
  reminders            TEXT NOT NULL DEFAULT '[]',
  sort_order           REAL NOT NULL DEFAULT 0,
  pinned               INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  completed_at         TEXT,
  deleted_at           TEXT
);

CREATE TABLE task_activity (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  at      TEXT NOT NULL,
  kind    TEXT NOT NULL,
  detail  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX task_activity_task ON task_activity(task_id);
