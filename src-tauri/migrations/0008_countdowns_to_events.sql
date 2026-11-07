-- Countdowns become all-day calendar events (D163). A picked emoji becomes a title prefix;
-- icon keys (lowercase words) and the defaults are dropped, since events have no icon.
ALTER TABLE calendar_events ADD COLUMN countdown TEXT CHECK (countdown IN ('until', 'since'));
ALTER TABLE calendar_events ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;

INSERT INTO calendar_events (id, title, notes, start_date, span_days, color, rrule, exdates, source, countdown, pinned, created_at, updated_at)
SELECT
  id,
  CASE WHEN emoji <> '' AND emoji <> '⏳' AND emoji GLOB '*[^a-z0-9-]*' THEN emoji || ' ' || title ELSE title END,
  '',
  date,
  1,
  color,
  CASE repeat WHEN 'monthly' THEN 'FREQ=MONTHLY' WHEN 'yearly' THEN 'FREQ=YEARLY' END,
  '[]',
  'local',
  direction,
  pinned,
  created_at,
  created_at
FROM countdowns;

DROP TABLE countdowns;
