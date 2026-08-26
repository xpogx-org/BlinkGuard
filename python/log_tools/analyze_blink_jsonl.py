#!/usr/bin/env python3
"""
Phase 0 blinkDebug JSONL analyzer for BlinkGuard.

Usage (from python/):
  venv\\Scripts\\python.exe log_tools\\analyze_blink_jsonl.py
  venv\\Scripts\\python.exe log_tools\\analyze_blink_jsonl.py --minutes 20
  venv\\Scripts\\python.exe log_tools\\analyze_blink_jsonl.py --since 2026-08-07T19:00:00+00:00
  venv\\Scripts\\python.exe log_tools\\analyze_blink_jsonl.py --path %APPDATA%/BlinkGuard/logs/blink-detector.jsonl

Checklist before trusting numbers:
  1. Compare mtime(electron/resources/blink_detector.exe) vs domain/*.py
     (or run log_tools/check_exe_mtime.py)
  2. Restart app / stop-start tracking after rebuild
  3. Pass --since = restart time (UTC) so pre-rebuild rows are excluded

Manual scenarios (run while logging):
  - frontal calm intentional blinks
  - 60s no blink (FP rate)
  - look down at screen bottom
  - side monitor glance
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

_TOOLS = Path(__file__).resolve().parent
if str(_TOOLS) not in sys.path:
	sys.path.insert(0, str(_TOOLS))

from paths import default_blink_jsonl  # noqa: E402


def default_log_path() -> Path:
	return default_blink_jsonl()


def parse_ts(value: str) -> datetime:
	return datetime.fromisoformat(value.replace("Z", "+00:00"))


def load_rows(paths: list[Path], cutoff: datetime | None):
	rows = []
	for path in paths:
		if not path.exists():
			continue
		with path.open(encoding="utf-8", errors="replace") as handle:
			for line in handle:
				line = line.strip()
				if not line:
					continue
				try:
					obj = json.loads(line)
				except json.JSONDecodeError:
					continue
				ts = obj.get("ts")
				bd = obj.get("blinkDebug")
				if not ts or not isinstance(bd, dict):
					continue
				try:
					t = parse_ts(ts)
				except ValueError:
					continue
				if cutoff is not None and t < cutoff:
					continue
				rows.append((t, bd))
	rows.sort(key=lambda item: item[0])
	return rows


def load_camera_states(paths: list[Path], cutoff: datetime | None):
	rows = []
	for path in paths:
		if not path.exists():
			continue
		with path.open(encoding="utf-8", errors="replace") as handle:
			for line in handle:
				line = line.strip()
				if not line:
					continue
				try:
					obj = json.loads(line)
				except json.JSONDecodeError:
					continue
				ts = obj.get("ts")
				state = obj.get("cameraState")
				if not ts or not isinstance(state, dict):
					continue
				try:
					t = parse_ts(ts)
				except ValueError:
					continue
				if cutoff is not None and t < cutoff:
					continue
				rows.append((t, state))
	rows.sort(key=lambda item: item[0])
	return rows


def _print_camera_state_summary(states: list) -> None:
	if not states:
		print("--- cameraState: n=0 ---")
		return
	kinds = Counter((s.get("kind") or "?") for _, s in states)
	print("--- cameraState ---")
	print(f"events={len(states)} kinds={dict(kinds.most_common())}")
	health = [s for _, s in states if s.get("kind") == "camera_health"]
	if health:
		lumas = [float(s["mean_luma"]) for s in health if s.get("mean_luma") is not None]
		blacks = [
			float(s["black_ratio"])
			for s in health
			if s.get("black_ratio") is not None
		]
		backends = Counter(
			(s.get("backend_name") or s.get("backend") or "?") for s in health
		)
		print(f"  health_n={len(health)} backends={dict(backends.most_common())}")
		if lumas:
			print(
				f"  mean_luma: p50={pct(lumas, 0.5):.1f} "
				f"p90={pct(lumas, 0.9):.1f} last={lumas[-1]:.1f}"
			)
		if blacks:
			print(
				f"  black_ratio: p50={pct(blacks, 0.5):.3f} "
				f"p90={pct(blacks, 0.9):.3f} last={blacks[-1]:.3f}"
			)
		detect_keys = (
			"face_ok",
			"face_none",
			"face_too_far",
			"yunet_hit",
			"yunet_enhanced_hit",
			"hog_refine_miss",
			"yunet_crop",
			"hog_full_hit",
		)
		detect_parts = []
		for key in detect_keys:
			vals = [int(s[key]) for s in health if s.get(key) is not None]
			if vals:
				detect_parts.append(f"{key}={sum(vals)}")
		if detect_parts:
			print("  detect: " + " ".join(detect_parts))
	opens = [s for _, s in states if s.get("kind") == "camera_open_result"]
	if opens:
		ok = sum(1 for s in opens if s.get("ok") is True)
		print(f"  open_result: n={len(opens)} ok={ok} fail={len(opens) - ok}")
		for s in opens[-3:]:
			print(
				f"    ok={s.get('ok')} backend={s.get('backend_name')} "
				f"luma={s.get('mean_luma')} reject={s.get('reject_reason')}"
			)
	streaks = [s for _, s in states if s.get("kind") == "camera_black_streak"]
	failovers = [s for _, s in states if s.get("kind") == "camera_failover"]
	if streaks or failovers:
		print(f"  black_streak={len(streaks)} failover={len(failovers)}")



def pct(vals: list[float], p: float) -> float:
	if not vals:
		return float("nan")
	vals = sorted(vals)
	index = int(round((len(vals) - 1) * p))
	return vals[index]


def stats(label: str, items: list[dict], key: str) -> None:
	vals = [float(item[key]) for item in items if item.get(key) is not None]
	if not vals:
		print(f"  {label} {key}: n=0")
		return
	print(
		f"  {label} {key}: n={len(vals)} "
		f"p25={pct(vals, 0.25):.4f} p50={pct(vals, 0.5):.4f} "
		f"p75={pct(vals, 0.75):.4f} p90={pct(vals, 0.9):.4f}"
	)


def cooldown_remaining_buckets(label: str, items: list[dict]) -> None:
	"""Bounce (high rem) vs late-cooldown (low rem) for cooldown phases."""
	vals = [
		float(item["cooldown_remaining"])
		for item in items
		if item.get("cooldown_remaining") is not None
	]
	if not vals:
		print(f"  {label} cooldown_remaining buckets: n=0")
		return
	edges = (0.15, 0.30, 0.40, 0.55)
	counts = {
		"lt_0.15": 0,
		"0.15_0.30": 0,
		"0.30_0.40": 0,
		"0.40_0.55": 0,
		"ge_0.55": 0,
	}
	for rem in vals:
		if rem < edges[0]:
			counts["lt_0.15"] += 1
		elif rem < edges[1]:
			counts["0.15_0.30"] += 1
		elif rem < edges[2]:
			counts["0.30_0.40"] += 1
		elif rem < edges[3]:
			counts["0.40_0.55"] += 1
		else:
			counts["ge_0.55"] += 1
	parts = " ".join(f"{name}={n}" for name, n in counts.items())
	print(f"  {label} cooldown_remaining buckets: n={len(vals)} {parts}")
	stats(label, items, "cooldown_remaining")


def _is_look_down(bd: dict) -> bool:
	return bool(bd.get("look_down"))


def _completion_attempts(rows: list) -> list[dict]:
	"""Credited completes + reject_* (finished candidates)."""
	out = []
	for _, bd in rows:
		phase = bd.get("phase") or ("complete" if bd.get("credited") else None)
		if not phase:
			continue
		if bd.get("credited") is True or str(phase).startswith("reject_"):
			out.append(bd)
	return out


def _print_pose_reject_split(attempts: list[dict]) -> None:
	"""Frontal vs look-down reject shares (Phase 0 acceptance metric)."""
	if not attempts:
		print("pose_split: n=0")
		return

	def bucket(items: list[dict], label: str) -> None:
		n = len(items)
		if n == 0:
			print(f"  {label}: n=0")
			return
		phases = Counter(
			(b.get("phase") or ("complete" if b.get("credited") else "?"))
			for b in items
		)
		vel = phases.get("reject_velocity", 0)
		opn = phases.get("reject_opening", 0)
		cred = sum(1 for b in items if b.get("credited") is True)
		print(
			f"  {label}: n={n} credited={cred} "
			f"credit_rate={cred / n:.3f} "
			f"reject_velocity={vel} ({vel / n:.3f}) "
			f"reject_opening={opn} ({opn / n:.3f}) "
			f"reject_vel+open={(vel + opn) / n:.3f}"
		)
		print(f"    phases={dict(phases.most_common())}")

	frontal = [b for b in attempts if not _is_look_down(b)]
	look_down = [b for b in attempts if _is_look_down(b)]
	print("--- pose split (completion attempts) ---")
	bucket(frontal, "frontal")
	bucket(look_down, "look_down")


def main() -> int:
	parser = argparse.ArgumentParser(description=__doc__)
	parser.add_argument("--path", type=Path, default=None)
	parser.add_argument("--minutes", type=float, default=None)
	parser.add_argument("--since", type=str, default=None)
	parser.add_argument(
		"--include-rotated",
		action="store_true",
		help="Also read blink-detector.jsonl.1 next to the active file",
	)
	args = parser.parse_args()

	path = args.path or default_log_path()
	paths = [path]
	if args.include_rotated:
		rotated = Path(str(path) + ".1")
		paths.append(rotated)

	cutoff = None
	if args.since:
		cutoff = parse_ts(args.since)
	elif args.minutes is not None:
		cutoff = datetime.now(timezone.utc) - timedelta(minutes=args.minutes)

	rows = load_rows(paths, cutoff)
	camera_states = load_camera_states(paths, cutoff)
	print(f"log={path}")
	print(f"events={len(rows)}")
	_print_camera_state_summary(camera_states)
	if not rows:
		return 0

	print(f"from={rows[0][0].isoformat()} to={rows[-1][0].isoformat()}")
	phases = Counter()
	credited = []
	rejected = []
	for _, bd in rows:
		phase = bd.get("phase") or ("complete" if bd.get("credited") else "?")
		phases[phase] += 1
		if bd.get("credited") is True:
			credited.append(bd)
		else:
			rejected.append(bd)

	print("phases:", dict(phases.most_common()))
	attempts = _completion_attempts(rows)
	waive_counts: Counter[str] = Counter()
	for bd in attempts:
		raw = bd.get("waives")
		if isinstance(raw, list):
			waive_counts.update(str(w) for w in raw if w)
	print("waives:", dict(waive_counts.most_common()) or "(none)")
	total = len(rows)
	print(f"credit_rate={len(credited) / total:.3f}" if total else "credit_rate=n/a")

	starts = phases.get("start", 0)
	near_miss = phases.get("near_miss", 0)
	completes = phases.get("complete", 0)
	rejects = sum(
		c for p, c in phases.items() if str(p).startswith("reject_")
	)
	if starts:
		print(
			f"start_funnel: start={starts} complete={completes} "
			f"reject={rejects} "
			f"start_to_complete={completes / starts:.3f} "
			f"start_to_outcome={(completes + rejects) / starts:.3f}"
		)
	print(f"near_miss={near_miss}")

	short = [b for b in credited if float(b.get("duration") or 99) < 0.09]
	look_down = [b for b in credited if b.get("look_down")]
	print(f"credited_short={len(short)} credited_look_down={len(look_down)}")

	_print_pose_reject_split(attempts)

	print("--- credited ---")
	stats("cred", credited, "duration")
	stats("cred", credited, "peak_velocity")
	stats("cred", credited, "peak_velocity_raw")
	stats("cred", credited, "peak_velocity_effective")
	stats("cred", credited, "absolute_drop")
	stats("cred", credited, "drop")
	stats("cred", credited, "yaw")

	for phase in (
		"reject_velocity",
		"reject_threshold",
		"reject_cooldown",
		"skip_cooldown",
		"reject_opening",
		"reject_bilateral",
		"reject_motion",
		"reject_aperture",
		"reject_ocec",
		"skip_face_lost",
		"skip_face_quality",
		"skip_landmark_quality",
	):
		bucket = [b for b in rejected if b.get("phase") == phase]
		if not bucket:
			continue
		print(f"--- {phase} n={len(bucket)} ---")
		stats(phase, bucket, "duration")
		stats(phase, bucket, "peak_velocity")
		stats(phase, bucket, "peak_velocity_raw")
		stats(phase, bucket, "peak_velocity_effective")
		stats(phase, bucket, "absolute_drop")
		stats(phase, bucket, "drop")
		if phase in ("reject_cooldown", "skip_cooldown"):
			cooldown_remaining_buckets(phase, bucket)
		if phase == "skip_face_quality":
			stats(phase, bucket, "face_area")
			stats(phase, bucket, "interocular")
		if phase == "skip_landmark_quality":
			stats(phase, bucket, "face_area")
			stats(phase, bucket, "interocular")
			stats(phase, bucket, "area_frac")
		if phase == "reject_ocec":
			stats(phase, bucket, "ocec_drop")

	# Scenario hint: credits closer than 0.5s often mean FP storms
	times = [t for t, bd in rows if bd.get("credited")]
	gaps = [
		(times[i] - times[i - 1]).total_seconds()
		for i in range(1, len(times))
	]
	fast = sum(1 for g in gaps if g < 0.5)
	if gaps:
		print(
			f"credit_gaps: n={len(gaps)} lt_0.5s={fast} "
			f"median={sorted(gaps)[len(gaps) // 2]:.3f}s"
		)

	print(
		"\nScenarios: frontal blinks | 60s no-blink FP | look-down | "
		"side-monitor | intentional only"
	)
	return 0


if __name__ == "__main__":
	raise SystemExit(main())
