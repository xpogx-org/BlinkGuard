# AGENTS

Hard constraints (do not bury these):

- One active harness task at a time (`docs/harness/tasks.md`). Before implementing: exactly one `active` task (`node scripts/harness-start-task.mjs` if none).
- Never write `status: verified` by hand. Run `npm run verify`, then `node scripts/harness-mark-verified.mjs <task-id>` (updates `tasks.md` + progress bullets).
- Commit only if the user asked.
- Stop and ask before: `git push`, publish, migrate, delete data, `/deploy`.
- Single Electron 44 + React 19 + Vite 8 desktop app. No backend, database, or Docker. Local state via `electron-store`.
- Thin `electron/main.ts` composition root — extend existing services/adapters; do not invent extra layers. Module map: rule `project-overview`.
- Dual UI: React settings vs vanilla `public/` popups — do not mix stacks.
- Optional Python OpenCV/dlib blink-detector sidecar. Core app must work without the binary.
- Windows camera open path is field-locked. Do not casually revert; see rule `camera-detection`.
- Agent docs are English only. Ukrainian product strings live in `shared/i18n/uk.ts`. Chat: English unless the user writes Ukrainian.
- Day-to-day commits land on `development`. `main` is updated only by `/deploy`.

## Harness

- Daily loop: `docs/harness/LOOP.md`
- Progress (what): `docs/harness/progress.md`
- Decisions (why): `docs/harness/decisions.md`
- Tasks: `docs/harness/tasks.md`
- Indexes TOC: `docs/harness/indexes/README.md`
- Verify: `npm run verify`

## When to open

- UI — `docs/harness/indexes/ui.md` — layout, components, copy, navigation, popups
- Logic — `docs/harness/indexes/logic.md` — domain, application, composition root
- Styles — `docs/harness/indexes/styles.md` — tokens, themes, CSS
- IPC — `docs/harness/indexes/ipc.md` — channels, preload, security
- Tooling — `docs/harness/indexes/tooling.md` — verify, lint/test/build, Cloud VM, `/deploy`, harness CLIs
- Sidecar — `docs/harness/indexes/sidecar.md` — optional camera detector
- Tray — `docs/harness/indexes/tray.md` — tray menu, hush, pause

Open a per-area index only when that area is in play. Do not load every index every chat.
