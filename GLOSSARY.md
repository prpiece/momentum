# Momentum

An offline desktop planner: tasks organised into lists and folders, viewed through smart lists, a calendar, an Eisenhower matrix and a focus timer.

## Organising tasks

**Folder**:
A named container for lists and other folders, nested at most three levels deep.
_Avoid_: Group, project, sublist

**List**:
A named collection of tasks that lives at the top level or inside one folder.
_Avoid_: Project, sublist

**Section**:
A named, ordered column within one list, shown as a column on the board.
_Avoid_: Column, lane, stage

**Unsectioned**:
The implicit column on a board that holds a list's tasks that belong to no section; it is not a section itself.
_Avoid_: Default section, not sectioned

**Note**:
The free-form Markdown text attached to a task.
_Avoid_: Description, body, comment

**Attachment**:
An image file owned by exactly one task and referenced from that task's note.
_Avoid_: Upload, media, embed

## Prioritising

**Quadrant**:
One of the four cells of the Eisenhower matrix, derived from a task's importance and urgency rather than stored on it.
_Avoid_: Box, category, bucket

**Quadrant colour**:
The colour that marks a quadrant everywhere it appears; a theme default unless the user picks one.
_Avoid_: Matrix theme

## Focus

**Phase**:
One uninterrupted stretch of the focus timer: a focus, a short break or a long break.
_Avoid_: Interval, block

**Cycle**:
One focus phase together with the break that follows it.
_Avoid_: Round, repetition, pomodoro

**Session**:
A run of the focus timer from start until it is stopped, or until its cycle count is reached when the count is finite.
_Avoid_: Run, sitting

## Windows and input

**Main window**:
The full application window and the only place where data is written.
_Avoid_: App window

**Mini window**:
A small always-on-top window that shows the current task, the focus timer or the matrix while the user works elsewhere.
_Avoid_: Widget, overlay, compact mode

**Quick-add**:
The single-line natural-language entry that turns typed or spoken text into a task.
_Avoid_: Capture, new task box

**Token**:
A marker inside quick-add text that sets a field instead of becoming title: a symbol form (`!high`, `#tag`, `~List`), or its keyword form (`priority high`, `tag x`, `list x`), which counts only in spoken entries.
_Avoid_: Command, shortcut

**Spoken entry**:
A quick-add entry any of whose text came from voice; it stays spoken after edits until it is cleared.
_Avoid_: Voice mode, dictated text

**Bulk import**:
Turning a pasted block of text into many tasks at once, one per item, each item read like a quick-add entry.
_Avoid_: Batch add, paste import

**Voice quick-add**:
Quick-add whose text comes from on-device speech recognition instead of typing.
_Avoid_: Dictation, voice commands

**Voice command**:
A fixed spoken phrase that navigates or controls the focus timer, as opposed to text that becomes a task.
_Avoid_: Voice action, intent

**Voice model**:
The optional speech-recognition model the user downloads once; voice features are unavailable until it is present.
_Avoid_: Engine, Parakeet (in UI copy)

## Appearance

**Layout**:
The arrangement of the navigation around the content: Classic, Flat, Top bar or Dock.
_Avoid_: Theme, mode

**Dock**:
The layout whose navigation is a floating bar at the bottom of the window.
_Avoid_: Bottom bar, taskbar

**Background**:
A user-chosen image or preset gradient shown behind the content area.
_Avoid_: Wallpaper, theme

## Progress

**Trophy**:
A kind of achievement measured by one count (tasks done, focus hours, habit streak, perfect days, perfect weeks).
_Avoid_: Badge, award

**Share card**:
An image summarising the user's progress over a week or a month, made of numbers and charts only, never task or list names.
_Avoid_: Report, summary, stats image

**Level**:
One rung of a trophy's ladder, reached when its count passes a threshold; each level has its own look.
_Avoid_: Tier, milestone, rank
