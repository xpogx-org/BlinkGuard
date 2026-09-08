# Windows camera open path (LOCKED)

**SoT for ownership / globs:** `.cursor/rules/camera-detection.mdc`. This note is the field lock only — do not “improve” CAP_PROP / backend order without new Export diagnostics proof.

## Built-in laptop webcam vs C170 (do not conflate)

| Case | Diagnostics | Symptom | Root cause | Fix class |
|---|---|---|---|---|
| **Built-in laptop webcam** | `BlinkGuard-diagnostics-20260809-185347` | Black `320×240` streams after 2.4.0 | DSHOW-first + forced MJPG + 4:3 snap | **Open path** — restore MSMF-first + native driver stream |
| **Logitech C170** (Fatar) | `BlinkGuard-diagnostics-20260814-130217` | Healthy capture (`black_ratio=0`, native 640×360) but **detect misses** when `mean_luma` ≳ 90 (daylight / side window); dark-room luma ~60–90 tracks | Locate / aspect-fit / YuNet path | **Vision / detector** — not CAP_PROP |

Restoring MSMF-first + native driver stream (no FOURCC / size / FPS CAP_PROP) fixed the built-in laptop case. Do **not** “fix” C170 by changing CAP_PROP.

## MSMF-first lock

Edit `python/blink_detector_package/infrastructure/camera.py` (`_platform_backends` / `_apply_capture_props`) **only** with a fresh Export diagnostics zip.

**Do:**

- Prefer **MSMF** then **DSHOW** in **index-major** order
- Keep a single `VideoCapture` (no probe-release-reopen)
- Warm-up requires non-black frames (`mean_luma` gate)
- Leave the driver default stream; detector loop **aspect-fits** inside the quality preset (`fit_processing_size`) and throttles FPS in software
- Sidecar spawn sets `OPENCV_VIDEOIO_MSMF_ENABLE_HW_TRANSFORMS=0` when unset
- Sustained black (~2s) or never-face (~5s, capped) → failover (MSMF↔DSHOW)

**Do not:**

- Set FOURCC
- Set `CAP_PROP_FPS`
- Set CAP_PROP size
- Snap to classic 4:3
- Change CAP_PROP size/FPS mid-stream

Protocol / `cameraState` triage details: [`protocol.md`](protocol.md). C170 daylight locate notes live with Stage / vision work in [`stages.md`](stages.md) (YuNet LAB-CLAHE retry, yunet-crop fallback — not an open-path change).
