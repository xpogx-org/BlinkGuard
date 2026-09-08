# Sidecar wire protocol

Newline-delimited JSON over stdin (commands) / stdout (events). Always flush after writes. Main buffers stdout via `NdjsonBuffer` in `electron/infrastructure/sidecar/protocol.ts` and splits on `\n` before `JSON.parse`. Prefer `encodeSidecarMessage` when writing lines.

Read this when changing stdin/stdout shapes, `cameraState`, `faceData`, `videoStream`, or camera start/stop/preview lifecycle. For the Windows `VideoCapture` open path lock, see [`windows-open-lock.md`](windows-open-lock.md).

## Main → sidecar (stdin)

```json
{"target_fps": 15, "processing_resolution": [480, 360], "face_detect_interval": 1, "pose_strictness": "normal"}
{"start_camera": true}
{"start_camera": true, "camera_device": {"id": "USB\\VID_…", "index": 1, "name": "USB Webcam"}}
{"camera_device": null}
{"list_cameras": true}
{"stop_camera": true}
{"request_video": true}
{"stop_video": true}
{"ear_calibration": 0.31}
{"ear_calibration": null}
{"classifier_calibration": {"bias": 0.4, "threshold": 0.2}}
{"classifier_calibration": null}
{"record_trace": "C:/path/to/session.ndjson"}
{"stop_trace": true}
{"quit": true}
```

`stop_camera` clears Python `send_video` and releases the capture; the process stays alive in standby. Detection can keep running after a later `start_camera` while the preview stays frozen on the last JPEG until `request_video` again. Electron must re-send `request_video` after a flushed start (and on `cameraStarted` / `cameraReady` ACK) when the camera preview window is open (`isCameraWindowOpen` → `WindowManager.isCameraOpen()`). Opening preview (shortcut / Show) must not start the tracking timer. Closing preview calls `ReminderService.stopCameraIfIdle` — release capture when `!isTracking`; while tracking, keep capture and send `{"stop_video": true}` so JPEG encode stops (`send_video` false). `request_video: false` is treated as `stop_video`.

While the sidecar camera is **capturing**, `infrastructure/process_qos.py` asks the OS not to treat the detector as background work (Windows HighQoS / macOS `NSActivityUserInitiatedAllowingIdleSystemSleep`). Release on `stop_camera` / detector exit. Failures are `debug` `process_qos …` only — never `camera-error`. Not `SetPriorityClass`, not Electron `powerSaveBlocker`. Live QoS needs a sidecar rebuild.

`quit` (or stdin EOF) exits the detector loop so the PyInstaller onefile bootloader can delete `%TEMP%\_MEI*`. `stop_camera` must not do that. App quit / `quitAndInstall` write `{"quit": true}` then `stdin.end()`, wait up to 15s (models load ~3s), then `taskkill /F` only if the process is still alive. Do **not** `/im blink_detector.exe /F` after a clean exit — that name also matches the unpacked copy inside `_MEI*` and can kill the bootloader mid-cleanup. Startup HMR orphan sweep still uses `/F` (`killOrphanedSidecarProcesses`).

`record_trace` / `stop_trace`: Stage-0 per-frame EAR/pose NDJSON (`blinkguard.ear_trace.v1`) plus companion MJPG `.avi` (same stem) for video-verified labeling via `log_tools/label.py`. Debug UI: `startTraceRecording` / `stopTraceRecording` IPC. `stop_camera` does **not** end an active trace.

Config keys are handled independently. Presets come from `shared/camera-quality.ts` via `toSidecarCameraQualityMessage` / `applyCameraQuality`. Preferred capture device is `shared/camera-devices.ts` via `toSidecarCameraDeviceMessage` / `applyCameraDevice` (`null` = Automatic scan). After models are ready, Electron should call `applySessionConfig()` (quality + EAR + personal classifier overlay + `camera_device` — no `detector_backend` / MediaPipe message), not only FPS. `target_fps` is forwarded into `BlinkDetectionState.set_target_fps` for frame-aware gates.

`list_cameras` refreshes OS inventory only (no `VideoCapture`) and emits `camera_devices`. Device switch while capture is live uses `restartCamera()` (stop+start); `startCamera()` still skips reopen when already `cameraReady`.

`pose_strictness`: `"loose" | "normal" | "strict"`.

## Sidecar → main (stdout)

| Shape | Meaning |
|---|---|
| `{"status":"..."}` | Lifecycle; see handshake in SKILL.md |
| `{"blink": true, "ear", "time", ...}` | Blink — closes reminder popup; forward to camera window |
| `{"faceData": {...}}` | Landmarks/EAR for camera UI + EAR calibration sampling |
| `{"videoStream": { "jpeg", "faceRect?", "eyeLandmarks?", … }}` | Preview after `request_video` (every frame; not face-gated). Prefer object payload; legacy string jpeg still accepted by camera.js |
| `{"error":"..."}` | Surface via `camera-error`; may retry camera |
| `{"debug":"..."}` | Human/debug string — Electron writes to JSONL file |
| `{"blinkDebug":{...}}` | Structured blink outcome — console: short credited/rejected; file: full JSONL |
| `{"cameraState":{...}}` | Capture health / open lifecycle — JSONL (`type: "cameraState"`); `camera_devices` / missing / fallback also forwarded to settings |

## `cameraState.kind` (diagnostics triage)

| kind | When | Useful fields |
|---|---|---|
| `camera_devices` | `start_camera` or `list_cameras` | `names`, `devices[{index,name,id}]`, `count` (OS inventory; index soft-match) |
| `camera_device_missing` | preferred id/name absent from inventory | `requested_id`, `requested_name`, `requested_index` — then Automatic scan |
| `camera_device_fallback` | name-guided open failed; using another index | `requested_*` |
| `camera_open_attempt` | each probe | `index`, `backend`, `backend_name`, `device_name?`; `requested_*` null; software `processing_resolution` + `target_fps` |
| `camera_open_result` | after warm-up | `ok`, `mean_luma`, `warm_frames`, `device_name?`, `reject_reason` (`black` / `read_fail` / …) |
| `camera_props` | after open | native `actual_wh`/`actual_fps`/`fourcc`; `requested_*` null; software `processing_resolution` + `target_fps` |
| `camera_health` | ~every 3s while active | `mean_luma`, `black_ratio`, `face_ok` / `face_none` / `face_too_far`, `yunet_hit` / `yunet_enhanced_hit` / `hog_refine_miss` / `yunet_crop` / `hog_full_hit`, `send_video`, `backend_name` (+ short `debug` twin line) |
| `camera_failover_begin` / `camera_black_streak` | black ≥~2s or no-face ≥~5s | `streak_ms`, `reason`, `action` |
| `camera_failover` | backend/index switch | `from_*` → `to_*`, `reason` (`black_streak` / `no_face`) |
| `camera_stop` | release | `reason` |

**Windows black-frame / no-face notes (summary):** open keeps a single `VideoCapture` (no probe-release-reopen). Warm-up requires non-black frames (`mean_luma` gate). Prefer **MSMF** then **DSHOW** in **index-major** order. Quiet OpenCV WARN during probe. **Do not set FOURCC**, **`CAP_PROP_FPS`**, or **CAP_PROP size** — leave the driver default stream; the detector loop **aspect-fits** inside the quality preset (`fit_processing_size`) and throttles FPS in software. Do **not** snap to classic 4:3. Do **not** change CAP_PROP size/FPS mid-stream. Sidecar spawn sets `OPENCV_VIDEOIO_MSMF_ENABLE_HW_TRANSFORMS=0` when unset. Command batches apply config **before** `start_camera` so software resize/throttle use the preset. Sustained black (~2s) or never-face (~5s, capped) → failover (MSMF↔DSHOW). Electron coalesces stop/start (~75ms) and skips reopen when already `cameraReady`. `installUpdate` / quit send sidecar `{"quit": true}` and wait up to 15s before `/F`. Discord working + BlinkGuard black usually means OpenCV format negotiation — check `camera_props` / `camera_open_result.reject_reason` in Export diagnostics.

**LOCKED open path:** see [`windows-open-lock.md`](windows-open-lock.md) (built-in laptop webcam vs C170). Camera-detection rule is SoT for ownership.

On each `start_camera` / `list_cameras`, emit `cameraState.kind=camera_devices` with OS-enumerated friendly names + ids (Windows PnP Camera/Image; macOS `system_profiler`; Linux v4l). Open attempt/result also include soft `device_name` / `device_id` when the numeric index lines up — index match is best-effort, not guaranteed. Last successful OpenCV index is the hard open handle across restarts.

## `faceData` / `videoStream`

`faceData` includes `faceDetected` plus `faceStatus`: `"ok"` | `"none"` | `"too_far"`.

- `ok` — quality face + landmarks (normal tracking)
- `none` — no face / no landmarks (sidecar emits on the ok→none edge, then ~3 Hz while idle)
- `too_far` — face found but bbox/interocular failed quality (`skip_face_quality`); may still include `faceRect` for UI

Camera popup (`public/js/camera.js`) shows a centered no-face overlay + hint from `faceStatus` (`hintNone` / `hintTooFar`) while keeping the live preview. The settings no-face toast (`no-face.html`) uses `NO_FACE_DEBOUNCE_MS` to show and `FACE_RETURN_DEBOUNCE_MS` to hide / credit face-return — do not create/destroy the BrowserWindow on a one-frame hit.

**Camera preview sync:** while `send_video`, sidecar emits `videoStream` as `{ jpeg, faceRect, eyeLandmarks, faceStatus, faceDetected }` (same frame). Preview cadence tracks `target_fps` (Ultra=30); JPEG size/quality scales down at high FPS. Blink gates track **measured** `loop_fps` (capped by quality preset). `public/js/camera.js` uses latest-frame-wins decode + light box EMA; dots are live sidecar 6-pt (no JS EMA). Legacy string JPEG still works.

## `blinkDebug` payload notes

`blinkDebug` includes `ear_raw`, `ear_smooth`, `peak_velocity_raw`, `peak_velocity_effective`, `peak_opening_velocity`, `closed_frames`, `interocular`, `detector_backend` (always `"dlib"` landmarks), `face_detect` (`hog`|`clahe`|`compress`|`upsample`|`yunet`), `waives` (list), `reject_gate`, `ocec_l` / `ocec_r` / `ocec_drop` / `ocec_ok` (Stage 7, additive), plus prior fields. Protocol for blink credit (`{"blink": true, ...}`) is unchanged. EAR calibration progress may include `faceDetected` (additive). Phase A samples `faceData.ear` only when `faceStatus === "ok"` (not `too_far` / junk eye boxes).

`blinkDebug` peak fields: `peak_velocity` / `peak_velocity_effective` (gate value, may include short-frontal synthetic); `peak_velocity_raw` (measured closing only). Analyzer prints frontal vs `look_down` reject shares for Phase 0 acceptance — see [`jsonl-analysis.md`](jsonl-analysis.md).
