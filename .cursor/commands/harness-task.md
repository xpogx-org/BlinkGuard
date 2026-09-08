# /harness-task

Start or close a harness task in this repo.

**Invoke skill:** `harness-loop`

## Steps

1. Read `docs/harness/LOOP.md` and `docs/harness/tasks.md`.
2. Read `.cursor/skills/harness-loop/SKILL.md`.
3. If the user wants to start work and nothing is `active`:
   - Prefer `node scripts/harness-start-task.mjs --add --next --title "..." --behavior "..." --proof "..."` (optional `--sddSpec`).
   - Or write the triple by hand, then `node scripts/harness-start-task.mjs --activate T-00N`.
   - Do not implement until that command succeeds.
4. If the user wants to close a task after a green wrapper:
   - `node scripts/harness-mark-verified.mjs <task-id>`
   - Never write `status: verified` by hand.
5. Optional check: `node scripts/harness-check-active.mjs` (`--need-active` when work is in flight).
