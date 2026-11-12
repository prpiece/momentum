# D4 · Phone design system, motion and gestures (Gate 3)

Status: **draft for approval**, combined with D2, D3, D5 and D6.

Colours come from the shared source (`docs/design/momentum-tokens.css`, generated into `mobile/src/theme/tokens.ts`, D250). Everything below is phone-only and lives in `mobile/src/theme`.

## 1. Type roles

Sizes are in pt/dp at the default text size. All roles scale with Dynamic Type and Android font scale. **Cap:** `maxFontSizeMultiplier` is 2.0 for body roles and 1.4 for the tab-bar label and the timer.

| Role | Font | Size / line | Weight | Used for |
|---|---|---|---|---|
| `display` | Bricolage Grotesque | 34 / 40 | 600 | Page titles (Today, Habits, a list). At most one per screen. |
| `title` | Bricolage Grotesque | 24 / 30 | 600 | Calendar month, onboarding headlines (28/34). |
| `heading` | Inter | 20 / 28 | 600 | Sheet titles, the task title in the sheet. |
| `body` | Inter | 16 / 22 | 500 (titles) / 400 | Row titles, inputs (18/26 in quick add). |
| `secondary` | Inter | 15 / 22 | 400 | Notes, explanations. |
| `meta` | Inter | 13 / 18 | 400 | Row meta, sub-lines. |
| `label` | Inter | 12 / 16 | 600, +0.06em, uppercase | Group headers (OVERDUE, TODAY). |
| `tab` | Inter | 12 / 16 | 500 | Tab and rail labels. |
| `timer` | JetBrains Mono | 88 | 500 | The focus clock only. 26 in the bar and the Live Activity. |

Rules:
- All counts, times and dates use tabular figures.
- Weight carries the hierarchy, not colour (CLAUDE.md).
- No role below 12.

## 2. Space, size, touch

- **Grid:** 4. **Gutter:** 20 at page edges and 16 for inset cards.
- **Rows:** min 52 (title only) or 64 (title and meta). Rows grow with text; never a fixed height.
- **Touch targets:** 44 minimum everywhere, including the ring, chips, Retry and Undo. The visible ring is 22; its hit area is the 44 square around it.
- **Primary buttons:** 52 tall in onboarding, 48 in sheets.
- **Radii:** 6 for controls and chips, 10 for cards and grouped lists, 14 for sheets (top corners), 22 for widgets (system), full for rings and pills.
- **Elevation:** one shadow, for floating layers only (sheets, toasts, the running-focus bar, a dragged block). Everything else sits on a border or a surface step.

## 3. Surfaces

- **Light:** `--surface` for content, `--bg` for the tab bar and rail, `--raised` for sheets, plus a scrim of `fg` at 32%.
- **Dark:** surfaces step up `#1B1D22` → `#24262C` → raised `#2E3037`, with no pure black. The scrim is black at 50%. Inside a sheet, fills step up one level, the same rule as desktop's `.layer-raised`.
- **Toasts:** inverted (`fg` background, `surface` text) so they read over any content.
- **Tab bar:**
  - 84 tall including the home indicator inset.
  - Labels always shown.
  - The active item uses `accent-text`.
  - The + is a 52 circle in `accent`, the only large accent fill on a screen.
- **Rail (expanded):** 80 wide, + at the top, active item on an `accent-soft` pill.

## 4. Icons

- **Lucide** (`lucide-react-native` + `react-native-svg`): the same set as desktop.
- The built app uses Feather through `@expo/vector-icons`. Feather is Lucide's ancestor, so the switch is mostly renames.
- Stroke 1.75 at 20, 2 at 16 and below.
- **New dependencies** for R1 need their line in PLAN §4: `lucide-react-native`, `react-native-svg` and `expo-haptics`. Expo modules are installed with `npx expo install`.

## 5. Motion

These extend the desktop tokens. Reanimated 4 is already installed (unused so far).

| Token | Value | Use |
|---|---|---|
| `fast` | 150 ms, ease-out | Fades, chip appear, ring fill. |
| `base` | 180 ms, ease-out | Toast in, group collapse. |
| `slow` | 220 ms, ease-out in / ease-in out | Pane and sheet fade on expanded widths. |
| `spring.sheet` | damping 26, stiffness 260 | Sheet open, close and snap. Follows the finger. |
| `spring.lift` | damping 18, stiffness 300, scale 1.03 | Drag pickup in the calendar and lists. |
| `settle` | 180 ms, ease-move | A dropped block settles into its slot (D243). |
| `complete` | ring fill 150 ms, then the row leaves for Done after 600 ms | Gives time to see it and to undo. |

**Reduced motion:**
- Springs and moves become 0 ms or crossfades.
- The completed row moves to Done at once.
- Haptics stay; they aren't motion.
- Nothing loops or decorates (anti-slop "motion as decoration").

## 6. Haptics (D246)

| Moment | iOS | Android |
|---|---|---|
| Complete a task or check in a habit | `impactAsync(Light)` | `performAndroidHapticsAsync(Confirm)` (or `CLOCK_TICK` where Confirm is missing) |
| Drag pickup in the calendar or lists | `selectionAsync()` | `Long_Press` |
| Drag crossing a 15-min snap | `selectionAsync()`, throttled to one every 60 ms | none |

They follow the OS haptics setting. There are no haptics on errors, toasts or navigation.

## 7. Gestures

Each gesture is a hypothesis, specified against the skill's checklist.

| Gesture | Trigger and threshold | Scroll conflict | Accidental activation | Feedback | Cancel and undo | Visible alternative | Verdict |
|---|---|---|---|---|---|---|---|
| **Row swipe right → complete** | Horizontal pan > 10 px before vertical; commits at 35% of row width | Vertical pan wins under 10 px; `activeOffsetX` ±10, `failOffsetY` ±8 | Needs 35%, so a flick across doesn't commit | Success-soft fill reveals a check and "Complete"; haptic at the threshold | Releasing before the threshold springs back; Undo toast | Ring tap | **Keep** |
| **Row swipe left → reschedule** | Same, mirrored | Same | Same | Accent-soft fill with "Reschedule"; on release, opens the date picker (nothing changes until a date is picked) | Close the picker | Due row in the sheet; Overdue "Reschedule" | **Keep** |
| **Press and hold to move (calendar)** | 350 ms (Observed) | Scroll is cancelled once the hold activates; edge auto-scroll near the top and bottom | Short presses do nothing | Lift (scale 1.03, shadow, haptic); live time label; ghost at the origin | Drop at the origin, or an interruption, cancels; Undo toast | Start/End rows in the sheet | **Keep** |
| **Drag bottom edge to resize** | 16 px handle zone (hit area 44) on blocks ≥ 32 px | Same as move | Handle only shown on blocks ≥ 32 px | Live end time | Same | End row | **Keep** |
| **Press and hold to reorder in a list** | 400 ms | Same as the calendar | Same | Lift plus a 2 px insertion line (D243) | Same | None needed: order is not consequential | **Keep** (manual order only) |
| **Sheet swipe down to dismiss** | Native sheet | Content scroll first, then the sheet | — | Follows the finger | Swipe back up | Done or Close button | **Keep** |
| **Pull to refresh** | — | — | — | — | — | — | **Rejected:** sync is automatic, and a pull gesture suggests it isn't. Retry lives in the error banner. |
| **Swipe left → delete** | — | — | — | — | — | — | **Rejected:** destructive. Delete lives in the sheet. |
| **Pinch to zoom the calendar** | — | — | — | — | — | — | **Deferred:** conflicts with scroll and drag. Revisit after R1. |
| **Long-press for a context menu on rows** | — | — | — | — | — | — | **Deferred:** every action already has a home. Add if testing shows people look for it. |
