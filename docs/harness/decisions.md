# Decisions

Git-tracked. Why we chose X. Do not duplicate `AGENTS.md`, code comments, or git history.

Format for each row:

## YYYY-MM-DD - short title

- **Choice:**
- **Why:**
- **Rejected:**
- **Revisit when:**

## 2026-09-08 - harness installed

- **Choice:** Machine-verified loop with one wrapper, short AGENTS.md router, progress + decisions on disk, one active task.
- **Why:** Naked agents guess checks and lose state between chats.
- **Rejected:** Gitignored-only session state; agent self-marking done; auto-commit.
- **Revisit when:** Changing the verify command / DoD (run `/harness` update interview).

## 2026-09-08 - verify composition (check-not-write)

- **Choice:** Layer 1 is `npx @biomejs/biome check src` then `npm run build:electron`. Layer 2 is `npm run coverage`. Layer 3 is missing (`layer3Status: "missing"`).
- **Why:** `npm run lint` mutates source (`biome check --write`). Read-only Biome plus compile is the static bar; coverage is the test bar. There is no app E2E script.
- **Rejected:** Using `npm run lint` as Layer 1; inventing a Layer 3 wrapper around manual Electron clicks.
- **Revisit when:** An app E2E script exists, or Biome scope grows beyond `src`.

## 2026-09-08 - extra indexes sidecar and tray

- **Choice:** Seven indexes: ui, logic, styles, ipc, tooling, sidecar, tray.
- **Why:** Optional CV sidecar and tray/hush are high-stakes seams that must not land in the AGENTS.md router.
- **Rejected:** Folding sidecar/tray into tooling/logic; pasting protocol or hush essays into indexes.
- **Revisit when:** Those surfaces merge or disappear.

## 2026-09-08 - /deploy HITL

- **Choice:** `/deploy` is an irreversible action. Stop and ask (same bar as `git push`, publish, migrate, delete data).
- **Why:** It merges `development` → `main`, bumps version, tags, and publishes a GitHub Release.
- **Rejected:** Agents running `/deploy` as part of day-to-day harness work.
- **Revisit when:** The release process changes.

## 2026-09-08 - AGENTS.md is a router

- **Choice:** Backup the encyclopedia to gitignored `AGENTS.md.harness-bak`. Tracked `AGENTS.md` is a short router (~40 lines). Detail lives in indexes plus existing rules/skills.
- **Why:** The old AGENTS.md was a second source of truth (Cloud VM, sidecar protocol, layout table). Indexes stay what / where / when-to-open with a pointer, not a paste.
- **Rejected:** Keeping Cloud/sidecar essays in `AGENTS.md`.
- **Revisit when:** Harness update interview, or the router grows past a screen.

## 2026-09-08 - track .cursor in git

- **Choice:** Commit `.cursor/` rules, skills, agents, commands, and hooks. Ignore only `.cursor/plans/` and `*.log` under it.
- **Why:** A clone on another machine needs the same agent setup; gitignored `.cursor/` blocked that.
- **Rejected:** Keeping `.cursor/` local-only; committing session plan files.
- **Revisit when:** Cursor starts writing secrets or large caches under `.cursor/`.

## 2026-09-08 - harness intake + machine progress bullets

- **Choice:** Shared `scripts/harness-tasks.mjs` parser; `harness-start-task.mjs` activates (and can add) a row; `harness-check-active.mjs` fails on two `active`; `harness-mark-verified.mjs` is still the only `verified` writer and now bumps **Verified** / **In progress**. One-active is enforced in scripts.
- **Why:** After T-001 the queue was empty; agents could implement with no harness task. Mark-verified did not sync `progress.md` and did not fail on two `active`.
- **Rejected:** Expanding the verify wrapper (no Python tests, no `check-docs.mjs` in the wrapper, no Layer 3) in this pass; `.ps1`/`.sh` twins for the new CLIs; wiring start/check into `npm run verify`.
- **Revisit when:** Layer 3 exists, sidecar Python unittests join the wrapper, or CI should run `npm run verify`.

## 2026-09-08 - Layer 1 Biome + Layer 2 window-position tests

- **Choice:** Biome `lineEnding: lf`, Tailwind CSS parser, exclude `src/assets/**` (Lottie + unused logos), `src/**` eol=lf in `.gitattributes`, `tsconfig` lib ES2022 for `Object.hasOwn`. Align window-position tests with shadow-inset clamp.
- **Why:** Wrapper Layer 1 was 94 errors (CRLF/format, Tailwind parse, logo a11y). `Object.hasOwn` is Biome’s rewrite of `hasOwnProperty`. Two size-clamp tests still expected pre-gutter geometry.
- **Rejected:** `lineEnding: crlf` (breaks Linux/Cloud); turning off `noPrototypeBuiltins`.
- **Revisit when:** Biome CSS/Tailwind or Electron lib target changes.

