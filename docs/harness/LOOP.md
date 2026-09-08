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

## Work

1. Set (or keep) one task `active`. Do not start a second.
2. Implement the behavior. Do not leave the tree half-broken. Clean up temps on exit.
3. Refresh **touched** indexes under `docs/harness/indexes/` (what / where / when-to-open). "Done" is illegal without this.
4. Update `progress.md` and any new `decisions.md` rows (choice, why, rejected, revisit).
5. Run the verify command from `docs/harness/manifest.json` (`verifyCommand`). One wrapper, one verdict. Do not shop for a greener tool.
6. If the wrapper exits non-zero: fix; do **not** edit status to `verified`.
7. If the wrapper exits 0: `node scripts/harness-mark-verified.mjs <task-id>`. That script is the only writer of `verified`.
8. Do **not** commit unless the user asked.

## Forbidden

- Writing `status: verified` (or saying "treat as verified")
- Auto-commit
- Refactor-only work while Layer 1 or Layer 2 of the wrapper is red
- Irreversible/prod actions without a human (`git push`, publish, migrate, delete data, `/deploy`, plus any extras in the manifest `irreversibleActions`)
- Cursor hooks, `CLAUDE.md`, git worktrees (v1)

## Language

Injected and edited harness docs stay in the repo's agent-doc language (English unless the repo already documents otherwise).
