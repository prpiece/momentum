-- Two-way Google Calendar and Outlook sync (FEAT-01, PLAN D345). A linked event names its provider and calendar,
-- its id and etag there, and ext_synced_at: the updated_at the calendar function last reconciled, so a different
-- updated_at is a Momentum edit still to send. The function writes these; the apps only carry them along.
-- Triggers generated: node scripts/sync-triggers.mjs 11 <this file's ALTERs>.
ALTER TABLE calendar_events ADD COLUMN provider TEXT CHECK (provider IN ('google', 'microsoft'));
ALTER TABLE calendar_events ADD COLUMN external_calendar_id TEXT;
ALTER TABLE calendar_events ADD COLUMN external_id TEXT;
ALTER TABLE calendar_events ADD COLUMN etag TEXT;
ALTER TABLE calendar_events ADD COLUMN ext_synced_at TEXT;

DROP TRIGGER sync_ins_calendar_events;
DROP TRIGGER sync_upd_calendar_events;
DROP TRIGGER sync_del_calendar_events;

CREATE TRIGGER sync_ins_calendar_events AFTER INSERT ON calendar_events WHEN (SELECT value FROM sync_state WHERE key = 'record') = '1' BEGIN
  INSERT INTO sync_outbox (tbl, row_id, fields, created_at) VALUES ('calendar_events', NEW.id, json_object('id', NEW.id, 'title', NEW.title, 'notes', NEW.notes, 'start_date', NEW.start_date, 'span_days', NEW.span_days, 'start_at', NEW.start_at, 'end_at', NEW.end_at, 'color', NEW.color, 'rrule', NEW.rrule, 'exdates', NEW.exdates, 'recurrence_parent_id', NEW.recurrence_parent_id, 'source', NEW.source, 'created_at', NEW.created_at, 'updated_at', NEW.updated_at, 'deleted_at', NEW.deleted_at, 'countdown', NEW.countdown, 'pinned', NEW.pinned, 'subscription_id', NEW.subscription_id, 'provider', NEW.provider, 'external_calendar_id', NEW.external_calendar_id, 'external_id', NEW.external_id, 'etag', NEW.etag, 'ext_synced_at', NEW.ext_synced_at, '_purged', NULL), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;

CREATE TRIGGER sync_upd_calendar_events AFTER UPDATE ON calendar_events WHEN (SELECT value FROM sync_state WHERE key = 'record') = '1' BEGIN
  INSERT INTO sync_outbox (tbl, row_id, fields, created_at)
  SELECT 'calendar_events', NEW.id, f, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM (SELECT json_group_object(k, CASE WHEN substr(k, 1, 5) IN ('_add_', '_del_') THEN json(v) ELSE v END) AS f FROM (
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
      UNION ALL SELECT '_add_exdates' AS k, (SELECT json_group_array(value) FROM json_each((CASE WHEN json_valid(NEW.exdates) THEN NEW.exdates ELSE '[]' END)) WHERE value NOT IN (SELECT value FROM json_each((CASE WHEN json_valid(OLD.exdates) THEN OLD.exdates ELSE '[]' END)))) AS v WHERE OLD.exdates IS NOT NEW.exdates
      UNION ALL SELECT '_del_exdates' AS k, (SELECT json_group_array(value) FROM json_each((CASE WHEN json_valid(OLD.exdates) THEN OLD.exdates ELSE '[]' END)) WHERE value NOT IN (SELECT value FROM json_each((CASE WHEN json_valid(NEW.exdates) THEN NEW.exdates ELSE '[]' END)))) AS v WHERE OLD.exdates IS NOT NEW.exdates
      UNION ALL SELECT 'recurrence_parent_id' AS k, NEW.recurrence_parent_id AS v WHERE OLD.recurrence_parent_id IS NOT NEW.recurrence_parent_id
      UNION ALL SELECT 'source' AS k, NEW.source AS v WHERE OLD.source IS NOT NEW.source
      UNION ALL SELECT 'created_at' AS k, NEW.created_at AS v WHERE OLD.created_at IS NOT NEW.created_at
      UNION ALL SELECT 'updated_at' AS k, NEW.updated_at AS v WHERE OLD.updated_at IS NOT NEW.updated_at
      UNION ALL SELECT 'deleted_at' AS k, NEW.deleted_at AS v WHERE OLD.deleted_at IS NOT NEW.deleted_at
      UNION ALL SELECT 'countdown' AS k, NEW.countdown AS v WHERE OLD.countdown IS NOT NEW.countdown
      UNION ALL SELECT 'pinned' AS k, NEW.pinned AS v WHERE OLD.pinned IS NOT NEW.pinned
      UNION ALL SELECT 'subscription_id' AS k, NEW.subscription_id AS v WHERE OLD.subscription_id IS NOT NEW.subscription_id
      UNION ALL SELECT 'provider' AS k, NEW.provider AS v WHERE OLD.provider IS NOT NEW.provider
      UNION ALL SELECT 'external_calendar_id' AS k, NEW.external_calendar_id AS v WHERE OLD.external_calendar_id IS NOT NEW.external_calendar_id
      UNION ALL SELECT 'external_id' AS k, NEW.external_id AS v WHERE OLD.external_id IS NOT NEW.external_id
      UNION ALL SELECT 'etag' AS k, NEW.etag AS v WHERE OLD.etag IS NOT NEW.etag
      UNION ALL SELECT 'ext_synced_at' AS k, NEW.ext_synced_at AS v WHERE OLD.ext_synced_at IS NOT NEW.ext_synced_at)) WHERE f <> '{}';
END;

CREATE TRIGGER sync_del_calendar_events AFTER DELETE ON calendar_events WHEN (SELECT value FROM sync_state WHERE key = 'record') = '1' BEGIN
  INSERT INTO sync_outbox (tbl, row_id, fields, created_at) VALUES ('calendar_events', OLD.id, json_object('deleted_at', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), '_purged', 1), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
