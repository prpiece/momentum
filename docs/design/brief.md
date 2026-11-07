# Momentum v1.0 visual brief

For mocking in Claude Design. The spec is `docs/specs/v1.0-simplify-redesign.md` (§9). The current look is in `docs/screenshots/`: the aim is to replace it, not to polish it.

## What Momentum is

A desktop planner (Windows, macOS, Linux; phones later) for tasks, a calendar, habits and a focus timer, with progress and trophies. Signing in, syncing and friends come in later releases. In v1.0 they appear only as empty places. The line we lead with is "The planner you do with friends", with "Capture anything instantly, even offline" in support.

The feedback we're answering: "there's too much, and it looks vibecoded". The new design must feel deliberate and quiet, and make the core path (capture → plan today → do) obvious.

## References

- **Things 3:** calm, generous space, typography doing the work.
- **Linear:** precise, keyboard-first, dense where it needs to be, no ornament.
- **TickTick:** a familiar planner structure (sidebar of lists, smart lists, calendar), so it's never confusing.

## Adjectives

**Calm, precise, warm.** Calm means low contrast in the chrome and high contrast in the content. Precise means aligned to a grid, with consistent spacing and no "almost" alignments. Warm means a warm off-white light theme and warm greys, not cold blue-grey.

## Rules

- **No** glass, frosted blur, gradients, glows, background images or decorative illustration.
- **One radius scale:** 6px for controls (buttons, inputs, chips), 10px for cards and menus, 14px for dialogs and panels. Checkboxes are circles.
- **One shadow level,** used only for floating layers (menus, dialogs, popovers). Cards sit on borders or a surface step, never on shadows.
- **Spacing:** a 4px grid. Row height about 36px (32px in compact density). 44px minimum touch target on anything clickable at narrow width.
- **Type:** Plus Jakarta Sans for UI. JetBrains Mono, or tabular figures, for times, timers and counters. About 4 sizes in total: 12, 13/14 (body), 16, 22 (page title). Weight does the hierarchy, not colour.
- **Colour:** neutrals carry the UI. The accent is for the primary action, selection and focus rings only, never for large areas. Priority colours (low, medium, high) and the 4 matrix quadrant colours stay fixed and must stay distinguishable from the accent.
- **Icons:** one outline icon set at one stroke width (currently Lucide-style, 1.75px stroke, 16/18px). **No emoji in the UI chrome.** Emoji appear only when a user typed them (a list name, a habit name). The tour's 💡, the streak 🔥 and the trophy 🏆 become icons.
- **Motion:** only when state changes (completing a task, opening a panel), 150–220ms. Nothing under reduced motion. Celebrations stay but are short (under a second).
- **Accent palette:** about 10 presets. The current 9 are Indigo #5b5bd6, Ocean #2f6fed, Teal #0e8a85, Fern #2f9358, Amber #d18a14, Coral #e1583f, Rose #d6457a, Violet #8a4fd8 and Slate #56607a. Adjust them as needed so each passes WCAG AA as a button with white or near-black text, in both themes.
- **Dark mode** uses layered surfaces (around #141519 → #1b1d22 → #24262c), never pure black. Text meets WCAG AA in both themes.
- **One breakpoint:** below about 720px wide, the layout becomes the phone layout (the bar at the bottom, single column, the task drawer as a full-height sheet).

## Navigation

- **Top level, and nothing else:** Inbox, Today, Upcoming, Calendar, Habits, Focus, Progress, then the user's folders and lists. Settings sits at the bottom or in a menu.
- **Two layouts:** a **sidebar** (left or right), or a **bar**, a single horizontal strip at the **top** or the **bottom** with labels always shown and a "More" overflow.

## Screens to mock

Each in light and dark, at desktop width (about 1280×800) and narrow width (about 390×844).

1. **Today.**
   - The Getting started card at the top (dismissable, 6 items with ticks, a collapsible "More to try").
   - 1–3 pinned countdown chips ("12 days until Trip").
   - The compact streak flame (an icon, not an emoji).
   - Overdue, then today's tasks. A quick-add field.
   - Show a task with: a priority, a tag, a due time, a subtask count, a recurring marker and a note marker.
2. **A list in all 4 view modes,** with the mode switch (List, Board, Matrix, Timeline) in the view header, beside a Show completed toggle and the filter.
   - **List:** sections as headed groups.
   - **Board:** sections as columns, plus an Unsectioned column.
   - **Matrix:** the 4 quadrants (Do, Schedule, Delegate, Drop) holding this list's tasks only.
   - **Timeline:** tasks on a horizontal day axis.
   - Also the **task drawer** open on one task: title, checklist, subtasks, note with an image, schedule, reminders, tags.
3. **Progress,** top to bottom:
   - **This week:** tasks done, focus hours, perfect days (leave room for a weekly score number to come).
   - **Streaks:** current perfect-day streak, best streak, rest day.
   - **Trophies:** a shelf of trophy kinds, each with a level look.
   - **Trends:** 14-day bars, 12-week bars, a contribution-style heatmap, habit consistency.
   - **Friends, empty:** "Sign in to add friends and compare your week" with a disabled button. Make it inviting, not an error.
   - A Share button in the header.
4. **Settings → Help:** a search box over every command, grouped (Tasks, Views, Habits & focus, Capture, Progress, Keyboard). Each row: an icon, a title, a one-line how-to, and its shortcut keys or token chips. Show the settings section list beside it (General, Appearance, Notifications & sounds, Voice, Data, Help, About & updates).
5. **The Getting started card** on its own, in three states: fresh, half-done, and with "New:" items after an update.

Nice to have: the command palette, the quick-add popup window, and the 4-slide tour.

## Components to settle

Button (primary, secondary, ghost, danger), text input, search input, menu, dialog, chip (tag, token, countdown), card, segmented control (the view-mode switch), toggle, task row (with its states: hover, selected, completed, overdue), checkbox, section header, empty state.

## Done when

The mocks cover the screens above in both themes and both widths, and use only the rules above. Then implementation follows the order in the spec §9.
