# Blink JSONL analysis & hard tune loop

Read this when diagnosing live tracking, tuning gates from field logs, or using `python/log_tools/`. Algorithm stage history and corpus F1 floors: [`stages.md`](stages.md). Always verify the installed binary first: `python/log_tools/check_exe_mtime.py`.

## Debug log paths (check these first for tracking issues)

Electron writes structured blink outcomes via `BlinkDetectorDebugLogger`:

| Platform | Path |
|---|---|
| Windows | `%APPDATA%\BlinkGuard\logs\blink-detector.jsonl` |
| macOS | `~/Library/Application Support/BlinkGuard/logs/blink-detector.jsonl` |
| Any | `{app.getPath('userData')}/logs/blink-detector.jsonl` |

- Rotated sibling: `blink-detector.jsonl.1` (when active file exceeds ~8 MB).
- Startup console once: `Blink debug log: <absolute path>`.
- Console stays short (`Blink credited` / `Blink rejected (<phase>)`); **full payloads are only in the JSONL**.
- Older installs may still have `ScreenBlink` under AppData — prefer `BlinkGuard` unless the path printed at startup says otherwise.
- App text log (startup/errors, Windows tee): `%APPDATA%/BlinkGuard/app.log` via `getAppLogPath()`.
- Interaction trail (settings / popups / tray / shortcuts): `{userData}/logs/interactions.jsonl` (+ `.1`); custom popup/exercise text redacted. See `electron/infrastructure/logging/interaction-logger.ts`.
- User export: About → **Export diagnostics** (`exportDiagnostics` IPC) packs blink JSONL, interactions, `app.log`, and algorithm prefs into a local zip — `electron/infrastructure/logging/diagnostics-export.ts`.

## Phase 0 — analyze JSONL before tuning

**Log tools live in `python/log_tools/`** (not throwaway temps under `scripts/`).

| Script | Use |
|---|---|
| `log_tools/analyze_blink_jsonl.py` | Phase 0 phases / pose split / start_funnel / credit gaps |
| `log_tools/phase0_acceptance.py` | Pass/fail vs fixed thresholds for a `--since` window |
| `log_tools/inspect_credits.py` | Credited-blink drilldown (ear/live ratio, synthetic boost, gaps) |
| `log_tools/check_exe_mtime.py` | Installed exe vs `domain/*.py` freshness |
| `log_tools/paths.py` | Shared default JSONL + exe + fixtures paths |
| `log_tools/trace_io.py` | Load EAR `.ndjson` traces + `.labels.json` |
| `log_tools/replay.py` | Offline `BlinkDetectionState` replay (no camera / no rebuild) |
| `log_tools/label.py` | Local HTML click-labeler for ground-truth blink times |
| `log_tools/metrics.py` | Precision / recall / F1 vs labels (`--dir fixtures/sessions`) |
| `log_tools/reprocess_video.py` | `.avi` → EAR NDJSON via YuNet+HOG 68-pt (geometry A/B; `--ocec` → `*.ocec.ndjson`) |
| `log_tools/corpus_status.py` | Which scenario stems are READY / missing labels |
| `log_tools/corpus_gate_report.py` | Aggregate reject_* / waive frequencies on the corpus |
| `log_tools/harvest_candidates.py` | Stage 4: feature rows from replay (`complete`/`reject_*`, classifier off) |
| `log_tools/train_classifier.py` | Stage 4: fit logistic on completes → `domain/classifier_weights.json` |

Corpus: `python/fixtures/sessions/*.ndjson` + `*.labels.json` — see `python/fixtures/README.md`. Companion `.avi` is gitignored (often under `%APPDATA%/BlinkGuard/traces`).

One-off probes → `python/log_tools/_scratch/` (gitignored). Do **not** create `_tmp_*.py` in `scripts/`. Shim: `python/scripts/analyze_blink_jsonl.py` still forwards to `log_tools/`.

**Algorithm gate** for detector PRs: `record → label → replay → metrics.py` F1 on `fixtures/sessions` (floor ≥0.90). `phase0_acceptance.py` / live JSONL = field diagnosis after rebuild, not the PR gate. Stage-0 baseline floors: [`stages.md`](stages.md) and [`python/fixtures/BASELINE.md`](../../../../python/fixtures/BASELINE.md).

## Hard tune loop (ban multi-knob PRs)

Live JSONL loop when a field bug is not in the corpus. Algorithm changes still need `metrics.py` on fixtures before claiming a win.

1. `check_exe_mtime.py` — exe newer than `domain/*.py` + `infrastructure/*.py` + `application/*.py`.
2. Restart app / stop-start tracking.
3. Run fixed scenarios (below) while logging.
4. `analyze_blink_jsonl.py --since <restart-UTC>` (phases + **waives** histogram) / `inspect_credits.py` if FAIL. `phase0_acceptance.py` is optional field pass/fail, not the corpus gate.
5. Change **one** gate constant (or one tightly coupled pair for a single hypothesis).
6. Rebuild/install exe → restart → `metrics.py` on fixtures → re-run live `--since`.

```bat
cd python
venv\Scripts\python.exe log_tools\check_exe_mtime.py
venv\Scripts\python.exe log_tools\analyze_blink_jsonl.py --since 2026-08-07T19:00:00+00:00
venv\Scripts\python.exe log_tools\phase0_acceptance.py --since 2026-08-07T19:00:00+00:00
venv\Scripts\python.exe log_tools\inspect_credits.py --since 2026-08-07T19:00:00+00:00
```

Manual scenarios (same every pass):

- Frontal calm intentional blinks
- 60s no blink (FP rate)
- Chat look-down (screen bottom)
- Side-monitor glance
- Walk-away return
- Talk without intentional blink

## How to analyze (manual)

1. Confirm which binary is live: `log_tools/check_exe_mtime.py` (compares exe vs `domain/*.py` + `infrastructure/*.py`; Stage 3 ROI lives in `vision.py`).
2. Filter JSONL by `ts` **after** the binary mtime (or after user restarted tracking). Pre-rebuild rows do not reflect new gates.
3. Count `blinkDebug.phase` (and `credited === true` → usually `phase: "complete"`). Prefer `analyze_blink_jsonl.py` (prints **waives** histogram); for FP loops use `inspect_credits.py`.
4. For rejects, look at `reject_gate`, `waives`, `peak_velocity`, `peak_opening_velocity`, `closed_frames`, `duration`, `drop`, `absolute_drop`, `ear_raw` / `ear_smooth`, `yaw`, `look_down`, `threshold`, `baseline`, `detector_backend`, `face_detect`, `face_area`.
5. Common phases:

| Phase | Meaning |
|---|---|
| `start` | Candidate entered close band (always emitted once per candidate) |
| `complete` | Credited blink |
| `near_miss` | Not in candidate but closing motion / near close band (rate-limited) |
| `reject_velocity` | Close spike too weak (short frontal / look-down FPS bands) |
| `reject_opening` | V-shape failed (weak reopen and not enough closed frames); frontal peak≥0.95 may waive; look-down needs openV≥`LOOK_DOWN_MIN_OPENING_VELOCITY` (0.25), deep trough, or strong peak+`closed≥2` |
| `reject_threshold` | Relative/absolute EAR drop failed |
| `reject_cooldown` | Too soon after previous credit |
| `reject_duration` | Too short in time / `< MIN_CLOSED_FRAMES` |
| `reject_recovery` | Evaluated at duration-max (or reopen check) but EAR never cleared recovery ratio |
| `reject_motion` | Head pose Δ (`|Δyaw|+|Δpitch|`) during candidate exceeded `MOTION_REJECT_DELTA` (waived when measured peak+drop strong) |
| `reject_bilateral` / `reject_yaw` | Other completion gates |
| `reject_aperture` | Stage 3.5: EAR credit ok but stronger-eye intensity aperture drop too shallow (side+look-down uses full adaptive, not min_each). Real OCEC drop in scored yaw band may waive (`ocec_aperture`) |
| `reject_ocec` | Stage 7: EAR credit ok but stronger-eye OCEC `prob_open` drop too shallow (`OCEC_CONFIRM_MIN_DROP`). Skipped when samples/ONNX missing, `OCEC_ENABLED=False`, or `|yaw| ≥ 0.35`. Look-down skip-confirm (`ocec_look_down`) is `duration≥0.09` only — not `closed≥2` |
| `reject_classifier` | Stage 4: gates_ok but logistic `p < threshold` (veto). Skipped when `|yaw| ≥ 0.35` (side glance) or OCEC confirmed (`ocec_clf`). `CLASSIFIER_ENABLED=False` skips this |
| `skip_yaw` / `skip_await_open` / `skip_eyes_closed` / `skip_cooldown` | Frame skipped; first entry always logged, then 0.5s throttle. Top-webcam + eyes on screen bottom: if these stick with `look_down≈false` and ear/live≈0.55–0.68, stale `live_open` is the usual cause (mid-band fall eases ref while latched) |
| `skip_face_lost` | Face disappeared mid-candidate; FSM candidate cancelled |
| `skip_face_quality` | Face bbox / interocular too small; EAR not fed (soft-hold 1–2 frames mid-blink) |
| `baseline_drift_nudge` | Session baseline gently moved toward `live_open_ear` after sustained frontal drift |

Analyzer reports `start_funnel` (start→complete/reject) and `near_miss` counts. Rejected alternatives: MediaPipe (FN regression), full-frame optical-flow (cost). **L2 geometry rule:** new landmarks/EAR measurement must not retune FSM gates in the same change — Phase 0 A/B first.

## Phase 0 acceptance (after rebuild + restart)

1. `log_tools/check_exe_mtime.py` — exe newer than `domain/*.py` + `classifier_weights.json` + `infrastructure/*.py` + `application/*.py`.
2. Restart app / stop-start tracking; analyze with `--since` = restart UTC.
3. Scenarios: calm frontal intentional blinks; 60 s no-blink (credit gaps `lt_0.5s ≈ 0`); chat look-down; walk-away return; watch preview dots/box track lids without float.

Do not constant-nudge without corpus `metrics.py` + mtime check. Ban multi-knob PRs (hard tune loop above). Do not ship L2 geometry + gate retunes together — see [`stages.md`](stages.md).
