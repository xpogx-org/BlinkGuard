"""Stage 3.2 — solvePnP head pose (gate-normalized yaw/pitch + roll)."""

from __future__ import annotations

import unittest

from blink_detector_package.domain.pose import (
	estimate_head_pose_heuristic,
	evaluate_pose_gate,
)
from blink_detector_package.infrastructure.head_pose import (
	PITCH_SCALE_DEG,
	YAW_SCALE_DEG,
	estimate_head_pose,
	project_model_landmarks,
)


class HeadPoseSolvePnPTests(unittest.TestCase):
	def test_frontal_near_zero(self):
		pose = estimate_head_pose(
			project_model_landmarks(),
			image_size=(640, 480),
		)
		self.assertTrue(pose["valid"])
		self.assertEqual(pose["method"], "solvepnp")
		self.assertAlmostEqual(pose["yaw"], 0.0, delta=0.05)
		self.assertAlmostEqual(pose["pitch"], 0.0, delta=0.05)
		self.assertAlmostEqual(pose["roll_deg"], 0.0, delta=1.0)

	def test_frontal_low_reprojection_error(self):
		pose = estimate_head_pose(
			project_model_landmarks(),
			image_size=(640, 480),
		)
		self.assertEqual(pose["method"], "solvepnp")
		self.assertIn("reproj_err_iod", pose)
		self.assertTrue(pose["landmark_fit_ok"])
		self.assertLess(pose["reproj_err_iod"], 0.05)

	def test_corrupted_landmarks_high_reprojection(self):
		points = list(project_model_landmarks())
		points[8] = (points[8][0], points[8][1] + 300.0)
		pose = estimate_head_pose(points, image_size=(640, 480))
		self.assertEqual(pose["method"], "solvepnp")
		self.assertGreater(pose["reproj_err_iod"], 0.42)
		self.assertFalse(pose["landmark_fit_ok"])

	def test_yaw_scales_into_gate_units(self):
		pose = estimate_head_pose(
			project_model_landmarks(yaw_deg=56.0),
			image_size=(640, 480),
		)
		self.assertEqual(pose["method"], "solvepnp")
		self.assertAlmostEqual(pose["yaw_deg"], 56.0, delta=0.5)
		self.assertAlmostEqual(pose["yaw"], 56.0 / YAW_SCALE_DEG, delta=0.02)
		self.assertGreater(abs(pose["yaw"]), 1.20)
		gate = evaluate_pose_gate(pose, "normal")
		self.assertTrue(gate["extreme_yaw"])

	def test_side_band_below_extreme(self):
		pose = estimate_head_pose(
			project_model_landmarks(yaw_deg=50.0),
			image_size=(640, 480),
		)
		self.assertGreater(abs(pose["yaw"]), 1.05)
		self.assertLess(abs(pose["yaw"]), 1.20)
		self.assertFalse(evaluate_pose_gate(pose, "normal")["extreme_yaw"])

	def test_look_down_positive_pitch(self):
		frontal = estimate_head_pose(
			project_model_landmarks(),
			image_size=(640, 480),
		)
		down = estimate_head_pose(
			project_model_landmarks(pitch_deg=8.0),
			image_size=(640, 480),
		)
		self.assertEqual(down["method"], "solvepnp")
		self.assertGreater(down["pitch"], frontal["pitch"])
		self.assertAlmostEqual(down["pitch"], 8.0 / PITCH_SCALE_DEG, delta=0.05)
		gate = evaluate_pose_gate(
			down, "normal", resting_pitch=frontal["pitch"]
		)
		self.assertTrue(gate["look_down"])

	def test_roll_present(self):
		pose = estimate_head_pose(
			project_model_landmarks(roll_deg=12.0),
			image_size=(640, 480),
		)
		self.assertEqual(pose["method"], "solvepnp")
		self.assertAlmostEqual(pose["roll_deg"], 12.0, delta=1.5)

	def test_degenerate_falls_back_to_heuristic(self):
		# Collapsed points → heuristic path.
		points = [(10.0, 10.0)] * 68
		pose = estimate_head_pose(points)
		self.assertEqual(pose["method"], "heuristic")
		heuristic = estimate_head_pose_heuristic(points)
		self.assertEqual(pose["valid"], heuristic["valid"])

	def test_absurd_pnp_uses_heuristic_yaw(self):
		"""Crude non-projective cloud should not keep wild PnP euler as gates."""
		points = [(0.0, 0.0)] * 68
		points[8] = (180.0, 260.0)
		points[30] = (200.0, 176.0)
		for i, (x, y) in enumerate(
			[(150, 150), (158, 145), (166, 145), (174, 150), (166, 155), (158, 155)]
		):
			points[36 + i] = (float(x), float(y))
		for i, (x, y) in enumerate(
			[(186, 150), (194, 145), (202, 145), (210, 150), (202, 155), (194, 155)]
		):
			points[42 + i] = (float(x), float(y))
		points[48] = (150.0, 220.0)
		points[54] = (210.0, 220.0)
		pose = estimate_head_pose(points)
		self.assertEqual(pose["method"], "heuristic")
		self.assertLessEqual(abs(pose["yaw"]), 5.0)
		self.assertLessEqual(abs(pose["pitch"]), 5.0)
		self.assertEqual(pose["yaw_deg"], 0.0)
		self.assertEqual(pose["pitch_deg"], 0.0)


if __name__ == "__main__":
	unittest.main()
