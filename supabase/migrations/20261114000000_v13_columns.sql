-- Slot for the server side of Track B's v1.3 task fields (deadline, duration, Someday, waiting,
-- habit period; docs/specs/v1.3-server-handoff.md). Records sync as jsonb in sync_rows, so a new
-- local column needs no server column (PLAN D225). Anything the server itself must read (the bots'
-- `deadline`, `waiting` and `overdue` commands) is read from `data` by key; add constraints or
-- indexes here once the handoff names the fields. Kept first so it runs before the v1.4 tables.
select 1;
