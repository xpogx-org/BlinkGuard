"""Landmark trust — YuNet cross-check + solvePnP fit."""

from __future__ import annotations

import unittest

from blink_detector_package.domain.landmark_trust import (
	LandmarkTrustDebouncer,
	_yunet_dlib_eye_offset,
	evaluate_landmark_trust,
)
from blink_detector_package.domain.pose import landmark_fail_face_status
from blink_detector_package.infrastructure.head_pose import (
	estimate_head_pose,
	project_model_landmarks,
)


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


def _mean_xy(landmarks, start, end):
	count = end - start
	sx = sy = 0.0
	for index in range(start, end):
		x, y = landmarks[index]
		sx += float(x)
		sy += float(y)
	return (sx / count, sy / count)


def _yunet_kps_matching(landmarks):
	return {
		"right_eye": _mean_xy(landmarks, 42, 48),
		"left_eye": _mean_xy(landmarks, 36, 42),
		"nose": (float(landmarks[30][0]), float(landmarks[30][1])),
	}


def _face_from_landmarks(landmarks, pad=50):
	xs = [float(p[0]) for p in landmarks[:68]]
	ys = [float(p[1]) for p in landmarks[:68]]
	left = int(min(xs) - pad)
	top = int(min(ys) - pad)
	right = int(max(xs) + pad)
	bottom = int(max(ys) + pad)
	return _FakeFace(right - left, bottom - top, left=left, top=top)


class LandmarkTrustTests(unittest.TestCase):
	def test_frontal_with_matching_yunet_passes(self):
		landmarks = project_model_landmarks(image_size=(640, 480))
		face = _face_from_landmarks(landmarks)
		pose = estimate_head_pose(landmarks, image_size=(640, 480))
		trusted, reason, metrics = evaluate_landmark_trust(
			face,
			landmarks,
			pose,
			yunet_kps=_yunet_kps_matching(landmarks),
		)
		self.assertTrue(trusted, reason)
		self.assertEqual(reason, "ok")
		self.assertIsNotNone(metrics["reproj_err_iod"])
		self.assertLess(metrics["reproj_err_iod"], 0.42)

	def test_forehead_dlib_eyes_fail_yunet_cross_check(self):
		true_landmarks = project_model_landmarks(image_size=(640, 480))
		lying = list(true_landmarks)
		for i in range(36, 48):
			x, y = lying[i]
			lying[i] = (x, y - 55.0)
		face = _face_from_landmarks(true_landmarks)
		pose = estimate_head_pose(lying, image_size=(640, 480))
		trusted, reason, metrics = evaluate_landmark_trust(
			face,
			lying,
			pose,
			yunet_kps=_yunet_kps_matching(true_landmarks),
		)
		self.assertFalse(trusted)
		self.assertEqual(reason, "yunet_eye_mismatch")
		self.assertGreater(metrics["yunet_eye_offset"], 0.32)

	def test_swapped_yunet_labels_still_match(self):
		landmarks = project_model_landmarks(image_size=(640, 480))
		kps = _yunet_kps_matching(landmarks)
		# Simulate YuNet subject left/right labels reversed vs dlib.
		swapped = {
			"right_eye": kps["left_eye"],
			"left_eye": kps["right_eye"],
			"nose": kps["nose"],
		}
		offset = _yunet_dlib_eye_offset(swapped, landmarks)
		self.assertLess(offset, 0.05)

	def test_corrupted_pnp_points_fail_reprojection(self):
		landmarks = project_model_landmarks(image_size=(640, 480))
		face = _face_from_landmarks(landmarks)
		pose = {
			"method": "solvepnp",
			"valid": True,
			"reproj_err_iod": 0.55,
			"pitch_deg": 0.0,
		}
		trusted, reason, _metrics = evaluate_landmark_trust(
			face,
			landmarks,
			pose,
			yunet_kps=_yunet_kps_matching(landmarks),
		)
		self.assertFalse(trusted)
		self.assertEqual(reason, "pnp_high_error")

	def test_hog_only_path_uses_pnp_without_yunet(self):
		landmarks = project_model_landmarks(image_size=(640, 480))
		face = _face_from_landmarks(landmarks)
		pose = estimate_head_pose(landmarks, image_size=(640, 480))
		trusted, reason, _metrics = evaluate_landmark_trust(
			face,
			landmarks,
			pose,
			yunet_kps=None,
		)
		self.assertTrue(trusted, reason)
		self.assertEqual(reason, "ok")

	def test_moderate_look_down_still_trusted_when_signals_agree(self):
		landmarks = project_model_landmarks(
			pitch_deg=12.0,
			image_size=(640, 480),
		)
		face = _face_from_landmarks(landmarks)
		pose = estimate_head_pose(landmarks, image_size=(640, 480))
		trusted, reason, _metrics = evaluate_landmark_trust(
			face,
			landmarks,
			pose,
			yunet_kps=_yunet_kps_matching(landmarks),
		)
		self.assertTrue(trusted, reason)

	def test_look_up_maps_to_head_too_high(self):
		landmarks = project_model_landmarks(
			pitch_deg=-32.0,
			image_size=(640, 480),
		)
		face = _face_from_landmarks(landmarks)
		pose = estimate_head_pose(landmarks, image_size=(640, 480))
		self.assertLess(pose["pitch_deg"], -28.0)
		trusted, reason, _metrics = evaluate_landmark_trust(
			face,
			landmarks,
			pose,
			yunet_kps=_yunet_kps_matching(landmarks),
		)
		self.assertFalse(trusted)
		self.assertEqual(reason, "pitch_up")
		self.assertEqual(landmark_fail_face_status("pitch_up"), "head_too_high")

	def test_collapsed_geometry_rejected(self):
		landmarks = list(project_model_landmarks(image_size=(640, 480)))
		for i in range(36, 48):
			x, y = landmarks[i]
			landmarks[i] = (320.0, y)
		face = _face_from_landmarks(landmarks)
		pose = estimate_head_pose(landmarks, image_size=(640, 480))
		trusted, reason, _metrics = evaluate_landmark_trust(
			face,
			landmarks,
			pose,
			yunet_kps=_yunet_kps_matching(landmarks),
		)
		self.assertFalse(trusted)
		self.assertEqual(reason, "collapsed_geometry")


class LandmarkTrustDebouncerTests(unittest.TestCase):
	def test_requires_two_fails_before_untrusted(self):
		debouncer = LandmarkTrustDebouncer(fail_streak_threshold=2)
		self.assertTrue(debouncer.should_emit_trusted(False))
		self.assertFalse(debouncer.should_emit_trusted(False))

	def test_recovers_in_one_good_frame(self):
		debouncer = LandmarkTrustDebouncer(fail_streak_threshold=2)
		debouncer.should_emit_trusted(False)
		debouncer.should_emit_trusted(False)
		self.assertTrue(debouncer.should_emit_trusted(True))


if __name__ == "__main__":
	unittest.main()
