# Design-rule compliance (DES)

Scope: src/**/*.tsx, mobile/src/ (tokens, radii, shadows). Part of the [v1.2.4 test findings](README.md). Each entry says whether a probe test proved it or it rests on reading the code; prove it with a failing test before fixing (the v1.2.1 rule).

Scope: `src/` (excluding `*.test.*` and `src/dev/`) and `mobile/src/`. Token definitions (`src/styles/tokens.css`, `src/domain/color.ts`, `mobile/src/theme/tokens.ts`) and generated `mobile/src/db/migrations.ts` were excluded. No files were modified and no builds or tests were run.

Checked and clean: no `rounded-lg/md/xl/2xl`, no Tailwind palette colours, no `--accent` set inline, no web fonts or `fonts.googleapis`, no `%APPDATA%` shown to users (only inside `dataDirLabel`), Ctrl/Alt/Shift text always goes through `Keys`/`Kbd`/`keyLabel`, Bricolage (`t-title`/`t-display`) at most 2 per file, `<img>` tags all have `alt` (one decorative `alt=""`), icon-only buttons all have `aria-label` where checked, and no emoji in chrome (`AppIcon.tsx` maps user-typed emoji to icons, which is user content).

### DES-01 · medium · bug · Rule 1: Hard-coded white text on accent or event fills, including where the fill is light
- [ ] Status: open
- Where: `src/components/ui/ColorField.tsx:24`, `src/components/ui/ColorField.tsx:41`, `mobile/src/app/(tabs)/calendar.tsx:116`, `mobile/src/app/(tabs)/calendar.tsx:236`, `mobile/src/app/(tabs)/calendar.tsx:240`
- What happens: the check mark on swatches and the event-block text use `text-white` or `color: "#FFFFFF"` regardless of the fill. Several presets are light (Amber `#e0a021`, Fern/Teal mid-tones, and the Graphite and Slate fills in dark mode), so white text on them falls below WCAG AA. Calendar titles at 11-12px are the most affected. Dark-mode fills also bypass `on-strong`.
- Expected: text on a fill is picked by contrast, as `accentForeground()` already does in `src/domain/color.ts:76` (used by `MatrixView`).
- Suggested fix: swatch check uses `accentForeground(p.hex)` as its `color`. Calendar blocks use `accentForeground(resolved fill)` instead of `#FFFFFF`. Drop `text-white mix-blend-difference` on the custom swatch and use the same helper.

### DES-02 · low · bug · Rule 1: Hard-coded white or black in mobile settings check icon
- [ ] Status: open
- Where: `mobile/src/app/settings.tsx:34`
- What happens: the selected accent's check icon is `c.mode === "dark" ? "#141519" : "#FFFFFF"`. It duplicates the `accent-fg` token by hand, so it drifts if the tokens change.
- Expected: `c.accentFg` or the `accent-fg` token from `mobile/src/theme`.
- Suggested fix: `color={c.accentFg}` (or whichever key the theme exposes for `accent-fg`).

### DES-03 · low · bug · Rule 1: Hard-coded `text-white` on the window close hover
- [ ] Status: open
- Where: `src/features/shell/WindowControls.tsx:55`
- What happens: `hover:text-white!` on the close button. The hover background is the `danger` token, but its foreground is a fixed palette white. In dark mode `danger-fg` is `#141519`, so the icon is white on the token background in one theme and not the other.
- Expected: `danger-fg` (token) is the foreground for `danger`.
- Suggested fix: `hover:text-danger-fg!`.

### DES-04 · low · bug · Rule 1: Toggle knob hard-coded to `#fff`
- [ ] Status: open
- Where: `src/styles/components.css:45`
- What happens: `.toggle::after { background: #fff }`. The knob is always white, including in dark mode where surfaces are `#1B1D22`. This is not a token.
- Expected: knob colour from a token.
- Suggested fix: `background: var(--accent-fg)` (white in light, near-black on the dark accent). If a knob that is always light is intended, add a `--knob` token to both themes instead of inlining `#fff`.

### DES-05 · low · bug · Rule 1: Habit colour hex map duplicates the `h-*` tokens and adds an untokenised fallback
- [ ] Status: open
- Where: `src/db/habitRows.ts:44`, `src/db/habitRows.ts:47`, `src/db/habitRows.ts:50`
- What happens: `HABIT_HEX` hard-codes five hexes that repeat `--h-*`. The fallback `"#5b5bd6"` (the indigo habit colour) is not in the token set. The hex values are fixed, so dark mode gets the light-theme colours on habits, unlike `--h-*`, which has a dark variant.
- Expected: habit colours come from `--h-*` (or `var(--h-…)` strings) so they follow the theme.
- Suggested fix: map to `"var(--h-blue)"` etc. and fall back to `"var(--h-violet)"` or the indigo token, if the consumer accepts a CSS string. Otherwise keep the map but read it from the same token source as `ACCENTS`.

### DES-06 · low · bug · Rule 1: Picker handle uses `border-white` and a hard-coded `rgb()` shadow
- [ ] Status: open
- Where: `src/components/ui/ColorPicker.tsx:25`
- What happens: the handle is `border-white shadow-[0_0_0_1px_rgb(0_0_0/0.45)]`. This is a fixed white ring with an arbitrary shadow, not tokens. The spectrum stops (`ColorPicker.tsx:84`, `:98`) are picker content and are left alone.
- Expected: tokens for ring and border colours.
- Suggested fix: `border-raised` (or `border-surface`) for the ring, and a focus or ring token instead of the arbitrary shadow.

### DES-07 · low · bug · Rule 2: Gradient (and shine highlight) in the generated app icon
- [ ] Status: open
- Where: `src/lib/os.ts:97`
- What happens: the icon SVG uses a `linearGradient` "shine" overlay with white stops. The rule bans gradients. This is brand artwork rather than chrome, so it may be a deliberate exception, but it is not documented as one.
- Expected: flat icon, or a documented exception.
- Suggested fix: remove the `<linearGradient>` and the `url(#shine)` overlay, or add a comment naming it as an intentional exception to PLAN D172.

### DES-08 · low · bug · Rule 2: Extra box-shadow rings and arbitrary shadows outside `shadow-float`
- [ ] Status: open
- Where: `src/styles/components.css:126`, `src/styles/components.css:177`, `src/styles/components.css:178`, `src/components/ui/ColorPicker.tsx:25`
- What happens: `.settings-hit` adds a 6px spread halo (`0 0 0 6px var(--accent-soft)`), and the selected swatch uses two box-shadow rings. These are not `shadow-float`, and the rule allows one shadow for floating layers only. The swatch and halo are selection states, not floating layers, so this is a rule breach even if the look is intended.
- Expected: selected or highlighted state uses `outline` or `ring` on tokens, not shadow.
- Suggested fix: `.settings-hit` uses `outline: 6px solid var(--accent-soft)` with the border radius, or `background` alone. The swatch ring uses `outline: 2px solid var(--surface)` plus `outline-offset` for the inner ring, and `outline: 2px solid var(--sw)` on the outer ring.

### DES-09 · low · bug · Rule 2: Extra shadow on phone "lifted" drag item
- [ ] Status: open
- Where: `mobile/src/app/(tabs)/calendar.tsx:329`
- What happens: `lifted` sets `elevation: 8, shadowColor: "#14120F", shadowOpacity: 0.2, shadowRadius: 12`. This is a second shadow recipe, not `shadow-float`, and the colour is a hard-coded hex.
- Expected: the same `--shadow` token used on desktop floating layers.
- Suggested fix: drive the shadow values from one theme shadow helper (or the `shadow` token values) so the phone uses the same recipe as desktop `shadow-float`.

### DES-10 · low · bug · Rule 2: Blur applied to the user's background image
- [ ] Status: open
- Where: `src/features/shell/BackgroundLayer.tsx:31`
- What happens: `bg.blur ? "scale-105 blur-[6px]"` blurs the user's wallpaper. The rule allows blur only on the Dialog scrim (`Dialog.tsx:50`, `backdrop-blur-[6px]`, allowed) and in short entry animations. A persistent blur on a background layer is outside both.
- Expected: no persistent blur on chrome. A user-chosen background is a separate case and should be a documented exception.
- Suggested fix: keep it only if it is a deliberate user setting, and add it to PLAN D202 with the Dialog exception. Otherwise remove the blur option.

### DES-11 · low · bug · Rule 5: `font-mono` used for code samples, not only the focus timer
- [ ] Status: open
- Where: `src/features/settings/AgentsPanel.tsx:45`, `mobile/src/app/connections.tsx:88` (used at lines 100-102)
- What happens: the rule limits `font-mono` and `.t-timer` to the focus timer. `AgentsPanel` uses it for a `<pre>` config sample, and the phone's connections screen uses `fontFamily: "monospace"` for the `/task link` commands the user copies. Both are code or command text, which is a reasonable use but outside the stated rule.
- Expected: JetBrains Mono only for the focus timer, per the Design tokens section.
- Suggested fix: keep the monospace for copyable command text, but either document these as exceptions in the feature registry or use the body font with `font-mono`-free styling and `select-all`. The `--font-mono` token is named "mono" and aliases the timer font, so consider renaming it to `--font-code` to avoid this confusion.

### DES-12 · low · bug · Rule 6: Arbitrary pixel radii instead of the radii scale
- [ ] Status: open
- Where: `src/windows/MiniWindow.tsx:243` (`rounded-[2px]`), `src/features/calendar/EventDialog.tsx:76` (`rounded-[4px]`), `src/features/progress/Heatmap.tsx:44` and `:56` (`rounded-[2px]`), `src/features/matrix/MatrixView.tsx:88` (`rounded-[2px]`), `src/features/calendar/AgendaRow.tsx:19` (`rounded-[4px]`), `src/features/settings/LayoutPicker.tsx:14` (`rounded-[2px]`), `src/features/settings/LayoutPicker.tsx:38` and `:43` (`rounded-[3px]`), `src/features/habits/HabitDetail.tsx:187` (`rounded-[2px]`), `src/features/habits/HabitDetail.tsx:197` and `:207` (`rounded-[3px]`)
- What happens: the scale is `xs` 4px, `control` 6px, `card` 10px, `panel` 14px. The 4px uses are already `rounded-xs` in value, and the 2px and 3px marks are off-scale. The sites are small data marks and swatches, so the visual impact is low.
- Expected: `rounded-xs` or `rounded-control` (or a documented micro-radius).
- Suggested fix: replace `rounded-[4px]` with `rounded-xs`. Replace `rounded-[2px]` and `rounded-[3px]` with `rounded-xs`, or add a single `rounded-micro` utility if the 2px/3px difference matters for the mark.

### DES-13 · low · bug · Rule 7: `outline-none` on bare text inputs with no own focus indicator
- [ ] Status: open
- Where: `src/features/calendar/EventDialog.tsx:77`, `src/features/tasks/FilterBar.tsx:51`, `src/features/tasks/TaskDrawer.tsx:306`, `src/features/help/HelpSection.tsx:27`, `src/features/focus/TaskPicker.tsx:153`
- What happens: each input uses `outline-none` with no `focus-visible:` replacement on the element itself. If the parent does not show focus (for example through `.input-wrap:focus-within` in `components.css:101`), keyboard users cannot see where focus is. `EventDialog`'s title input has no wrapper focus style in the lines I checked. The other four may be covered by a wrapper (not verified).
- Expected: every focusable element has a visible focus ring (`--accent-text`).
- Suggested fix: on each input, replace `outline-none` with the pattern `KanbanView.tsx:161` uses: `focus-visible:shadow-[var(--focus-ring-input)] focus-visible:outline-none`, or wrap in `input-wrap`. Verify the four wrapped ones first, which may need no change.

### DES-14 · low · bug · Rule 7: Clickable `span` without role, tabIndex or keydown
- [ ] Status: open
- Where: `src/features/focus/TaskPicker.tsx:247`
- What happens: a subtask row is `<span onClick={() => commitSubs([s.id])}>`. It has no role or tabIndex. Keyboard use works through the combobox's `aria-activedescendant` (the `zone === "sub"` path), so this is a semantic gap, not a keyboard trap.
- Expected: the clickable row is exposed as an option (or button) with the same id the `aria-activedescendant` points to.
- Suggested fix: make it `role="option"` with `id={`pks-${s.id}`}` and `aria-selected`, matching the `pks-` activedescendant target, and keep the `onClick`.

---

Skipped as false positives or accepted exceptions:
- Rule 9 networking checks, per the coordinator's update that Momentum is moving away from offline-first. This covers `fetch` in `src/features/tasks/NoteMarkdown.tsx:45`. No web-loaded fonts (`fonts.googleapis`) were found, so there is no font entry.
- Hex in `src/domain/color.ts`, `src/styles/tokens.css` and `mobile/src/theme/tokens.ts` (token definitions).
- Hex defaults in data or seed code: `src/domain/subscriptions.ts:74`, `src/stores/habits.ts:62`, `src/features/settings/BackgroundSection.tsx:13`, `src/dev/seed.ts`.
- Colour-picker spectrum gradients (`ColorPicker.tsx:84`, `:98`), stated as picker content in its own comment.
- `repeating-linear-gradient` in `TimeGrid.tsx:301`, used as hairline grid lines, not a visible gradient.
- `backdrop-blur-[6px]` on the Dialog scrim, and `blur(…)` in `tokens.css:498` and `:505` (short entry animations).
- `focus-visible:shadow-[…]` focus rings, which are required.
- Emoji in `src/components/ui/AppIcon.tsx:133-138`, which map user-typed emoji to icons (user content).
- Generated `mobile/src/db/migrations.ts`.
- `%APPDATA%` in `src/lib/platform.ts:9`, inside `dataDirLabel`.
- `TaskPicker.tsx:214` (`div role="option" onClick`), which has a role and keyboard support through `aria-activedescendant`.
- `NoteMarkdown.tsx:27` (`span onClick={stopPropagation}`), which is not an action.
---

Totals: 14 entries (1 medium, 13 low). Widest violations:
1. Rule 6, arbitrary px radii: 11 sites across 9 files.
2. Rule 1, hard-coded white text or fills (`text-white`, `#FFFFFF`, `#fff`): about 8 sites, including the two medium-severity contrast risks on swatches and phone calendar blocks.
3. Rule 2, extra shadows and rings outside `shadow-float` (box-shadow rings, mobile lifted shadow, arbitrary shadow): 5 sites.
