# Momentum

A local-first planner for desktop and phone: tasks organised into lists and folders, viewed through smart lists, a calendar, an Eisenhower matrix and a focus timer.

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

**Countdown**:
An all-day calendar event shown as the number of days until it, or since it.
_Avoid_: Timer, deadline

**Planned date**:
When you intend to do a task: no date, a day, a time, or someday.
_Avoid_: Due date, do date, schedule (in UI copy)

**Deadline**:
The local date a task must be done by, independent of its planned date; it makes the task urgent in the Matrix.
_Avoid_: Due date, due

**Duration**:
How long a task is expected to take, which can be set without giving it a time.
_Avoid_: Estimate, length, time block

**Someday**:
A planned date meaning "not now", which keeps a task out of Today, Upcoming and the Matrix until you give it a real date.
_Avoid_: Backlog, later, icebox

**Waiting for**:
A task that can't move until something else happens, either a person getting back to you by a follow-up date or another task being completed; it comes back when the date arrives or the other task is done.
_Avoid_: Blocked, on hold, delegated, dependency (in UI copy)

**One thing**:
A way of showing Today as only the next single task, optionally limited to short tasks on a low-energy day.
_Avoid_: Focus mode (that is the timer), zen mode, single-task view

**Calendar subscription**:
Another calendar's published address, whose events the app shows read-only next to your own and refreshes regularly.
_Avoid_: Calendar sync, linked calendar, feed

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

**Phone app**:
The separate native app for iOS and Android phones: a focused companion that shares the desktop's data and sync but shows only a subset of its views.
_Avoid_: Mobile, mobile app, companion

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
The arrangement of the navigation around the content: the sidebar or the bar.
_Avoid_: Theme, mode

**Bar**:
The layout whose navigation is one horizontal strip, placed at the top or the bottom of the window.
_Avoid_: Dock, taskbar, top bar

**Narrow layout**:
How the desktop app rearranges itself when its window is narrower than a phone's width threshold.
_Avoid_: Phone layout, mobile layout

**View mode**:
How one task view presents its tasks: list, board, matrix or timeline.
_Avoid_: Layout, view type

## Learning the app

**Getting started**:
The dismissable set of first things to try, each of which ticks itself when the user actually does it.
_Avoid_: Checklist (that is part of a task), onboarding, tutorial

**Tour**:
The few slides shown once to a new user that introduce the main ideas.
_Avoid_: Walkthrough, tutorial

**Help**:
The searchable reference of every command, shortcut and token, inside Settings.
_Avoid_: Docs, manual, cheat sheet

## Progress

**Friend**:
Another account that has accepted a mutual friend request, so you can send each other tasks, invite each other to shares, focus together and be check-in buddies.
_Avoid_: Follower, contact, buddy

**Connection**:
A link between an account and an outside service (Discord, Slack, Telegram, a webhook) that lets text sent from there land in that account's Inbox as a task.
_Avoid_: Integration (in UI copy), plugin, bot

**Sent task**:
A copy of a task that one friend sends to another; it lands in the recipient's Inbox once they accept it, and from then on is unconnected to the sender's task.
_Avoid_: Shared task, delegated task, forwarded task

**Focus together**:
Starting your own focus session so it ends at the same moment as a friend's session that is in progress; neither of you sees the other's task.
_Avoid_: Co-working, group session, body doubling (in UI copy)

**Check-in buddy**:
A friend you chose on one habit, who sees only that habit's name and whether you've checked it in today, and may nudge you.
_Avoid_: Accountability partner, follower

**Nudge**:
A reminder a check-in buddy sends you about a habit, at most once a day.
_Avoid_: Poke, ping

**Invite link**:
A link that makes whoever opens it and signs in a friend of its sender, or a member of a share, depending on what it was made for.
_Avoid_: Referral link, share link

**Progress**:
The one place that shows the user's plain statistics: completions over time, focus time and the heatmap. It has no points, rewards or rankings.
_Avoid_: Stats page, achievements page

## Accounts

**Account**:
A person's identity on the Momentum server, which their devices sync through; using the app without one is fully supported.
_Avoid_: User (in UI copy), profile, login

**Sign-in**:
The state of a device being connected to an account; signing out disconnects it.
_Avoid_: Session (that is a focus-timer run), login

**Sync**:
Keeping an account's data the same across its signed-in devices.
_Avoid_: Backup, cloud save

**Handle**:
An account's unique public name, written with a leading @, which friends and collaborators use to find it.
_Avoid_: Username, user id, tag

**Pro**:
The paid plan, which raises the limits that cost the server money (devices, share members, attachment storage) and adds two-way calendar sync; every local feature stays free.
_Avoid_: Premium, Supporter, subscription (in UI copy)

**Digest**:
An optional morning message, sent privately through a connection, listing that day's tasks.
_Avoid_: Summary, briefing, newsletter

## Sharing

**Share**:
A list or folder that more than one account can see, together with its members; a list inside a shared folder is seen by the folder's members and may also have members of its own.
_Avoid_: Workspace, project, team

**Member**:
An account that belongs to a share, in exactly one role: owner, editor or viewer.
_Avoid_: Collaborator (in UI copy), participant, guest

**Owner**:
The one member who can invite and remove members, change roles, and rename or delete the share.
_Avoid_: Admin, creator

**Editor**:
A member who can change everything inside a share but not its membership.
_Avoid_: Collaborator, contributor

**Viewer**:
A member who can see a share but not change it.
_Avoid_: Read-only member, guest

**Assignee**:
The one member, if any, responsible for a task in a share.
_Avoid_: Owner (of a task), responsible

**Missed updates**:
Every CHANGELOG section newer than the last version the app showed, walked through together in What's new after an update (PLAN D98).
_Avoid_: Release notes, patch notes
