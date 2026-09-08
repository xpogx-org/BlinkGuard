# Harness tasks

One active task at a time. Status values: `not-started` | `active` | `verified` | `blocked`.

If nothing is `active`, add or activate before implementing:

`node scripts/harness-start-task.mjs --add --next --title "..." --behavior "..." --proof "..."`

`node scripts/harness-start-task.mjs --activate T-00N`

Check: `node scripts/harness-check-active.mjs` (add `--need-active` to require exactly one).

Do not set `verified` by hand. Run the verify wrapper, then:

`node scripts/harness-mark-verified.mjs <task-id>`

Task id is the text inside `[...]` in the heading (example: `T-001`).

Keep fields exactly as `- key: value` lines so the harness scripts can parse them.

## [T-001] npm run verify exits 0

- behavior: `npm run verify` exits 0 (Layer 1 read-only Biome + `build:electron`, then Layer 2 `coverage`). Layer 3 is missing.
- proof: `npm run verify`
- status: verified
- sddSpec: (none)

## [T-002] Freeze tracking on keyboard idle

- behavior: After 5 minutes of OS keyboard/mouse idle with the screen still on, BlinkGuard freezes timer-mode minutes and soft-pauses the camera the same way quiet hours does; isTracking stays true; first input resumes clock and camera; lock/sleep stay on SessionPauseService; fullscreen and Zoom app-rule still do not freeze minutes.
- proof: npm run verify
- status: blocked
- sddSpec: (none)

## [T-003] Follow Windows light and dark appearance

- behavior: Settings, boot splash, and tray follow Windows light/dark when appearance is system, with explicit Light/Dark override; overlay popups stay on popupColors; backup preserves appearance; EN+UK strings exist.
- proof: npm run verify
- status: verified
- sddSpec: (none)

## [T-004] Icon appearance toggle

- behavior: App chrome theme control is a round icon that shows Light/System/Night; first click expands an animated row in that order; choosing the current option collapses into it; choosing another slides neighbors into the new selection; labels appear only as a long-press hint.
- proof: npm run verify
- status: verified
- sddSpec: (none)

## [T-005] Center appearance row from side

- behavior: When the chrome appearance control opens from a side option (Light or Night), the full Light/System/Night icon row recenters on the collapsed button so the trio sits centered rather than expanding only toward one edge.
- proof: npm run verify
- status: verified
- sddSpec: (none)

## [T-006] Document active development pause

- behavior: README and harness docs state that after 2.20.0 active feature work is paused while issues and requests still get answers
- proof: git show HEAD --stat includes README and docs/harness; wording matches the pause note
- status: verified
- sddSpec: (none)
