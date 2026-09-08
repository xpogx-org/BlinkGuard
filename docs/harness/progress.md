# Progress

Git-tracked. What is true on disk for the next session / teammate. Not an encyclopedia; not a git log.

**Verified** and **In progress** are machine-owned (`harness-start-task.mjs` / `harness-mark-verified.mjs`). **Blocked** and **Next** are human-edited; scripts do not rewrite them.

- **Verified:** T-001 (npm run verify exits 0); T-003 (Follow Windows light and dark appearance); T-004 (Icon appearance toggle); T-005 (Center appearance row from side); T-006 (Document active development pause)
- **In progress:** (none)
- **Blocked:** T-002 — rejected: BlinkGuard is an eye-blink helper, not an AFK activity checker. Keyboard idle cannot tell a coffee break from watching or reading; freeze-on-idle is out of product scope.
- **Next:** Active feature work paused after 2.20.0 (see decisions.md). Triage issues/requests only until revisit. Do not revive keyboard-idle freeze.
