# Desktop UI (UI)

Scope: src/features/, src/components/ui/, src/lib/{dnd,shortcuts}. Part of the [v1.2.4 test findings](README.md). Each entry says whether a probe test proved it or it rests on reading the code; prove it with a failing test before fixing (the v1.2.1 rule).

No jsdom or testing-library is installed, so every finding below is "reasoning only" (traced through the code, not executed). No probe files were created.

### UI-01 · high · bug · Dialog re-runs its focus effect whenever the parent passes a new onClose, stealing focus and breaking IME
- [ ] Status: open
- Where: src/components/ui/Dialog.tsx:21-43 (effect deps [onClose]); callers with an unstable onClose: src/features/tasks/ImportDialog.tsx (const close = () => setImport(false) defined inside the component), src/features/shell/CommandPalette.tsx (const close inside PaletteBody), src/features/shell/WhatsNew.tsx (const close defined after the early return)
- Proven: reasoning only
- What happens: the effect does prev = document.activeElement; first.focus(), and its cleanup does prev.focus(). Every re-render of a component that builds close inline changes onClose, so cleanup and setup run again. Focus jumps out of the dialog to prev, then back to the FIRST focusable control in the dialog.
  - ImportDialog: changing "Add to" (select), the "Treat each item as plain text" checkbox, or typing in the "Custom separator" input (the 2nd character typed lands in the textarea) all re-render, and focus snaps back to the textarea.
  - WhatsNew tour: pressing Next with Enter re-renders, so focus jumps to the first button, which is "Back" once step > 0. A second Enter goes Back.
  - CommandPalette: every keystroke blurs and refocuses the search input, which cancels or commits IME composition (CJK search is broken).
- Repro: Tasks, then Import tasks. Switch Separator to Custom and type ";;". The second ";" ends up in the big textarea. Or choose a different list in "Add to": focus goes back to the textarea.
- Expected: focus stays where the user put it.
- Suggested fix: keep onClose in a ref inside Dialog (const closeRef = useRef(onClose); closeRef.current = onClose;) and make the effect []-dependent. That fixes every caller at once.

### UI-02 · high · bug · Popover menus and editors have no keyboard path, and in the centred task window they are unreachable
- [ ] Status: open
- Where: src/components/ui/Popover.tsx:24-70 (no focus move, no arrow keys, no trap); users: src/features/tasks/TaskDrawer.tsx Prop chips (~l.250-275), BulkBar.tsx menus, TaskView.tsx sort/group menu, KanbanView.tsx section menu
- Proven: reasoning only
- What happens: Popover is portaled to the end of document.body. Opening it with Enter or Space leaves focus on the anchor button, and the popover never takes focus. Tab moves to the next control in the original DOM, not into the popover. Only ContextMenu focuses its first item explicitly. With the task window centred (taskOpen === "center"), the Dialog focus trap wraps Tab inside the dialog, so Planned, Deadline, Duration, Waiting, Priority, Tags and List editors cannot be reached by keyboard at all. In side-drawer mode you would have to Tab through the whole app first. This violates the "every interactive element has a keyboard path" convention.
- Repro: set Settings, Task window, Centre. Open a task, Tab to the "Priority: None" chip, press Enter. The menu appears but no key reaches it.
- Expected: opening moves focus to the first item. Up/Down move between items, Escape closes and refocuses the anchor, and Tab stays inside.
- Suggested fix: in Popover, after layout, focus the first [role=menuitem], input, select or button inside ref. Add the ContextMenu arrow-key handler to Popover itself (or a shared hook). The Dialog trap's querySelectorAll should also include the topmost popover.

### UI-03 · medium · bug · Bulk Date actions on recurring tasks skip the scope prompt and can destroy the series
- [ ] Status: open
- Where: src/features/tasks/BulkBar.tsx:23-27 and 63-67 (setDate), src/features/tasks/taskMenu.tsx:28-33 (reschedule when many), 35-37 (Someday); src/lib/shortcuts.ts:39-46 handles this correctly by excluding recurring tasks
- Proven: reasoning only (updateTask at src/stores/data.ts:189 sets recurrence = null when the schedule becomes none or someday)
- What happens: a selection that includes a repeating task, with Date set to "No date" or "Someday" (BulkBar or the right-click "Date" row), silently removes its recurrence. The single-task path asks "this / following / all". Today, Tomorrow and Next week rewrite the whole series' anchor date with no prompt. Only the undo toast saves the user.
- Repro: Ctrl+click two tasks, one of them "every mon". Date, then "No date". The recurring task loses its repeat.
- Expected: skip recurring tasks (as the t key does) and toast "Repeating tasks are rescheduled from the task itself".
- Suggested fix: filter ids to !task.recurrence in BulkBar.setDate and in taskMenu's many branch, reusing the toast from shortcuts.ts. Dropping a recurring task on Someday in the sidebar (Sidebar.tsx onDrop("smart")) loses the recurrence the same way and needs the same guard.

### UI-04 · medium · bug · Enter or Space on a button inside a task row or board card also triggers the row/card action
- [ ] Status: open
- Where: src/features/tasks/TaskRow.tsx (row onKeyDown, ~l.72-79), src/features/tasks/KanbanView.tsx Card onKeyDown (~l.178)
- Proven: reasoning only
- What happens: the handlers don't check e.target === e.currentTarget.
  - Row: Enter on the checkbox, the subtask chevron or a tag chip bubbles up and also calls openTask. Enter on the checkbox completes the task AND opens the drawer. Enter on a tag chip filters AND opens the drawer.
  - Row: Space on the chevron or a tag chip is swallowed by the row (preventDefault plus toggleDone), so Space on "Collapse subtasks" completes the task instead.
  - Card: Enter on the checkbox completes the card and also opens the drawer.
- Repro: Tab into a row's checkbox and press Space or Enter.
- Expected: the focused child handles its own key.
- Suggested fix: if (e.target !== e.currentTarget) return; at the top of both handlers.

### UI-05 · medium · bug · Command palette: the highlighted result never scrolls into view
- [ ] Status: open
- Where: src/features/shell/CommandPalette.tsx (~l.121-140; ArrowDown/ArrowUp only call setCursor)
- Proven: reasoning only (no scrollIntoView anywhere in the file)
- What happens: the results <ul> is max-h-[50vh] overflow-y-auto, and up to 40 results are kept. Arrow down past about 9 rows moves the cursor (and Enter's target) off-screen, so the user opens a result they can't see.
- Repro: Ctrl+K, type "a", press ArrowDown 15 times.
- Suggested fix: an effect on cursor that runs document.getElementById("pi-" + items[cursor]?.id)?.scrollIntoView({block:"nearest"}).

### UI-06 · medium · bug · Escape in the centred task window may discard unsaved title, description and checklist edits
- [ ] Status: open
- Where: src/features/tasks/TaskDrawer.tsx TitleInput (~l.230), Description (~l.300) and Checklist input commit only onBlur; src/components/ui/Dialog.tsx:30-33 closes on Escape
- Proven: reasoning only (depends on the browser not delivering a blur to React for an element removed while focused, which is not guaranteed in WebView2)
- What happens: in centred mode, Escape with focus in the title, notes or a checklist item closes the Dialog, and the drawer is unmounted with the pending draft. The side drawer skips Escape for textareas, so it doesn't close at all there, which is inconsistent. There is also no Escape-to-revert.
- Repro: Settings, Task window, Centre. Open a task, edit the notes, press Escape.
- Expected: commit the draft before closing (or ask).
- Suggested fix: have closeDrawer (or the drawer's Dialog onClose) first blur document.activeElement, so the existing onBlur commit runs, then close.

### UI-07 · medium · feature · Multi-select, and therefore all bulk actions, are mouse-only and not available on phone widths
- [ ] Status: open
- Where: src/features/tasks/TaskListView.tsx (~l.91-100; only Ctrl/Meta/Shift+click build a selection); src/lib/shortcuts.ts taskKey (acts on the selection)
- What happens: the keys c, t, 0-3 and Delete act on "selected or focused", but a keyboard user can't select several rows (no Shift+Arrow, no Ctrl+A, no Space-to-select). Below 720px there is no modifier key, so BulkBar can never appear.
- Suggested fix: Shift+Down/Up extends the selection from the focused row. On phone widths, long-press toggles selection.

### UI-08 · medium · feature · Board cards can't be reordered within a column, and drops onto a column aren't undoable
- [ ] Status: open
- Where: src/features/tasks/KanbanView.tsx (~l.14-19: onDrop("kanban-column") calls updateTask per id without withUndo); Card (~l.170) uses useDraggable, not useSortable
- What happens: columns list cards by sortVMs(..., "manual"), but there is no way to set that order from the board. Moving a card between columns (or a multi-selection) shows no undo toast, unlike the sidebar drops, which are wrapped in withUndo. It also bypasses the confirmShareMove guard and moves a selected subtask without its parent.
- Suggested fix: wrap the drop handler in withUndo("Moved N tasks", ...). Use moveTasks/reorderTask for in-column ordering.

### UI-09 · low · bug · Checklist item inputs are uncontrolled, so a stale value can overwrite a synced change
- [ ] Status: open
- Where: src/features/tasks/TaskDrawer.tsx Checklist, <input defaultValue={it.title} onBlur=...> (~l.470)
- Proven: reasoning only
- What happens: if another device renames the item, the input keeps showing the old title (defaultValue is read once per mount). Focusing and blurring it compares e.target.value !== it.title, which is true, and writes the stale title back, reverting the remote edit. An emptied item also saves with an empty title.
- Suggested fix: use key={it.id + it.title} (or a controlled draft), and ignore blur when unchanged or empty.

### UI-10 · low · bug · A bulk move can detach a subtask from its parent, depending on selection order
- [ ] Status: open
- Where: src/stores/data.ts:195 combined with src/features/tasks/BulkBar.tsx (Move menu) and src/features/tasks/taskMenu.tsx "Move to" (moveTasks(ids, ...) loops in selection order)
- Proven: reasoning only
- What happens: updateTask clears parentId when a subtask moves to a list its parent isn't in yet. Moving [child, parent] detaches the child before the parent moves. Moving [parent, child] keeps it nested (the child already travelled). The outcome depends on click order.
- Suggested fix: in moveTasks, drop ids whose ancestor is also in ids (descendants travel with the parent).

### UI-11 · low · bug · Enter submits during IME composition in quick add, inline add and the popup
- [ ] Status: open
- Where: src/features/tasks/QuickAdd.tsx (onKeyDown Enter), InlineAdd.tsx, windows/QuickAddWindow.tsx, CreatePopover.tsx, and the Checklist add input. isComposing is never checked anywhere (grep).
- What happens: for Japanese, Chinese or Korean input, the Enter that confirms a candidate also submits a half-typed task.
- Suggested fix: ignore keys where e.nativeEvent.isComposing is true.

### UI-12 · low · bug · The Tour only handles keys when focus is inside its card, and polls layout every frame
- [ ] Status: open
- Where: src/features/shell/Tour.tsx (onKeyDown on the wrapper ~l.178, tick rAF loop ~l.140)
- What happens: step 1 is "interactive" and leaves focus in the app's quick-add input, so Escape and arrow keys don't drive the tour. A requestAnimationFrame loop runs getBoundingClientRect and JSON.stringify every frame for as long as the tour is open.
- Suggested fix: attach the key handler on window while open, and drive measuring from ResizeObserver or scroll events.

### UI-13 · low · bug · Task list ARIA structure is invalid
- [ ] Status: open
- Where: src/features/tasks/TaskListView.tsx (~l.128, role="listbox" wrapping GroupHeader buttons); TaskRow.tsx role="option" with nested buttons (checkbox, chevron, tag chips)
- What happens: a listbox may contain only options, and an option must not contain interactive children. Screen readers read the list inconsistently.
- Suggested fix: use role="list"/"listitem" (or grid/row), or drop the roles and keep aria-selected on a row.

### UI-14 · low · bug · Lists are unreachable from the sidebar in the icon rail
- [ ] Status: open
- Where: src/features/shell/Sidebar.tsx (~l.264, the !collapsed block that renders Filters and Lists)
- What happens: below 960px the sidebar is forced into the icon rail (D203), and the rail shows no lists, filters or tags. You can't navigate to a list or drop a task onto a list; only Ctrl+K reaches them. A collapsed sidebar on a wide window has the same limit.
- Suggested fix: show a flyout of lists from a "Lists" rail icon, or show them as coloured list glyphs in the rail.

### UI-15 · low · bug · Reminder popup: "Tomorrow 9:00" snooze minutes are computed at render and can go stale
- [ ] Status: open
- Where: src/windows/ReminderWindow.tsx:7-14 (snoozeOptions() called inside the render map)
- What happens: the minutes are fixed when the card last rendered. If the popup sits past midnight, "Tomorrow 9:00" snoozes to a time a day too late.
- Suggested fix: compute at click time inside act for that option. Also add Escape-to-dismiss.

### UI-16 · low · bug · Calendar mini-month drag has no pointercancel handler
- [ ] Status: open
- Where: src/features/calendar/SidePanel.tsx (~l.52-62; startDrag adds pointerup once on window)
- What happens: if the pointer is cancelled (touch scroll or an OS gesture), drag is never cleared and the range highlight sticks. The listener also outlives the component if it unmounts mid-drag.
- Suggested fix: also listen for pointercancel, and remove both in an effect cleanup.

### UI-17 · low · feature · Trash has no "Empty trash"
- [ ] Status: open
- Where: src/features/trash/TrashView.tsx
- What happens: items must be purged one at a time with "Delete forever", and each needs its own confirm.

## Verified OK
- The Zustand selector rule holds across the area: no useData, useUi, useSettings or useSocial selector in features, components, windows, lib or App builds a new array or object (grep for Object.values, map, filter, sort and literals).
- The double-click problem on the completion checkbox is handled (e.detail > 1, TaskCheckbox.tsx).
- Popup windows (src/windows/*) import no stores or DB. They only emit events, as D33 requires. onFocusChanged and listen registrations are cleaned up, including the StrictMode double-mount case.
- Shortcut handling:
  - Global shortcuts stand down while typing and while any Dialog is open.
  - A Dialog opened over a Popover handles Escape correctly: the Popover has role=dialog and is the last one in the DOM, so Dialog's top-layer check passes it by.
  - The lightbox captures + - 0 before the app's task keys.
- A task deleted or synced away while its drawer is open closes the drawer (TaskDrawer effect). The selection is dropped on view change.
- Whitespace-only input is rejected by createFromText (text.trim()), so InlineAdd and QuickAdd add nothing for blank input.
- The task list is virtualized (useVirtualizer, overscan 12). derive() is memoized per (tasks, lists), so the many useDerived() callers share one pass.
- Platform key text goes through Keys / keyLabel. No hard-coded %APPDATA% and no stray hex colors in tsx (only the ColorPicker gradients, which are documented as content).
- Drag and drop: dropping a row onto itself or onto a row with a different parent or list is guarded in onDrop("task"). Column reorder and task drops use separate droppables. Edits on a read-only list are refused in commit / updateSection.
- Escape priority in the quick-add inputs (autocomplete first, then raw mode, then clear) is consistent, and stopPropagation correctly prevents the global Escape handler.
