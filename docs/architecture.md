# Architecture

Pragmatic Clean Architecture for a single Electron + React + optional Python desktop app. Layers exist where they help navigation; not every button gets a port.

## Dependency rule

Dependencies point inward:

```text
presentation (React / public HTML / IPC handlers)
  → application (services, ports)
    → domain (pure policies / models)

infrastructure (store, windows, process, sidecar adapters)
  → implements application ports
```

- `electron/domain/` and pure `shared/` contracts must not import Electron, React, Node process APIs, or OpenCV.
- `electron/application/` may depend on domain + port interfaces only — not on concrete Electron adapters.
- Infrastructure and presentation (main IPC wiring, React, `public/`) may depend on application and domain.
- Python follows the same idea inside `python/blink_detector_package/`.

## Folder map

| Path | Role |
|---|---|
| `electron/main.ts` | Thin Vite entry + composition root: creates services/adapters, connects sidecar callbacks, and starts lifecycle. |
| `electron/preload.ts` | `contextBridge` (`ipcRenderer`, `popupAPI`) + channel whitelists from `shared/`. |
| `electron/domain/` | Pure policies (reminder, prompt ladder, focus, session activity, blink-rate coaching helpers, calibration freshness). |
| `electron/application/` | Runtime state; preferences, reminder, exercise, look-away, tracking session, blink stats, settings profiles, calibration nudge, camera capture status, snooze-all, focus-pause, session-pause, preference actions, deferred tracking restore; plus ports. |
| `electron/infrastructure/` | Electron/Node adapters for IPC, windows, lifecycle/power, sidecar, shortcuts, tray, sound, OS toasts, store, process cleanup, paths/logging, backup, profile export, focus, session activity (Win+Mac lid / display-sleep; stub elsewhere), auto-update. |
| `shared/` | Electron-free contracts: IPC channel names and send/on/invoke whitelists, preference types/defaults, named setups, backup envelope, and related types. |
| `src/app.tsx` | React settings entry (`BlinkGuardHomepage`). Nav shell: `src/features/settings/ui/settings-shell.tsx` (`SettingsShell`). |
| `src/features/*` | Feature UI + hooks (`reminders`, `camera`, `exercises`, `look-away`, `popup-appearance`, `statistics`, `profile`, `achievements`, `rewards`, `settings`, `onboarding`, `about`, `shortcuts`, `debug`). |
| `src/shared/ipc/` | Renderer adapter over the preload bridge. |
| `public/*.html` | Popup / camera / editor / sound / look-away / ambient and related shells. |
| `public/js/`, `public/css/` | Per-surface vanilla scripts and styles (+ `js/shared/theme.js`, `css/base.css`). |
| `python/blink_detector.py` | Thin CLI entry. |
| `python/blink_detector_package/` | `domain/` (EAR, blink state), `application/` (detector loop), `infrastructure/` (camera, models, NDJSON transport, vision). |

Dual UI rule: React settings and vanilla popups stay separate stacks. Do not import React into `public/` or popup DOM helpers into `src/`.

## Flutter → Electron analogies

| Flutter / clean arch | Here |
|---|---|
| `main()` / DI setup | `electron/main.ts` composition root |
| Cubit / Bloc (presentation) | React feature hooks + UI under `src/features/*/model` and `ui` |
| Use case / interactor | Application service (e.g. `PreferencesService`) |
| Repository interface | Application port (e.g. `PreferenceStore`) |
| Repository implementation | Infrastructure adapter (e.g. `ElectronPreferenceStore`) |
| Domain entity / policy | `electron/domain/*`, `shared/preferences.ts` types |
| Platform channel | IPC via `shared/ipc-channels.ts` + preload whitelist |
| Isolate / native plugin | Optional Python sidecar (`blink_detector_package`) |

Use the analogy for placement, not as a mandate to mirror Flutter folder counts.

## Anti-patterns (this project)

1. **Electron / Node in domain** — no `BrowserWindow`, `ipcMain`, `fs`, or `child_process` under `electron/domain/`.
2. **Port per button** — don’t invent interfaces for every slider click; prefer feature hooks calling `rendererIpc` and a small set of application services.
3. **Mixing React and public UI** — settings stay in `src/`; reminder/exercise/camera/editor stay in `public/`.
4. **Changing sidecar protocol unilaterally** — status strings and NDJSON shapes are shared with Electron (`infrastructure/sidecar/protocol.ts` / Python `transport.py`). Change both sides together.
5. **Storing reminder or micro-break interval in seconds in the store** — both `reminderInterval` and `microBreakInterval` persist as milliseconds; the React UI works in seconds (see [ipc-and-preferences.md](./ipc-and-preferences.md)).
6. **Growing `main.ts` with new feature logic** — wire lifecycle there; put rules in domain and orchestration in application/infrastructure modules.
7. **README-per-folder / ADR dumps** — keep orientation docs thin; Cursor rules/skills cover agent-facing detail.
