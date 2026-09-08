---
name: harness-loop
description: >-
  Daily harness work loop for this repo (one active task, verify wrapper,
  no self-verify). Use when claiming done, starting a harness task, or running verify.
disable-model-invocation: true
---

<!-- harness-stock: true -->

Read `docs/harness/LOOP.md` and follow it.

Never write `status: verified` in `docs/harness/tasks.md`. Run the verify command from `docs/harness/manifest.json`, then `node scripts/harness-mark-verified.mjs <task-id>`.
