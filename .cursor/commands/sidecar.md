# /sidecar

Blink-detector sidecar workflow: JSONL analysis, rebuild, or protocol checks.

**Invoke skill:** `blink-detector-sidecar`

## Steps

1. Read `.cursor/skills/blink-detector-sidecar/SKILL.md`.
2. Open only the needed `references/` file (protocol, jsonl-analysis, stages, windows-open-lock).
3. For binary freshness: `python/log_tools/check_exe_mtime.py`.
4. Optional: spawn `sidecar-reviewer` for Electron↔Python / Windows open-path review.

Do not casually retune the Windows camera open path or reintroduce MediaPipe.
