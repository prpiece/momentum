-- The server side of Track B's v1.3 fields (docs/specs/v1.3-server-handoff.md). Records sync as
-- jsonb, so the new task fields (deadline, duration_min, someday, waiting), calendar_events.
-- subscription_id and the dayEndHour setting need no change. The one new synced table does.
-- calendar_subscriptions.url is a private calendar address: it stays owner-only like every row,
-- and no shared or friend-visible view reads it.
alter table public.sync_rows drop constraint sync_rows_tbl_check;
alter table public.sync_rows add constraint sync_rows_tbl_check check (tbl in (
  'folders', 'lists', 'sections', 'tags', 'tasks', 'task_activity', 'calendar_events', 'habit_groups',
  'habits', 'habit_checkins', 'focus_sessions', 'rest_days', 'celebrations', 'settings', 'calendar_subscriptions'));
