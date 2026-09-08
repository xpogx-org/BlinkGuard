<!-- harness-stock: true -->
# Harness daily loop

Parent agent runs this loop. Spawn helpers only for an isolated index refresh or for running the verify wrapper. Do not fan out one subagent per index area.

## One active task

Read `docs/harness/tasks.md`. At most one item may be `status: active`. Next task starts only after the current one is `verified` (or `blocked` with a reason in `progress.md`) **and** touched indexes were refreshed.

Each task is the triple:

- **behavior** - what must be true
- **proof** - the verify command / scenario
- **status** - `not-started` | `active` | `verified` | `blocked`

If `sddSpec` is set, that path (`specs/active/<id>/`) is the planning SoT. Harness is the runtime loop. Do not replace SDD docs with harness state.

## Intake

If nothing is `active`, do not implement. Add or activate a row first:

```
node scripts/harness-start-task.mjs --add --next --title "..." --behavior "..." --proof "..."
node scripts/harness-start-task.mjs --activate T-00N
```

`--activate` only from `not-started`. The script fails if any row is already `active`. You may write the triple by hand, then `--activate`.

Sources: a user ask, a next-product-gaps brief (planning first), or SDD via `sddSpec`. Gitignored `specs/` is the planning SoT; the harness row is the runtime tracker.

`proof` may name a scenario, but `harness-mark-verified.mjs` still requires a green wrapper stamp.

After mark-verified, trust the script for the **Verified** and **In progress** bullets in `progress.md`. Refresh touched indexes. Run `/docs` only when prefs, IPC, UI, or sidecar contracts drifted (not a wrapper layer).

Blocked: set `status: blocked` by hand and put the reason under **Blocked:** in `progress.md`. Then another task may start.

Helpers: dual-ui / sidecar / tray / docs-auditor reviewers are allowed when that surface is in play. Still no one-subagent-per-index.

Harness v1 does not add Cursor hooks. Do not delete existing repo hooks.

Check the queue:

```
node scripts/harness-check-active.mjs
node scripts/harness-check-active.mjs --need-active
```

## Work

1. If nothing is `active`, stop and use Intake (`harness-start-task.mjs`). Do not start a second `active`.
2. Implement the behavior. Do not leave the tree half-broken. Clean up temps on exit.
3. Refresh **touched** indexes under `docs/harness/indexes/` (what / where / when-to-open). "Done" is illegal without this.
4. Update `progress.md` **Blocked** / **Next** by hand if needed, and any new `decisions.md` rows (choice, why, rejected, revisit). Do not hand-edit **Verified** / **In progress** after mark-verified.
5. Run the verify command from `docs/harness/manifest.json` (`verifyCommand`). One wrapper, one verdict. Do not shop for a greener tool.
6. If the wrapper exits non-zero: fix; do **not** edit status to `verified`.
7. If the wrapper exits 0: `node scripts/harness-mark-verified.mjs <task-id>`. That script is the only writer of `verified`. It also moves the id from **In progress** onto **Verified**.
8. Do **not** commit unless the user asked.

## Forbidden

- Writing `status: verified` (or saying "treat as verified")
- Auto-commit
- Refactor-only work while Layer 1 or Layer 2 of the wrapper is red
- Irreversible/prod actions without a human (stop and ask before every item in the manifest `irreversibleActions`)
- Adding Cursor hooks, `CLAUDE.md`, or git worktrees (v1). Do not delete existing repo hooks.

## Language

Injected and edited harness docs stay in the repo's agent-doc language (English unless the repo already documents otherwise).
