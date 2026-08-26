"""Pure blink detection rules and state."""

from .blink_detection import (
	BLINK_DISPLAY_DURATION,
	MIN_FACE_AREA_PX,
	MIN_INTEROCULAR_PX,
	BlinkDetectionState,
	get_adaptive_ear_drop_threshold,
)
from .landmark_trust import (
	LandmarkTrustDebouncer,
	evaluate_landmark_trust,
)
from .pose import (
	DEFAULT_POSE_STRICTNESS,
	MAX_FACE_AREA_FRAC,
	MIN_FACE_WIDTH_FRAC,
	estimate_head_pose_heuristic,
	evaluate_pose_gate,
	face_area_fraction,
	face_bbox_area,
	face_bbox_plausible,
	interocular_distance_px,
	is_face_too_close,
	landmark_fail_face_status,
	select_largest_face,
)

__all__ = [
	"BLINK_DISPLAY_DURATION",
	"BlinkDetectionState",
	"DEFAULT_POSE_STRICTNESS",
	"LandmarkTrustDebouncer",
	"MAX_FACE_AREA_FRAC",
	"MIN_FACE_AREA_PX",
	"MIN_FACE_WIDTH_FRAC",
	"MIN_INTEROCULAR_PX",
	"estimate_head_pose_heuristic",
	"evaluate_landmark_trust",
	"evaluate_pose_gate",
	"face_area_fraction",
	"face_bbox_area",
	"face_bbox_plausible",
	"is_face_too_close",
	"landmark_fail_face_status",
	"get_adaptive_ear_drop_threshold",
	"interocular_distance_px",
	"select_largest_face",
]
