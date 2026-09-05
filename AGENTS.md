# AGENTS.md

## Cursor Cloud specific instructions

BlinkGuard is a single desktop app (not a monorepo): an Electron 44 + React 19 + Vite 8 + TypeScript 7 app, with an **optional** Python (OpenCV 5 / dlib 20) computer-vision sidecar for camera-based blink detection. There is no web backend, database, or docker. State is local (`electron-store`). Standard commands live in `package.json` scripts; the notes below only cover non-obvious cloud caveats.

**Branches:** day-to-day commits land on `development`; `main` is updated only by `/deploy` (merge `development` → `main`, version bump, tag, GitHub Release). See skill `deploy`.

**Communication:** English by default in chat and all agent docs. Use Ukrainian in chat only when the user writes in Ukrainian. Product Ukrainian strings live in `shared/i18n/uk.ts`.

### Layout (post-refactor)

Pragmatic Clean Architecture with a thin `electron/main.ts` composition root. Detail lives in file-scoped rules (`clean-architecture`, `tray-runtime`, `composition-root`, `preferences-store`, `camera-detection`, `dual-ui`) — do not duplicate hush/tray essays here.

| Path | Notes |
|---|---|
| `shared/` | Electron-free contracts (IPC, prefs, backup, camera, blink-stats/rewards, session-recap, i18n, theme). Named setups not in `PERSISTED_KEYS`; optional in backup v1. Face reliability: `face-status.ts` |
| `electron/domain/` | Pure policies (reminder, focus, session-activity, blink-rate-coaching helpers, calibration-freshness, session-recap-policy) |
| `electron/application/` | Orchestration: preferences, reminder, exercise, look-away, tracking-session, blink-stats, settings-profiles, calibration-nudge, camera-capture-status, snooze-all, snooze-token-prompt, session-recap, focus-pause, session-pause, preference-actions, deferred-tracking-restore, AppRuntimeState; ports |
| `electron/infrastructure/` | IPC, windows, lifecycle, sidecar, shortcuts, **tray/**, sound, OS toasts, store, focus, session-activity, idle, auto-update, logging — see `tray-runtime` |
| `electron/main.ts` | Composition root only — see `composition-root`; cold-start tracking waits for `shellReady` after boot splash |
| `electron/preload.ts` | `contextBridge`; whitelists from `shared/ipc-channels` |
| `src/app.tsx` | React settings entry + `SettingsShell`; nav order in `project-overview` |
| `src/components/` | Shared React UI; catalog in `.cursor/skills/ui-reuse/catalog.json` |
| `src/features/*` | Feature `model/` + `ui/` |
| `src/shared/ipc/` | Renderer IPC adapter |
| `public/` | Vanilla popups (incl. `ambient.html`, `recap.html`, `tray-menu.html`) — see `dual-ui` |
| `python/blink_detector.py` | Thin entry |
| `python/blink_detector_package/` | Sidecar domain / application / infrastructure |

Cursor rules under `.cursor/rules/` and project skills under `.cursor/skills/` document these seams (`.cursor/` is gitignored locally; `.cursorignore` may re-include it for chat). Security bar: rule `electron-security`. Skills:

- `blink-detector-sidecar` — NDJSON protocol, rebuild, JSONL analysis, stages
- `readme-screenshots` — README PNGs / intro MP4 (`/screenshots`)
- `i18n-en-uk` — EN+UK catalogs, plurals, popup `data-i18n`
- `preferences-sync-loops` — main↔renderer prefs bounce prevention
- `ui-reuse` / `ui-theme` — catalog + tokens
- `keep-agent-docs-current` — after meaningful changes, fix drifted rules/skills/`AGENTS.md`
- `next-product-gaps` — N paste-ready planning briefs (`/next-product-gaps`); respect `shipped-drop.md`
- `deploy` — `/deploy` / Ship release

### Required service: the Electron desktop app

- Dependencies are installed by the update script (`npm install`). Node v22 is available.
- Run in dev mode: `DISPLAY=:1 npm run dev`. The VM has a real XFCE desktop on `DISPLAY=:1`, so the app window renders there and can be tested with computer-use. Vite dev server also listens on `http://localhost:5173`.
- Electron auto-runs with `--no-sandbox` in this container. The `Failed to connect to the bus` (DBus) and `Exiting GPU process` / GPU fallback (swiftshader) log lines at startup are benign in a headless container — the window still renders via software rendering.
- On startup the main process logs `Blink detector binary not found ... run cd python && ./build_and_install.sh`. This is expected: the camera feature is optional and its binary is not built here.

### Lint / test / build

- Lint: `npm run lint` runs `biome check --write src`, which **mutates source files**. For a read-only check use `npx @biomejs/biome check src`. Biome currently reports pre-existing lint errors (e.g. missing button `type`); these are not caused by env setup. Biome scopes **`src` only** — `electron/` and `shared/` are not Biome-gated.
- Tests: `npm test` (watch) or `npm run coverage` (one-shot). Vitest uses `happy-dom` (`vitest.config.ts`). `src/__tests__/pages/app.test.tsx` is a settings-shell smoke suite (render controls + IPC send for start reminders / shortcut), not the old Electron+React template.
- Note: `coverage/` and `.vitest/` are **gitignored** — do not commit regenerated coverage or Vitest JSON reporter output.
- Build (compile only): `npm run build:electron` (`tsc && vite build`). Size inventory: `npm run measure:size` (add `--packaged` after `electron-builder`). Do NOT use `npm run build:mac` / `npm run build:windows` / publish scripts here — they are OS-host packaging helpers (`scripts/prepare-python-windows.js`, `scripts/publish-mac.js`, `scripts/publish-windows.js`, `scripts/remove-quarantine.js`) and need a matching OS host / Python sidecar toolchain; quarantine removal is macOS-only and no-ops elsewhere. Tag CI (`.github/workflows/build.yml`) builds Windows + macOS and can attach macOS artifacts to an existing release via `workflow_dispatch` (`platforms=macos`, `publish_to_tag=vX.Y.Z`). `package.json` `build.electronLanguages` must match app i18n (`en-US` + `uk` for `shared/i18n` locales); do not put `compression` under `nsis` — it is a root `build` key if needed.

### Optional service: Python blink-detector sidecar

Not runnable in this cloud VM without extra work and is not needed to run/test the core app. It requires building a `dlib` wheel (C++/CMake toolchain), pulling the ~99MB Git LFS model `electron/assets/models/shape_predictor_68_face_landmarks.dat` (`git lfs pull`), the committed YuNet ONNX `electron/assets/models/face_detection_yunet_2023mar.onnx` (~227KB; missing → HOG-only detect), optional `electron/assets/models/ocec_s.onnx` (~495KB; missing ONNX → skip Stage 7 confirm; `OCEC_ENABLED` in `vision.py`), building the PyInstaller binary (`cd python && ./build_and_install.sh` or `build_and_install.bat`), and a physical webcam — none of which are available headless. Setup lives in `python/setup.sh` and `python/requirements.txt` (`opencv-python-headless`, not full `opencv-python`). After swapping OpenCV wheels, verify `import cv2` in the venv and force-reinstall headless if the `cv2` package dir is missing before PyInstaller. Models under `electron/assets/models/` are **embedded in the sidecar** via PyInstaller datas (not re-shipped through electron-builder `files`/`asarUnpack`). Protocol strings and NDJSON semantics must stay in sync with `electron/infrastructure/sidecar/protocol.ts` and the spawn/parse loop in `electron/infrastructure/sidecar/blink-detector-sidecar.ts` — see `.cursor/skills/blink-detector-sidecar/SKILL.md`. Camera quality presets, EAR helpers, and Stage-5 personal classifier overlay live in `shared/camera-quality.ts` / `shared/ear-calibration.ts` / `shared/classifier-calibration.ts`. YuNet locates the face (5-pt keypoints kept for landmark trust); HOG-refine inside that ROI is the preferred dlib 68-pt crop (plausible YuNet box if refine misses; no full-frame HOG on a YuNet hit; no MediaPipe preference). Landmark overlay honesty uses `domain/landmark_trust.py` (YuNet↔dlib eye agreement + solvePnP reprojection / IOD; sidecar **5-frame** fail debounce) — not bbox/pitch band heuristics. Optional OCEC is a confirm overlay via OpenCV DNN, not a landmark backend. Detector software-resize aspect-fits inside the quality preset (do not stretch 16:9 C170 640×360 to 4:3). **Windows open path is field-locked** after a 2.4.0 regression on a **built-in laptop webcam** (black frames, diagnostics `BlinkGuard-diagnostics-20260809-185347` — not the Logitech C170 daylight detect-miss): MSMF→DSHOW, no FOURCC force, no 4:3 snap, no `CAP_PROP_FPS`, no CAP_PROP size — do not casually revert; see `.cursor/rules/camera-detection.mdc` and `python/blink_detector_package/infrastructure/camera.py`.

Blink debug capture (Electron): structured JSONL at `{app.getPath('userData')}/logs/blink-detector.jsonl` (Windows: typically `%APPDATA%/BlinkGuard/logs/blink-detector.jsonl`). Console prints the absolute path once at startup (`Blink debug log: …`) and short credited/rejected lines only; full `blinkDebug` and `cameraState` (open/health/black_ratio/backend) payloads go to the file via `electron/infrastructure/logging/blink-detector-debug-logger.ts`. User-action trail: `{userData}/logs/interactions.jsonl` (`interaction-logger.ts`). About → Report a problem exports diagnostics (zip + enriched `meta.json`; IPC `exportDiagnostics` / `openGithubReportIssue`) — nothing is uploaded. Profile → Share card opens a preview modal (session-only field toggles), then saves a local PNG (`export-profile-image.ts`, IPC `exportProfileImage`). Settings → Backup exports/imports prefs, optional saved Setups (with preferences/both scope), and/or blink statistics as local JSON (`backup-io.ts`, IPC `exportBackup` / `importBackup`) — also nothing uploaded.
