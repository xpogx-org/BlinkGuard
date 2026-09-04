"""Unit tests for EAR blink FSM — no camera required."""

from __future__ import annotations

import math
import unittest

from blink_detector_package.domain.blink_detection import (
	BLINK_MIN_CLOSING_VELOCITY,
	MIN_CLOSED_FRAMES,
	MIN_FACE_AREA_PX,
	MIN_INTEROCULAR_PX,
	MIN_OPENING_VELOCITY,
	RESTING_PITCH_STABLE_S,
	SIDE_GLANCE_OPENING_KILL_YAW,
	BlinkDetectionState,
	get_adaptive_ear_drop_threshold,
	merge_eye_drops,
	min_blink_duration_s,
	short_frontal_velocity,
	short_look_down_velocity,
)
from blink_detector_package.domain.pose import (
	PITCH_WEIGHT_SPAN,
	MAX_FACE_AREA_FRAC,
	estimate_head_pose_heuristic,
	evaluate_pose_gate,
	face_area_fraction,
	face_bbox_plausible,
	get_pose_profile,
	interocular_distance_px,
	is_face_too_close,
	lerp,
	pose_weight,
	select_largest_face,
)
from blink_detector_package.infrastructure.head_pose import estimate_head_pose



class _FakeFace:
	def __init__(self, width, height, left=80, top=60):
		self._w = width
		self._h = height
		self._left = left
		self._top = top

	def width(self):
		return self._w

	def height(self):
		return self._h

	def left(self):
		return self._left

	def top(self):
		return self._top

	def right(self):
		return self._left + self._w

	def bottom(self):
		return self._top + self._h


def _seed_open_eye(state, ear=0.28, t0=1.0, frames=15, dt=0.1):
	"""Build a stable open-eye baseline (enough frames for EAR smooth window)."""
	for index in range(frames):
		credited, _info = state.detect(ear, t0 + index * dt)
		assert credited is False
	assert state.current_baseline_ear > 0
	return t0 + frames * dt


def _feed(state, t, steps, pose=None):
	"""
	Feed (dt, ear) or ear steps. Optional (dt, ear, left, right).
	Returns (credited_any, t, last_info, phases).
	last_info prefers the credited complete payload when present.
	"""
	credited_any = False
	last_info = None
	credited_info = None
	phases = []
	for step in steps:
		left = right = None
		if isinstance(step, tuple) and len(step) == 4:
			dt, ear, left, right = step
		elif isinstance(step, tuple) and len(step) == 2:
			dt, ear = step
		else:
			dt, ear = 0.1, step
		t += dt
		credited, info = state.detect(
			ear,
			t,
			left_ear=left,
			right_ear=right,
			pose=pose,
		)
		last_info = info
		if info:
			phases.append(info.get("phase"))
		if credited:
			credited_any = True
			credited_info = info
	return credited_any, t, credited_info or last_info, phases


def _eval_ld_one_frame(
	*,
	live_open_ear,
	max_drop,
	opening_velocity,
	window_ear,
	detect_ear,
	left_ocec,
	right_ocec,
	closed_frames=1,
	peak=1.2,
	duration=0.05,
):
	"""Seed a look-down candidate and eval after `duration` seconds."""
	state = BlinkDetectionState(target_fps=20)
	t = _seed_open_eye(state, ear=0.28)
	pose = estimate_head_pose(_frontal_landmarks(pitch_shift=-35.0))
	state.resting_pitch = pose["pitch"] - 0.20
	state.live_open_ear = live_open_ear
	state.live_open_ocec = 0.90
	state.blink_in_progress = True
	state.blink_start_time = t
	state.closed_frames = closed_frames
	state.peak_closing_velocity = peak
	state.peak_closing_velocity_measured = peak
	state.peak_opening_velocity = opening_velocity
	state.max_drop_percentage = max_drop
	state._candidate_pose_delta = 0.0
	state._ear_window.clear()
	for _ in range(3):
		state._ear_window.append(window_ear)
	t += duration
	credited, info = state.detect(
		detect_ear,
		t,
		pose=pose,
		left_ocec=left_ocec,
		right_ocec=right_ocec,
	)
	return credited, info, pose


# Deep close + hold (≥2 closed) + reopen past smooth recovery lag.
_CREDIT_STEPS = (
	(0.1, 0.16),
	(0.1, 0.10),
	(0.1, 0.08),
	(0.1, 0.07),
	(0.1, 0.22),
	(0.1, 0.28),
	(0.1, 0.28),
)


def _frontal_landmarks(yaw_offset=0.0, pitch_shift=0.0):
	"""
	Synthetic 68-pt cloud. yaw_offset moves nose in X;
	pitch_shift moves nose in Y (negative → look-down / smaller nose_ratio).
	"""
	points = [(0.0, 0.0)] * 68
	for i in range(17):
		points[i] = (100.0 + i * 10.0, 200.0)
	points[8] = (180.0, 260.0)

	for i in range(17, 27):
		points[i] = (120.0 + (i - 17) * 8.0, 120.0)

	for i in range(27, 31):
		points[i] = (180.0 + yaw_offset, 140.0 + (i - 27) * 12.0 + pitch_shift)
	points[30] = (180.0 + yaw_offset, 176.0 + pitch_shift)
	for i in range(31, 36):
		points[i] = (160.0 + (i - 31) * 10.0 + yaw_offset, 190.0 + pitch_shift)

	left = [(150, 150), (158, 145), (166, 145), (174, 150), (166, 155), (158, 155)]
	for i, (x, y) in enumerate(left):
		points[36 + i] = (float(x), float(y))
	right = [(186, 150), (194, 145), (202, 145), (210, 150), (202, 155), (194, 155)]
	for i, (x, y) in enumerate(right):
		points[42 + i] = (float(x), float(y))

	for i in range(48, 68):
		points[i] = (150.0 + (i - 48) * 3.0, 220.0)

	return points


def _rotate_landmarks(landmarks, cx, cy, deg):
	rad = math.radians(deg)
	cos_r = math.cos(rad)
	sin_r = math.sin(rad)
	return [
		(
			cx + (x - cx) * cos_r - (y - cy) * sin_r,
			cy + (x - cx) * sin_r + (y - cy) * cos_r,
		)
		for x, y in landmarks
	]


class PoseTests(unittest.TestCase):
	def test_select_largest_face(self):
		faces = [_FakeFace(40, 40), _FakeFace(100, 80), _FakeFace(50, 50)]
		best = select_largest_face(faces)
		self.assertIs(best, faces[1])
		self.assertIsNone(select_largest_face([]))

	def test_edge_laundry_bbox_rejected(self):
		"""Small HOG hit flush left (laundry) is not a face."""
		laundry = _FakeFace(48, 56, left=0, top=80)
		self.assertFalse(face_bbox_plausible(laundry, 480, 360))

	def test_centered_desk_face_plausible(self):
		face = _FakeFace(140, 160, left=170, top=80)
		self.assertTrue(face_bbox_plausible(face, 480, 360))

	def test_centered_eye_micro_box_rejected(self):
		"""~44px HOG hit on an eye is miss, not too_far (Fifine 2.7.0)."""
		eye = _FakeFace(44, 44, left=200, top=140)
		self.assertFalse(face_bbox_plausible(eye, 480, 360))
		zip_eye = _FakeFace(53, 53, left=180, top=120)
		self.assertFalse(face_bbox_plausible(zip_eye, 480, 360))

	def test_relative_min_width_allows_zip_8190_candidate(self):
		face = _FakeFace(90, 91, left=170, top=80)
		self.assertTrue(face_bbox_plausible(face, 480, 360))

	def test_chair_distance_face_on_640_is_plausible(self):
		"""C930e High/Ultra 640-wide: lean-back ~14% width is a face, not an eye."""
		chair = _FakeFace(90, 100, left=270, top=80)
		self.assertTrue(face_bbox_plausible(chair, 640, 360))
		too_small = _FakeFace(70, 78, left=280, top=90)
		self.assertFalse(face_bbox_plausible(too_small, 640, 360))

	def test_closeup_clipping_border_still_plausible(self):
		"""Filled-frame close-up may touch edges; area fraction saves it."""
		close = _FakeFace(400, 320, left=0, top=0)
		self.assertTrue(face_bbox_plausible(close, 480, 360))

	def test_face_area_fraction_and_too_close(self):
		desk = _FakeFace(140, 160, left=170, top=80)
		close = _FakeFace(400, 320, left=0, top=0)
		self.assertLess(face_area_fraction(desk, 480, 360), MAX_FACE_AREA_FRAC)
		self.assertFalse(is_face_too_close(desk, 480, 360))
		self.assertGreater(face_area_fraction(close, 480, 360), MAX_FACE_AREA_FRAC)
		self.assertTrue(is_face_too_close(close, 480, 360))

	def test_estimate_yaw_and_pitch(self):
		frontal = estimate_head_pose(_frontal_landmarks())
		self.assertTrue(frontal["valid"])
		self.assertAlmostEqual(frontal["yaw"], 0.0, delta=0.15)

		profile = estimate_head_pose(_frontal_landmarks(yaw_offset=40.0))
		self.assertGreater(abs(profile["yaw"]), abs(frontal["yaw"]))

		look_down = estimate_head_pose(_frontal_landmarks(pitch_shift=-30.0))
		self.assertGreater(look_down["pitch"], frontal["pitch"])

	def test_extreme_yaw_blocks_credit(self):
		pose = estimate_head_pose(_frontal_landmarks(yaw_offset=22.0))
		self.assertGreater(abs(pose["yaw"]), 1.20)
		gate = evaluate_pose_gate(pose, "normal")
		self.assertTrue(gate["extreme_yaw"])
		self.assertFalse(gate["allow_credit"])

	def test_moderate_side_yaw_still_allows_credit(self):
		pose = estimate_head_pose(_frontal_landmarks(yaw_offset=10.0))
		gate = evaluate_pose_gate(pose, "normal")
		self.assertFalse(gate["extreme_yaw"])
		self.assertTrue(gate["allow_credit"])
		self.assertGreater(abs(pose["yaw"]), 0.3)
		self.assertLess(abs(pose["yaw"]), 1.20)

	def test_left_monitor_yaw_still_allows_credit(self):
		pose = estimate_head_pose(_frontal_landmarks(yaw_offset=18.0))
		self.assertGreater(abs(pose["yaw"]), 0.85)
		self.assertLess(abs(pose["yaw"]), 1.20)
		gate = evaluate_pose_gate(pose, "normal")
		self.assertFalse(gate["extreme_yaw"])
		self.assertTrue(gate["allow_credit"])

	def test_side_monitor_right_band_allows_credit(self):
		"""Former 1.10–1.20 band was skip_yaw on right-monitor glances."""
		pose = estimate_head_pose(_frontal_landmarks(yaw_offset=20.0))
		self.assertGreater(abs(pose["yaw"]), 1.05)
		self.assertLess(abs(pose["yaw"]), 1.20)
		gate = evaluate_pose_gate(pose, "normal")
		self.assertFalse(gate["extreme_yaw"])
		self.assertTrue(gate["allow_credit"])

	def test_pose_weight_endpoints_and_mid(self):
		profile = get_pose_profile("normal")
		d0 = profile["pitch_look_down_delta"]
		self.assertEqual(pose_weight(d0, profile), 0.0)
		self.assertEqual(pose_weight(d0 - 0.01, profile), 0.0)
		self.assertAlmostEqual(
			pose_weight(d0 + PITCH_WEIGHT_SPAN, profile), 1.0, places=5
		)
		mid = pose_weight(d0 + PITCH_WEIGHT_SPAN * 0.5, profile)
		self.assertAlmostEqual(mid, 0.5, places=5)
		self.assertEqual(
			pose_weight(d0 + 1.0, profile, extreme_yaw=True), 0.0
		)

	def test_lerp_and_continuous_mults(self):
		self.assertAlmostEqual(lerp(1.0, 0.88, 0.0), 1.0, places=5)
		self.assertAlmostEqual(lerp(1.0, 0.88, 1.0), 0.88, places=5)
		self.assertAlmostEqual(lerp(1.0, 0.88, 0.5), 0.94, places=5)
		pose = estimate_head_pose(_frontal_landmarks(pitch_shift=-35.0))
		gate = evaluate_pose_gate(
			pose, "normal", resting_pitch=pose["pitch"] - 0.20
		)
		self.assertGreaterEqual(gate["pose_weight"], 0.999)
		self.assertTrue(gate["look_down"])
		profile = get_pose_profile("normal")
		self.assertAlmostEqual(
			gate["threshold_mult"],
			profile["look_down_threshold_mult"],
			places=5,
		)
		flat = evaluate_pose_gate(
			pose, "normal", resting_pitch=pose["pitch"]
		)
		self.assertEqual(flat["pose_weight"], 0.0)
		self.assertFalse(flat["look_down"])
		self.assertAlmostEqual(flat["threshold_mult"], 1.0, places=5)

	def test_look_down_relaxes_drop_threshold(self):
		pose = estimate_head_pose(_frontal_landmarks(pitch_shift=-35.0))
		resting = pose["pitch"] - 0.20
		gate = evaluate_pose_gate(pose, "normal", resting_pitch=resting)
		self.assertTrue(gate["look_down"])
		self.assertLess(gate["threshold_mult"], 1.0)
		self.assertGreaterEqual(gate["velocity_mult"], 1.0)
		# Frontal reopen uses BLINK_RECOVERY_DEFAULT; LD credit uses
		# LOOK_DOWN_CREDIT_RECOVERY_RATIO in the FSM (not this gate field).
		self.assertAlmostEqual(gate["recovery_threshold"], 0.7, places=2)
		self.assertTrue(gate["allow_credit"])

	def test_resting_pitch_avoids_false_look_down(self):
		pose = estimate_head_pose(_frontal_landmarks(pitch_shift=-30.0))
		gate = evaluate_pose_gate(
			pose,
			"normal",
			resting_pitch=pose["pitch"],
		)
		self.assertFalse(gate["look_down"])
		self.assertAlmostEqual(gate["pitch_delta"], 0.0, places=5)


class BlinkDetectionTests(unittest.TestCase):
	def setUp(self):
		# Gate tests are Stage 3.5; trained Stage-4 weights must not veto
		# synthetic blinks that are unlike the corpus.
		from blink_detector_package.domain import classifier as clf

		self._clf_enabled = clf.CLASSIFIER_ENABLED
		clf.CLASSIFIER_ENABLED = False

	def tearDown(self):
		from blink_detector_package.domain import classifier as clf

		clf.CLASSIFIER_ENABLED = self._clf_enabled

	def test_resting_pitch_does_not_chase_look_down(self):
		state = BlinkDetectionState()
		t = _seed_open_eye(state, ear=0.28)
		frontal = estimate_head_pose(_frontal_landmarks())
		down = estimate_head_pose(_frontal_landmarks(pitch_shift=-35.0))
		state.resting_pitch = frontal["pitch"]
		before = state.resting_pitch
		self.assertGreater(down["pitch"], before + 0.05)
		for _ in range(40):
			t += 0.05
			state.detect(0.28, t, pose=down)
		self.assertLessEqual(state.resting_pitch, before + 1e-6)

	def test_resting_pitch_still_tracks_when_looking_up(self):
		state = BlinkDetectionState()
		t = _seed_open_eye(state, ear=0.28)
		high = estimate_head_pose(_frontal_landmarks(pitch_shift=-35.0))
		low = estimate_head_pose(_frontal_landmarks())
		state.resting_pitch = high["pitch"]
		before = state.resting_pitch
		self.assertLess(low["pitch"], before - 0.05)
		for _ in range(40):
			t += 0.05
			state.detect(0.28, t, pose=low)
		self.assertLess(state.resting_pitch, before)

	def test_resting_pitch_recovers_from_too_low_seed(self):
		"""Desk webcam bias after a camera-look seed must not stay full look-down."""
		state = BlinkDetectionState()
		t = _seed_open_eye(state, ear=0.28)
		desk = estimate_head_pose(_frontal_landmarks())
		desk_pitch = desk["pitch"]
		state.resting_pitch = desk_pitch - 0.20
		before = state.resting_pitch
		gate0 = evaluate_pose_gate(
			desk, "normal", resting_pitch=state.resting_pitch
		)
		self.assertTrue(gate0["look_down"])
		self.assertGreater(gate0["pose_weight"], 0.8)
		dt = 0.05
		# Hold the desk pose past the glance window, then let the slow rise
		# EMA land mid look-down weight (not frontal, not a 2s glance).
		frames = int(RESTING_PITCH_STABLE_S / dt) + 250
		for _ in range(frames):
			t += dt
			state.detect(0.28, t, pose=desk)
		self.assertGreater(state.resting_pitch, before + 0.04)
		gate1 = evaluate_pose_gate(
			desk, "normal", resting_pitch=state.resting_pitch
		)
		# Laptop desk must not become frontal (pose_w~0.24) nor stay full LD.
		self.assertGreater(gate1["pose_weight"], 0.3)
		self.assertLess(gate1["pose_weight"], gate0["pose_weight"] - 0.3)
		self.assertTrue(gate1["look_down"])

	def test_resting_pitch_short_look_down_pulse_does_not_raise(self):
		"""A 2s screen-bottom glance must not climb rest (anti-FP)."""
		state = BlinkDetectionState()
		t = _seed_open_eye(state, ear=0.28)
		desk = estimate_head_pose(_frontal_landmarks())
		down = estimate_head_pose(_frontal_landmarks(pitch_shift=-35.0))
		state.resting_pitch = desk["pitch"]
		before = state.resting_pitch
		self.assertGreater(down["pitch"], before + 0.05)
		for _ in range(40):
			t += 0.05
			state.detect(0.28, t, pose=down)
		self.assertLessEqual(state.resting_pitch, before + 1e-6)

	def test_resting_pitch_sustained_look_down_does_not_chase(self):
		"""Chat-bottom hold (>6s) must not become the new rest (POG 2026-08-15)."""
		state = BlinkDetectionState()
		t = _seed_open_eye(state, ear=0.28)
		desk = estimate_head_pose(_frontal_landmarks())
		down = estimate_head_pose(_frontal_landmarks(pitch_shift=-35.0))
		state.resting_pitch = desk["pitch"]
		dt = 0.05
		for _ in range(int(4.0 / dt)):
			t += dt
			state.detect(0.28, t, pose=desk)
		before = state.resting_pitch
		self.assertGreater(down["pitch"], before + 0.08)
		for _ in range(int(8.0 / dt)):
			t += dt
			state.detect(0.28, t, pose=down)
		self.assertLessEqual(state.resting_pitch, before + 1e-6)
		gate = evaluate_pose_gate(
			down, "normal", resting_pitch=state.resting_pitch
		)
		self.assertTrue(gate["look_down"])
		self.assertGreater(gate["pose_weight"], 0.5)

	def test_reset_preserves_resting_pitch(self):
		"""Preview / MSMF reopen must not re-seed rest from the first frame."""
		state = BlinkDetectionState()
		t = _seed_open_eye(state, ear=0.28)
		desk = estimate_head_pose(_frontal_landmarks())
		state.resting_pitch = 0.118
		state._resting_pitch_hist.append((t, 0.118))
		state._resting_rise_last_t = t
		state.reset()
		self.assertAlmostEqual(state.resting_pitch, 0.118, places=5)
		self.assertEqual(len(state._resting_pitch_hist), 1)
		self.assertIsNone(state._resting_rise_last_t)
		self.assertEqual(state.current_baseline_ear, 0.0)
		# Huge gap after reset must not count as one 6s rise.
		later = t + 90.0
		state.detect(0.28, later, pose=desk)
		self.assertAlmostEqual(state.resting_pitch, 0.118, places=5)

	def test_look_down_mild_ear_oscillation_no_credit_storm(self):
		"""Screen-bottom eyelid drift must not credit ~1 Hz without a blink."""
		state = BlinkDetectionState(target_fps=20)
		t = _seed_open_eye(state, ear=0.28)
		pose = estimate_head_pose(_frontal_landmarks(pitch_shift=-35.0))
		state.resting_pitch = pose["pitch"] - 0.20
		self.assertTrue(
			evaluate_pose_gate(
				pose, "normal", resting_pitch=state.resting_pitch
			)["look_down"]
		)
		# Adapt live open toward look-down height first.
		for level in (0.27, 0.26, 0.25, 0.24, 0.23):
			for _ in range(10):
				t += 0.05
				state.detect(level, t, pose=pose)
		credits = 0
		for index in range(80):
			t += 0.05
			ear = 0.235 if index % 2 == 0 else 0.225
			credited, _info = state.detect(ear, t, pose=pose)
			if credited:
				credits += 1
		self.assertLessEqual(credits, 1)

	def test_ear_depressed_mid_band_oscillation_no_credit_without_pitch(self):
		"""After live_open adapts to look-down height, mid-band jitter ≠ blink."""
		state = BlinkDetectionState(target_fps=20)
		t = _seed_open_eye(state, ear=0.28)
		pose = estimate_head_pose(_frontal_landmarks())
		state.resting_pitch = pose["pitch"]
		# Stable hold below rise band so live_open falls; baseline stays high.
		for _ in range(40):
			t += 0.05
			state.detect(0.24, t, pose=pose)
		self.assertLess(state.live_open_ear, 0.25)
		self.assertTrue(state.ear_depressed)
		credits = 0
		for index in range(80):
			t += 0.05
			ear = 0.245 if index % 2 == 0 else 0.235
			credited, _info = state.detect(ear, t, pose=pose)
			if credited:
				credits += 1
		self.assertEqual(credits, 0)

	def test_ear_depressed_real_deep_blink_still_credited(self):
		state = BlinkDetectionState(target_fps=20)
		t = _seed_open_eye(state, ear=0.28)
		pose = estimate_head_pose(_frontal_landmarks())
		state.resting_pitch = pose["pitch"]
		for _ in range(40):
			t += 0.05
			state.detect(0.24, t, pose=pose)
		self.assertTrue(state.ear_depressed)
		self.assertFalse(state.eyes_closed)
		steps = (
			(0.05, 0.12),
			(0.05, 0.08),
			(0.05, 0.06),
			(0.05, 0.18),
			(0.05, 0.24),
			(0.05, 0.24),
			(0.05, 0.24),
		)
		credited_any, _t, _info, phases = _feed(state, t, steps, pose=pose)
		self.assertTrue(credited_any)
		self.assertIn("complete", phases)
		self.assertFalse(state.eyes_closed)

	def test_live_open_ear_adapts_down_then_up(self):
		state = BlinkDetectionState(target_fps=20)
		t = _seed_open_eye(state, ear=0.28)
		frontal_open = state.live_open_ear
		for level in (0.27, 0.26, 0.25, 0.24, 0.23, 0.22, 0.21):
			for _ in range(12):
				t += 0.05
				state.detect(level, t)
		self.assertLess(state.live_open_ear, frontal_open * 0.9)
		for _ in range(20):
			t += 0.05
			state.detect(0.28, t)
		self.assertGreater(state.live_open_ear, 0.25)

	def test_live_open_does_not_fall_during_slow_close(self):
		"""Slow intentional close must start before live_open collapses."""
		state = BlinkDetectionState(target_fps=20)
		t = _seed_open_eye(state, ear=0.28)
		before = state.live_open_ear
		# Descending lids with measurable closing velocity / ΔEAR.
		phases = []
		for ear in (0.26, 0.24, 0.22, 0.20, 0.18, 0.16, 0.14):
			t += 0.05
			_c, info = state.detect(ear, t)
			if info:
				phases.append(info.get("phase"))
		self.assertGreater(state.live_open_ear, before * 0.92)
		self.assertIn("start", phases)

	def test_look_down_opening_waived_on_strong_peak(self):
		from blink_detector_package.domain.blink_detection import (
			FRONTAL_OPENING_PEAK_WAIVE,
		)

		state = BlinkDetectionState(target_fps=20)
		t = _seed_open_eye(state, ear=0.28)
		pose = estimate_head_pose(_frontal_landmarks(pitch_shift=-35.0))
		state.resting_pitch = pose["pitch"] - 0.20
		self.assertTrue(
			evaluate_pose_gate(
				pose, "normal", resting_pitch=state.resting_pitch
			)["look_down"]
		)
		# Short deep trough: openVel≈0, closed_frames=1, strong peak.
		steps = (
			(0.05, 0.08),
			(0.05, 0.22),
			(0.05, 0.26),
			(0.05, 0.28),
		)
		credited_any, _t, info, phases = _feed(state, t, steps, pose=pose)
		self.assertTrue(credited_any)
		self.assertIn("complete", phases)
		self.assertGreaterEqual(
			info["peak_velocity"],
			FRONTAL_OPENING_PEAK_WAIVE,
		)

	def test_eyes_closed_soft_clear_at_look_down_open(self):
		state = BlinkDetectionState(target_fps=20)
		t = _seed_open_eye(state, ear=0.28)
		state.live_open_ear = 0.22
		state.eyes_closed = True
		# ~0.86 of live open — soft clear band, below hard 0.70 frontal-style.
		for _ in range(6):
			t += 0.05
			state.detect(0.19, t)
		self.assertFalse(state.eyes_closed)

	def test_walk_away_clears_eyes_closed_and_reseeds_live_open(self):
		"""Face gap ≥1.5s (leave desk) must not stick skip_eyes_closed on return."""
		state = BlinkDetectionState(target_fps=20)
		t = _seed_open_eye(state, ear=0.28)
		state.live_open_ear = 0.425
		state.eyes_closed = True
		state.awaiting_reopen = True
		state.awaiting_reopen_since = t
		state.cancel_on_face_lost(t)
		self.assertIsNotNone(state._face_absent_since)
		# <1s flicker: keep latches (live may ease slightly in mid-band).
		t += 0.5
		state.detect(0.29, t)
		self.assertTrue(state.eyes_closed)
		self.assertGreater(state.live_open_ear, 0.40)
		# Sustained absence then return at look-down open height.
		state.cancel_on_face_lost(t)
		t += 2.0
		state.detect(0.29, t)
		self.assertFalse(state.eyes_closed)
		self.assertFalse(state.awaiting_reopen)
		self.assertIsNone(state._face_absent_since)
		self.assertAlmostEqual(state.live_open_ear, 0.29, places=3)
		# Next deep blink should be able to start (not skip_eyes_closed).
		t += 0.05
		_c, info = state.detect(0.12, t)
		self.assertNotEqual(info.get("phase"), "skip_eyes_closed")

	def test_eyes_closed_mid_band_allows_live_open_fall(self):
		"""Sticky mid-band closed latch must not freeze an inflated live_open."""
		state = BlinkDetectionState(target_fps=20)
		t = _seed_open_eye(state, ear=0.28)
		state.live_open_ear = 0.42
		state.eyes_closed = True
		# Mid-band vs inflated live (not clearly shut <0.52×).
		for _ in range(40):
			t += 0.05
			state.detect(0.29, t)
		self.assertLess(state.live_open_ear, 0.36)

	def test_noisy_mid_band_eyes_closed_clears_via_live_fall(self):
		"""Top-cam screen-bottom: jittery mid-band must not stick skip_eyes_closed."""
		state = BlinkDetectionState(target_fps=20)
		t = _seed_open_eye(state, ear=0.40)
		state.live_open_ear = 0.406
		state.current_baseline_ear = 0.406
		state.eyes_closed = True
		# Field pattern: ear oscillates ~0.22–0.28 vs stale live 0.41.
		pattern = (0.25, 0.22, 0.27, 0.23, 0.28, 0.24, 0.26, 0.21)
		for i in range(50):
			t += 0.05
			state.detect(pattern[i % len(pattern)], t)
		self.assertLess(state.live_open_ear, 0.34)
		self.assertFalse(state.eyes_closed)

	def test_saccade_does_not_latch_eyes_closed(self):
		"""Quick gaze dart dips EAR without held-shut lids."""
		state = BlinkDetectionState(target_fps=30)
		t = _seed_open_eye(state, ear=0.28)
		for i in range(8):
			t += 0.03
			pose = estimate_head_pose(
				_frontal_landmarks(pitch_shift=-8.0 * i)
			)
			state.detect(0.13, t, pose=pose)
		self.assertFalse(state.eyes_closed)

	def test_look_down_open_unsticks_skip_eyes_closed(self):
		"""Open lids looking down vs stale frontal live_open (field 0.60–0.66)."""
		state = BlinkDetectionState(target_fps=30)
		t = _seed_open_eye(state, ear=0.30)
		state.live_open_ear = 0.30
		state.eyes_closed = True
		pose = estimate_head_pose(_frontal_landmarks(pitch_shift=-35.0))
		state.resting_pitch = pose["pitch"] - 0.20
		for _ in range(8):
			t += 0.05
			state.detect(0.19, t, pose=pose)
		self.assertFalse(state.eyes_closed)
		_credited, info = state.detect(0.13, t + 0.05, pose=pose)
		self.assertNotEqual(info.get("phase"), "skip_eyes_closed")

	def test_adaptive_threshold_bounds(self):
		low = get_adaptive_ear_drop_threshold(0.15)
		high = get_adaptive_ear_drop_threshold(0.35)
		self.assertGreaterEqual(low, high)
		self.assertAlmostEqual(low, 0.20, places=3)
		self.assertAlmostEqual(high, 0.15, places=3)

	def test_short_frontal_velocity_fps_bands(self):
		self.assertAlmostEqual(short_frontal_velocity(20), 0.40, places=3)
		self.assertAlmostEqual(short_frontal_velocity(18), 0.40, places=3)
		self.assertAlmostEqual(short_frontal_velocity(15), 0.45, places=3)
		self.assertAlmostEqual(short_frontal_velocity(12), 0.45, places=3)
		self.assertAlmostEqual(short_frontal_velocity(10), 0.50, places=3)

	def test_short_look_down_velocity_fps_bands(self):
		# Softened after Ultra reject_velocity FN (was 0.75/0.70/0.65).
		self.assertAlmostEqual(short_look_down_velocity(20), 0.55, places=3)
		self.assertAlmostEqual(short_look_down_velocity(15), 0.55, places=3)
		self.assertAlmostEqual(short_look_down_velocity(10), 0.50, places=3)
		# Look-down short floor stays ≥ frontal at each band.
		self.assertGreaterEqual(
			short_look_down_velocity(20),
			short_frontal_velocity(20),
		)
		self.assertGreaterEqual(
			short_look_down_velocity(15),
			short_frontal_velocity(15),
		)

	def test_min_blink_duration_s_scales_with_high_fps(self):
		# ≤20 FPS keep ~50ms floor; Ultra/Max allow one-frame wall-clock.
		self.assertAlmostEqual(min_blink_duration_s(20), 0.0475, places=3)
		self.assertAlmostEqual(min_blink_duration_s(15), 0.05, places=3)
		self.assertAlmostEqual(min_blink_duration_s(10), 0.05, places=3)
		self.assertAlmostEqual(min_blink_duration_s(30), 0.0317, places=3)
		self.assertAlmostEqual(min_blink_duration_s(60), 0.016, places=3)

	def test_ear_smoothing_exposes_raw_and_smooth(self):
		state = BlinkDetectionState()
		t = _seed_open_eye(state, ear=0.28)
		t += 0.1
		credited, info = state.detect(0.10, t)
		self.assertFalse(credited)
		self.assertIsNotNone(info)
		self.assertIn("ear_raw", info)
		self.assertIn("ear_smooth", info)
		self.assertAlmostEqual(info["ear_raw"], 0.10, places=5)
		self.assertGreater(info["ear_smooth"], info["ear_raw"])
		self.assertAlmostEqual(info["ear"], info["ear_smooth"], places=5)

	def test_normal_blink_credited(self):
		state = BlinkDetectionState(target_fps=15)
		t = _seed_open_eye(state, ear=0.28)
		credited_any, _t, info, phases = _feed(state, t, _CREDIT_STEPS)
		self.assertTrue(credited_any)
		self.assertIn("complete", phases)
		self.assertGreaterEqual(info["peak_velocity"], BLINK_MIN_CLOSING_VELOCITY)
		self.assertGreaterEqual(info["closed_frames"], MIN_CLOSED_FRAMES)

	def test_shallow_flicker_rejected_by_velocity(self):
		"""Shallow 1-frame dip must not credit (velocity / drop gates)."""
		state = BlinkDetectionState(target_fps=20)
		t = _seed_open_eye(state, ear=0.28)
		credited_any, _t, _info, phases = _feed(
			state,
			t,
			((0.05, 0.24), (0.05, 0.27), (0.05, 0.28)),
		)
		self.assertFalse(credited_any)
		self.assertNotIn("complete", phases)

	def test_slow_look_down_rejected_by_velocity(self):
		state = BlinkDetectionState()
		t = _seed_open_eye(state, ear=0.28)
		credited_any = False
		ear = 0.28
		for _ in range(14):
			ear -= 0.01
			t += 0.1
			credited, _info = state.detect(ear, t)
			if credited:
				credited_any = True
		for _ in range(8):
			ear += 0.01
			t += 0.1
			credited, _info = state.detect(min(ear, 0.28), t)
			if credited:
				credited_any = True
		self.assertFalse(credited_any)

	def test_baseline_frozen_during_blink(self):
		state = BlinkDetectionState()
		t = _seed_open_eye(state, ear=0.28)

		for ear in (0.18, 0.12):
			t += 0.1
			state.detect(ear, t)
		self.assertTrue(state.blink_in_progress)
		frozen_baseline = state.current_baseline_ear
		len_at_start = len(state.baseline_ear_values)

		for ear in (0.11, 0.10, 0.09):
			t += 0.1
			state.detect(ear, t)
			self.assertTrue(state.blink_in_progress)
			self.assertEqual(len(state.baseline_ear_values), len_at_start)
			self.assertAlmostEqual(
				state.current_baseline_ear,
				frozen_baseline,
				places=5,
			)

	def test_cooldown_suppresses_second_blink(self):
		state = BlinkDetectionState(target_fps=15)
		t = _seed_open_eye(state, ear=0.28)

		first, t, _info, _phases = _feed(state, t, _CREDIT_STEPS, pose=None)
		self.assertTrue(first)
		# Clear await-reopen / eyes_closed while still inside cooldown window.
		for ear in (0.24, 0.26, 0.28, 0.28):
			t += 0.05
			state.detect(ear, t)
		self.assertFalse(state.awaiting_reopen)
		self.assertFalse(state.eyes_closed)
		self.assertLess(t - state.last_blink_time, 0.55)
		# Bounce dip during cooldown must not start a candidate.
		t += 0.05
		credited, info = state.detect(0.10, t)
		self.assertFalse(credited)
		self.assertEqual(info["phase"], "skip_cooldown")
		self.assertGreater(info.get("cooldown_remaining", 0), 0)

	def test_extreme_yaw_no_credit(self):
		state = BlinkDetectionState()
		t = _seed_open_eye(state, ear=0.28)
		pose = estimate_head_pose(_frontal_landmarks(yaw_offset=24.0))
		self.assertGreater(abs(pose["yaw"]), 1.30)
		self.assertTrue(evaluate_pose_gate(pose, "normal")["extreme_yaw"])
		credited_any, _t, _info, phases = _feed(
			state, t, _CREDIT_STEPS, pose=pose
		)
		self.assertFalse(credited_any)
		self.assertTrue(
			all(p in ("skip_yaw", "skip_yaw_hold") for p in phases)
		)

	def test_mid_blink_yaw_flicker_hold_then_credit(self):
		"""Brief extreme yaw mid-candidate should not immediately cancel."""
		from blink_detector_package.domain.blink_detection import (
			YAW_EXTREME_CANCEL_STREAK,
		)

		state = BlinkDetectionState(target_fps=15)
		t = _seed_open_eye(state, ear=0.28)
		ok_pose = estimate_head_pose(_frontal_landmarks(yaw_offset=10.0))
		extreme = estimate_head_pose(_frontal_landmarks(yaw_offset=22.0))
		self.assertFalse(evaluate_pose_gate(ok_pose, "normal")["extreme_yaw"])
		self.assertTrue(evaluate_pose_gate(extreme, "normal")["extreme_yaw"])
		# Start close on ok pose.
		t += 0.07
		_c, info = state.detect(0.10, t, left_ear=0.10, right_ear=0.10, pose=ok_pose)
		self.assertEqual(info["phase"], "start")
		self.assertTrue(state.blink_in_progress)
		# One extreme frame → hold, still in progress.
		t += 0.07
		_c, info = state.detect(
			0.08, t, left_ear=0.08, right_ear=0.08, pose=extreme
		)
		self.assertEqual(info["phase"], "skip_yaw_hold")
		self.assertTrue(state.blink_in_progress)
		self.assertEqual(state._extreme_yaw_streak, 1)
		# Back under threshold; finish blink.
		for ear in (0.07, 0.22, 0.28, 0.28):
			t += 0.07
			credited, info = state.detect(
				ear, t, left_ear=ear, right_ear=ear, pose=ok_pose
			)
		self.assertTrue(credited)
		self.assertEqual(info["phase"], "complete")
		self.assertGreaterEqual(YAW_EXTREME_CANCEL_STREAK, 2)

	def test_moderate_side_yaw_blink_credited(self):
		state = BlinkDetectionState(target_fps=15)
		t = _seed_open_eye(state, ear=0.28)
		pose = estimate_head_pose(_frontal_landmarks(yaw_offset=10.0))
		self.assertFalse(evaluate_pose_gate(pose, "normal")["extreme_yaw"])
		credited_any, _t, _info, phases = _feed(
			state, t, _CREDIT_STEPS, pose=pose
		)
		self.assertTrue(credited_any)
		self.assertIn("complete", phases)

	def test_one_closed_frame_at_20fps_can_credit(self):
		"""Real high-FPS blinks often have one trough sample then reopen."""
		self.assertAlmostEqual(min_blink_duration_s(20), 0.0475, places=3)
		state = BlinkDetectionState(target_fps=20)
		t = _seed_open_eye(state, ear=0.28)
		pose = estimate_head_pose(_frontal_landmarks())
		# Extra open frames: EAR rolling mean must climb past recovery.
		steps = (
			(0.05, 0.08),
			(0.05, 0.24),
			(0.05, 0.28),
			(0.05, 0.28),
			(0.05, 0.28),
		)
		credited_any, _t, info, phases = _feed(state, t, steps, pose=pose)
		self.assertTrue(credited_any)
		self.assertIn("complete", phases)
		self.assertGreaterEqual(
			info["duration"], min_blink_duration_s(20) - 1e-6
		)
		self.assertGreaterEqual(info["closed_frames"], MIN_CLOSED_FRAMES)

	def test_short_blink_weak_velocity_rejected(self):
		state = BlinkDetectionState(target_fps=15)
		t = _seed_open_eye(state, ear=0.28)
		# Shallow trough: below strong-drop cover and waive peak.
		credited_any, _t, _info, phases = _feed(
			state,
			t,
			((0.067, 0.255), (0.067, 0.25), (0.067, 0.26), (0.067, 0.28)),
		)
		self.assertFalse(credited_any)
		self.assertNotIn("complete", phases)

	def test_short_frontal_moderate_velocity_credited(self):
		state = BlinkDetectionState(target_fps=20)
		t = _seed_open_eye(state, ear=0.28)
		pose = estimate_head_pose(_frontal_landmarks())
		steps = (
			(0.05, 0.10),
			(0.05, 0.07),
			(0.05, 0.06),
			(0.05, 0.05),
			(0.05, 0.22),
			(0.05, 0.28),
			(0.05, 0.28),
		)
		credited_any, _t, info, phases = _feed(state, t, steps, pose=pose)
		self.assertTrue(credited_any)
		self.assertIn("complete", phases)
		self.assertFalse(info.get("look_down"))
		self.assertGreaterEqual(
			info["peak_velocity"],
			short_frontal_velocity(20),
		)

	def test_pre_blink_close_spike_credits_short_frontal(self):
		"""Close spike 1 frame before start must count (history), not peak≈0."""
		state = BlinkDetectionState(target_fps=20)
		t = _seed_open_eye(state, ear=0.28)
		pose = estimate_head_pose(_frontal_landmarks())
		# Sharp close while still above close-band, then trough + reopen.
		steps = (
			(0.05, 0.12),
			(0.05, 0.08),
			(0.05, 0.22),
			(0.05, 0.28),
			(0.05, 0.28),
		)
		credited_any, _t, info, phases = _feed(state, t, steps, pose=pose)
		self.assertTrue(credited_any)
		self.assertIn("complete", phases)
		self.assertGreaterEqual(
			info["peak_velocity"],
			short_frontal_velocity(20),
		)

	def test_short_look_down_still_needs_strict_velocity(self):
		state = BlinkDetectionState(target_fps=15)
		t = _seed_open_eye(state, ear=0.28)
		pose = estimate_head_pose(_frontal_landmarks(pitch_shift=-35.0))
		state.resting_pitch = pose["pitch"] - 0.20
		gate = evaluate_pose_gate(
			pose, "normal", resting_pitch=state.resting_pitch
		)
		self.assertTrue(gate["look_down"])
		# Soft close under look-down short gate; reopen past close band.
		steps = (
			(0.1, 0.22),
			(0.1, 0.20),
			(0.1, 0.18),
			(0.1, 0.24),
			(0.1, 0.27),
			(0.1, 0.28),
		)
		credited_any, _t, info, phases = _feed(state, t, steps, pose=pose)
		self.assertFalse(credited_any)
		self.assertIn("reject_velocity", phases)
		self.assertLess(
			info.get("peak_velocity_raw", info.get("peak_velocity", 99)),
			short_look_down_velocity(15),
		)

	def test_opening_reject_when_shallow_reopen(self):
		"""V-shape: weak opening with only one closed frame → reject_opening."""
		state = BlinkDetectionState(target_fps=15)
		t = _seed_open_eye(state, ear=0.28)
		state.blink_in_progress = True
		state.blink_start_time = t - 0.25
		state.closed_frames = 1
		# Below frontal measured-peak waive (0.95); duration long so no
		# synthetic inflation of peak.
		state.peak_closing_velocity = 0.5
		state.peak_closing_velocity_measured = 0.5
		state.peak_opening_velocity = 0.02
		state.max_drop_percentage = 0.55
		state.prev_ear = 0.24
		state.prev_time = t
		state._ear_window.clear()
		for _ in range(3):
			state._ear_window.append(0.24)
		# Exit close band with almost no opening velocity delta.
		t += 0.2
		credited, info = state.detect(0.245, t)
		self.assertFalse(credited)
		self.assertEqual(info["phase"], "reject_opening")
		self.assertLess(
			info.get("peak_opening_velocity", 1.0),
			MIN_OPENING_VELOCITY,
		)
		self.assertLess(info.get("closed_frames", 99), 2)

	def test_opening_waived_when_measured_peak_strong(self):
		"""Measured peak ≥ waive credits with openVel≈0 (not synthetic)."""
		from blink_detector_package.domain.blink_detection import (
			FRONTAL_OPENING_PEAK_WAIVE,
		)

		state = BlinkDetectionState(target_fps=20)
		t = _seed_open_eye(state, ear=0.28)
		pose = estimate_head_pose(_frontal_landmarks())
		# Fast deep trough → measured close peak ≥ waive; reopen past close.
		steps = (
			(0.05, 0.08),
			(0.05, 0.22),
			(0.05, 0.28),
			(0.05, 0.28),
		)
		credited_any, _t, info, phases = _feed(state, t, steps, pose=pose)
		self.assertTrue(credited_any)
		self.assertIn("complete", phases)
		self.assertGreaterEqual(
			info.get("peak_velocity_raw", info["peak_velocity"]),
			FRONTAL_OPENING_PEAK_WAIVE,
		)

	def test_synthetic_short_without_reopen_rejected(self):
		"""Invented synthetic peak + openVel≈0 + 1 closed → reject_opening."""
		state = BlinkDetectionState(target_fps=20)
		t = _seed_open_eye(state, ear=0.28)
		pose = estimate_head_pose(_frontal_landmarks())
		state.blink_in_progress = True
		state.blink_start_time = t - 0.05
		state.closed_frames = 1
		state.peak_closing_velocity = 0.25
		state.peak_closing_velocity_measured = 0.25
		state.peak_opening_velocity = 0.0
		state.max_drop_percentage = 0.18
		state._candidate_yaw = 0.0
		state._candidate_pitch = 0.0
		state._candidate_pose_delta = 0.0
		state.prev_ear = 0.26
		state.prev_time = t
		state._ear_window.clear()
		for _ in range(3):
			state._ear_window.append(0.26)
		t += 0.05
		# Exit close band with tiny ΔEAR so opening velocity stays ≈0.
		credited, info = state.detect(0.261, t, pose=pose)
		self.assertFalse(credited)
		self.assertIn(info["phase"], ("reject_opening", "reject_velocity", "reject_threshold"))

	def test_look_down_one_frame_ok_with_strong_peak(self):
		"""Look-down short duration credits when measured peak clears gate."""
		state = BlinkDetectionState(target_fps=20)
		t = _seed_open_eye(state, ear=0.28)
		pose = estimate_head_pose(_frontal_landmarks(pitch_shift=-35.0))
		state.resting_pitch = pose["pitch"] - 0.20
		self.assertTrue(
			evaluate_pose_gate(
				pose, "normal", resting_pitch=state.resting_pitch
			)["look_down"]
		)
		steps = (
			(0.05, 0.10),
			(0.05, 0.22),
			(0.05, 0.28),
			(0.05, 0.28),
		)
		credited_any, _t, info, phases = _feed(state, t, steps, pose=pose)
		self.assertTrue(credited_any)
		self.assertIn("complete", phases)
		self.assertLess(float(info.get("duration") or 1), 0.2)

	def test_head_motion_rejects_credit(self):
		state = BlinkDetectionState(target_fps=20)
		t = _seed_open_eye(state, ear=0.28)
		pose = estimate_head_pose(_frontal_landmarks())
		state.blink_in_progress = True
		state.blink_start_time = t
		state.closed_frames = 2
		# Below motion waive (peak/drop) so pose Δ alone rejects.
		state.peak_closing_velocity = 0.8
		state.peak_closing_velocity_measured = 0.8
		state.peak_opening_velocity = 0.2
		state.max_drop_percentage = 0.25
		state._candidate_yaw = 0.0
		state._candidate_pitch = 0.0
		state._candidate_pose_delta = 0.35
		state._ear_window.clear()
		for _ in range(3):
			state._ear_window.append(0.28)
		t += 0.2
		credited, info = state.detect(0.28, t, pose=pose)
		self.assertFalse(credited)
		self.assertEqual(info["phase"], "reject_motion")
		self.assertAlmostEqual(float(info.get("pose_delta") or 0), 0.35, places=3)

	def test_strong_blink_waives_motion_reject(self):
		state = BlinkDetectionState(target_fps=20)
		t = _seed_open_eye(state, ear=0.28)
		pose = estimate_head_pose(_frontal_landmarks())
		state.blink_in_progress = True
		state.blink_start_time = t
		state.closed_frames = 3
		state.peak_closing_velocity = 2.5
		state.peak_closing_velocity_measured = 2.5
		state.peak_opening_velocity = 0.2
		state.max_drop_percentage = 0.45
		state._candidate_yaw = 0.0
		state._candidate_pitch = 0.0
		state._candidate_pose_delta = 0.30
		state._ear_window.clear()
		for _ in range(3):
			state._ear_window.append(0.28)
		t += 0.25
		credited, info = state.detect(0.28, t, pose=pose)
		self.assertTrue(credited)
		self.assertEqual(info["phase"], "complete")
		self.assertIn("motion_peak", info.get("waives") or [])

	def test_duration_timeout_credits_strong_blink(self):
		"""Past BLINK_DURATION_MAX still credits if lids reopened (recovery)."""
		state = BlinkDetectionState(target_fps=20)
		t = _seed_open_eye(state, ear=0.28)
		pose = estimate_head_pose(_frontal_landmarks())
		state.blink_in_progress = True
		state.blink_start_time = t
		state.closed_frames = 8
		state.peak_closing_velocity = 2.0
		state.peak_closing_velocity_measured = 2.0
		state.peak_opening_velocity = 0.15
		state.max_drop_percentage = 0.45
		state._candidate_pose_delta = 0.0
		state._ear_window.clear()
		for _ in range(3):
			state._ear_window.append(0.28)
		t += 0.65
		# Open again (above frontal close-band recovery).
		credited, info = state.detect(0.28, t, pose=pose)
		self.assertTrue(credited)
		self.assertEqual(info["phase"], "complete")
		self.assertGreater(float(info.get("duration") or 0), 0.6)

	def test_look_down_mid_open_recovers_without_close_band(self):
		"""Look-down chat open (~0.82 live) must complete — not timeout."""
		state = BlinkDetectionState(target_fps=20)
		t = _seed_open_eye(state, ear=0.28)
		pose = estimate_head_pose(_frontal_landmarks(pitch_shift=-35.0))
		state.resting_pitch = pose["pitch"] - 0.20
		# Soft look-down blink: dip then settle above credit recovery (0.80)
		# but below frontal close-band (~0.84).
		steps = (
			(0.05, 0.12),
			(0.05, 0.12),
			(0.05, 0.14),
			(0.05, 0.235),
			(0.05, 0.235),
			(0.05, 0.235),
		)
		credited_any, _t, info, phases = _feed(state, t, steps, pose=pose)
		self.assertTrue(credited_any)
		self.assertIn("complete", phases)
		self.assertLess(float(info.get("duration") or 1), 0.55)
		# Frontal close band would block this reopen (~0.84 of live).
		close_band = float(info.get("close_band_ear") or 0)
		self.assertGreater(close_band, 0.235)

	def test_look_down_talk_jitter_short_no_credit(self):
		"""Talk-jaw short look-down: closed=2, openV=0, drop≈0.25 → no credit."""
		state = BlinkDetectionState(target_fps=20)
		t = _seed_open_eye(state, ear=0.28)
		pose = estimate_head_pose(_frontal_landmarks(pitch_shift=-35.0))
		state.resting_pitch = pose["pitch"] - 0.20
		state.blink_in_progress = True
		state.blink_start_time = t
		state.closed_frames = 2
		# Below LOOK_DOWN_SHORT_STRONG_PEAK (0.85) — talk jitter, not blink.
		state.peak_closing_velocity = 0.75
		state.peak_closing_velocity_measured = 0.75
		state.peak_opening_velocity = 0.0
		state.max_drop_percentage = 0.25
		state._candidate_pose_delta = 0.0
		state._ear_window.clear()
		for _ in range(3):
			state._ear_window.append(0.235)
		# Just above SHORT_BLINK_DURATION — still shortish talk bounce.
		t += 0.10
		credited, info = state.detect(0.235, t, pose=pose)
		self.assertFalse(credited)
		self.assertIn(
			info["phase"],
			("reject_opening", "reject_velocity", "reject_threshold"),
		)

	def test_look_down_one_frame_strong_peak_no_credit(self):
		"""LD closed=1 + strong peak but shallow drop → still reject."""
		state = BlinkDetectionState(target_fps=20)
		t = _seed_open_eye(state, ear=0.28)
		pose = estimate_head_pose(_frontal_landmarks(pitch_shift=-35.0))
		state.resting_pitch = pose["pitch"] - 0.20
		state.blink_in_progress = True
		state.blink_start_time = t
		state.closed_frames = 1
		state.peak_closing_velocity = 1.25
		state.peak_closing_velocity_measured = 1.25
		state.peak_opening_velocity = 0.0
		state.max_drop_percentage = 0.08
		state._candidate_pose_delta = 0.0
		state._ear_window.clear()
		for _ in range(3):
			state._ear_window.append(0.235)
		t += 0.05
		credited, info = state.detect(0.26, t, pose=pose)
		self.assertFalse(credited)
		self.assertIn(info["phase"], ("reject_opening", "reject_threshold"))

	def test_look_down_strong_peak_waives_with_closed2(self):
		"""Dark/Ultra LD: peak≥0.85 + closed≥2 can credit without openV."""
		state = BlinkDetectionState(target_fps=20)
		t = _seed_open_eye(state, ear=0.28)
		pose = estimate_head_pose(_frontal_landmarks(pitch_shift=-35.0))
		state.resting_pitch = pose["pitch"] - 0.20
		state.blink_in_progress = True
		state.blink_start_time = t
		state.closed_frames = 2
		state.peak_closing_velocity = 0.90
		state.peak_closing_velocity_measured = 0.90
		state.peak_opening_velocity = 0.0
		state.max_drop_percentage = 0.20
		state._candidate_pose_delta = 0.0
		state._ear_window.clear()
		for _ in range(3):
			state._ear_window.append(0.235)
		t += 0.10
		credited, info = state.detect(0.26, t, pose=pose)
		self.assertTrue(credited, msg=info)
		self.assertEqual(info["phase"], "complete")

	def test_look_down_one_frame_shallow_reopen_rejected(self):
		"""LD closed=1 + openV ok but shallow drop → burst/motion FP."""
		state = BlinkDetectionState(target_fps=20)
		t = _seed_open_eye(state, ear=0.28)
		pose = estimate_head_pose(_frontal_landmarks(pitch_shift=-35.0))
		state.resting_pitch = pose["pitch"] - 0.20
		state.blink_in_progress = True
		state.blink_start_time = t
		state.closed_frames = 1
		state.peak_closing_velocity = 0.70
		state.peak_closing_velocity_measured = 0.70
		state.peak_opening_velocity = 0.40
		state.max_drop_percentage = 0.08
		state._candidate_pose_delta = 0.0
		state._ear_window.clear()
		for _ in range(3):
			state._ear_window.append(0.235)
		t += 0.05
		credited, info = state.detect(0.26, t, pose=pose)
		self.assertFalse(credited)
		self.assertIn(info["phase"], ("reject_opening", "reject_threshold"))

	def test_look_down_one_frame_strong_peak_with_depth_credits(self):
		"""closed=1 openV=0 is a saccade even with a strong peak (not a blink)."""
		state = BlinkDetectionState(target_fps=20)
		t = _seed_open_eye(state, ear=0.28)
		pose = estimate_head_pose(_frontal_landmarks(pitch_shift=-35.0))
		state.resting_pitch = pose["pitch"] - 0.20
		state.blink_in_progress = True
		state.blink_start_time = t
		state.closed_frames = 1
		state.peak_closing_velocity = 0.90
		state.peak_closing_velocity_measured = 0.90
		state.peak_opening_velocity = 0.0
		state.max_drop_percentage = 0.20
		state._candidate_pose_delta = 0.0
		state._ear_window.clear()
		for _ in range(3):
			state._ear_window.append(0.235)
		t += 0.05
		credited, info = state.detect(0.26, t, pose=pose)
		self.assertFalse(credited, msg=info)
		self.assertEqual(info["phase"], "reject_opening")

	def test_side_and_look_down_one_frame_peak_not_credited(self):
		"""Side + look-down 34ms peak-waive is landmark jitter, not a blink."""
		state = BlinkDetectionState(target_fps=20)
		t = _seed_open_eye(state, ear=0.28)
		pose = estimate_head_pose(
			_frontal_landmarks(yaw_offset=18.0, pitch_shift=-35.0)
		)
		state.resting_pitch = pose["pitch"] - 0.20
		gate = evaluate_pose_gate(
			pose, "normal", resting_pitch=state.resting_pitch
		)
		self.assertGreaterEqual(abs(pose["yaw"]), SIDE_GLANCE_OPENING_KILL_YAW)
		self.assertGreaterEqual(float(gate.get("pose_weight") or 0), 0.5)
		state.blink_in_progress = True
		state.blink_start_time = t
		state.closed_frames = 1
		state.peak_closing_velocity = 2.2
		state.peak_closing_velocity_measured = 2.2
		state.peak_opening_velocity = 0.0
		state.max_drop_percentage = 0.20
		state._candidate_pose_delta = 0.0
		state._ear_window.clear()
		for _ in range(3):
			state._ear_window.append(0.235)
		t += 0.05
		credited, info = state.detect(0.26, t, pose=pose)
		self.assertFalse(credited, msg=info)
		self.assertEqual(info["phase"], "reject_opening")

	def test_chat_bottom_mild_yaw_one_frame_credits(self):
		"""Look-down |yaw| 0.35–0.80 must not use the yaw≈1.1 opening kill."""
		state = BlinkDetectionState(target_fps=20)
		t = _seed_open_eye(state, ear=0.28)
		pose = estimate_head_pose(
			_frontal_landmarks(yaw_offset=8.0, pitch_shift=-35.0)
		)
		state.resting_pitch = pose["pitch"] - 0.20
		gate = evaluate_pose_gate(
			pose, "normal", resting_pitch=state.resting_pitch
		)
		self.assertGreaterEqual(abs(pose["yaw"]), 0.35)
		self.assertLess(abs(pose["yaw"]), SIDE_GLANCE_OPENING_KILL_YAW)
		self.assertGreaterEqual(float(gate.get("pose_weight") or 0), 0.5)
		state.blink_in_progress = True
		state.blink_start_time = t
		state.closed_frames = 1
		state.peak_closing_velocity = 2.2
		state.peak_closing_velocity_measured = 2.2
		state.peak_opening_velocity = 0.0
		state.max_drop_percentage = 0.20
		state._candidate_pose_delta = 0.0
		state._ear_window.clear()
		for _ in range(3):
			state._ear_window.append(0.235)
		t += 0.05
		credited, info = state.detect(0.26, t, pose=pose)
		self.assertFalse(credited, msg=info)
		self.assertEqual(info["phase"], "reject_opening")
		self.assertNotIn("ld_one_frame_peak", info.get("waives") or [])

	def test_side_and_look_down_real_reopen_still_credits(self):
		"""Side + look-down with a real V-shape still credits."""
		state = BlinkDetectionState(target_fps=15)
		t = _seed_open_eye(state, ear=0.26)
		pose = estimate_head_pose(
			_frontal_landmarks(yaw_offset=18.0, pitch_shift=-35.0)
		)
		state.resting_pitch = pose["pitch"] - 0.20
		steps = (
			(0.1, 0.14),
			(0.1, 0.08),
			(0.1, 0.06),
			(0.1, 0.05),
			(0.1, 0.18),
			(0.1, 0.24),
			(0.1, 0.26),
		)
		credited_any, _t, _info, phases = _feed(state, t, steps, pose=pose)
		self.assertTrue(credited_any)
		self.assertIn("complete", phases)

	def test_side_depressed_short_fake_openv_not_credited(self):
		"""Down-left: ear_depressed + yaw≈1 + 34ms + fake openV must not credit."""
		state = BlinkDetectionState(target_fps=20)
		t = _seed_open_eye(state, ear=0.28)
		pose = estimate_head_pose(_frontal_landmarks(yaw_offset=18.0))
		self.assertGreaterEqual(abs(pose["yaw"]), SIDE_GLANCE_OPENING_KILL_YAW)
		state.ear_depressed = True
		state.live_open_ear = 0.22
		state.current_baseline_ear = 0.28
		state.blink_in_progress = True
		state.blink_start_time = t
		state.closed_frames = 1
		state.peak_closing_velocity = 2.2
		state.peak_closing_velocity_measured = 2.2
		state.peak_opening_velocity = 2.5
		state.max_drop_percentage = 0.24
		state.max_left_drop = 0.30
		state.max_right_drop = 0.04
		state._candidate_pose_delta = 0.0
		state._ear_window.clear()
		for _ in range(3):
			state._ear_window.append(0.18)
		t += 0.05
		credited, info = state.detect(0.20, t, pose=pose)
		self.assertFalse(credited, msg=info)
		self.assertEqual(info["phase"], "reject_opening")

	def test_side_right_short_stronger_eye_not_credited(self):
		"""Right-monitor short one-eye jitter must not credit via stronger_eye."""
		state = BlinkDetectionState(target_fps=20)
		t = _seed_open_eye(state, ear=0.28)
		pose = estimate_head_pose(
			_frontal_landmarks(yaw_offset=18.0, pitch_shift=-35.0)
		)
		state.resting_pitch = pose["pitch"] - 0.20
		gate = evaluate_pose_gate(
			pose, "normal", resting_pitch=state.resting_pitch
		)
		self.assertGreaterEqual(abs(pose["yaw"]), SIDE_GLANCE_OPENING_KILL_YAW)
		self.assertGreaterEqual(float(gate.get("pose_weight") or 0), 0.5)
		state.blink_in_progress = True
		state.blink_start_time = t
		state.closed_frames = 2
		state.peak_closing_velocity = 2.4
		state.peak_closing_velocity_measured = 2.4
		state.peak_opening_velocity = 2.0
		state.max_drop_percentage = 0.20
		state.max_left_drop = 0.28
		state.max_right_drop = 0.05
		state.left_track.peak_closing = 2.4
		state.left_track.peak_closing_measured = 2.4
		state.left_track.peak_opening = 2.0
		state.left_track.closed_frames = 2
		state.left_track.max_drop = 0.28
		state.right_track.max_drop = 0.05
		state._candidate_pose_delta = 0.0
		state.live_open_ear = 0.28
		state._ear_window.clear()
		for _ in range(3):
			state._ear_window.append(0.22)
		t += 0.05
		credited, info = state.detect(
			0.26,
			t,
			left_ear=0.22,
			right_ear=0.28,
			pose=pose,
		)
		self.assertFalse(credited, msg=info)
		self.assertEqual(info["phase"], "reject_opening")
		self.assertEqual(info.get("merge"), "stronger")

	def test_look_down_sub_frame_duration_not_reject_duration(self):
		"""gate_fps≈15 still credits real ~34ms LD blink (Ultra camera)."""
		state = BlinkDetectionState(target_fps=15)
		t = _seed_open_eye(state, ear=0.29)
		pose = estimate_head_pose(_frontal_landmarks(pitch_shift=-35.0))
		state.resting_pitch = pose["pitch"] - 0.20
		state.blink_in_progress = True
		state.blink_start_time = t
		state.closed_frames = 2
		state.peak_closing_velocity = 2.4
		state.peak_closing_velocity_measured = 2.4
		state.peak_opening_velocity = 0.0
		state.max_drop_percentage = 0.22
		state._candidate_pose_delta = 0.0
		state.live_open_ear = 0.29
		state._ear_window.clear()
		for _ in range(3):
			state._ear_window.append(0.24)
		t += 0.034
		credited, info = state.detect(0.24, t, pose=pose)
		self.assertFalse(credited, msg=info)
		self.assertNotEqual(info["phase"], "complete")

	def test_recent_pose_motion_seeds_one_frame_motion_reject(self):
		"""Head nod before a one-frame candidate must still reject_motion."""
		state = BlinkDetectionState(target_fps=20)
		t = _seed_open_eye(state, ear=0.28)
		pose = estimate_head_pose(_frontal_landmarks())
		state._recent_pose_motion = 0.28
		state.blink_in_progress = True
		state.blink_start_time = t
		state.closed_frames = 2
		state.peak_closing_velocity = 0.9
		state.peak_closing_velocity_measured = 0.9
		state.peak_opening_velocity = 0.3
		state.max_drop_percentage = 0.30
		state._candidate_yaw = 0.0
		state._candidate_pitch = 0.0
		state._candidate_pose_delta = 0.28
		state._ear_window.clear()
		for _ in range(3):
			state._ear_window.append(0.28)
		t += 0.10
		credited, info = state.detect(0.28, t, pose=pose)
		self.assertFalse(credited)
		self.assertEqual(info["phase"], "reject_motion")

	def test_look_down_weak_open_no_credit(self):
		"""LD weak openV + peak below strong waive → reject_opening."""
		state = BlinkDetectionState(target_fps=20)
		t = _seed_open_eye(state, ear=0.28)
		pose = estimate_head_pose(_frontal_landmarks(pitch_shift=-35.0))
		state.resting_pitch = pose["pitch"] - 0.20
		state.blink_in_progress = True
		state.blink_start_time = t
		state.closed_frames = 1
		state.peak_closing_velocity = 0.70
		state.peak_closing_velocity_measured = 0.70
		state.peak_opening_velocity = 0.10
		state.max_drop_percentage = 0.22
		state._candidate_pose_delta = 0.0
		state._ear_window.clear()
		for _ in range(3):
			state._ear_window.append(0.235)
		t += 0.10
		credited, info = state.detect(0.26, t, pose=pose)
		self.assertFalse(credited)
		self.assertEqual(info["phase"], "reject_opening")

	def test_look_down_one_frame_openv_022_credits(self):
		"""Named split chat_look_down: leftover FN is reject_opening.

		LOOK_DOWN_ONE_FRAME_MIN_OPENING 0.25→0.22; openV=0.10 still rejects
		(test_look_down_weak_open_no_credit). 0.23 + depth should pass opening.
		"""
		state = BlinkDetectionState(target_fps=20)
		t = _seed_open_eye(state, ear=0.28)
		pose = estimate_head_pose(_frontal_landmarks(pitch_shift=-35.0))
		state.resting_pitch = pose["pitch"] - 0.20
		state.blink_in_progress = True
		state.blink_start_time = t
		state.closed_frames = 1
		state.peak_closing_velocity = 1.0
		state.peak_closing_velocity_measured = 1.0
		state.peak_opening_velocity = 0.23
		state.max_drop_percentage = 0.20
		state.max_left_drop = 0.20
		state.max_right_drop = 0.18
		state._candidate_pose_delta = 0.0
		state._ear_window.clear()
		for _ in range(3):
			state._ear_window.append(0.24)
		t += 0.08
		credited, info = state.detect(0.27, t, pose=pose)
		self.assertNotEqual(info.get("phase"), "reject_opening")
		if credited:
			self.assertEqual(info["phase"], "complete")

	def test_look_down_credits_at_074_recovery(self):
		"""Chat reopen ear/live≈0.75 must credit (0.78 timed out real blinks)."""
		state = BlinkDetectionState(target_fps=20)
		t = _seed_open_eye(state, ear=0.32)
		pose = estimate_head_pose(_frontal_landmarks(pitch_shift=-35.0))
		state.resting_pitch = pose["pitch"] - 0.20
		state.blink_in_progress = True
		state.blink_start_time = t
		state.closed_frames = 4
		state.peak_closing_velocity = 2.4
		state.peak_closing_velocity_measured = 2.4
		state.peak_opening_velocity = 1.2
		state.max_drop_percentage = 0.45
		state._candidate_pose_delta = 0.0
		state._ear_window.clear()
		for _ in range(3):
			state._ear_window.append(0.24)
		t += 0.20
		# 0.75 * live_open(0.32) = 0.24; use 0.242 > 0.74*0.32.
		credited, info = state.detect(0.242, t, pose=pose)
		self.assertTrue(credited, msg=info)
		self.assertEqual(info["phase"], "complete")

	def test_synthetic_short_shallow_rejected(self):
		"""Invented peak + shallow drop (rawV≈0) must not credit."""
		state = BlinkDetectionState(target_fps=20)
		t = _seed_open_eye(state, ear=0.32)
		pose = estimate_head_pose(_frontal_landmarks())
		state.blink_in_progress = True
		state.blink_start_time = t
		state.closed_frames = 1
		state.peak_closing_velocity = 0.0
		state.peak_closing_velocity_measured = 0.0
		state.peak_opening_velocity = 0.20
		state.max_drop_percentage = 0.16
		state._candidate_pose_delta = 0.0
		state._ear_window.clear()
		for _ in range(3):
			state._ear_window.append(0.32)
		t += 0.051
		credited, info = state.detect(0.32, t, pose=pose)
		self.assertFalse(credited)
		self.assertIn(
			info["phase"],
			("reject_opening", "reject_velocity", "reject_threshold"),
		)

	def test_look_down_short_shallow_peak_waive_rejected(self):
		"""Look-down 1-frame + peak without depth → reject (openV=0 FP)."""
		state = BlinkDetectionState(target_fps=20)
		t = _seed_open_eye(state, ear=0.28)
		pose = estimate_head_pose(_frontal_landmarks(pitch_shift=-35.0))
		state.resting_pitch = pose["pitch"] - 0.20
		state.blink_in_progress = True
		state.blink_start_time = t
		state.closed_frames = 1
		state.peak_closing_velocity = 1.05
		state.peak_closing_velocity_measured = 1.05
		state.peak_opening_velocity = 0.0
		state.max_drop_percentage = 0.10  # below LOOK_DOWN_ONE_FRAME_MIN_DROP
		state._candidate_pose_delta = 0.0
		state._ear_window.clear()
		for _ in range(3):
			state._ear_window.append(0.28)
		t += 0.05
		credited, info = state.detect(0.28, t, pose=pose)
		self.assertFalse(credited)
		self.assertIn(info["phase"], ("reject_opening", "reject_threshold"))

	def test_center_mid_band_no_credit_storm(self):
		"""EAR stuck ~0.73–0.80 of live must not credit ~1 Hz (POG center FP)."""
		state = BlinkDetectionState(target_fps=20)
		t = _seed_open_eye(state, ear=0.30)
		pose = estimate_head_pose(_frontal_landmarks())
		state.resting_pitch = pose["pitch"]
		credits = 0
		for index in range(120):
			t += 0.05
			# Oscillate inside close band but above old 0.70 recovery.
			ear = 0.23 if index % 2 == 0 else 0.22
			credited, _info = state.detect(ear, t, pose=pose)
			if credited:
				credits += 1
		self.assertEqual(credits, 0)

	def test_await_reopen_blocks_rapid_second_blink(self):
		state = BlinkDetectionState(target_fps=15)
		t = _seed_open_eye(state, ear=0.28)
		credited_first, t, _info, _phases = _feed(state, t, _CREDIT_STEPS)
		self.assertTrue(credited_first)
		# Completing blink leaves smooth EAR open; re-arm await and pull the
		# smooth window into the mid band so reopen gate is observable.
		state.awaiting_reopen = True
		state.awaiting_reopen_since = t
		state.eyes_closed = False
		state._ear_window.clear()
		for _ in range(3):
			state._ear_window.append(0.19)
		t += 0.1
		credited, info = state.detect(0.19, t)
		self.assertFalse(credited)
		self.assertIn(info["phase"], ("skip_await_open", "skip_eyes_closed"))
		# Clear await only after leaving the close band and holding open.
		for ear in (0.26, 0.28, 0.28, 0.28):
			t += 0.1
			state.detect(ear, t)
		self.assertFalse(state.awaiting_reopen)
		self.assertFalse(state.eyes_closed)

	def test_await_reopen_expires_latches_eyes_closed_if_still_shut(self):
		state = BlinkDetectionState()
		t = _seed_open_eye(state, ear=0.28)
		state.awaiting_reopen = True
		state.awaiting_reopen_since = t
		t += 0.5
		# Clearly shut (< EYES_CLOSED_RATIO) after timeout → latch closed.
		state._update_eyes_closed_state(0.12, t)
		self.assertFalse(state.awaiting_reopen)
		self.assertTrue(state.eyes_closed)

	def test_await_reopen_expires_mid_band_keeps_blocking(self):
		"""Frontal mid-band timeout must not free start (POG center FP re-arm)."""
		state = BlinkDetectionState()
		t = _seed_open_eye(state, ear=0.28)
		state.awaiting_reopen = True
		state.awaiting_reopen_since = t
		t += 0.5
		# Mid-band still inside close zone → keep awaiting (timer refresh).
		state._update_eyes_closed_state(0.18, t, pose_w=0.0)
		self.assertTrue(state.awaiting_reopen)
		self.assertFalse(state.eyes_closed)

	def test_look_down_await_clears_at_open_ratio(self):
		"""Chat look-down open (~0.75×live) must clear await, not sticky skip."""
		state = BlinkDetectionState(target_fps=20)
		t = _seed_open_eye(state, ear=0.28)
		pose = estimate_head_pose(_frontal_landmarks(pitch_shift=-35.0))
		state.resting_pitch = pose["pitch"] - 0.20
		state.live_open_ear = 0.28
		state.awaiting_reopen = True
		state.awaiting_reopen_since = t
		# 0.75 of live — below frontal close≈0.84, above look-down clear 0.70.
		for _ in range(6):
			t += 0.05
			state.detect(0.21, t, pose=pose)
		self.assertFalse(state.awaiting_reopen)

	def test_look_down_await_timeout_mid_band_does_not_refresh(self):
		state = BlinkDetectionState()
		t = _seed_open_eye(state, ear=0.28)
		state.awaiting_reopen = True
		state.awaiting_reopen_since = t
		t += 0.5
		state._update_eyes_closed_state(0.20, t, pose_w=1.0)
		self.assertFalse(state.awaiting_reopen)
		self.assertFalse(state.eyes_closed)

	def test_sustained_low_ear_marks_eyes_closed(self):
		state = BlinkDetectionState()
		t = _seed_open_eye(state, ear=0.28)
		# Drive smooth EAR into sustained-closed band (smoothing lags).
		for ear in (0.12, 0.11, 0.10):
			t += 0.1
			state.detect(ear, t)
		# Abort any in-progress blink then mark sustained closed.
		state.blink_in_progress = False
		state._reset_blink_tracking()
		state._low_ear_since = t - 0.2
		state._update_eyes_closed_state(0.10, t)
		self.assertTrue(state.eyes_closed)
		credited, info = state.detect(0.10, t + 0.05)
		self.assertFalse(credited)
		self.assertEqual(info["phase"], "skip_eyes_closed")

	def test_baseline_not_pulled_down_by_half_closed_ear(self):
		state = BlinkDetectionState()
		t = _seed_open_eye(state, ear=0.28)
		baseline = state.current_baseline_ear
		# Mid-band EAR (drop > 12%) must not collapse open-eye baseline.
		for _ in range(20):
			t += 0.1
			state.detect(0.20, t)
		self.assertGreater(state.current_baseline_ear, baseline * 0.92)

	def test_held_closed_eyes_no_credit_storm(self):
		"""Shut lids for several seconds must not credit a blink every cooldown."""
		state = BlinkDetectionState(target_fps=15)
		t = _seed_open_eye(state, ear=0.28)
		baseline = state.current_baseline_ear
		credits = 0
		# Noisy closed-eye EAR around 0.12–0.16 (matches POG storm logs shape
		# after baseline collapse — here baseline must stay high).
		for index in range(80):
			t += 0.05
			ear = 0.12 + (0.04 if index % 3 == 0 else 0.0)
			credited, _info = state.detect(ear, t)
			if credited:
				credits += 1
		self.assertLessEqual(credits, 1)
		self.assertGreater(state.current_baseline_ear, baseline * 0.90)
		self.assertTrue(state.eyes_closed)

	def test_side_glance_asymmetry_near_half_not_skipped(self):
		state = BlinkDetectionState()
		t = _seed_open_eye(state, ear=0.28)
		t += 0.1
		_credited, info = state.detect(
			0.20,
			t,
			left_ear=0.31,
			right_ear=0.19,
		)
		self.assertNotEqual(info.get("phase"), "skip_degraded")

	def test_bilateral_degraded_skips_frame(self):
		state = BlinkDetectionState()
		t = _seed_open_eye(state, ear=0.28)
		t += 0.1
		credited, info = state.detect(
			0.20,
			t,
			left_ear=0.28,
			right_ear=0.08,
		)
		self.assertFalse(credited)
		self.assertEqual(info["phase"], "skip_degraded")

	def test_bilateral_agreement_required_for_credit(self):
		state = BlinkDetectionState(target_fps=15)
		t = _seed_open_eye(state, ear=0.28)
		steps = (
			(0.1, 0.16, 0.28, 0.10),
			(0.1, 0.10, 0.28, 0.00),
			(0.1, 0.08, 0.28, 0.00),
			(0.1, 0.07, 0.28, 0.00),
			(0.1, 0.22, 0.28, 0.16),
			(0.1, 0.28, 0.28, 0.28),
			(0.1, 0.28, 0.28, 0.28),
		)
		credited_any, _t, _info, _phases = _feed(state, t, steps)
		self.assertFalse(credited_any)

	def test_bilateral_agreeing_blink_credited(self):
		state = BlinkDetectionState(target_fps=15)
		t = _seed_open_eye(state, ear=0.28)
		steps = (
			(0.1, 0.16, 0.17, 0.15),
			(0.1, 0.10, 0.11, 0.09),
			(0.1, 0.08, 0.09, 0.07),
			(0.1, 0.07, 0.08, 0.06),
			(0.1, 0.22, 0.22, 0.22),
			(0.1, 0.28, 0.28, 0.28),
			(0.1, 0.28, 0.28, 0.28),
		)
		credited_any, _t, _info, phases = _feed(state, t, steps)
		self.assertTrue(credited_any)
		self.assertIn("complete", phases)

	def test_merge_eye_drops_policy(self):
		ok, label, reject = merge_eye_drops(
			0.20,
			0.22,
			required_drop=0.18,
			pose_w=0.0,
			yaw=0.0,
			has_both=True,
		)
		self.assertTrue(ok)
		self.assertEqual(label, "both")
		self.assertIsNone(reject)

		ok, label, reject = merge_eye_drops(
			0.06,
			0.40,
			required_drop=0.18,
			pose_w=0.0,
			yaw=0.0,
			has_both=True,
		)
		self.assertTrue(ok)
		self.assertEqual(label, "stronger")

		ok, label, reject = merge_eye_drops(
			0.0,
			0.40,
			required_drop=0.18,
			pose_w=0.0,
			yaw=0.0,
			has_both=True,
		)
		self.assertFalse(ok)
		self.assertEqual(reject, "reject_bilateral")

		ok, label, reject = merge_eye_drops(
			0.0,
			0.40,
			required_drop=0.18,
			pose_w=1.0,
			yaw=0.0,
			has_both=True,
		)
		self.assertTrue(ok)
		self.assertEqual(label, "stronger")

		ok, label, reject = merge_eye_drops(
			0.2,
			None,
			required_drop=0.18,
			pose_w=0.0,
			yaw=0.0,
			has_both=False,
		)
		self.assertTrue(ok)
		self.assertEqual(label, "single")

	def test_per_eye_stronger_credits_shallow_plus_deep(self):
		"""L shallow (≥min_each) + R deep → stronger credit (not anti-talk)."""
		state = BlinkDetectionState(target_fps=15)
		t = _seed_open_eye(state, ear=0.28)
		# Left stays near-open (~0.22 → drop≈0.21 ≥ 0.18*0.28); right blinks.
		steps = (
			(0.1, 0.18, 0.24, 0.12),
			(0.1, 0.14, 0.23, 0.05),
			(0.1, 0.12, 0.22, 0.02),
			(0.1, 0.11, 0.22, 0.00),
			(0.1, 0.22, 0.25, 0.20),
			(0.1, 0.28, 0.28, 0.28),
			(0.1, 0.28, 0.28, 0.28),
		)
		credited_any, _t, info, phases = _feed(state, t, steps)
		self.assertTrue(credited_any)
		self.assertIn("complete", phases)
		self.assertIn(info.get("merge"), ("both", "stronger"))

	def test_per_eye_frontal_one_eye_talk_rejected(self):
		"""Frontal + only one eye dips → reject_bilateral (anti-talk)."""
		state = BlinkDetectionState(target_fps=15)
		t = _seed_open_eye(state, ear=0.28)
		steps = (
			(0.1, 0.16, 0.28, 0.10),
			(0.1, 0.10, 0.28, 0.00),
			(0.1, 0.08, 0.28, 0.00),
			(0.1, 0.07, 0.28, 0.00),
			(0.1, 0.22, 0.28, 0.16),
			(0.1, 0.28, 0.28, 0.28),
			(0.1, 0.28, 0.28, 0.28),
		)
		credited_any, _t, info, phases = _feed(state, t, steps)
		self.assertFalse(credited_any)
		self.assertIn("reject_bilateral", phases)

	def test_per_eye_look_down_stronger_one_eye_ok(self):
		"""Look-down: one deep eye may credit via stronger (no bilateral)."""
		state = BlinkDetectionState(target_fps=15)
		t = _seed_open_eye(state, ear=0.26)
		pose = estimate_head_pose(_frontal_landmarks(pitch_shift=-35.0))
		state.resting_pitch = pose["pitch"] - 0.20
		self.assertTrue(
			evaluate_pose_gate(
				pose, "normal", resting_pitch=state.resting_pitch
			)["look_down"]
		)
		steps = (
			(0.1, 0.16, 0.26, 0.10),
			(0.1, 0.10, 0.26, 0.04),
			(0.1, 0.08, 0.25, 0.02),
			(0.1, 0.06, 0.25, 0.01),
			(0.1, 0.18, 0.25, 0.14),
			(0.1, 0.24, 0.26, 0.22),
			(0.1, 0.26, 0.26, 0.26),
		)
		credited_any, _t, info, phases = _feed(state, t, steps, pose=pose)
		self.assertTrue(credited_any)
		self.assertIn("complete", phases)
		self.assertEqual(info.get("merge"), "stronger")

	def test_per_eye_both_deep_merge_both(self):
		state = BlinkDetectionState(target_fps=15)
		t = _seed_open_eye(state, ear=0.28)
		steps = (
			(0.1, 0.16, 0.17, 0.15),
			(0.1, 0.10, 0.11, 0.09),
			(0.1, 0.08, 0.09, 0.07),
			(0.1, 0.07, 0.08, 0.06),
			(0.1, 0.22, 0.22, 0.22),
			(0.1, 0.28, 0.28, 0.28),
			(0.1, 0.28, 0.28, 0.28),
		)
		credited_any, _t, info, phases = _feed(state, t, steps)
		self.assertTrue(credited_any)
		self.assertIn("complete", phases)
		self.assertEqual(info.get("merge"), "both")

	def test_aperture_confirm_rejects_when_open(self):
		"""EAR-shaped blink but aperture stays open → reject_aperture."""
		state = BlinkDetectionState(target_fps=15)
		t = _seed_open_eye(state, ear=0.28)
		# Seed open aperture ref while lids open.
		for _ in range(5):
			t += 0.1
			state.detect(
				0.28,
				t,
				left_ear=0.28,
				right_ear=0.28,
				left_aperture=0.30,
				right_aperture=0.30,
			)
		steps = (
			(0.1, 0.16, 0.17, 0.15, 0.30, 0.30),
			(0.1, 0.10, 0.11, 0.09, 0.30, 0.30),
			(0.1, 0.08, 0.09, 0.07, 0.29, 0.29),
			(0.1, 0.07, 0.08, 0.06, 0.29, 0.29),
			(0.1, 0.22, 0.22, 0.22, 0.30, 0.30),
			(0.1, 0.28, 0.28, 0.28, 0.30, 0.30),
			(0.1, 0.28, 0.28, 0.28, 0.30, 0.30),
		)
		credited_any = False
		phases = []
		for step in steps:
			dt, ear, left, right, lap, rap = step
			t += dt
			credited, info = state.detect(
				ear,
				t,
				left_ear=left,
				right_ear=right,
				left_aperture=lap,
				right_aperture=rap,
			)
			if info:
				phases.append(info.get("phase"))
			if credited:
				credited_any = True
		self.assertFalse(credited_any)
		self.assertIn("reject_aperture", phases)

	def test_ocec_aperture_waives_when_aperture_open(self):
		"""EAR blink + flat aperture + real OCEC close → credit (ocec_aperture)."""
		state = BlinkDetectionState(target_fps=15)
		t = _seed_open_eye(state, ear=0.28)
		for _ in range(5):
			t += 0.1
			state.detect(
				0.28,
				t,
				left_ear=0.28,
				right_ear=0.28,
				left_aperture=0.30,
				right_aperture=0.30,
				left_ocec=0.90,
				right_ocec=0.90,
			)
		# Same shape as reject_aperture fixture, but OCEC collapses.
		steps = (
			(0.1, 0.16, 0.17, 0.15, 0.30, 0.30, 0.40, 0.40),
			(0.1, 0.10, 0.11, 0.09, 0.30, 0.30, 0.15, 0.15),
			(0.1, 0.08, 0.09, 0.07, 0.29, 0.29, 0.08, 0.08),
			(0.1, 0.07, 0.08, 0.06, 0.29, 0.29, 0.05, 0.05),
			(0.1, 0.22, 0.22, 0.22, 0.30, 0.30, 0.70, 0.70),
			(0.1, 0.28, 0.28, 0.28, 0.30, 0.30, 0.90, 0.90),
			(0.1, 0.28, 0.28, 0.28, 0.30, 0.30, 0.90, 0.90),
		)
		credited_any = False
		phases = []
		last_info = None
		for step in steps:
			dt, ear, left, right, lap, rap, loc, roc = step
			t += dt
			credited, info = state.detect(
				ear,
				t,
				left_ear=left,
				right_ear=right,
				left_aperture=lap,
				right_aperture=rap,
				left_ocec=loc,
				right_ocec=roc,
			)
			last_info = info
			if info:
				phases.append(info.get("phase"))
			if credited:
				credited_any = True
		self.assertTrue(credited_any, msg=last_info)
		self.assertIn("complete", phases)
		self.assertIn("ocec_aperture", (last_info or {}).get("waives") or [])

	def test_ocec_aperture_does_not_waive_when_ocec_open(self):
		"""Flat aperture + flat OCEC still reject_aperture (no false waive)."""
		state = BlinkDetectionState(target_fps=15)
		t = _seed_open_eye(state, ear=0.28)
		for _ in range(5):
			t += 0.1
			state.detect(
				0.28,
				t,
				left_ear=0.28,
				right_ear=0.28,
				left_aperture=0.30,
				right_aperture=0.30,
				left_ocec=0.90,
				right_ocec=0.90,
			)
		steps = (
			(0.1, 0.16, 0.17, 0.15, 0.30, 0.30, 0.90, 0.90),
			(0.1, 0.10, 0.11, 0.09, 0.30, 0.30, 0.88, 0.88),
			(0.1, 0.08, 0.09, 0.07, 0.29, 0.29, 0.88, 0.87),
			(0.1, 0.07, 0.08, 0.06, 0.29, 0.29, 0.89, 0.89),
			(0.1, 0.22, 0.22, 0.22, 0.30, 0.30, 0.90, 0.90),
			(0.1, 0.28, 0.28, 0.28, 0.30, 0.30, 0.90, 0.90),
			(0.1, 0.28, 0.28, 0.28, 0.30, 0.30, 0.90, 0.90),
		)
		credited_any = False
		phases = []
		last_info = None
		for step in steps:
			dt, ear, left, right, lap, rap, loc, roc = step
			t += dt
			credited, info = state.detect(
				ear,
				t,
				left_ear=left,
				right_ear=right,
				left_aperture=lap,
				right_aperture=rap,
				left_ocec=loc,
				right_ocec=roc,
			)
			last_info = info
			if info:
				phases.append(info.get("phase"))
			if credited:
				credited_any = True
		self.assertFalse(credited_any)
		# Flat aperture + flat OCEC: aperture confirm fails; no ocec_aperture.
		self.assertIn("reject_aperture", phases)
		self.assertNotIn(
			"ocec_aperture",
			(last_info or {}).get("waives") or [],
		)

	def test_aperture_confirm_credits_when_both_deep(self):
		state = BlinkDetectionState(target_fps=15)
		t = _seed_open_eye(state, ear=0.28)
		for _ in range(5):
			t += 0.1
			state.detect(
				0.28,
				t,
				left_ear=0.28,
				right_ear=0.28,
				left_aperture=0.30,
				right_aperture=0.30,
			)
		steps = (
			(0.1, 0.16, 0.17, 0.15, 0.18, 0.17),
			(0.1, 0.10, 0.11, 0.09, 0.08, 0.07),
			(0.1, 0.08, 0.09, 0.07, 0.04, 0.03),
			(0.1, 0.07, 0.08, 0.06, 0.02, 0.02),
			(0.1, 0.22, 0.22, 0.22, 0.22, 0.22),
			(0.1, 0.28, 0.28, 0.28, 0.30, 0.30),
			(0.1, 0.28, 0.28, 0.28, 0.30, 0.30),
		)
		credited_any = False
		phases = []
		last_info = None
		for step in steps:
			dt, ear, left, right, lap, rap = step
			t += dt
			credited, info = state.detect(
				ear,
				t,
				left_ear=left,
				right_ear=right,
				left_aperture=lap,
				right_aperture=rap,
			)
			last_info = info
			if info:
				phases.append(info.get("phase"))
			if credited:
				credited_any = True
		self.assertTrue(credited_any)
		self.assertIn("complete", phases)
		self.assertTrue(last_info.get("aperture_ok"))

	def test_aperture_none_keeps_34_behaviour(self):
		"""No aperture args → same credit path as Stage 3.4."""
		state = BlinkDetectionState(target_fps=15)
		t = _seed_open_eye(state, ear=0.28)
		credited_any, _t, _info, phases = _feed(state, t, _CREDIT_STEPS)
		self.assertTrue(credited_any)
		self.assertIn("complete", phases)

	def test_ocec_confirm_rejects_when_open(self):
		"""EAR-shaped blink but OCEC stays open → reject_ocec."""
		state = BlinkDetectionState(target_fps=15)
		t = _seed_open_eye(state, ear=0.28)
		for _ in range(5):
			t += 0.1
			state.detect(
				0.28,
				t,
				left_ear=0.28,
				right_ear=0.28,
				left_ocec=0.90,
				right_ocec=0.90,
			)
		steps = (
			(0.1, 0.16, 0.17, 0.15, 0.90, 0.90),
			(0.1, 0.10, 0.11, 0.09, 0.88, 0.88),
			(0.1, 0.08, 0.09, 0.07, 0.88, 0.87),
			(0.1, 0.07, 0.08, 0.06, 0.89, 0.89),
			(0.1, 0.22, 0.22, 0.22, 0.90, 0.90),
			(0.1, 0.28, 0.28, 0.28, 0.90, 0.90),
			(0.1, 0.28, 0.28, 0.28, 0.90, 0.90),
		)
		credited_any = False
		phases = []
		for step in steps:
			dt, ear, left, right, loc, roc = step
			t += dt
			credited, info = state.detect(
				ear,
				t,
				left_ear=left,
				right_ear=right,
				left_ocec=loc,
				right_ocec=roc,
			)
			if info:
				phases.append(info.get("phase"))
			if credited:
				credited_any = True
		self.assertFalse(credited_any)
		self.assertIn("reject_ocec", phases)

	def test_ocec_confirm_skips_on_side_yaw(self):
		"""|yaw|≥0.35: shallow OCEC must not veto (same band as classifier)."""
		state = BlinkDetectionState(target_fps=15)
		t = _seed_open_eye(state, ear=0.28)
		pose = estimate_head_pose(_frontal_landmarks(yaw_offset=18.0))
		self.assertGreaterEqual(abs(pose["yaw"]), 0.35)
		self.assertFalse(
			evaluate_pose_gate(pose, "normal")["extreme_yaw"]
		)
		for _ in range(5):
			t += 0.1
			state.detect(
				0.28,
				t,
				left_ear=0.28,
				right_ear=0.28,
				left_ocec=0.90,
				right_ocec=0.90,
				pose=pose,
			)
		steps = (
			(0.1, 0.16, 0.17, 0.15, 0.90, 0.90),
			(0.1, 0.10, 0.11, 0.09, 0.88, 0.88),
			(0.1, 0.08, 0.09, 0.07, 0.88, 0.87),
			(0.1, 0.07, 0.08, 0.06, 0.89, 0.89),
			(0.1, 0.22, 0.22, 0.22, 0.90, 0.90),
			(0.1, 0.28, 0.28, 0.28, 0.90, 0.90),
			(0.1, 0.28, 0.28, 0.28, 0.90, 0.90),
		)
		credited_any = False
		phases = []
		for step in steps:
			dt, ear, left, right, loc, roc = step
			t += dt
			credited, info = state.detect(
				ear,
				t,
				left_ear=left,
				right_ear=right,
				left_ocec=loc,
				right_ocec=roc,
				pose=pose,
			)
			if info:
				phases.append(info.get("phase"))
			if credited:
				credited_any = True
		self.assertTrue(credited_any)
		self.assertIn("complete", phases)
		self.assertNotIn("reject_ocec", phases)

	def test_ocec_confirm_credits_when_both_deep(self):
		state = BlinkDetectionState(target_fps=15)
		t = _seed_open_eye(state, ear=0.28)
		for _ in range(5):
			t += 0.1
			state.detect(
				0.28,
				t,
				left_ear=0.28,
				right_ear=0.28,
				left_ocec=0.90,
				right_ocec=0.90,
			)
		steps = (
			(0.1, 0.16, 0.17, 0.15, 0.55, 0.52),
			(0.1, 0.10, 0.11, 0.09, 0.20, 0.18),
			(0.1, 0.08, 0.09, 0.07, 0.08, 0.07),
			(0.1, 0.07, 0.08, 0.06, 0.05, 0.04),
			(0.1, 0.22, 0.22, 0.22, 0.70, 0.72),
			(0.1, 0.28, 0.28, 0.28, 0.90, 0.90),
			(0.1, 0.28, 0.28, 0.28, 0.90, 0.90),
		)
		credited_any = False
		phases = []
		last_info = None
		for step in steps:
			dt, ear, left, right, loc, roc = step
			t += dt
			credited, info = state.detect(
				ear,
				t,
				left_ear=left,
				right_ear=right,
				left_ocec=loc,
				right_ocec=roc,
			)
			last_info = info
			if info:
				phases.append(info.get("phase"))
			if credited:
				credited_any = True
		self.assertTrue(credited_any)
		self.assertIn("complete", phases)
		self.assertTrue(last_info.get("ocec_ok"))

	def test_ocec_none_keeps_legacy_behaviour(self):
		"""No OCEC args → same credit path as without Stage 7."""
		state = BlinkDetectionState(target_fps=15)
		t = _seed_open_eye(state, ear=0.28)
		credited_any, _t, _info, phases = _feed(state, t, _CREDIT_STEPS)
		self.assertTrue(credited_any)
		self.assertIn("complete", phases)

	def test_ocec_opening_waives_look_down_abs_miss(self):
		"""≥60ms + closed≥2 + real OCEC close can still ocec_opening."""
		credited, info, pose = _eval_ld_one_frame(
			live_open_ear=0.20,
			max_drop=0.17,
			opening_velocity=0.0,
			window_ear=0.16,
			detect_ear=0.19,
			left_ocec=0.08,
			right_ocec=0.08,
			closed_frames=2,
			duration=0.10,
		)
		self.assertLess(abs(pose["yaw"]), 0.35)
		self.assertTrue(credited, msg=info)
		self.assertEqual(info["phase"], "complete")

	def test_ocec_opening_does_not_waive_when_still_open(self):
		"""Same abs-miss shape but OCEC stays open → still reject_opening."""
		credited, info, _pose = _eval_ld_one_frame(
			live_open_ear=0.20,
			max_drop=0.17,
			opening_velocity=0.0,
			window_ear=0.16,
			detect_ear=0.19,
			left_ocec=0.90,
			right_ocec=0.90,
		)
		self.assertFalse(credited, msg=info)
		self.assertEqual(info["phase"], "reject_opening")
		self.assertNotIn("ocec_opening", info.get("waives") or [])

	def test_ocec_opening_does_not_waive_short_marginal_ocec(self):
		"""34ms + openV=0 + ocec_drop≈0.36 must not ocec_opening (eye-motion FP)."""
		credited, info, _pose = _eval_ld_one_frame(
			live_open_ear=0.20,
			max_drop=0.17,
			opening_velocity=0.0,
			window_ear=0.16,
			detect_ear=0.19,
			left_ocec=0.58,
			right_ocec=0.58,
			duration=0.034,
		)
		self.assertFalse(credited, msg=info)
		self.assertNotIn("ocec_opening", info.get("waives") or [])
		self.assertNotIn("ocec_threshold", info.get("waives") or [])

	def test_ocec_opening_does_not_waive_short_when_ocec_collapsed(self):
		"""1-frame + real OCEC collapse still must not ocec_opening (gaze FP)."""
		credited, info, _pose = _eval_ld_one_frame(
			live_open_ear=0.20,
			max_drop=0.17,
			opening_velocity=0.0,
			window_ear=0.16,
			detect_ear=0.19,
			left_ocec=0.08,
			right_ocec=0.08,
			duration=0.034,
		)
		self.assertFalse(credited, msg=info)
		self.assertNotIn("ocec_opening", info.get("waives") or [])

	def test_ocec_threshold_waives_look_down_relative_miss(self):
		"""≥60ms LD relative miss + real OCEC close → ocec_threshold."""
		credited, info, pose = _eval_ld_one_frame(
			live_open_ear=0.24,
			max_drop=0.148,
			opening_velocity=0.40,
			window_ear=0.20,
			detect_ear=0.22,
			left_ocec=0.08,
			right_ocec=0.08,
			closed_frames=2,
			duration=0.10,
		)
		self.assertLess(abs(pose["yaw"]), 0.35)
		self.assertTrue(credited, msg=info)
		self.assertEqual(info["phase"], "complete")
		self.assertIn("ocec_threshold", info.get("waives") or [])

	def test_ocec_threshold_does_not_waive_when_still_open(self):
		"""Same relative-miss shape but OCEC stays open → still reject_threshold."""
		credited, info, _pose = _eval_ld_one_frame(
			live_open_ear=0.24,
			max_drop=0.148,
			opening_velocity=0.40,
			window_ear=0.20,
			detect_ear=0.22,
			left_ocec=0.90,
			right_ocec=0.90,
		)
		self.assertFalse(credited, msg=info)
		self.assertEqual(info["phase"], "reject_threshold")
		self.assertNotIn("ocec_threshold", info.get("waives") or [])

	def test_ocec_look_down_skips_confirm_on_multiframe(self):
		"""Look-down duration≥0.09 with OCEC stuck open still credits (crop miss)."""
		credited, info, _pose = _eval_ld_one_frame(
			live_open_ear=0.28,
			max_drop=0.20,
			opening_velocity=0.40,
			window_ear=0.235,
			detect_ear=0.26,
			left_ocec=0.90,
			right_ocec=0.90,
			closed_frames=2,
			peak=0.90,
			duration=0.10,
		)
		self.assertTrue(credited, msg=info)
		self.assertEqual(info["phase"], "complete")
		self.assertIn("ocec_look_down", info.get("waives") or [])

	def test_ocec_look_down_rejects_short_two_frame_saccade(self):
		"""Look-down closed=2 + 34ms + OCEC open is not credited (saccade EAR)."""
		credited, info, _pose = _eval_ld_one_frame(
			live_open_ear=0.28,
			max_drop=0.20,
			opening_velocity=0.0,
			window_ear=0.235,
			detect_ear=0.26,
			left_ocec=0.90,
			right_ocec=0.90,
			closed_frames=2,
			peak=0.90,
			duration=0.034,
		)
		self.assertFalse(credited, msg=info)
		self.assertNotEqual(info["phase"], "complete")
		self.assertNotIn("ocec_look_down", info.get("waives") or [])

	def test_gaze_one_frame_high_ocec_not_credited(self):
		"""34ms openV=0 + ocec≈0.9 must not credit (vertical saccade)."""
		credited, info, _pose = _eval_ld_one_frame(
			live_open_ear=0.28,
			max_drop=0.20,
			opening_velocity=0.0,
			window_ear=0.235,
			detect_ear=0.26,
			left_ocec=0.05,
			right_ocec=0.05,
			closed_frames=1,
			peak=3.08,
			duration=0.034,
		)
		self.assertFalse(credited, msg=info)
		self.assertEqual(info["phase"], "reject_opening")

	def test_sub60_ld_strong_peak_ocec_credits(self):
		"""34ms closed≥2 + ld_strong_peak + OCEC close must not reject_opening."""
		credited, info, pose = _eval_ld_one_frame(
			live_open_ear=0.28,
			max_drop=0.22,
			opening_velocity=0.0,
			window_ear=0.235,
			detect_ear=0.26,
			left_ocec=0.05,
			right_ocec=0.05,
			closed_frames=2,
			peak=2.5,
			duration=0.034,
		)
		self.assertLess(abs(pose["yaw"]), 0.35)
		self.assertTrue(credited, msg=info)
		self.assertEqual(info["phase"], "complete")
		self.assertIn("ocec_sub60_opening", info.get("waives") or [])

	def test_sub60_one_frame_ocec_moderate_peak_credits(self):
		"""34ms 1-frame + moderate peak + OCEC close credits via sub-60 carve-out."""
		credited, info, pose = _eval_ld_one_frame(
			live_open_ear=0.28,
			max_drop=0.26,
			opening_velocity=0.0,
			window_ear=0.235,
			detect_ear=0.26,
			left_ocec=0.05,
			right_ocec=0.05,
			closed_frames=1,
			peak=2.02,
			duration=0.034,
		)
		self.assertLess(abs(pose["yaw"]), 0.35)
		self.assertTrue(credited, msg=info)
		self.assertEqual(info["phase"], "complete")
		self.assertIn("ocec_sub60_opening", info.get("waives") or [])

	def test_ocec_look_down_keeps_one_frame_confirm(self):
		"""Look-down 1-frame + OCEC open stays reject_ocec (anti-jitter)."""
		credited, info, _pose = _eval_ld_one_frame(
			live_open_ear=0.28,
			max_drop=0.20,
			opening_velocity=0.0,
			window_ear=0.235,
			detect_ear=0.26,
			left_ocec=0.90,
			right_ocec=0.90,
			peak=0.90,
		)
		self.assertFalse(credited, msg=info)
		self.assertNotEqual(info["phase"], "complete")
		self.assertNotIn("ocec_look_down", info.get("waives") or [])

	def test_ocec_velocity_waives_slow_look_down(self):
		"""LD slow close (peak 0.36) + real OCEC + duration≥0.06 → credit."""
		credited, info, pose = _eval_ld_one_frame(
			live_open_ear=0.28,
			max_drop=0.25,
			opening_velocity=0.0,
			window_ear=0.21,
			detect_ear=0.26,
			left_ocec=0.08,
			right_ocec=0.08,
			peak=0.36,
			duration=0.08,
		)
		self.assertLess(abs(pose["yaw"]), 0.35)
		self.assertTrue(credited, msg=info)
		self.assertEqual(info["phase"], "complete")
		self.assertIn("ocec_velocity", info.get("waives") or [])

	def test_ocec_velocity_does_not_waive_when_still_open(self):
		"""Same slow LD shape but OCEC stays open → still reject_velocity."""
		credited, info, _pose = _eval_ld_one_frame(
			live_open_ear=0.28,
			max_drop=0.25,
			opening_velocity=0.0,
			window_ear=0.21,
			detect_ear=0.26,
			left_ocec=0.90,
			right_ocec=0.90,
			peak=0.36,
			duration=0.08,
		)
		self.assertFalse(credited, msg=info)
		self.assertEqual(info["phase"], "reject_velocity")
		self.assertNotIn("ocec_velocity", info.get("waives") or [])

	def test_ocec_velocity_keeps_sub_60ms_floor(self):
		"""OCEC-real but duration < 0.06 stays reject_velocity (anti-storm)."""
		credited, info, _pose = _eval_ld_one_frame(
			live_open_ear=0.28,
			max_drop=0.25,
			opening_velocity=0.0,
			window_ear=0.21,
			detect_ear=0.26,
			left_ocec=0.08,
			right_ocec=0.08,
			peak=0.36,
			duration=0.05,
		)
		self.assertFalse(credited, msg=info)
		self.assertEqual(info["phase"], "reject_velocity")
		self.assertNotIn("ocec_velocity", info.get("waives") or [])

	def test_look_down_real_blink_credited(self):
		state = BlinkDetectionState(target_fps=15)
		t = _seed_open_eye(state, ear=0.26)
		pose = estimate_head_pose(_frontal_landmarks(pitch_shift=-35.0))
		state.resting_pitch = pose["pitch"] - 0.20
		self.assertTrue(
			evaluate_pose_gate(
				pose, "normal", resting_pitch=state.resting_pitch
			)["look_down"]
		)
		steps = (
			(0.1, 0.14),
			(0.1, 0.08),
			(0.1, 0.06),
			(0.1, 0.05),
			(0.1, 0.18),
			(0.1, 0.24),
			(0.1, 0.26),
		)
		credited_any, _t, _info, phases = _feed(state, t, steps, pose=pose)
		self.assertTrue(credited_any)
		self.assertIn("complete", phases)

	def test_look_down_rejects_slow_drift(self):
		state = BlinkDetectionState()
		t = _seed_open_eye(state, ear=0.28)
		pose = estimate_head_pose(_frontal_landmarks(pitch_shift=-35.0))
		state.resting_pitch = pose["pitch"] - 0.20
		self.assertTrue(
			evaluate_pose_gate(
				pose, "normal", resting_pitch=state.resting_pitch
			)["look_down"]
		)

		credited_any = False
		ear = 0.28
		for _ in range(12):
			ear -= 0.015
			t += 0.1
			credited, _ = state.detect(ear, t, pose=pose)
			if credited:
				credited_any = True
		for _ in range(8):
			ear = min(ear + 0.015, 0.28)
			t += 0.1
			credited, _ = state.detect(ear, t, pose=pose)
			if credited:
				credited_any = True
		self.assertFalse(credited_any)

	def test_look_down_rejects_marginal_velocity(self):
		state = BlinkDetectionState()
		t = _seed_open_eye(state, ear=0.28)
		pose = estimate_head_pose(_frontal_landmarks(pitch_shift=-35.0))
		state.resting_pitch = pose["pitch"] - 0.20
		gate = evaluate_pose_gate(
			pose, "normal", resting_pitch=state.resting_pitch
		)
		self.assertTrue(gate["look_down"])

		steps = ((0.1, 0.255), (0.1, 0.23), (0.1, 0.22), (0.1, 0.21), (0.1, 0.26), (0.1, 0.28))
		credited_any, _t, _info, _phases = _feed(state, t, steps, pose=pose)
		self.assertFalse(credited_any)

	def test_reset_clears_velocity_state(self):
		state = BlinkDetectionState()
		_seed_open_eye(state)
		state.detect(0.12, 5.0)
		state.reset()
		self.assertEqual(state.current_baseline_ear, 0.0)
		self.assertFalse(state.blink_in_progress)
		self.assertIsNone(state.prev_ear)
		self.assertEqual(state.peak_closing_velocity, 0.0)
		self.assertEqual(state.peak_closing_velocity_measured, 0.0)
		self.assertEqual(state.closed_frames, 0)

	def test_cancel_on_face_lost_clears_candidate_keeps_calibration(self):
		state = BlinkDetectionState()
		state.set_ear_calibration(0.30)
		t = _seed_open_eye(state, ear=0.30)
		t += 0.1
		state.detect(0.12, t)
		self.assertTrue(state.blink_in_progress)
		baseline = state.current_baseline_ear
		self.assertTrue(state.cancel_on_face_lost(t))
		self.assertFalse(state.blink_in_progress)
		self.assertIsNone(state.prev_ear)
		self.assertEqual(len(state._ear_window), 0)
		self.assertAlmostEqual(state.ear_calibration, 0.30, places=5)
		self.assertAlmostEqual(state.current_baseline_ear, baseline, places=5)
		self.assertIsNotNone(state._face_absent_since)
		# Second call with no candidate is a no-op cancel.
		self.assertFalse(state.cancel_on_face_lost(t + 0.1))

	def test_completion_logs_measured_and_effective_peak(self):
		state = BlinkDetectionState(target_fps=15)
		t = _seed_open_eye(state, ear=0.28)
		credited_any, _t, info, phases = _feed(state, t, _CREDIT_STEPS)
		self.assertTrue(credited_any)
		self.assertIn("complete", phases)
		self.assertIn("peak_velocity_raw", info)
		self.assertIn("peak_velocity_effective", info)
		self.assertAlmostEqual(
			info["peak_velocity"],
			info["peak_velocity_effective"],
			places=5,
		)
		self.assertGreaterEqual(
			info["peak_velocity_effective"],
			info["peak_velocity_raw"],
		)

	def test_interocular_distance_and_face_quality_floors(self):
		landmarks = _frontal_landmarks()
		iod = interocular_distance_px(landmarks)
		self.assertGreater(iod, MIN_INTEROCULAR_PX)
		self.assertGreater(MIN_FACE_AREA_PX, 0)
		self.assertEqual(interocular_distance_px(None), 0.0)

	def test_set_target_fps(self):
		state = BlinkDetectionState(target_fps=10)
		self.assertTrue(state.set_target_fps(20))
		self.assertEqual(state.target_fps, 20.0)
		self.assertFalse(state.set_target_fps(0))
		self.assertFalse(state.set_target_fps("bad"))

	def test_ear_calibration_seeds_baseline(self):
		state = BlinkDetectionState()
		self.assertTrue(state.set_ear_calibration(0.31))
		self.assertAlmostEqual(state.ear_calibration, 0.31, places=5)
		self.assertAlmostEqual(state.current_baseline_ear, 0.31, places=5)
		self.assertEqual(len(state.baseline_ear_values), 15)

		credited, info = state.detect(0.31, 1.0)
		self.assertFalse(credited)
		self.assertIsNotNone(info)
		self.assertAlmostEqual(info["baseline"], 0.31, delta=0.02)

	def test_ear_calibration_clears(self):
		state = BlinkDetectionState()
		state.set_ear_calibration(0.30)
		state.set_ear_calibration(None)
		self.assertIsNone(state.ear_calibration)
		self.assertGreater(state.current_baseline_ear, 0)

	def test_ear_calibration_survives_reset(self):
		state = BlinkDetectionState()
		state.set_ear_calibration(0.29)
		state.detect(0.12, 2.0)
		state.reset()
		self.assertAlmostEqual(state.ear_calibration, 0.29, places=5)
		self.assertAlmostEqual(state.current_baseline_ear, 0.29, places=5)

	def test_ear_calibration_clamps_and_rejects_invalid(self):
		state = BlinkDetectionState()
		self.assertTrue(state.set_ear_calibration(0.9))
		self.assertAlmostEqual(state.ear_calibration, 0.45, places=5)
		self.assertFalse(state.set_ear_calibration("bad"))
		self.assertFalse(state.set_ear_calibration(0))

	def test_baseline_drift_nudge_after_hold(self):
		state = BlinkDetectionState()
		state.current_baseline_ear = 0.30
		state.live_open_ear = 0.36
		state._baseline_drift_since = 0.0
		out = state.maybe_drift_recalibrate(61.0, look_down=False)
		self.assertIsNotNone(out)
		self.assertEqual(out["phase"], "baseline_drift_nudge")
		self.assertGreater(state.current_baseline_ear, 0.30)
		self.assertLess(state.current_baseline_ear, 0.36)

	def test_baseline_drift_clears_on_look_down(self):
		state = BlinkDetectionState()
		state.current_baseline_ear = 0.30
		state.live_open_ear = 0.36
		state._baseline_drift_since = 0.0
		self.assertIsNone(
			state.maybe_drift_recalibrate(61.0, look_down=True)
		)
		self.assertIsNone(state._baseline_drift_since)

	def test_baseline_drift_waits_for_hold(self):
		state = BlinkDetectionState()
		state.current_baseline_ear = 0.30
		state.live_open_ear = 0.36
		self.assertIsNone(
			state.maybe_drift_recalibrate(1.0, look_down=False)
		)
		self.assertIsNotNone(state._baseline_drift_since)
		self.assertIsNone(
			state.maybe_drift_recalibrate(30.0, look_down=False)
		)


	def test_classifier_disabled_keeps_stage35_credit(self):
		from blink_detector_package.domain import classifier as clf

		previous = clf.CLASSIFIER_ENABLED
		clf.CLASSIFIER_ENABLED = False
		try:
			state = BlinkDetectionState(target_fps=15)
			t = _seed_open_eye(state, ear=0.28)
			credited_any, _t, info, phases = _feed(state, t, _CREDIT_STEPS)
			self.assertTrue(credited_any)
			self.assertIn("complete", phases)
			self.assertFalse(info.get("clf_veto"))
			self.assertIsNone(info.get("clf_p"))
		finally:
			clf.CLASSIFIER_ENABLED = previous

	def test_classifier_low_p_vetoes_after_gates(self):
		from blink_detector_package.domain import blink_detection as bd

		original = bd.classifier_score

		def _always_veto(info, **kwargs):
			return 0.01, True

		bd.classifier_score = _always_veto
		try:
			state = BlinkDetectionState(target_fps=15)
			t = _seed_open_eye(state, ear=0.28)
			credited_any, _t, info, phases = _feed(state, t, _CREDIT_STEPS)
			self.assertFalse(credited_any)
			self.assertIn("reject_classifier", phases)
			self.assertEqual(info.get("phase"), "reject_classifier")
			self.assertTrue(info.get("clf_veto"))
			self.assertAlmostEqual(info.get("clf_p"), 0.01, places=5)
		finally:
			bd.classifier_score = original

	def test_ocec_confirm_waives_classifier_veto(self):
		"""Real OCEC close must not die on reject_classifier (frontal 2nd start)."""
		from blink_detector_package.domain import blink_detection as bd

		original = bd.classifier_score

		def _always_veto(info, **kwargs):
			return 0.01, True

		bd.classifier_score = _always_veto
		try:
			state = BlinkDetectionState(target_fps=15)
			t = _seed_open_eye(state, ear=0.28)
			for _ in range(5):
				t += 0.1
				state.detect(
					0.28,
					t,
					left_ear=0.28,
					right_ear=0.28,
					left_ocec=0.90,
					right_ocec=0.90,
				)
			steps = (
				(0.1, 0.16, 0.17, 0.15, 0.55, 0.52),
				(0.1, 0.10, 0.11, 0.09, 0.20, 0.18),
				(0.1, 0.08, 0.09, 0.07, 0.08, 0.07),
				(0.1, 0.07, 0.08, 0.06, 0.05, 0.04),
				(0.1, 0.22, 0.22, 0.22, 0.70, 0.72),
				(0.1, 0.28, 0.28, 0.28, 0.90, 0.90),
				(0.1, 0.28, 0.28, 0.28, 0.90, 0.90),
			)
			credited_any = False
			phases = []
			credited_info = None
			last_info = None
			for step in steps:
				dt, ear, left, right, loc, roc = step
				t += dt
				credited, info = state.detect(
					ear,
					t,
					left_ear=left,
					right_ear=right,
					left_ocec=loc,
					right_ocec=roc,
				)
				last_info = info
				if info:
					phases.append(info.get("phase"))
				if credited:
					credited_any = True
					credited_info = info
			self.assertTrue(credited_any, msg=last_info)
			self.assertIn("complete", phases)
			self.assertNotIn("reject_classifier", phases)
			self.assertIn("ocec_clf", (credited_info or {}).get("waives") or [])
			self.assertFalse((credited_info or {}).get("clf_veto"))
		finally:
			bd.classifier_score = original


if __name__ == "__main__":
	unittest.main()
