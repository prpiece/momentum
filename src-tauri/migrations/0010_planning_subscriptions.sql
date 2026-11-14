-- Planning fields and calendar subscriptions (v1.3, PLAN D267, D263).
-- tasks.someday marks the Someday planned date (only when due_date/start_at are null);
-- tasks.waiting is null or a JSON Waiting-for object validated in src/db/rows.ts.
ALTER TABLE tasks ADD COLUMN deadline TEXT;
ALTER TABLE tasks ADD COLUMN duration_min INTEGER;
ALTER TABLE tasks ADD COLUMN someday INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN waiting TEXT;

-- A subscribed calendar's events are read-only 'ics' events tagged with their subscription.
ALTER TABLE calendar_events ADD COLUMN subscription_id TEXT;

CREATE TABLE calendar_subscriptions (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  url          TEXT NOT NULL,
  color        TEXT,
  sort_order   REAL NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  deleted_at   TEXT
);

-- Generated: node scripts/sync-triggers.mjs 9 <this file's head>, for the tables above.
DROP TRIGGER sync_ins_tasks;
DROP TRIGGER sync_upd_tasks;
DROP TRIGGER sync_del_tasks;
DROP TRIGGER sync_ins_calendar_events;
DROP TRIGGER sync_upd_calendar_events;
DROP TRIGGER sync_del_calendar_events;

CREATE TRIGGER sync_ins_tasks AFTER INSERT ON tasks WHEN (SELECT value FROM sync_state WHERE key = 'record') = '1' BEGIN
  INSERT INTO sync_outbox (tbl, row_id, fields, created_at) VALUES ('tasks', NEW.id, json_object('id', NEW.id, 'title', NEW.title, 'description', NEW.description, 'list_id', NEW.list_id, 'parent_id', NEW.parent_id, 'section_id', NEW.section_id, 'status', NEW.status, 'priority', NEW.priority, 'due_date', NEW.due_date, 'start_at', NEW.start_at, 'end_at', NEW.end_at, 'rrule', NEW.rrule, 'exdates', NEW.exdates, 'recurrence_parent_id', NEW.recurrence_parent_id, 'tags', NEW.tags, 'checklist', NEW.checklist, 'reminders', NEW.reminders, 'sort_order', NEW.sort_order, 'pinned', NEW.pinned, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'completed_at', NEW.completed_at, 'deleted_at', NEW.deleted_at, 'deadline', NEW.deadline, 'duration_min', NEW.duration_min, 'someday', NEW.someday, 'waiting', NEW.waiting), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;

CREATE TRIGGER sync_upd_tasks AFTER UPDATE ON tasks WHEN (SELECT value FROM sync_state WHERE key = 'record') = '1' BEGIN
  INSERT INTO sync_outbox (tbl, row_id, fields, created_at)
  SELECT 'tasks', NEW.id, f, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM (SELECT json_group_object(k, v) AS f FROM (
      SELECT 'id' AS k, NEW.id AS v WHERE OLD.id IS NOT NEW.id
      UNION ALL SELECT 'title' AS k, NEW.title AS v WHERE OLD.title IS NOT NEW.title
      UNION ALL SELECT 'description' AS k, NEW.description AS v WHERE OLD.description IS NOT NEW.description
      UNION ALL SELECT 'list_id' AS k, NEW.list_id AS v WHERE OLD.list_id IS NOT NEW.list_id
      UNION ALL SELECT 'parent_id' AS k, NEW.parent_id AS v WHERE OLD.parent_id IS NOT NEW.parent_id
      UNION ALL SELECT 'section_id' AS k, NEW.section_id AS v WHERE OLD.section_id IS NOT NEW.section_id
      UNION ALL SELECT 'status' AS k, NEW.status AS v WHERE OLD.status IS NOT NEW.status
      UNION ALL SELECT 'priority' AS k, NEW.priority AS v WHERE OLD.priority IS NOT NEW.priority
      UNION ALL SELECT 'due_date' AS k, NEW.due_date AS v WHERE OLD.due_date IS NOT NEW.due_date
      UNION ALL SELECT 'start_at' AS k, NEW.start_at AS v WHERE OLD.start_at IS NOT NEW.start_at
      UNION ALL SELECT 'end_at' AS k, NEW.end_at AS v WHERE OLD.end_at IS NOT NEW.end_at
      UNION ALL SELECT 'rrule' AS k, NEW.rrule AS v WHERE OLD.rrule IS NOT NEW.rrule
      UNION ALL SELECT 'exdates' AS k, NEW.exdates AS v WHERE OLD.exdates IS NOT NEW.exdates
      UNION ALL SELECT 'recurrence_parent_id' AS k, NEW.recurrence_parent_id AS v WHERE OLD.recurrence_parent_id IS NOT NEW.recurrence_parent_id
      UNION ALL SELECT 'tags' AS k, NEW.tags AS v WHERE OLD.tags IS NOT NEW.tags
      UNION ALL SELECT 'checklist' AS k, NEW.checklist AS v WHERE OLD.checklist IS NOT NEW.checklist
      UNION ALL SELECT 'reminders' AS k, NEW.reminders AS v WHERE OLD.reminders IS NOT NEW.reminders
      UNION ALL SELECT 'sort_order' AS k, NEW.sort_order AS v WHERE OLD.sort_order IS NOT NEW.sort_order
      UNION ALL SELECT 'pinned' AS k, NEW.pinned AS v WHERE OLD.pinned IS NOT NEW.pinned
      UNION ALL SELECT 'created_at' AS k, NEW.created_at AS v WHERE OLD.created_at IS NOT NEW.created_at
      UNION ALL SELECT 'updated_at' AS k, NEW.updated_at AS v WHERE OLD.updated_at IS NOT NEW.updated_at
      UNION ALL SELECT 'completed_at' AS k, NEW.completed_at AS v WHERE OLD.completed_at IS NOT NEW.completed_at
      UNION ALL SELECT 'deleted_at' AS k, NEW.deleted_at AS v WHERE OLD.deleted_at IS NOT NEW.deleted_at
      UNION ALL SELECT 'deadline' AS k, NEW.deadline AS v WHERE OLD.deadline IS NOT NEW.deadline
      UNION ALL SELECT 'duration_min' AS k, NEW.duration_min AS v WHERE OLD.duration_min IS NOT NEW.duration_min
      UNION ALL SELECT 'someday' AS k, NEW.someday AS v WHERE OLD.someday IS NOT NEW.someday
      UNION ALL SELECT 'waiting' AS k, NEW.waiting AS v WHERE OLD.waiting IS NOT NEW.waiting)) WHERE f <> '{}';
END;

CREATE TRIGGER sync_del_tasks AFTER DELETE ON tasks WHEN (SELECT value FROM sync_state WHERE key = 'record') = '1' BEGIN
  INSERT INTO sync_outbox (tbl, row_id, fields, created_at) VALUES ('tasks', OLD.id, json_object('deleted_at', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;

CREATE TRIGGER sync_ins_calendar_subscriptions AFTER INSERT ON calendar_subscriptions WHEN (SELECT value FROM sync_state WHERE key = 'record') = '1' BEGIN
  INSERT INTO sync_outbox (tbl, row_id, fields, created_at) VALUES ('calendar_subscriptions', NEW.id, json_object('id', NEW.id, 'name', NEW.name, 'url', NEW.url, 'color', NEW.color, 'sort_order', NEW.sort_order, 'created_at', NEW.created_at, 'deleted_at', NEW.deleted_at), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;

CREATE TRIGGER sync_upd_calendar_subscriptions AFTER UPDATE ON calendar_subscriptions WHEN (SELECT value FROM sync_state WHERE key = 'record') = '1' BEGIN
  INSERT INTO sync_outbox (tbl, row_id, fields, created_at)
  SELECT 'calendar_subscriptions', NEW.id, f, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM (SELECT json_group_object(k, v) AS f FROM (
      SELECT 'id' AS k, NEW.id AS v WHERE OLD.id IS NOT NEW.id
      UNION ALL SELECT 'name' AS k, NEW.name AS v WHERE OLD.name IS NOT NEW.name
      UNION ALL SELECT 'url' AS k, NEW.url AS v WHERE OLD.url IS NOT NEW.url
      UNION ALL SELECT 'color' AS k, NEW.color AS v WHERE OLD.color IS NOT NEW.color
      UNION ALL SELECT 'sort_order' AS k, NEW.sort_order AS v WHERE OLD.sort_order IS NOT NEW.sort_order
      UNION ALL SELECT 'created_at' AS k, NEW.created_at AS v WHERE OLD.created_at IS NOT NEW.created_at
      UNION ALL SELECT 'deleted_at' AS k, NEW.deleted_at AS v WHERE OLD.deleted_at IS NOT NEW.deleted_at)) WHERE f <> '{}';
END;

CREATE TRIGGER sync_del_calendar_subscriptions AFTER DELETE ON calendar_subscriptions WHEN (SELECT value FROM sync_state WHERE key = 'record') = '1' BEGIN
  INSERT INTO sync_outbox (tbl, row_id, fields, created_at) VALUES ('calendar_subscriptions', OLD.id, json_object('deleted_at', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;

CREATE TRIGGER sync_ins_calendar_events AFTER INSERT ON calendar_events WHEN (SELECT value FROM sync_state WHERE key = 'record') = '1' BEGIN
  INSERT INTO sync_outbox (tbl, row_id, fields, created_at) VALUES ('calendar_events', NEW.id, json_object('id', NEW.id, 'title', NEW.title, 'notes', NEW.notes, 'start_date', NEW.start_date, 'span_days', NEW.span_days, 'start_at', NEW.start_at, 'end_at', NEW.end_at, 'color', NEW.color, 'rrule', NEW.rrule, 'exdates', NEW.exdates, 'recurrence_parent_id', NEW.recurrence_parent_id, 'source', NEW.source, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'countdown', NEW.countdown, 'pinned', NEW.pinned, 'subscription_id', NEW.subscription_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;

CREATE TRIGGER sync_upd_calendar_events AFTER UPDATE ON calendar_events WHEN (SELECT value FROM sync_state WHERE key = 'record') = '1' BEGIN
  INSERT INTO sync_outbox (tbl, row_id, fields, created_at)
  SELECT 'calendar_events', NEW.id, f, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM (SELECT json_group_object(k, v) AS f FROM (
      SELECT 'id' AS k, NEW.id AS v WHERE OLD.id IS NOT NEW.id
      UNION ALL SELECT 'title' AS k, NEW.title AS v WHERE OLD.title IS NOT NEW.title
      UNION ALL SELECT 'notes' AS k, NEW.notes AS v WHERE OLD.notes IS NOT NEW.notes
      UNION ALL SELECT 'start_date' AS k, NEW.start_date AS v WHERE OLD.start_date IS NOT NEW.start_date
      UNION ALL SELECT 'span_days' AS k, NEW.span_days AS v WHERE OLD.span_days IS NOT NEW.span_days
      UNION ALL SELECT 'start_at' AS k, NEW.start_at AS v WHERE OLD.start_at IS NOT NEW.start_at
      UNION ALL SELECT 'end_at' AS k, NEW.end_at AS v WHERE OLD.end_at IS NOT NEW.end_at
      UNION ALL SELECT 'color' AS k, NEW.color AS v WHERE OLD.color IS NOT NEW.color
      UNION ALL SELECT 'rrule' AS k, NEW.rrule AS v WHERE OLD.rrule IS NOT NEW.rrule
      UNION ALL SELECT 'exdates' AS k, NEW.exdates AS v WHERE OLD.exdates IS NOT NEW.exdates
      UNION ALL SELECT 'recurrence_parent_id' AS k, NEW.recurrence_parent_id AS v WHERE OLD.recurrence_parent_id IS NOT NEW.recurrence_parent_id
      UNION ALL SELECT 'source' AS k, NEW.source AS v WHERE OLD.source IS NOT NEW.source
      UNION ALL SELECT 'created_at' AS k, NEW.created_at AS v WHERE OLD.created_at IS NOT NEW.created_at
      UNION ALL SELECT 'updated_at' AS k, NEW.updated_at AS v WHERE OLD.updated_at IS NOT NEW.updated_at
      UNION ALL SELECT 'deleted_at' AS k, NEW.deleted_at AS v WHERE OLD.deleted_at IS NOT NEW.deleted_at
      UNION ALL SELECT 'countdown' AS k, NEW.countdown AS v WHERE OLD.countdown IS NOT NEW.countdown
      UNION ALL SELECT 'pinned' AS k, NEW.pinned AS v WHERE OLD.pinned IS NOT NEW.pinned
      UNION ALL SELECT 'subscription_id' AS k, NEW.subscription_id AS v WHERE OLD.subscription_id IS NOT NEW.subscription_id)) WHERE f <> '{}';
END;

CREATE TRIGGER sync_del_calendar_events AFTER DELETE ON calendar_events WHEN (SELECT value FROM sync_state WHERE key = 'record') = '1' BEGIN
  INSERT INTO sync_outbox (tbl, row_id, fields, created_at) VALUES ('calendar_events', OLD.id, json_object('deleted_at', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
