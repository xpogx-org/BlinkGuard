---
name: harness-loop
description: >-
  Daily harness work loop for this repo (one active task, verify wrapper,
  no self-verify). Use when claiming done, starting a harness task, or running verify.
---

<!-- harness-stock: true -->

Read `docs/harness/LOOP.md` and follow it.

Before implementing: exactly one `active` task. If none, run
`node scripts/harness-start-task.mjs` (`--add` or `--activate`). Do not start a second
`active`. Check with `node scripts/harness-check-active.mjs`.

Never write `status: verified` in `docs/harness/tasks.md`. Run the verify command from
`docs/harness/manifest.json`, then `node scripts/harness-mark-verified.mjs <task-id>`
(updates `tasks.md` plus the **Verified** / **In progress** bullets).
