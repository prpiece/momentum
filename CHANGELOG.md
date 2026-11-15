# Changelog

Each release's section becomes the top of its GitHub release notes and the in-app "What's new" (PLAN D66, D67).
Each top-level bullet is one item. For a bigger release, give items a screenshot on an indented line under the bullet,
`  ![Alt text](whats-new/0.5.0/name.png)`, with the image in `public/whats-new/`. "What's new" then becomes a
step-by-step tour. Screenshot lines are left out of the GitHub notes.

## v1.2.3

- **Friend requests arrive instantly.** A request, an accepted friend or a share invite now shows up on the other person's screen within seconds, and opening Friends always shows the latest.
- **Clear old sync issues.** Settings → Account → Sync issues has a Clear button, and entries older than a week are hidden. Old reports for changes the app now handles are cleared on their own, and those changes are fetched again.

## v1.2.2

- **Sync stops repeating the same error.** A task whose list never reached your device now lands in your Inbox instead of failing every sync, and an incomplete change for a task you don't have is skipped quietly.
- **Chats answer faster after a quiet spell.** Discord and Slack show "thinking…" sooner, so the first command after a while no longer times out.
- **Connections work on the live server.** Linked chats, the webhook and the morning digest can now read your account.

## v1.2.1

- **Trash.** Deleted tasks stay in Trash for 30 days, where you can restore them or delete them for good. Restoring a subtask brings its parent back too.
- **Safer AI agents.** Agents can delete a task to the Trash and restore it. A delete needs the task's full id, never touches subtasks unless asked, and only removes one task at a time.
- **Chats can do more.** From Discord, Slack, Telegram or your webhook you can now view, update, complete, reopen, delete and restore tasks, not just add them. Each connection can be set to add-only, and the webhook starts that way.
- **Quick add reads durations properly.** "5pm 30m" makes a 30-minute task, and "15 min", "1 h 30 min" and "90 minutes" are always durations.
- **Back-to-back tasks stack** on the calendar instead of squeezing side by side.
- **View-only shares stay view-only** everywhere on desktop and phone.
- **Clearer errors.** When the server needs an update, sharing and connections say so instead of "Something went wrong".
- **Fixes:** restoring a backup keeps its settings; an expired sign-in refreshes instead of signing you out; signing in on a second device no longer overwrites your data; shortcuts and undo wait while a dialog is open; habit colours stay what you picked on the phone; quick add pickers open on iPhone; the phone's Today and widgets roll over to the new day; "Day ends at" now counts for Today's done list and the charts; and several security fixes for shared lists.

## v1.2.0

- **Momentum on your phone.** The Android and iPhone app shows the same tasks, calendar, habits and focus timer, synced within seconds when you're signed in. It has a Today widget, lock-screen quick add, and full-screen alarms for high-priority reminders on Android.
- **Deadlines, separate from when you plan to work.** "Write report fri by mon" plans it for Friday with a Monday deadline. The Matrix now judges urgency by the deadline.
- **Durations without a time.** Type "30m" or "~2h" and Today adds up what you've planned ("4h 10m planned").
- **Someday and Waiting for.** Park a task for someday, or mark it as waiting on a person (it comes back on the follow-up date) or on another task (it comes back once that's done).
- **One thing.** A switch on Today shows only the next task, with Done and Not now. On a low-energy day it sticks to short tasks.
- **Your AI agent can use Momentum.** The `momentum` command and its MCP server let Claude Code, Claude Desktop, Cursor, Codex and Gemini CLI list, add and complete your tasks. Set it up in Settings → AI agents.
- **Calendar subscriptions.** Paste any calendar address (Google's private address, Outlook, iCloud, Proton, Fastmail) to see its events next to your tasks.
- **Import from Todoist and TickTick.** Bring in lists, sections, subtasks, priorities, dates and tags from their export files, with a preview first and one undo.
- **Friends.** Add friends by @handle or invite link. Send each other tasks, focus together, and pick check-in buddies for a habit who can nudge you once a day.
- **Shared lists and folders.** Invite friends or anyone with a link as an editor or viewer. Your reminders, tags and pins stay your own, and tasks can be assigned.
- **Connections.** Add and check tasks from Discord, Slack and Telegram, or send them in through your own webhook, and get a morning digest of your day.
- **Smaller things.** Choose when your day ends (for night owls), snooze a task to a chosen time from any list, see past focus sessions on the calendar, use tables in notes, give habits weekly totals, and subtasks start with their parent's tags.
- **No more rewards.** Badges, confetti, the all-done-day count, the app-wide streak and the share image are gone: points built for screenshots got in the way of a calm planner. Progress now shows plain numbers (what you finished, how long you focused, and the activity heatmap), and each habit still keeps its own streak.

## v1.1.3

- **Move tasks between days.** In Today and Upcoming, drag a task onto another day's task or heading to move it there. It keeps its time. Upcoming now has a heading for each of the next seven days.
- **The calendar makes room for an open task.** With a task open beside the week, the calendar shows the days that fit. Hold a dragged item at the edge and the next day slides in, or use the arrows by the times.
- **Tidier popups.** Several notices at once now line up instead of piling on top of each other.
- **Fixes.** No more "a change to tasks wasn't synced (NOT NULL constraint failed)" errors. Changes those errors held back are fetched again the next time you open the app.

## v1.1.2

- **Settings save when you say so.** Changes wait in an "Unsaved changes" bar until you press Save, and leaving the page asks first. The Scale slider no longer zooms the window while you drag it.
- **Backgrounds that stay put.** Your background image now saves reliably, shows only behind your task lists (the sidebar stays plain, like Microsoft To Do), and can be blurred or left sharp. Backups include the image too.
- **Streak reminders.** If a habit's streak is about to break, you get one reminder at 6 PM. Change the time, or turn it off, in Settings → Notifications.
- **Focus starts on its own.** Turn on "Start focus at time blocks" and a focus session begins when a task you've scheduled on the calendar starts, and stops when the block ends.
- **Report a problem.** Settings → Help has a form for telling us what went wrong, with an optional screenshot.
- **One colour picker.** Lists, habits, events and the Matrix all use the same picker, with presets and any custom colour. Matrix colours are under "Rules & colours", or click a quadrant's dot.
- **Clearer dragging.** A line shows where an item will land, and it settles into place when you let go.
- **Smaller popups.** Notices like "Event deleted · Undo" fit their text, and the update notice is a small card in the corner.
- **Fixes.** No more "task activity wasn't synced" errors. Being offline no longer asks you to choose your handle again. The calendar's side panel button stays visible at any scale. The page behind Getting started and dialogs no longer scrolls. Sending a sign-in code shows that it's working.

## v1.1.1

- **Handles with an @.** Typing an @ at the start of your handle no longer stops it from saving. The @ is shown for you in the field.
- **Your devices by name.** Settings → Account lists each device as Windows, macOS or Linux instead of just "Device". Devices already signed in are named the next time they sync.

## v1.1.0

- **Sync across your devices.** Sign in under Settings → Account with your email and a 6-digit code, and your tasks, lists, habits, calendar, focus sessions and settings stay the same on every computer. Edits you make offline merge when you're back online, field by field, so changes on two devices don't overwrite each other.
- **Optional, and still offline-first.** Without an account, Momentum works exactly as before and nothing leaves your device. When you first sign in, a backup is saved, and everything already on this computer is added to your account.
- **Your account.** Pick an @handle, see your signed-in devices and when they last synced, sync on demand, and sign out on one device or everywhere. When you sign out you choose to keep a copy on this device or remove it.
- **Terms and Privacy.** Read them from the sign-in form or Settings → About. In short: we never sell your data, there are no ads or analytics, and we only send emails with sign-in codes.

## v1.0.2

- **A better Day view.** The calendar's Day mode puts a brief beside the time grid: the date, how much is booked, what's on now or next, and the day as a list. With Arrange open, the grid fills the space instead.
- **Habits for limits and quitting.** Besides building a habit, you can now limit something (say, at most 5 minutes of Instagram a day) or quit it. Limits log what you used; quits log a slip. Streaks, charts and Progress all understand both. The Past year map on each habit is fixed too.
- **Your own background.** Put a colour or one of your images behind the app in Settings → Appearance, and dim it to keep text easy to read.
- **A floating bar.** The bar at the top or bottom can float like a dock. Switch it on in Settings → Appearance → Layout.
- **Open tasks in the middle.** Settings → Appearance → Open tasks in can show a task as a centred window instead of the side panel.
- **See images properly.** Click an image in a task's notes to enlarge it, then zoom and pan. Moving an image's text to another task keeps the image.
- **Tokens in every add box.** `!high`, `#tag`, `~list`, dates and `every day` work in Board columns, Matrix quadrants, the calendar and subtasks, not just the main add bar.
- **Any Matrix colour.** Each quadrant gets a full colour picker.
- **A tidier sidebar.** A bigger logo, the collapse button beside it, and a quieter search shortcut. Scale is now a slider.
- **Show completed lives in Settings.** One switch in Settings → General (or the command palette) shows or hides completed tasks in every view. View tooltips explain List, Board, Timeline and Matrix.
- **Mini window.** The Matrix tab lists every task, and the Focus tab can start a stopwatch.
- **Small fixes.** Saying a priority twice no longer adds it twice, spoken tags drop the word "tag", the quick add text is larger, toasts are evenly spaced, What's new stays open until you close it, trophies fit one row, and Friends on Progress says "coming soon".

## v1.0.1

- **Fits any window size.** The close, minimize and maximize buttons always stay visible, even with a task open. In narrow windows the sidebar shrinks to icons, and toolbars swap labels for icons with tooltips instead of getting cut off.
- **One Scale setting.** Zoom and Text size are now a single Scale (80–175%) in Settings → Appearance, still on Ctrl + / Ctrl − / Ctrl 0. Your current size carries over.
- **Settings, like a phone.** Settings opens to a list of categories you tap into and back out of, with a search box that jumps straight to any setting.
- **A cleaner task panel.** The task panel is narrower, with List, Due, Priority and Tags as chips under the title. Tags wrap instead of being cut off.
- **Focus on a task, a subtask or several.** The Focus page's task picker shows subtasks when you hover a task. Pick one, or tick several (click, Shift-click or drag).
- **Set the length in the mini window.** Its Focus tab shows the real length, with − / + and 15 / 25 / 45 / 60 presets before you start.
- **Fair progress.** A task finished within 2 minutes of being created no longer counts toward trophies, perfect days or charts, and unticking a task straight away cancels its celebration.
- **Calmer calendar.** More room between hours, readable all-day items in narrow columns, a task-count badge on Arrange tasks, and a view menu when the window is narrow.
- **Smoother motion.** Menus, dialogs and the task panel animate out as well as in, toasts stack and can be swiped away, the selected option slides in every switcher, and ticks draw themselves. Settings → Appearance → Animations still turns it all off.
- **Small fixes.** Dropdowns match the app's look, the subtask arrow lines up with its checkbox, tags sit at the end of each row, the filter is now separate from Add a task, and icon buttons have tooltips.

## v1.0.0

- **A new, calmer look.** Every screen is redrawn: warm neutrals, the Inter typeface, one radius scale, quiet borders instead of shadows, and the accent kept for what you act on. Ten accent colours are tuned for light and dark. Your accent carries over.
  ![Today in the new look](whats-new/1.0.0/today.png)
- **One switch for every view.** Any list, Today or Upcoming can show as List, Board, Timeline or Matrix from the toolbar, and Show completed replaces the Logbook. The Matrix is a mode now, so it holds just that view's tasks.
  ![A list in Matrix mode](whats-new/1.0.0/matrix.png)
- **Progress replaces Statistics.** Your week, your perfect-day streak, trophies as medals with levels to climb, and the charts, on one page. Friends will appear here once accounts arrive.
  ![The Progress page](whats-new/1.0.0/progress.png)
- **Countdowns live in the calendar.** Each countdown became an all-day event, and pinned ones still show as chips on Today.
- **Sidebar or bar.** Keep the sidebar (left or right), or switch to a single bar at the top or bottom of the window in Settings → Appearance.
- **Works in a narrow window.** Below about 720px wide, Momentum switches to a phone-style layout with a bottom bar, two-line rows and bigger touch targets.
  ![The narrow layout](whats-new/1.0.0/today-phone.png)
- **Quick add finishes your tags and lists.** Type `#` or `~` and pick from matching tags or lists with the arrow keys and Tab.
- **Subtasks show where they belong.** A subtask sits under its parent when both are in view, and on its own with its parent's name when only it is (a dated subtask in Today, for example).
- **Help, Getting started and the tour know every feature.** The command palette, the `?` sheet, Settings → Help and Getting started all list the same commands, shortcuts and tokens. Getting started ticks items off as you use them.
- **Settings, reorganised.** General, Appearance, Notifications & sounds, Voice, Data, Help, and About & updates, with a section list to jump between them.
- **Starts with your computer.** New installs open Momentum (in the tray) when you log in. Turn it off in Settings → General → Launch at login.
- **Background images are gone.** The new look keeps content on plain surfaces, so the background image setting was removed.
- **Opens on Mac and Linux.** The Mac app is now signed, so it no longer says it's "damaged" (it isn't notarized yet: the first time, right-click it and choose Open). It asks before using the microphone for voice, shows ⌘ shortcuts, and reopens from the Dock. On Linux, the window no longer opens blank on newer graphics drivers, and the `.deb` and `.rpm` install what voice needs.

## v0.9.1

- **Catch up on everything you missed.** Skipped a few updates? What's new now walks you through every one since your last, newest first. The guided tour covers every feature so far, and you can replay it from Settings or by searching "tour".
- **Images in notes behave.** Several images no longer spill over the subtasks: the panel scrolls instead. Hover an image to copy it back out, and deleting it from the note deletes the file too.
- **Delete subtasks from their parent.** Hover a subtask in the task panel and click the bin. Undo brings it back.
- **Tidier reminder popups.** The popup is now exactly the size of its cards, with no box around them.
- **Easier to change your mood.** A habit's face shows "Edit mood & note" on hover, so you can pick another face any time.
- **A little more motion.** Menus and dialogs ease in, and the task panel's sections settle in one after another. Turn it off under Settings → Animations.

## v0.9.0

- **Import many tasks at once.** Paste a list, pick "New line" or your own separator, and Momentum adds each line as a task, reading dates, priorities and tags as usual. The whole import undoes in one step.
  ![Importing pasted tasks](whats-new/0.9.0/import.png)
- **A share card for your stats.** Turn your week or month into a card with tasks done, focus hours, streak and a trophy, then save or copy it. It shows numbers only, never task names.
  ![The share card preview](whats-new/0.9.0/share-card.png)
- **Quick add pickers become chips.** Choose a priority or list and it turns into a chip you can tap to change. The popup now starts fresh every time you open it.
- **Spoken keywords stay spoken.** "List", "priority" and "tag" only work when you say them, so a typed title like "Grocery list" stays as it is. Spoken list names are matched even when they are misheard.
- **Clearer voice.** Momentum trims the silence, lifts quiet recordings and opens the microphone a moment sooner. You can now choose your microphone in Settings.
- **More things to say.** Open any view or list, pause, resume or skip focus, start a break, open or close the mini window, or say "finished" and a task name to tick it off after a quick confirmation.

## v0.8.1

- **Trophies you can climb.** Every trophy now has levels that start small: 10 tasks, then 25, 50, 100 and on up to 2500. The same goes for focus hours, habit streaks, perfect days and perfect weeks. Each level has its own metal and badge shape, from bronze to prism, and every new level gets a celebration.
  ![Trophy cards with levels and progress](whats-new/0.8.0/trophies.png)
- **Your own matrix colours.** Pick a colour for each quadrant in Matrix → Rules, use your accent for all four, or reset to the defaults. Dark mode adjusts them for you.
  ![Choosing quadrant colours](whats-new/0.8.0/matrix-colours.png)
- **Say it instead of typing symbols.** Quick add now understands "priority high", "tag chemistry" and "list School", so voice works without "!" or "#". It matches your own list names, even ones with spaces. In the quick add window you can also tap Priority, List or Tag to set them.
- **Finish tasks from the mini window.** Tasks in its Matrix tab now have checkboxes.
- **Comfortable spacing that sticks.** Comfortable and Compact now always do what you pick, including on shorter screens.
- **Smoother backgrounds.** The whole window frame is softly frosted, so a gradient no longer shows as a hard border around the page, and scrollbars are slimmer and no longer clipped by rounded corners.
- **Tidier boards.** The Unsectioned column no longer pops up while you drag. It only appears when a task actually has no section.

## v0.7.0

- **Images in your notes.** Paste, drop or add pictures straight into a task's note. Zip backups now include them, so nothing goes missing when you restore.
- **Make it yours with a background.** Pick one of 8 gradients or use your own image, then adjust the dim and blur until the text reads comfortably.
  ![A custom image behind the app](whats-new/0.7.0/background.png)
- **A mini window that stays on top.** It shows your current task, the focus timer and the matrix in a small always-on-top window. Open it from the tray, the header button or Ctrl+Alt+M (you can change the shortcut).
  ![The mini window on its Focus tab](whats-new/0.7.0/mini.png)
- **Add tasks by voice.** Hold Ctrl+Alt+Space or click the mic and say what you need. It runs on your computer with NVIDIA Parakeet, so nothing leaves it. This is optional: a one-time 482 MB download from Settings → Voice. A few spoken commands work too, like "start focus".

## v0.6.0

- **A calmer task panel.** Priority, date, list and tags now sit in one row of chips under the title, each opening its editor when you click it. Your notes get the rest of the space, and the activity log stays folded away until you want it.
  ![The task panel with chips and a roomy note](whats-new/0.6.0/drawer.png)
- **Clearer matrix colours.** The four quadrants are red, blue, violet and grey, each with its own tint, so you can tell them apart at a glance whatever accent colour you pick.
  ![The matrix in its new colours](whats-new/0.6.0/matrix.png)
- **An easier dock.** The dock now shows labels under its icons, groups your lists, views and tools, and folds anything that doesn't fit into a More menu. Hover an item to see its keyboard shortcut. Prefer it minimal? Turn labels off in Settings → Layout.
  ![The labelled dock](whats-new/0.6.0/dock.png)
- **Focus sessions that finish.** Choose how many cycles to run, or ∞ to keep going. When the last one ends you get a summary instead of another break. You can also clear the minute boxes while typing; leave one empty and it goes back to its default.
  ![The focus timer with a cycle count](whats-new/0.6.0/focus.png)
- **Folders inside folders.** Nest folders up to three levels deep. Hover a folder for quick buttons to add a list or a subfolder, and drag folders onto each other to reorganise.
- **Rearrange board columns.** Drag a section by its header, or use Move left and Move right in its menu. The Unsectioned column hides when it's empty.
- **Press N anywhere.** N now starts a new task from every view. On boards and the calendar it opens quick add already set to that list or day.
- **Fits your screen.** Momentum opens inside the space your taskbar leaves free, remembers its size and position, and switches to a compact layout on short screens.

## v0.5.0

- **A guided tour.** Momentum now shows you around: it dims the app and walks you through each part, from quick add to the calendar, habits and focus timer, with tips along the way. Take it again any time from Settings → System.
  ![The tour spotlighting quick add](whats-new/0.5.0/tour.png)
- **Top bar layout.** Pick a new layout in Settings → Layout. Top bar puts navigation across the top and gives your tasks the full width.
  ![The top bar layout](whats-new/0.5.0/topbar.png)
- **Dock layout.** A floating dock at the bottom with every view one click away. There's also Flat, an edge-to-edge look, alongside the original Classic.
  ![The dock layout](whats-new/0.5.0/dock.png)

## v0.4.1

- **Updates pop up.** When a new version is out, Momentum asks in a dialog instead of a small message at the bottom.
- **What's new tour.** After an update, Momentum walks you through what changed, with screenshots for bigger releases.

## v0.4.0

- **Celebrations.** Finish everything due today for a perfect day: the logo swooshes in with confetti. Very good weeks, 4-week runs and 52-week runs get bigger celebrations.
- **Streak flame and rest days.** Today shows your perfect-day run. Take one rest day a week without breaking it.
- **Trophies** on the Statistics page, including ones earned from your recent history.
- **Sound effects.** Pick from five sounds for tasks, habits, streaks, perfect days and the focus timer in Settings → Sounds.
- **Focus timer alarm.** The end of a focus round rings, shows a message and flashes the taskbar.
- **Zoom and bigger text.** Zoom from 80% to 175% (Ctrl + / Ctrl − / Ctrl 0) and two larger text sizes.
- **Updates panel** in Settings shows your version, the latest release's notes and download progress.
- The collapsed sidebar's icons are centered.
