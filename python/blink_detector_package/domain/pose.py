"""Pose gate profiles and heuristic head-pose fallback (no OpenCV).

Stage 3.2 live path: ``infrastructure.head_pose.estimate_head_pose`` (solvePnP).
This module keeps gate profiles + a pure-Python heuristic used when PnP fails.
"""

# Matches BlinkDetectionState recovery when not looking down.
BLINK_RECOVERY_DEFAULT = 0.7

# Laptop webcam-on-top often reports absolute pitch ~0.15–0.25 at rest.
# Look-down uses *delta vs resting pitch*, not absolute pitch.
# Yaw hard-block is only for near-profile faces; side-monitor glances credit.
POSE_PROFILES = {
	"loose": {
		"yaw_extreme": 1.25,
		"pitch_look_down_delta": 0.05,
		"look_down_threshold_mult": 0.85,
		"look_down_velocity_mult": 1.0,
	},
	"normal": {
		# Raised 1.10→1.20: side_monitor_right sat just over 1.10 and
		# skip_yaw cancelled mid-blink; left (~0.98) was already under.
		"yaw_extreme": 1.20,
		"pitch_look_down_delta": 0.06,
		"look_down_threshold_mult": 0.88,
		"look_down_velocity_mult": 1.05,
	},
	"strict": {
		"yaw_extreme": 0.95,
		"pitch_look_down_delta": 0.07,
		"look_down_threshold_mult": 0.90,
		"look_down_velocity_mult": 1.1,
	},
}

DEFAULT_POSE_STRICTNESS = "normal"

# Stage 3.3: pitch_delta above look-down threshold → weight 0→1 over this span.
PITCH_WEIGHT_SPAN = 0.12


def get_pose_profile(strictness=None):
	key = strictness if strictness in POSE_PROFILES else DEFAULT_POSE_STRICTNESS
	return POSE_PROFILES[key]


def lerp(a, b, weight):
	"""Linear blend: weight 0 → a, weight 1 → b."""
	try:
		w = float(weight)
	except (TypeError, ValueError):
		w = 0.0
	w = 0.0 if w < 0.0 else (1.0 if w > 1.0 else w)
	return (1.0 - w) * float(a) + w * float(b)


def pose_weight(pitch_delta, profile, *, extreme_yaw=False):
	"""
	Continuous look-down amount in [0, 1] from pitch_delta.

	0 while pitch_delta <= profile pitch_look_down_delta (or extreme yaw);
	1 after an additional PITCH_WEIGHT_SPAN.
	"""
	if extreme_yaw:
		return 0.0
	try:
		delta = float(pitch_delta)
	except (TypeError, ValueError):
		return 0.0
	d0 = float(profile["pitch_look_down_delta"])
	if delta <= d0:
		return 0.0
	span = float(PITCH_WEIGHT_SPAN)
	if span <= 1e-9:
		return 1.0
	w = (delta - d0) / span
	if w >= 1.0:
		return 1.0
	if w <= 0.0:
		return 0.0
	return w


def _point(landmarks, index):
	pt = landmarks[index]
	return float(pt[0]), float(pt[1])


def _mean_xy(landmarks, start, end):
	count = end - start
	sx = 0.0
	sy = 0.0
	for index in range(start, end):
		x, y = _point(landmarks, index)
		sx += x
		sy += y
	return sx / count, sy / count


def estimate_head_pose_heuristic(landmarks):
	"""
	Normalized yaw/pitch from 68-point shape (no solvePnP).

	yaw: 0 = frontal; magnitude grows toward profile (side monitor).
	pitch: 0 ≈ neutral geometry; positive = looking down (chin tuck).
	Absolute pitch is biased with top-mounted webcams — use resting delta.

	Prefer ``infrastructure.head_pose.estimate_head_pose`` in live paths.
	"""
	if landmarks is None or len(landmarks) < 68:
		return {"yaw": 0.0, "pitch": 0.0, "valid": False}

	left_eye = _mean_xy(landmarks, 36, 42)
	right_eye = _mean_xy(landmarks, 42, 48)
	nose = _point(landmarks, 30)
	chin = _point(landmarks, 8)

	eye_mid_x = (left_eye[0] + right_eye[0]) * 0.5
	eye_mid_y = (left_eye[1] + right_eye[1]) * 0.5
	interocular = abs(right_eye[0] - left_eye[0])
	if interocular < 1e-3:
		return {"yaw": 0.0, "pitch": 0.0, "valid": False}

	# Nose offset from eye midpoint, normalized by half interocular distance.
	yaw = (nose[0] - eye_mid_x) / (interocular * 0.5)

	face_height = chin[1] - eye_mid_y
	if face_height < 1e-3:
		return {"yaw": float(yaw), "pitch": 0.0, "valid": False}

	# Neutral nose sits ~45% of the way from eyes to chin; looking down
	# pulls the tip toward the eye line (smaller ratio → positive pitch).
	nose_ratio = (nose[1] - eye_mid_y) / face_height
	pitch = 0.45 - nose_ratio

	return {
		"yaw": float(yaw),
		"pitch": float(pitch),
		"valid": True,
	}


def evaluate_pose_gate(pose, strictness=None, resting_pitch=None):
	"""
	Return gate decision for blink credit.

	- extreme yaw (near profile) → block credit
	- pose_weight from pitch_delta (Stage 3.3); look_down = weight > 0
	- threshold/velocity mults lerp frontal → look-down endpoints
	"""
	profile = get_pose_profile(strictness)
	if not pose or not pose.get("valid", False):
		return {
			"allow_credit": True,
			"look_down": False,
			"extreme_yaw": False,
			"pose_weight": 0.0,
			"threshold_mult": 1.0,
			"velocity_mult": 1.0,
			"recovery_threshold": BLINK_RECOVERY_DEFAULT,
			"yaw": 0.0,
			"pitch": 0.0,
			"pitch_delta": 0.0,
			"profile": profile,
		}

	yaw = float(pose.get("yaw", 0.0))
	pitch = float(pose.get("pitch", 0.0))
	extreme_yaw = abs(yaw) >= profile["yaw_extreme"]

	if resting_pitch is None:
		# No resting estimate yet — do not treat webcam bias as look-down.
		pitch_delta = 0.0
	else:
		pitch_delta = pitch - float(resting_pitch)

	weight = pose_weight(
		pitch_delta, profile, extreme_yaw=extreme_yaw
	)
	look_down = weight > 0.0

	threshold_mult = lerp(1.0, profile["look_down_threshold_mult"], weight)
	velocity_mult = lerp(1.0, profile["look_down_velocity_mult"], weight)
	# Frontal reopen uses BLINK_RECOVERY_DEFAULT. Look-down credit reopen is
	# LOOK_DOWN_CREDIT_RECOVERY_RATIO in BlinkDetectionState (not this field).
	recovery_threshold = BLINK_RECOVERY_DEFAULT

	return {
		"allow_credit": not extreme_yaw,
		"look_down": look_down,
		"extreme_yaw": extreme_yaw,
		"pose_weight": weight,
		"threshold_mult": threshold_mult,
		"velocity_mult": velocity_mult,
		"recovery_threshold": recovery_threshold,
		"yaw": yaw,
		"pitch": pitch,
		"pitch_delta": pitch_delta,
		"profile": profile,
	}


def face_bbox_area(face):
	"""Area of a dlib rectangle (or duck-typed width/height object)."""
	try:
		return max(0, int(face.width()) * int(face.height()))
	except Exception:
		return 0


def interocular_distance_px(landmarks):
	"""Horizontal eye-center distance in pixels; 0 if landmarks invalid."""
	if landmarks is None or len(landmarks) < 48:
		return 0.0
	left_eye = _mean_xy(landmarks, 36, 42)
	right_eye = _mean_xy(landmarks, 42, 48)
	return abs(right_eye[0] - left_eye[0])


def select_largest_face(faces):
	"""Pick the largest face bbox; None if empty."""
	if not faces:
		return None
	best = None
	best_area = -1
	for face in faces:
		area = face_bbox_area(face)
		if area > best_area:
			best_area = area
			best = face
	return best


# Small HOG hits glued to the frame edge are clutter (laundry, bags), not
# the user. Close-up faces that fill the frame may touch edges — those have
# a large area fraction and still pass.
FACE_EDGE_BORDER_PX = 3
FACE_EDGE_MIN_AREA_FRAC = 0.12
# Centered ~44px HOG hits on an eye/eyebrow (Fifine upsample=1) are not a
# face. 0.18 of 640px ≈ 115px also killed a real C930e desk face after a
# short lean-back (working boxes were ~19% of frame; chair ≈14–16%).
# 0.12 of 480 ≈ 58px still rejects 44px / 53px eyes; 90px zip-8190 passes.
MIN_FACE_WIDTH_FRAC = 0.12
# Close-up clip: bbox fills most of the frame — landmarks drift to hair/forehead.
MAX_FACE_AREA_FRAC = 0.55


def landmark_fail_face_status(reason):
	"""Map landmark gate reason → wire faceStatus for UI hints."""
	if reason == "pitch_up":
		return "head_too_high"
	if reason == "pitch_down":
		return "head_too_low"
	return "unreliable_landmarks"


def face_area_fraction(face, frame_w, frame_h):
	"""Face bbox area as a fraction of the frame (0 if invalid)."""
	if face is None or frame_w <= 0 or frame_h <= 0:
		return 0.0
	frame_area = int(frame_w) * int(frame_h)
	if frame_area <= 0:
		return 0.0
	return face_bbox_area(face) / float(frame_area)


def is_face_too_close(face, frame_w, frame_h):
	"""True when the user is so close the face box dominates the frame."""
	return face_area_fraction(face, frame_w, frame_h) > MAX_FACE_AREA_FRAC


def face_bbox_plausible(face, frame_w, frame_h):
	"""
	True if this bbox can be the user.

	Rejects small detections flush against a frame edge (HOG FP on laundry
	when the real face is covered) and centered micro-boxes (eye-as-face).
	Those are miss / face_none, not too_far. Large close-up faces that clip
	the border still pass.
	"""
	if face is None or frame_w <= 0 or frame_h <= 0:
		return False
	try:
		left = int(face.left())
		top = int(face.top())
		right = int(face.right())
		bottom = int(face.bottom())
		box_w = int(face.width())
	except Exception:
		return False
	if box_w < int(MIN_FACE_WIDTH_FRAC * int(frame_w)):
		return False
	area = face_bbox_area(face)
	frame_area = int(frame_w) * int(frame_h)
	if frame_area <= 0 or area <= 0:
		return False
	frac = area / float(frame_area)
	touches_edge = (
		left <= FACE_EDGE_BORDER_PX
		or top <= FACE_EDGE_BORDER_PX
		or right >= int(frame_w) - FACE_EDGE_BORDER_PX
		or bottom >= int(frame_h) - FACE_EDGE_BORDER_PX
	)
	if touches_edge and frac < FACE_EDGE_MIN_AREA_FRAC:
		return False
	return True
