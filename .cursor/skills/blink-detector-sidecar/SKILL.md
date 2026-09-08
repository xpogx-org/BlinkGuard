---
name: blink-detector-sidecar
description: >-
  BlinkGuard optional OpenCV/dlib blink-detector sidecar protocol — spawn
  paths, newline-delimited JSON stdin/stdout handshake, camera quality / EAR
  calibration messages, video stream, process lifecycle, blinkDebug JSONL
  logs, gate tuning, Stage-5 personal classifier overlay, and when to rebuild
  the binary.
  Use when working on camera blink detection, cameraQuality, earCalibration,
  classifierBias, classifierThreshold, the Python sidecar package
  (blink_detector_package), electron/resources binary,
  electron/infrastructure/sidecar, face tracking, video stream,
  MGD mode camera path, reject_velocity / reject_threshold, or
  blink-detector.jsonl analysis.
---

# Blink-detector sidecar protocol

Optional feature. Core app must work when the binary is missing.

Details are progressive — **Read only the reference you need**:

| Need | Read |
|---|---|
| stdin/stdout shapes, `cameraState.kind`, `faceData` / `videoStream` | [`references/protocol.md`](references/protocol.md) |
| Phase 0, `log_tools` table, hard tune loop, JSONL paths | [`references/jsonl-analysis.md`](references/jsonl-analysis.md) |
| Stage 0–7, OCEC, calibration flow, L2 backlog | [`references/stages.md`](references/stages.md) |
| Built-in laptop webcam vs C170; MSMF-first CAP_PROP lock | [`references/windows-open-lock.md`](references/windows-open-lock.md) (camera-detection rule is SoT) |

Before claiming a gate/binary fix is live, run `python/log_tools/check_exe_mtime.py` (exe newer than `domain` / `infrastructure` / `application` `.py`).

## Binary paths

Built via `cd python && ./build_and_install.sh` (or `.bat` on Windows) → copied to `electron/resources/`.

| Mode | Path |
|---|---|
| Dev | `{APP_ROOT}/electron/resources/blink_detector[.exe]` |
| Prod | `{resourcesPath}/app.asar.unpacked/electron/resources/blink_detector[.exe]` |

Spawn lives in `electron/infrastructure/sidecar/blink-detector-sidecar.ts` with `stdio: ['pipe','pipe','pipe']`. If the file is missing, log and return — do not fall back to raw `python` in the production path. Process bookkeeping uses `electron/infrastructure/process/child-process-registry.ts`.

Model files (dev / CI / PyInstaller input): `electron/assets/models/shape_predictor_68_face_landmarks.dat` (Git LFS or CI download), `electron/assets/models/face_detection_yunet_2023mar.onnx` (committed, ~227KB, Apache-2.0 OpenCV Zoo), and optional `electron/assets/models/ocec_s.onnx` (committed, ~495KB, MIT OCEC). Landmarks stay dlib 68-pt; YuNet is **face detect only**. OCEC is a confirm overlay (`OCEC_ENABLED=True`, live soak held 2026-08-14) — not a `detector_backend`. Missing YuNet ONNX → HOG-only. Missing OCEC ONNX → skip confirm. Stage 7 details: [`references/stages.md`](references/stages.md).

**Packaging:** the model is embedded into `blink_detector[.exe]` via PyInstaller `datas` (`python/blink_detector.spec` → runtime `{sys._MEIPASS}/assets/models/…`). Do **not** add `electron/assets/models/**/*` back to electron-builder `files` / `asarUnpack` — that shipped a unused second ~99 MB copy. Electron only unpacks `electron/resources/` (the sidecar binary).

## Rebuild intake (mandatory — read before any "rebuild" request)

When the user says **rebuild**, **build sidecar**, or `/implement` touched `python/blink_detector_package/**`:

1. **Read this section first** — do not run `setup.bat` / `setup.sh` on a routine rebuild.
2. **Assume `python/venv` already exists** (BlinkGuard devs rebuild often). Only run setup when:
   - `python/venv/Scripts/python.exe` (Windows) or `python/venv/bin/python` (mac/Linux) is **missing**, or
   - `test_build.py` / `build_binary.py` fails with an explicit missing-package import **after** using the venv interpreter.
3. **Never delete or recreate venv** because system `python` lacks `cv2` — that means you used the wrong interpreter. Sidecar uses `opencv-python-headless` (`python/requirements.txt`). After swapping wheels, run `venv/Scripts/python -c "import cv2"`; if it fails, `pip install --force-reinstall opencv-python-headless` before PyInstaller (`blink_detector.spec` lists `cv2` in `hiddenimports`).
4. Stop any running `blink_detector.exe` before install (copy lock on Windows).
5. After install, run `python/log_tools/check_exe_mtime.py` — exe must be newer than edited `.py` files.

**Wrong (do not):** `setup.bat` → fresh venv → `pip install` from scratch when user only asked to rebuild.

## Rebuild rules (do not run stale builds)

Electron **always** spawns the packaged binary under `electron/resources/`, not the `.py` tree. Editing Python does nothing until that binary is rebuilt **and** the app/sidecar is restarted.

**Rebuild when** (and only when) something that ships inside the PyInstaller binary changed:

- `python/blink_detector.py`
- `python/blink_detector_package/**` (domain / application / infrastructure)
- `python/blink_detector.spec` or bundled model/data paths that the binary embeds

**Do not rebuild for:** skill/docs/AGENTS, Electron/React/shared-only changes, Python unit-test-only edits, preference/UI tweaks that only affect main process.

**Before claiming a gate fix is live:**

1. Run `python/log_tools/check_exe_mtime.py` — `mtime(domain .py)` vs `mtime(electron/resources/blink_detector[.exe])`; exe must be newer.
2. User must restart the app (or stop/start tracking so main respawns the sidecar). Killing a locked exe may be required on Windows before copy.
3. Analyze only JSONL rows with `ts` after that restart — see [`references/jsonl-analysis.md`](references/jsonl-analysis.md).

**How to rebuild (Windows — primary path):** always invoke **`python\venv\Scripts\python.exe` directly**. Do not rely on `activate.bat` / `build_and_install.bat` first — they can fall back to system Python when activation fails.

PowerShell (copy-paste; adjust repo root if needed):

```powershell
cd S:\Projects\PetProj\BlinkGuard\python
$py = "S:\Projects\PetProj\BlinkGuard\python\venv\Scripts\python.exe"
Get-Process blink_detector -ErrorAction SilentlyContinue | Stop-Process -Force
& $py test_build.py
& $py build_binary.py
& $py test_binary.py
& $py install_binary.py
& $py log_tools\check_exe_mtime.py
```

cmd equivalent:

```bat
cd python
set PY=%CD%\venv\Scripts\python.exe
%PY% test_build.py
%PY% build_binary.py
%PY% test_binary.py
%PY% install_binary.py
%PY% log_tools\check_exe_mtime.py
```

**Fallback:** `build_and_install.bat` only after confirming `%CD%\venv\Scripts\python.exe` exists and `VIRTUAL_ENV` is unset or points at this repo's `python\venv`.

mac/Linux: `cd python && ./build_and_install.sh` (uses `venv/bin/activate`).

Unit tests (no camera): **always** use venv python — never bare `python` on PATH:

```powershell
cd S:\Projects\PetProj\BlinkGuard\python
& .\venv\Scripts\python.exe -m unittest blink_detector_package.tests.test_landmark_trust blink_detector_package.tests.test_face_resolve blink_detector_package.tests.test_blink_detection
```

Python locate/backoff edits in `detector.py` / `vision.py` / `blink_detection.py` are **not live** until `electron/resources/blink_detector[.exe]` is rebuilt and the sidecar respawned.

Landmarks are **dlib only** (68-pt predictor). Face **locate** is YuNet; the 68-pt crop is HOG-refine. MediaPipe Face Mesh was removed after gaming logs showed more misses (`skip_degraded` / peak≈0) vs dlib — do not reintroduce a MediaPipe UI switch.

## Handshake (exact status strings)

1. Sidecar starts → `{"status":"Starting blink detector in standby mode..."}`
2. Models OK → `{"status":"Models loaded successfully, ready for camera activation"}` (`SIDECAR_STATUS.modelsReady`)
3. Main writes session config (`applySessionConfig`)
4. When tracking needs camera → main writes `{"start_camera": true}`
5. Success → `{"status":"Camera opened successfully"}` (`SIDECAR_STATUS.cameraReady`; sets `isCameraReady`)

Do not change those status strings without updating `SIDECAR_STATUS`, `blink-detector-sidecar.ts`, and the Python emitter together.

**Capture-status SoT:** step 5’s `isCameraReady` is what Settings and the tray consume via `CameraCaptureStatusService` (`shared/camera-capture-status.ts` → IPC). Do **not** derive the chip / tray row from `cameraEnabled` or “preview window open”. Surfaces: `idle` / `preview` / `monitoring` — see camera-detection rule.

Wire shapes (`start_camera`, `videoStream`, `cameraState`, …): [`references/protocol.md`](references/protocol.md).

## Implementation map

| Concern | Path |
|---|---|
| Spawn + stdout parse + camera start/stop + apply* | `electron/infrastructure/sidecar/blink-detector-sidecar.ts` |
| Stage-0 EAR trace save/stop dialogs | `electron/infrastructure/sidecar/trace-recording.ts` |
| Blink debug JSONL | `electron/infrastructure/logging/blink-detector-debug-logger.ts` |
| Reminder/face gate | `electron/application/reminder-service.ts` |
| Capture status SoT (Settings + tray) | `electron/application/camera-capture-status-service.ts`, `shared/camera-capture-status.ts` |
| NDJSON buffer + status constants | `electron/infrastructure/sidecar/protocol.ts` |
| Quality / EAR / personal clf / freshness / device contracts | `shared/camera-quality.ts`, `shared/ear-calibration.ts`, `shared/classifier-calibration.ts`, `shared/calibration-freshness.ts`, `shared/camera-devices.ts` |
| Settings UI | `src/features/camera/ui/camera-setup-panel.tsx`, `camera-controls.tsx`, `camera-device-picker.tsx`, `camera-calibration-banner.tsx`; status hook `src/features/camera/model/use-camera-status.ts` |
| Calibration stale/drift nudge | `electron/application/calibration-nudge-service.ts` + `parseBaselineDriftNudge` (do not persist Python-nudged EAR) |
| Thin Python entry | `python/blink_detector.py` → `blink_detector_package.application.run` |
| Detector loop | `python/blink_detector_package/application/detector.py` |
| EAR / blink / pose gates | `python/blink_detector_package/domain/` |
| solvePnP head pose | `python/blink_detector_package/infrastructure/head_pose.py` |
| Camera, models, vision, OCEC, transport | `python/blink_detector_package/infrastructure/` |
| Phase 0 JSONL analyzer | `python/log_tools/` (shim: `python/scripts/analyze_blink_jsonl.py`) |
| Exe freshness check | `python/log_tools/check_exe_mtime.py` |
| Stage-0 EAR traces / labels / metrics | `python/log_tools/{replay,label,metrics,trace_io}.py`, `python/fixtures/` |
| Stage-4 logistic vote | `python/blink_detector_package/domain/classifier.py`, `log_tools/{harvest_candidates,train_classifier}.py` |
| Stage-5 personal overlay | `classifier.set_personal`, prefs `classifierBias`/`classifierThreshold`, Camera Calibrate phase B |
| Stage-3 video→EAR reprocess | `python/log_tools/reprocess_video.py`, `vision.LANDMARK_ROI_UPSCALE`, `head_pose`; `--ocec` writes `left_ocec`/`right_ocec` |
| Stage-7 OCEC confirm | `infrastructure/ocec.py` (`cv2.dnn`), `OCEC_ENABLED` in `vision.py`, FSM `reject_ocec` |
| Build/install | `python/build_and_install.sh`, `python/install_binary.py`, `python/blink_detector.spec` |
| Camera UI | `public/camera.html` + `public/js/camera.js` via `popupAPI` |

## Lifecycle

App quit asks the sidecar to exit via stdin (`{"quit": true}` + EOF) so PyInstaller can delete `%TEMP%\_MEI*`; `taskkill /F` / `pkill` is the hung-process fallback only. `AppLifecycle.shutdown` must run sidecar cleanup **before** `destroyAll()`. On Windows, subscribe to `window-all-closed` without `app.quit()` (tray app) so destroying the last window does not kill the PyInstaller bootloader mid-extract. Startup still force-kills HMR/crash orphans before spawn. Keep `isBlinkDetectorRunning` / `isCameraReady` in sync with process `exit`/`error`. Camera open failures retry with backoff while tracking + camera remain enabled.
