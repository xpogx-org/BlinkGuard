"""Landmark trust — YuNet cross-check + solvePnP fit (no pose-band heuristics)."""

from __future__ import annotations

import math

from blink_detector_package.domain.pose import interocular_distance_px

# Minimal geometry sanity before independent checks.
MIN_DLIB_IOD_PX = 8.0

# YuNet right/left eye vs dlib eye-center agreement (normalized by YuNet IOD).
MAX_YUNET_DLIB_EYE_OFFSET_IOD = 0.32

# Mean solvePnP reprojection error / dlib IOD. Generic 3D model on real dlib
# landmarks is looser than synthetic project_model_landmarks() fits.
MAX_PNP_REPROJ_ERR_IOD = 0.42

# Honest look-up / look-down (valid PnP) — UI hints, not lying landmarks.
HEAD_TOO_HIGH_PITCH_DEG = -28.0
HEAD_TOO_LOW_PITCH_DEG = 28.0

LANDMARK_TRUST_FAIL_STREAK = 5


def _mean_xy(landmarks, start, end):
	count = end - start
	sx = 0.0
	sy = 0.0
	for index in range(start, end):
		pt = landmarks[index]
		sx += float(pt[0])
		sy += float(pt[1])
	return sx / count, sy / count


def _yunet_iod(yunet_kps):
	if not yunet_kps:
		return 0.0
	try:
		re = yunet_kps["right_eye"]
		le = yunet_kps["left_eye"]
		return math.hypot(float(le[0]) - float(re[0]), float(le[1]) - float(re[1]))
	except (KeyError, TypeError, ValueError):
		return 0.0


def _yunet_dlib_eye_offset(yunet_kps, landmarks):
	"""Max eye-center distance between YuNet and dlib, divided by YuNet IOD.

	YuNet row labels are subject right/left; try both pairings and keep the
	lower offset so a naming mismatch cannot reject every frontal frame.
	"""
	iod = _yunet_iod(yunet_kps)
	if iod < 1e-3:
		return float("inf")
	dlib_left = _mean_xy(landmarks, 36, 42)
	dlib_right = _mean_xy(landmarks, 42, 48)
	yunet_left = yunet_kps["left_eye"]
	yunet_right = yunet_kps["right_eye"]

	def _offset(a, b):
		return math.hypot(float(a[0]) - float(b[0]), float(a[1]) - float(b[1]))

	same_side = max(
		_offset(dlib_left, yunet_left),
		_offset(dlib_right, yunet_right),
	)
	crossed = max(
		_offset(dlib_left, yunet_right),
		_offset(dlib_right, yunet_left),
	)
	return min(same_side, crossed) / iod


def _minimal_sanity(face, landmarks):
	if face is None or landmarks is None or len(landmarks) < 48:
		return False, "missing_landmarks"

	try:
		box_left = float(face.left())
		box_top = float(face.top())
		box_right = float(face.right())
		box_bottom = float(face.bottom())
		box_w = float(face.width())
		box_h = float(face.height())
	except Exception:
		return False, "missing_landmarks"

	if box_w <= 1.0 or box_h <= 1.0:
		return False, "missing_landmarks"

	iod = interocular_distance_px(landmarks)
	if iod < MIN_DLIB_IOD_PX:
		return False, "collapsed_geometry"

	return True, "ok"


def evaluate_landmark_trust(face, landmarks, pose, yunet_kps=None):
	"""
	Return (trusted, reason, metrics) for overlay / blink tracking honesty.

	`pose` is from ``estimate_head_pose`` (may include reproj_err_iod).
	"""
	metrics = {
		"yunet_eye_offset": None,
		"reproj_err_iod": None,
	}

	ok, reason = _minimal_sanity(face, landmarks)
	if not ok:
		return False, reason, metrics

	if yunet_kps is not None:
		offset = _yunet_dlib_eye_offset(yunet_kps, landmarks)
		metrics["yunet_eye_offset"] = float(offset)
		if offset > MAX_YUNET_DLIB_EYE_OFFSET_IOD:
			return False, "yunet_eye_mismatch", metrics

	reproj_err = None
	if pose:
		try:
			reproj_err = pose.get("reproj_err_iod")
		except (TypeError, AttributeError):
			reproj_err = None
	if reproj_err is not None:
		metrics["reproj_err_iod"] = float(reproj_err)
		if float(reproj_err) > MAX_PNP_REPROJ_ERR_IOD:
			return False, "pnp_high_error", metrics
	elif pose and pose.get("method") == "solvepnp":
		return False, "pnp_high_error", metrics
	# Heuristic pose fallback: skip PnP gate (hog-only / degenerate solvePnP).

	if pose and pose.get("method") == "solvepnp" and pose.get("valid"):
		try:
			pitch_deg = float(pose.get("pitch_deg", 0.0))
		except (TypeError, ValueError):
			pitch_deg = 0.0
		if pitch_deg < HEAD_TOO_HIGH_PITCH_DEG:
			return False, "pitch_up", metrics
		if pitch_deg > HEAD_TOO_LOW_PITCH_DEG:
			return False, "pitch_down", metrics

	return True, "ok", metrics


class LandmarkTrustDebouncer:
	"""Require consecutive untrusted frames before emitting fail; recover in one."""

	def __init__(self, fail_streak_threshold=LANDMARK_TRUST_FAIL_STREAK):
		self.fail_streak_threshold = max(1, int(fail_streak_threshold))
		self.fail_streak = 0

	def reset(self):
		self.fail_streak = 0

	def should_emit_trusted(self, frame_trusted):
		if frame_trusted:
			self.fail_streak = 0
			return True
		self.fail_streak += 1
		return self.fail_streak < self.fail_streak_threshold
