"""Head-pose from dlib landmarks via OpenCV solvePnP (Stage 3.2)."""

from __future__ import annotations

import math
from typing import Any

import cv2
import numpy as np

from blink_detector_package.domain.landmark_trust import MAX_PNP_REPROJ_ERR_IOD
from blink_detector_package.domain.pose import (
	estimate_head_pose_heuristic,
	interocular_distance_px,
)

# dlib indices for the 6-point canonical face used with solvePnP.
_PNP_INDICES = (30, 8, 36, 45, 48, 54)

# Generic 3D face model (mm) — OpenCV / dlib common pairing.
_MODEL_POINTS_MM = np.array(
	[
		(0.0, 0.0, 0.0),  # nose tip
		(0.0, -330.0, -65.0),  # chin
		(-225.0, 170.0, -135.0),  # left eye outer
		(225.0, 170.0, -135.0),  # right eye outer
		(-150.0, -150.0, -125.0),  # left mouth
		(150.0, -150.0, -125.0),  # right mouth
	],
	dtype=np.float64,
)

# Map degrees → gate units so existing POSE_PROFILES stay valid.
# |yaw_deg| ≈ 54° → |yaw| ≈ 1.20 (yaw_extreme normal).
YAW_SCALE_DEG = 45.0
# pitch_look_down_delta 0.06 ≈ 1.5° raw; resting deltas stay small.
PITCH_SCALE_DEG = 25.0


def _point_xy(landmarks, index: int) -> tuple[float, float]:
	pt = landmarks[index]
	return float(pt[0]), float(pt[1])


def _camera_matrix(
	landmarks,
	image_size: tuple[int, int] | None,
) -> np.ndarray:
	if image_size is not None and image_size[0] > 1 and image_size[1] > 1:
		width, height = float(image_size[0]), float(image_size[1])
		cx, cy = width * 0.5, height * 0.5
		focal = max(width, height)
	else:
		xs = [float(landmarks[i][0]) for i in range(min(68, len(landmarks)))]
		ys = [float(landmarks[i][1]) for i in range(min(68, len(landmarks)))]
		x0, x1 = min(xs), max(xs)
		y0, y1 = min(ys), max(ys)
		span = max(x1 - x0, y1 - y0, 1.0)
		cx = (x0 + x1) * 0.5
		cy = (y0 + y1) * 0.5
		focal = span * 1.2
	return np.array(
		[[focal, 0.0, cx], [0.0, focal, cy], [0.0, 0.0, 1.0]],
		dtype=np.float64,
	)


def _reprojection_error_iod(
	image_pts: np.ndarray,
	rvec: np.ndarray,
	tvec: np.ndarray,
	camera: np.ndarray,
	dist: np.ndarray,
	iod_px: float,
) -> float:
	projected, _ = cv2.projectPoints(
		_MODEL_POINTS_MM, rvec, tvec, camera, dist
	)
	projected = projected.reshape(-1, 2)
	errors = np.linalg.norm(projected - image_pts, axis=1)
	mean_err = float(np.mean(errors))
	if iod_px < 1e-3:
		return float("inf")
	return mean_err / iod_px


def _image_points(landmarks) -> np.ndarray | None:
	if landmarks is None or len(landmarks) < 68:
		return None
	pts = []
	for index in _PNP_INDICES:
		x, y = _point_xy(landmarks, index)
		pts.append((x, y))
	arr = np.asarray(pts, dtype=np.float64)
	if not np.isfinite(arr).all():
		return None
	# Degenerate: all points collapsed.
	if float(np.ptp(arr[:, 0])) < 1.0 and float(np.ptp(arr[:, 1])) < 1.0:
		return None
	return arr


def euler_deg_from_rvec_tvec(
	rvec: np.ndarray,
	tvec: np.ndarray,
) -> tuple[float, float, float]:
	"""
	Pitch / yaw / roll in degrees via decomposeProjectionMatrix.

	Convention (gate-compatible):
	- pitch > 0 → looking down (chin tuck)
	- yaw magnitude grows toward profile
	- roll → head tilt
	"""
	rotation, _ = cv2.Rodrigues(rvec)
	pose = cv2.hconcat((rotation, tvec.reshape(3, 1)))
	_cam, _rot, _trans, _rx, _ry, _rz, euler = cv2.decomposeProjectionMatrix(
		pose
	)
	# OpenCV euler: [pitch, yaw, roll] in degrees (x, y, z).
	pitch_raw = float(euler[0, 0])
	yaw_raw = float(euler[1, 0])
	roll_raw = float(euler[2, 0])
	# Flip pitch so positive = look down (matches Stage 0–1 heuristic).
	pitch_deg = -pitch_raw
	yaw_deg = yaw_raw
	roll_deg = roll_raw
	return pitch_deg, yaw_deg, roll_deg


def _normalize_gate_units(
	yaw_deg: float,
	pitch_deg: float,
) -> tuple[float, float]:
	yaw = float(yaw_deg) / YAW_SCALE_DEG
	pitch = float(pitch_deg) / PITCH_SCALE_DEG
	return yaw, pitch


def _with_degrees(
	base: dict[str, Any],
	*,
	yaw_deg: float,
	pitch_deg: float,
	roll_deg: float,
	method: str,
) -> dict[str, Any]:
	out = dict(base)
	out["yaw_deg"] = float(yaw_deg)
	out["pitch_deg"] = float(pitch_deg)
	out["roll_deg"] = float(roll_deg)
	out["method"] = method
	return out


def estimate_head_pose(
	landmarks,
	image_size: tuple[int, int] | None = None,
) -> dict[str, Any]:
	"""
	Estimate head pose for blink gates.

	Returns gate-normalized `yaw` / `pitch` (same semantics as Stage 0–1
	heuristic) plus raw `yaw_deg` / `pitch_deg` / `roll_deg`.
	"""
	fallback = estimate_head_pose_heuristic(landmarks)
	image_pts = _image_points(landmarks)
	if image_pts is None:
		return _with_degrees(
			fallback,
			yaw_deg=0.0,
			pitch_deg=0.0,
			roll_deg=0.0,
			method="heuristic",
		)

	camera = _camera_matrix(landmarks, image_size)
	dist = np.zeros((4, 1), dtype=np.float64)
	ok, rvec, tvec = cv2.solvePnP(
		_MODEL_POINTS_MM,
		image_pts,
		camera,
		dist,
		flags=cv2.SOLVEPNP_ITERATIVE,
	)
	if not ok:
		return _with_degrees(
			fallback,
			yaw_deg=0.0,
			pitch_deg=0.0,
			roll_deg=0.0,
			method="heuristic",
		)

	pitch_deg, yaw_deg, roll_deg = euler_deg_from_rvec_tvec(rvec, tvec)
	if not (
		math.isfinite(pitch_deg)
		and math.isfinite(yaw_deg)
		and math.isfinite(roll_deg)
	):
		return _with_degrees(
			fallback,
			yaw_deg=0.0,
			pitch_deg=0.0,
			roll_deg=0.0,
			method="heuristic",
		)

	# Discard absurd poses (bad landmarks / wrong camera).
	if abs(yaw_deg) > 89.0 or abs(pitch_deg) > 89.0 or abs(roll_deg) > 89.0:
		return _with_degrees(
			fallback,
			yaw_deg=0.0,
			pitch_deg=0.0,
			roll_deg=0.0,
			method="heuristic",
		)

	iod_px = interocular_distance_px(landmarks)
	reproj_err_iod = _reprojection_error_iod(
		image_pts, rvec, tvec, camera, dist, iod_px
	)
	yaw, pitch = _normalize_gate_units(yaw_deg, pitch_deg)
	return {
		"yaw": float(yaw),
		"pitch": float(pitch),
		"valid": True,
		"yaw_deg": float(yaw_deg),
		"pitch_deg": float(pitch_deg),
		"roll_deg": float(roll_deg),
		"method": "solvepnp",
		"reproj_err_iod": float(reproj_err_iod),
		"landmark_fit_ok": reproj_err_iod <= MAX_PNP_REPROJ_ERR_IOD,
	}


def project_model_landmarks(
	*,
	yaw_deg: float = 0.0,
	pitch_deg: float = 0.0,
	roll_deg: float = 0.0,
	image_size: tuple[int, int] = (640, 480),
	translate: tuple[float, float, float] = (0.0, 0.0, 500.0),
) -> list[tuple[float, float]]:
	"""
	Project the 6 PnP model points (+ fill remaining with nose) for tests.

	`pitch_deg` / `yaw_deg` use the same gate-facing signs as estimate_head_pose
	(positive pitch = look down).
	"""
	width, height = image_size
	# Invert the pitch flip applied in euler_deg_from_rvec_tvec.
	pitch = math.radians(-pitch_deg)
	yaw = math.radians(yaw_deg)
	roll = math.radians(roll_deg)
	rx = np.array(
		[
			[1.0, 0.0, 0.0],
			[0.0, math.cos(pitch), -math.sin(pitch)],
			[0.0, math.sin(pitch), math.cos(pitch)],
		],
		dtype=np.float64,
	)
	ry = np.array(
		[
			[math.cos(yaw), 0.0, math.sin(yaw)],
			[0.0, 1.0, 0.0],
			[-math.sin(yaw), 0.0, math.cos(yaw)],
		],
		dtype=np.float64,
	)
	rz = np.array(
		[
			[math.cos(roll), -math.sin(roll), 0.0],
			[math.sin(roll), math.cos(roll), 0.0],
			[0.0, 0.0, 1.0],
		],
		dtype=np.float64,
	)
	rotation = ry @ rx @ rz
	rvec, _ = cv2.Rodrigues(rotation)
	tvec = np.array(translate, dtype=np.float64).reshape(3, 1)
	camera = np.array(
		[
			[float(max(width, height)), 0.0, width * 0.5],
			[0.0, float(max(width, height)), height * 0.5],
			[0.0, 0.0, 1.0],
		],
		dtype=np.float64,
	)
	dist = np.zeros((4, 1), dtype=np.float64)
	projected, _ = cv2.projectPoints(
		_MODEL_POINTS_MM, rvec, tvec, camera, dist
	)
	projected = projected.reshape(-1, 2)
	nose = (float(projected[0, 0]), float(projected[0, 1]))
	points = [nose] * 68
	for model_i, landmark_i in enumerate(_PNP_INDICES):
		points[landmark_i] = (
			float(projected[model_i, 0]),
			float(projected[model_i, 1]),
		)
	return points
