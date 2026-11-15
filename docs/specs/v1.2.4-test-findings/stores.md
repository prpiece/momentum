# Stores, persistence, backup and import (DATA)

Scope: src/stores/, src/db/, src-tauri/migrations/, importers. Part of the [v1.2.4 test findings](README.md). Each entry says whether a probe test proved it or it rests on reading the code; prove it with a failing test before fixing (the v1.2.1 rule).

### DATA-01 · high · bug · Backup restore can fail halfway (duplicate tag names) and still reports success
- [ ] Status: open
- Where: src/db/backupFormat.ts (validateBackup/repairReferences, no tag dedupe); src/db/backup.ts:restoreBackup; src/db/client.ts:write (swallows errors); src-tauri/migrations/0002_tasks.sql (tags.name UNIQUE COLLATE NOCASE)
- Proven: yes. validateBackup with tags {Work},{work} returns both (tags kept 2). Upserting both into a DB built from the real migrations fails: "UNIQUE constraint failed: tags.name". `write()` resolves even when statements fail (`run.catch(() => undefined)`).
- What happens: restoreBackup first runs DELETE FROM every table, then saveWorkspace. Statements run in order inside one write(); the failing tag insert aborts the rest of that batch, so tasks/events/lists after it are never inserted. restoreBackup never sees the error, hydrates the (nearly empty) DB and DataSection shows "Backup restored". The user loses all data; only the pre-restore snapshot path in a toast remains. A backup can legitimately contain case-variant tags (the store allows them, see next finding).
- Repro: backup whose tags table has "Work" and "work" (or edit the JSON), Settings -> Data -> restore.
- Expected: validation dedupes/renames tags case-insensitively; a restore failure surfaces as an error (ideally inside a transaction/rollback).
- Suggested fix: in repairReferences dedupe tags by lowercase name (remap task.tags ids to the survivor). Make write() able to throw for restore (e.g. `writeOrThrow`) so restoreBackup aborts and tells the user to use the snapshot.

### DATA-02 · medium · bug · Renaming a tag to an existing name desyncs store from DB
- [ ] Status: open
- Where: src/stores/data.ts:updateTag (~544); src/features/settings/TagsSection.tsx:22
- Proven: yes. Store accepts rename "Home" -> "work" next to "Work" (names [Work, work]); the DB upsert of the same fails UNIQUE (proved on real schema).
- What happens: store updated optimistically, DB write silently fails (only a generic write-error toast). Until restart two tags look alike; after restart the tag reverts. ensureTags/quick add then picks the first match. Feeds the backup-restore failure above.
- Repro: Settings -> Tags, rename a tag to another tag's name (any case).
- Expected: refuse with a toast, or merge the tags.
- Suggested fix: in updateTag, if another tag has the same lowercase name, return false / merge ids into the existing tag.

### DATA-03 · medium · bug · Subtask depth limit off by one in bulk text import and Todoist/TickTick import (6 levels created, limit is 5)
- [ ] Status: open
- Where: src/domain/bulkImport.ts:42 (`stack.length = MAX_SUBTASK_DEPTH`), src/domain/importPlan.ts:81 (`chain.slice(0, MAX_SUBTASK_DEPTH)`); bulkImport.test.ts:42 encodes the wrong expectation ([0,1,2,3,4,5,5,5])
- Proven: yes. Pasting 6 progressively indented lines creates a task with depthOf == 6, and setParent then refuses depth 6 (returns false). A 7-level Todoist JSON import yields max depth 6. TaskDrawer (canNest: depthOf < 5), agentApi and setParent all treat 5 as max.
- What happens: tasks nested 6 deep exist; the drawer offers no "Add subtask" there; moves are refused inconsistently; layouts built for 5 levels may overflow.
- Expected: at most MAX_SUBTASK_DEPTH levels (top level = 1).
- Suggested fix: cap ancestors at MAX_SUBTASK_DEPTH - 1 in both places and fix the test.

### DATA-04 · medium · bug · Live subtask can be permanently destroyed when its trashed parent is purged (setParent accepts a trashed parent)
- [ ] Status: open
- Where: src/stores/data.ts:setParent (~299, no deletedAt check); src/db/repo.ts:loadWorkspace purge; migration 0002 `parent_id ... ON DELETE CASCADE`
- Proven: yes for the first half (setParent(child, trashedParent) returns true); the cascade is by schema (reasoning).
- What happens: a task re-parented under a trashed task is hidden; 30 days later the launch purge `DELETE FROM tasks WHERE deleted_at < cutoff` cascades and deletes the live child and its subtasks with no trash entry.
- Repro: trash task P, setParent(C, P) (palette/agent/sync), wait 30 days.
- Expected: refuse trashed parents.
- Suggested fix: `if (!p || p.deletedAt || ...) return false`; in the purge also detach live children first (UPDATE tasks SET parent_id=NULL WHERE parent_id IN (...) AND deleted_at IS NULL).

### DATA-05 · medium · bug · updateTask/addTask accept any parentId: cycles and depth bypass possible
- [ ] Status: open
- Where: src/stores/data.ts:updateTask (~167), addTask (~118); only setParent validates
- Proven: yes: updateTask(a,{parentId:b}) where b is a's child makes an a<->b cycle in the store.
- What happens: the cycle/depth check exists only in setParent; every other path (editTask patches, agent, phone, sync) can bypass it. Cycle tasks vanish from tree views (neither is a root) while still in the DB.
- Expected: one guard in the single write path.
- Suggested fix: move self/cycle/depth/missing-parent validation into updateTask when `patch.parentId` is set (ignore the parentId otherwise); validate depth in addTask.

### DATA-06 · medium · bug · removeList leaves its sections (and cross-list subtasks) in the store
- [ ] Status: open
- Where: src/stores/data.ts:removeList (~407)
- Proven: yes (after removeList the sections count is still 1). DB cascade removes them; the store does not.
- What happens: ghost sections remain until restart; a subtask living in another list whose parent was in the removed list is cascade-deleted in the DB but kept in the store (parent_id ON DELETE CASCADE).
- Suggested fix: filter `sections` by listId in the same set(), and also drop tasks whose ancestor was removed.

### DATA-07 · low · bug · removeTag skips trashed tasks, leaving dangling tag ids
- [ ] Status: open
- Where: src/stores/data.ts:removeTag (uses live())
- Proven: yes (restored task keeps the deleted tag id; tag gone).
- Suggested fix: iterate all tasks, not live(). Backup repairReferences also doesn't strip unknown tag ids from tasks.

### DATA-08 · low · bug · duplicateTask gives copies identical sortOrder
- [ ] Status: open
- Where: src/stores/data.ts:duplicateTask (`sortOrder: src.sortOrder + 0.5`)
- Proven: yes: duplicating A twice gives 0.5 and 0.5 (also collides with any sibling already at +0.5). Order between equal values is unstable.
- Suggested fix: use the midpoint to the next sibling or `after(siblings)`.

### DATA-09 · low · bug · CSV priority cell like "constructor"/"__proto__" yields a non-number priority
- [ ] Status: open
- Where: src/domain/importTodoist.ts (CSV_PRIORITY[...] ?? 0), src/domain/importTickTick.ts (PRIORITY[...])
- Proven: yes (priority becomes `function Object()` / `[object Object]`). Hostile or corrupt file only; the DB CHECK then rejects the write and that task is lost while the store holds it.
- Suggested fix: `Object.hasOwn(map, key) ? map[key] : 0`, or use a Map.

### DATA-10 · low · bug · Todoist JSON import ignores child_order and maps the Inbox project to a second list
- [ ] Status: open
- Where: src/domain/importTodoist.ts:fromJson, src/stores/importPlan.ts (sortOrder: i)
- Proven: yes: items with child_order 2,1 import as [b, a]; the inbox project becomes a new list named "Inbox" beside the built-in Inbox.
- Suggested fix: sort items and sections by child_order/section_order first; map inbox_project to INBOX_ID.

### DATA-11 · low · bug · No rollback for failed DB writes: store actions are optimistic fire-and-forget
- [ ] Status: open
- Where: src/stores/data.ts:commit and every list/folder/section/tag action; src/db/client.ts:write
- Proven: reasoning (+ the tag rename demo).
- What happens: any failing statement (UNIQUE, CHECK, FK, disk full) is only logged and toasted; the store keeps the new state; a multi-statement batch (saveTasks of N tasks) stops at the first failure so later rows are not saved. After restart the data silently reverts.
- Suggested fix: on write failure reload the workspace from the DB so the UI shows the truth, keeping the toast.

### DATA-12 · low · bug · askScope / confirm / askSave overwrite a pending prompt, leaving the first promise unresolved
- [ ] Status: open
- Where: src/stores/ui.ts
- Proven: reasoning only. A second call before the first resolves replaces scopeAsk/confirmAsk; the first caller's action never completes.
- Suggested fix: resolve the previous ask with null/false before setting a new one.

### DATA-13 · low · bug · LATEST_SCHEMA in backup.ts is a hard-coded 10
- [ ] Status: open
- Where: src/db/backup.ts:11. Proven: reasoning. The next migration will silently stamp backups with a stale schemaVersion. Suggested fix: a test comparing it to the migrations folder (migrations.test.ts already reads the dir).

### DATA-14 · low · feature · No data export other than the full-database zip
- [ ] Status: open
- exportBackup is the only export; no tasks CSV, no .ics export of dated tasks, no per-list export. Users can import Todoist/TickTick/ics but cannot export to a readable file.

### DATA-15 · low · feature · Undo coverage gaps for structural deletes
- [ ] Status: open
- removeList (hard-deletes all its tasks, never reaching the Trash), removeSection, removeTag, removeFolder, removeHabit have no undo. Only task/event operations and imports go through undoable/pushUndo.

## Verified OK
- Migrations 0001-0010 are all registered in lib.rs migrations() in order with matching versions.
- Row mappers (task/list/folder/section/tag/event/habit rows) validate enums, JSON columns and NULLs and drop or repair bad values.
- parseCsv handles BOM, doubled quotes, embedded newlines, CRLF and an unterminated quote without throwing.
- parseExternalImport never throws on malformed or non-object JSON; `__proto__` ids are harmless; duplicate ids are skipped; parent cycles and cross-list parents are dropped in finalize.
- Todoist priority mapping (CSV 1 = p1, API 4 = p1) and TickTick 0/1/3/5 mapping are correct; TickTick all-day dates use the task timezone; `every! mon` style repeats map correctly.
- backup repairReferences breaks parent cycles, re-creates Inbox, fixes dangling list/section/folder/group/habit refs; restore insert order respects FKs.
- reorder(): 200 repeated moves into the same gap still give distinct orders (renumber fallback works for full sibling sets).
- Folder nesting (canNest/canAddChild/repairFolderParents) guards cycles and depth; trash restore revives trashed ancestors; descendants() is cycle-safe.
- Store selector convention: the assigned stores expose raw maps; no array-building selectors found.
