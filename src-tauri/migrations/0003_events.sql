-- Standalone calendar events (not tasks). Same schedule encoding as tasks:
-- all-day = start_date + span_days, timed = start_at/end_at (UTC ISO).
CREATE TABLE calendar_events (
  id                   TEXT PRIMARY KEY,
  title                TEXT NOT NULL,
  notes                TEXT NOT NULL DEFAULT '',
  start_date           TEXT,
  span_days            INTEGER NOT NULL DEFAULT 1,
  start_at             TEXT,
  end_at               TEXT,
  color                TEXT,
  rrule                TEXT,
  exdates              TEXT NOT NULL DEFAULT '[]',
  recurrence_parent_id TEXT REFERENCES calendar_events(id) ON DELETE SET NULL,
  source               TEXT NOT NULL DEFAULT 'local' CHECK (source IN ('local', 'ics')),
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  deleted_at           TEXT
);
