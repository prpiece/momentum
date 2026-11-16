-- Series remember the zone their start was written in (TIME-03, PLAN D347). Bumps schema_version to 12.
--
-- `rrule_tz` is a new nullable field on `tasks` and `calendar_events` rows. Synced rows are jsonb in
-- sync_rows (ADR 0005) with per-field last-writer-wins stamps (SYNC-11), so a new field needs no
-- column or function change: sync_push merges and stamps whatever keys a patch carries. Rows the
-- calendar function writes leave it absent (null), which clients read in their own zone as before.

-- D289: every migration bumps the schema version by one.
update public.server_meta set schema_version = 12;
