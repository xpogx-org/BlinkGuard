# Detector stages 0–7 + L2 backlog

Read this when changing algorithm stages, corpus metrics, OCEC, classifier overlay, or geometry. Live JSONL triage: [`jsonl-analysis.md`](jsonl-analysis.md). Windows open path: [`windows-open-lock.md`](windows-open-lock.md).

## Stage-0 human baseline

Video-verified labels, `source: human_video`: see [`python/fixtures/BASELINE.md`](../../../../python/fixtures/BASELINE.md). Match window **0.45s**. After Stage 1 yaw fix: overall **P≈0.95 / R≈0.88 / F1≈0.92** across 8 sessions. Weakest recall: `side_monitor_right` (improved, still lowest).

**Gate PR rule:** do not regress overall corpus F1 below the floor in `BASELINE.md` / `test_trace_replay` (overall ≥0.90). Do not drop `frontal_calm` or `chat_look_down` F1 below their baseline rows by more than ~0.02 without an explicit reason. Prefer `metrics.py --dir fixtures/sessions` over live JSONL proxies.

**Stage 0 measure loop (preferred before gate nudges):**

1. Record a scenario: app Debug → EAR trace recording (sidecar `record_trace` / `stop_trace`).
2. Copy into `python/fixtures/sessions/`, label with `label.py` (prefer video-verified).
3. `replay.py` / `metrics.py` — algorithm gate is F1 on the corpus, not live JSONL proxies alone.
4. Domain `.py` edits still need a sidecar rebuild for *live* recording; replay uses the Python package directly (no exe).

## Stage 3 — geometry

**Stage 3 measure loop (geometry — EAR / landmarks / pose):**

1. Do **not** rely on `replay.py` of old NDJSON — EAR/yaw are baked at record time.
2. `reprocess_video.py session.ndjson|--avi [--upscale 1|2]` → `session.repro.ndjson` (or `.u1` / `.u2`).
3. `metrics.py --trace …repro.ndjson` (labels resolve by stripping `.repro` / `.u1` / `.u2` / `.pnp`).
4. Compare to `BASELINE.md` floor (≥0.90). **Do not** retune blink gates in the same pass as geometry.
5. Live needs sidecar rebuild after `vision.py` / `head_pose.py` / predictor path changes (`check_exe_mtime`).

Stage 3.1 default: `LANDMARK_ROI_UPSCALE = 2` in `infrastructure/vision.py` (float landmarks; set `1` to disable).

Stage 3.2: `infrastructure/head_pose.estimate_head_pose` (`cv2.solvePnP` + roll); gate `yaw`/`pitch` = deg / scale (`YAW_SCALE_DEG=45`, `PITCH_SCALE_DEG=25`). Domain keeps `evaluate_pose_gate` + heuristic fallback. Do **not** retune `POSE_PROFILES` in the same pass.

Stage 3.3: `pose_weight(pitch_delta)` + `lerp` frontal↔LOOK_DOWN_* endpoints in `domain/pose.py` / `blink_detection.py` (`PITCH_WEIGHT_SPAN=0.12`). Gate change → measure with `metrics.py` on **baked** traces (not only reprocess). Do **not** retune endpoint constants in the same pass. Resting pitch still does not chase a short look-down (2s glance / `test_resting_pitch_does_not_chase_look_down`). After `RESTING_PITCH_STABLE_S` (6s) of open-eye pitch in a tight band **that matches** the ~30s 20th-percentile desk floor, rest may slowly rise toward `min(band, floor) − pitch_look_down_delta − PITCH_WEIGHT_SPAN/2` so laptop desk stays ~`pose_w` 0.4–0.6 (not ~0.24 → frontal aperture FN). `reset()` keeps `resting_pitch` + the 30s hist (preview / MSMF / no-face recover must not re-seed from the first frame; POG 2026-08-15: rest 0.118 → 0.009). A 6s chat-bottom hold must **not** become the new rest. Do **not** retune LOOK_DOWN_* / OCEC / `ear_depressed` in that pass. Baked corpus F1 **0.929** (floor ≥0.90).

Stage 3.4: per-eye `EyeTrack` + merge `both|stronger|single` in `domain/blink_detection.py` (start on either eye; avg EAR for `live_open`/drift only). Frontal one-eye drop → `reject_bilateral` (anti-talk); look-down/yaw may credit `stronger`. Info: `merge`, `left_drop`, `right_drop`. Baked metrics floor ≥0.90; prefer ↑ `side_monitor_*` recall. Do **not** retune ROI / PnP scales / LOOK_DOWN_* in the same pass.

Stage 3.5: `eye_intensity_aperture` in `infrastructure/vision.py` (`INTENSITY_APERTURE_ENABLED`) — 2nd closedness channel. Confirm on credit only (`reject_aperture`); no blend into EAR / start. Measure via `reprocess_video.py` → `*.ap.ndjson` + `metrics.py` (baked NDJSON without aperture fields = 3.4 skip). Floor ≥0.90. Do **not** retune LOOK_DOWN_* / velocity in the same pass.

## Stage 4 — logistic credit vote

Logistic **credit vote** after FSM gates (`domain/classifier.py` + `classifier_weights.json`). Numpy-free sigmoid; `CLASSIFIER_ENABLED` off = Stage 3.5 path; `CLASSIFIER_RESCUE=False` (no promote of `reject_*`). `p < t` → `reject_classifier`, except `|yaw| ≥ CLASSIFIER_SIDE_YAW_WAIVE` (0.35) and except a real OCEC confirm (`ocec_drop ≥ 0.35` → `ocec_clf` waive; POG 2026-08-14 frontal 2nd start). Harvest with classifier disabled, train on **completes** only, write weights. `blinkDebug`: `clf_p`, `clf_veto`. Floor ≥0.90. Do **not** retune LOOK_DOWN_* / velocity / ROI in the same pass. Not ONNX / eye-crop.

## Stage 5 — personal classifier overlay

**Personal overlay** on the baked logistic — not a corpus retrain. Camera Calibrate is two-phase: open-eye EAR (~8s) then ≥6 frontal blinks (~20s) sampling `blinkDebug.clf_p` on `complete` and `reject_classifier`. Apply the new EAR to the sidecar before Phase B. Bias `b = logit(0.70) − median(logit(p_i))` clamp ±2; keep baked `t=0.25` unless min biased p is close, then `clamp(min_p − 0.08, 0.15, 0.30)`. Prefs `classifierBias` / `classifierThreshold`; stdin `classifier_calibration`. Side-yaw waive unchanged. Phase B skips `|yaw|≥0.35` only — **do not** drop `look_down` samples (laptop webcam pitch trips `pose_weight > 0` while looking at the screen). Reset on Camera clears EAR **and** the overlay. Do **not** retune LOOK_DOWN_* / retrain weights / ONNX in the same pass.

### EAR + personal classifier calibration flow

1. UI → `start-ear-calibration` → `BlinkDetectorSidecar.startEarCalibration`
2. Phase A: Electron samples `faceData.ear` for `EAR_CALIBRATION_DURATION_MS` (default 8s) **only when `faceStatus === "ok"`**
3. `medianEarCalibration(samples)` → persist `earCalibration` + `calibrationAt` (even if Phase B is short)
4. Phase B (~20s): sample top-level `blinkDebug.clf_p` on `complete` and `reject_classifier` (skip `|yaw|≥0.35` only — keep `look_down` samples). Need ≥6 scores.
5. `personalBiasFromScores` / `personalThresholdFromScores` → persist `classifierBias` / `classifierThreshold` → `{"classifier_calibration": {"bias", "threshold"}}`
6. Progress/complete via `ear-calibration-progress` / `ear-calibration-complete` (payload includes `phase`, `blinkCount`, classifier fields)
7. Clear EAR with `{"ear_calibration": null}` / `update-ear-calibration` null (also clears `calibrationAt`). Clear overlay with `{"classifier_calibration": null}` / `update-classifier-calibration` `{bias:null,threshold:null}`. Camera Reset clears both.
8. Sidecar `blinkDebug.phase === "baseline_drift_nudge"` is promoted in Electron (`parseBaselineDriftNudge` → `onBaselineDriftNudge`) for a gated toast + Camera banner. Do **not** persist the Python-nudged EAR. Do **not** auto-start calibration. Named profiles remain deferred.

Helpers: `shared/ear-calibration.ts`, `shared/classifier-calibration.ts`, `shared/calibration-freshness.ts`. Domain apply: `BlinkDetectionState.set_ear_calibration` + `classifier.set_personal`.

## Stage 6 — hygiene

**Hygiene only** — forward FSM `waives` / `reject_gate` into `blinkDebug` JSONL; `analyze_blink_jsonl.py` prints a waive histogram; `corpus_gate_report.py` lists never-fired names. Do **not** delete LOOK_DOWN_* / SYNTHETIC_* / waive constants (FSM still owns credit; 0 on the 8-session corpus ≠ unused live). See [`python/fixtures/BASELINE.md`](../../../../python/fixtures/BASELINE.md) Stage 6 note.

## Stage 7 — OCEC confirm

**OCEC confirm** (`infrastructure/ocec.py`, OpenCV `cv2.dnn.readNetFromONNX`, not onnxruntime / not Face Mesh). Same pattern as Stage 3.5 aperture: credit-only `_confirm_ocec_for_credit` → `reject_ocec`; no blend into EAR / start. Skip confirm when `|yaw| ≥ CLASSIFIER_SIDE_YAW_WAIVE` (0.35) — side crop is unreliable; same band as Stage 4. After a real OCEC drop (`ocec_drop ≥ 0.35`) in that scored band, waive `reject_opening` (`ocec_opening`) — look-down one-frame abs often sits 0.031–0.034 vs 0.035 — waive `reject_threshold` (`ocec_threshold`) when relative EAR drop sits 0.14–0.18 vs adaptive ~0.17–0.19 (POG 2026-08-15; 21/30 live `reject_threshold` had `ocec_drop≥0.35`) — and waive `reject_velocity` (`ocec_velocity`) when duration ≥ `OCEC_VELOCITY_MIN_DURATION` 0.06 (POG 2026-08-16: 101 LD `reject_velocity`, peak p50≈0.36 vs short_ld 0.55, `ocec_drop` p50≈0.53) — and waive `reject_aperture` (`ocec_aperture`) when intensity aperture stays open on a real OCEC close (POG 2026-08-21: 113 live `reject_aperture`, 29 with `ocec_drop≥0.35`; smoking-gun 0.33s frontal closed=5 ocec=0.92 aperture_drop=0.03). Do **not** lower aperture ×0.28 / LOOK_DOWN_* in that pass. Look-down with `duration≥0.09` skips `reject_ocec` (`ocec_look_down`) when the eye crop stays open — laptop desk `ocec_drop` p50=0 on real EAR blinks (POG 2026-08-15 soak). `closed=2` + `duration<0.09` does **not** waive (vertical saccade EAR, POG 2026-08-22). One-frame look-down still confirms. Sub-60ms EAR misses get `ocec_opening` / `ocec_threshold` / `ocec_aperture` / `ocec_clf` only when `ocec_drop ≥ 0.60` (POG 2026-08-22: 0.35–0.39 on 34ms openV=0 credited eye motion). Do **not** lower `OCEC_CONFIRM_MIN_DROP`. Short+shallow opening kill is `SIDE_GLANCE_OPENING_KILL_YAW` **0.80** (2026-08-12 yaw≈1.1 storm), not the 0.35 crop band — chat-bottom live FN was `|yaw|` 0.35–0.80 `reject_opening`, not `reject_ocec`. `OCEC_ENABLED=False` until `reprocess_video.py --ocec` → `*.ocec.ndjson` + `metrics.py` holds the Stage 6 floor. Missing fields / missing ONNX → skip (baked 3.4–6 behaviour). Score only when 68-pt exists. Do **not** retune LOOK_DOWN_* / YuNet / idle locate / Windows open path in the same pass. `detector_backend` stays `"dlib"`.

Live soak held 2026-08-14; corpus join F1 0.932; `OCEC_ENABLED=True`. Optional model: `electron/assets/models/ocec_s.onnx` (~495KB, MIT OCEC) — missing ONNX → skip confirm.

## Gate constants / face locate (current behaviour)

Gate constants live in `python/blink_detector_package/domain/blink_detection.py` (+ pose profiles in `domain/pose.py`). Duration / short velocity scale with `target_fps` (`min_blink_duration_s`, `short_frontal_velocity`, `short_look_down_velocity`). Short frontal credits that rely on **synthetic** peak (`effective > measured + SYNTHETIC_PEAK_EPS`) also need real opening or `closed_frames ≥ 2`; shallow short abs-drop can hard-fail. Look-down may use ≈one-frame `duration_min` when measured peak clears the (raised) look-down short gate; look-down **credit recovery** uses `LOOK_DOWN_CREDIT_RECOVERY_RATIO` (0.74; await-clear stays 0.70; pose `look_down_recovery` aligned / unused for credit). Look-down opening: multi-frame uses `LOOK_DOWN_MIN_OPENING_VELOCITY` 0.15 / deep trough / strong peak (`LOOK_DOWN_SHORT_STRONG_PEAK` 0.85 + drop≥0.12 + `closed≥2`). One-frame needs depth (`drop≥0.12`, abs≥0.035) plus reopen≥0.25 **or** peak≥0.85. Strong short LD peak clears `LOOK_DOWN_ONE_FRAME_DURATION_MIN` 0.028. `short_look_down_velocity` ≈0.55. LD cooldown 0.90. `near_miss` needs drop≥0.08 for the velocity path and is throttled to 2s. `blinkDebug.gate_fps` is measured gate rate; `target_fps` is the camera preset. Candidate `pose_delta` is seeded from recent pose EMA. Soft frontal peak≥0.95 waive does **not** apply to look-down. Credit always requires reopen past recovery. Face detect: YuNet locates (`run_face_detect`); HOG-refine inside that ROI (`hog_refine_yunet_box`) is the preferred 68-pt crop. Skip HOG-refine while the YuNet box is within hold (~2.5px / IoU 0.93); ROI refine is upsample=0 (+ CLAHE then highlight-compress miss retry), not upsample=1. Raw YuNet miss retries LAB-CLAHE BGR (locate only; predictor stays raw gray). Plausible YuNet+HOG-miss uses the YuNet rect (`face_detect=yunet`) — do not fall through to full-frame HOG (eye-as-face). Hits are hold/EMA-stabilized (`stabilize_face_rect`). Do not temporally hold 68-pt. Do not re-detect every frame mid-blink. Relative min width `MIN_FACE_WIDTH_FRAC=0.12` plus edge-glued clutter (`face_bbox_plausible`) drop micro-boxes (eye-as-face / Fifine upsample=1) as **miss**, not `too_far`. Do not raise back to 0.18 — that cut real C930e desk faces after a short lean-back. Miss-hold `FACE_MISS_HOLD_FRAMES` (12); soft quality hold `FACE_QUALITY_HOLD_FRAMES` (skip EAR, keep bbox, no mid-blink cancel); after hard loss (had a bbox) re-acquire every-frame with heavy HOG retries for `FACE_REACQUIRE_FRAMES`, then idle-miss uses `FACE_IDLE_DETECT_INTERVAL` and YuNet-only locate (`run_face_detect(..., heavy_retries=False)` — no full-frame HOG / upsample=1). Do not reset the burst on every subsequent miss. Idle `faceStatus=none` IPC is edge plus ~3 Hz. Landmark `CLAHE_ENABLED` stays parked. Detector software-resize **fits** native aspect inside the quality preset (`fit_processing_size` — C170 640×360 stays 16:9, not stretched to 640×480). `face_none` with healthy `mean_luma` / `black_ratio=0` is a detect miss (side light / yaw / micro-box / C170 daylight), not multi-monitor routing. `blinkDebug.face_detect` is `hog`|`clahe`|`compress`|`upsample`|`yunet`; `detector_backend` stays `"dlib"` (landmarks). `camera_health` also counts `yunet_hit` / `yunet_enhanced_hit` / `hog_refine_miss` / `yunet_crop` / `hog_full_hit`. Sustained `|live_open − session baseline|` → `maybe_drift_recalibrate` (`BASELINE_DRIFT_*`). Face-loss cancels the candidate in `application/detector.py` (keeps EAR calibration).

## L2 backlog

**L2-A (parked):** CLAHE helpers in [`vision.py`](../../../../python/blink_detector_package/infrastructure/vision.py) (`prepare_predictor_gray`) but **`CLAHE_ENABLED = False`** — predictor uses raw gray again (pre-L2 path). Eye-ROI CLAHE shook dots; face-rect still hurt funnel when face patch was darker than room. Re-enable only after dark-room A/B; never with gate retunes. `blinkDebug.clahe` stays 0 while disabled.

**L2 later (same FSM, separate PRs):**

| Phase | What | Gate to start |
|---|---|---|
| L2-B ELA / lid angle | Intensity or denser-mesh aperture beside EAR; blend only behind flag | Stage 7 OCEC is confirm-only (not blend). Mesh still L2-C |
| L2-C ONNX Face Mesh | Landmarks adapter → same eye-6 + pose inputs; PyInstaller datas; no UI until funnel wins | A/B vs dlib+CLAHE: look_down/frontal credit_rate + `lt_0.5s` must match or beat |
| L2-D Eye-crop optical flow | Debug `flow_close`/`flow_open` first; soft V-shape confirm in a **second** PR | Never full-frame; skip Performance if ROI/FPS headroom low |

Focus for now: **L1 gate loop + L2 geometry** (CLAHE parked). Stage 4 is a numpy logistic **veto after gates**, not ONNX Face Mesh. Stage 7 OCEC is OpenCV DNN confirm-only (corpus join F1 0.932; live soak held; `OCEC_ENABLED=True`), not a backend switch.

### Gaps → fixes (algorithm backlog)

L1 (smoothing, hysteresis, FPS-aware shorts, face hold/re-acquire, drift recal, motion/duration/synthetic floors) is **shipped** — do not re-open those rows; see git history / `BASELINE.md`.

| Gap | Fix (phased) |
|---|---|
| Dark / uneven lighting EAR jitter | L2-A landmark CLAHE parked (`CLAHE_ENABLED=False`); YuNet locate + HOG-refine crop; relative min-face width (anti-eyebrow) |
| C170 daylight face_none (healthy luma) | Shipped locate-only: aspect-fit resize; YuNet LAB-CLAHE retry; highlight-compress HOG retry; plausible YuNet-crop fallback. Predictor stays raw gray. Not a CAP_PROP/open-path change. |
| Fifine / side-light eye-as-face | Shipped: `MIN_FACE_WIDTH_FRAC` + YuNet locate; upsample=1 kept but cannot return ~44px boxes |
| Look-down 68-pt on brow | Shipped: HOG-refine crop preferred. YuNet rect only when refine misses (bright/side-light). Still no full-frame HOG on a YuNet hit. |
| Look-down EAR ratio fragile | L2-B: Stage 7 OCEC confirm (eye-crop intensity ONNX, corpus + live soak held; `OCEC_ENABLED=True`). Blend / ELA later |
| Crude 68-pt yaw/pitch | L2-C ONNX mesh A/B (default stays dlib) |
| Weak V-shape confirm | L2-D eye-crop optical flow (debug → soft confirm) |
| Side-glance short one-eye FP | Shipped: `stronger_eye` must not undo the short+shallow opening kill (`|yaw|≥0.80`, dur<0.09, drop<0.35). Crop/veto band stays `|yaw|≥0.35` |

Do not constant-nudge without corpus `metrics.py` + mtime check. Ban multi-knob PRs. Do not ship L2 geometry + gate retunes together.
