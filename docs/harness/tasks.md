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
