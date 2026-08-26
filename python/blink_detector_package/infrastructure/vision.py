import base64

import cv2
import dlib
import numpy as np

from blink_detector_package.domain.pose import face_bbox_plausible

# Preview JPEG — keep light; dark rooms + 640 encode were ~halfing loop FPS
# (POG 2026-08-09: target 20 → measured ~10 with send_video).
ENCODE_JPEG_QUALITY = 50
PREVIEW_MAX_WIDTH = 480
ENCODE_PARAMS = [cv2.IMWRITE_JPEG_QUALITY, ENCODE_JPEG_QUALITY]

# L2-A: local CLAHE before shape_predictor (default HOG path stays raw gray).
# Parked off: eye-ROI chase shook dots; face-rect still hurt Phase 0 when the
# face patch was darker than the room (POG 2026-08-09 start_to_complete≈0.32).
# Keep helpers for a future dark-only A/B — do not enable with gate retunes.
CLAHE_ENABLED = False
CLAHE_CLIP_LIMIT = 1.5
CLAHE_TILE_SIZE = (8, 8)
FACE_ROI_PAD_RATIO = 0.05
CLAHE_MAX_FACE_LUMA = 55.0
CLAHE_BLEND = 0.35

# Miss-only full-frame CLAHE for HOG retry (side light / Fifine face_none).
# Separate from landmark CLAHE_ENABLED — never applied to shape_predictor here.
HOG_DETECT_CLAHE_CLIP = 2.0
HOG_DETECT_CLAHE_TILE = (8, 8)
# dlib HOG default is 0.0; weak scores are almost always clutter FPs
# (laundry, fabric) once the real face is gone. Side-light misses still
# retry via CLAHE/upsample — this only drops low-confidence hits.
HOG_MIN_SCORE = 0.30

# YuNet locates a real face (anti eye-as-face / side-light miss).
# shape_predictor_68 is trained on dlib HOG boxes — prefer HOG-refine inside
# that ROI. If refine misses on a plausible YuNet box, use the YuNet rect
# (bright/side-light C170) rather than dropping the face. Do not fall
# through to full-frame HOG on a YuNet hit (eye-as-face). Score in
# models.load_yunet.
YUNET_PAD_X = 0.05
YUNET_PAD_Y = 0.05
HOG_REFINE_PAD = 0.35
HOG_REFINE_MIN_IOU = 0.25
# C170 daylight: mean luma ≥~90 → HOG/YuNet miss on a valid preview.
# Locate-only (never the 68-pt gray): LAB-CLAHE BGR retry + highlight compress.
HIGHLIGHT_COMPRESS_LUMA = 90.0
HIGHLIGHT_COMPRESS_ALPHA = 0.70
DETECT_STAT_NAMES = (
	"yunet_hit",
	"yunet_enhanced_hit",
	"hog_refine_miss",
	"yunet_crop",
	"hog_full_hit",
)
FACE_RETRY_LOG_KINDS = frozenset(
	("clahe", "upsample", "compress", "yunet")
)
# Box hold swallows detector px noise so the HOG crop (and thus 68-pt)
# does not jitter. Keep tight so look-down can still move the crop.
FACE_BOX_HOLD_IOU = 0.93
FACE_BOX_HOLD_CENTER_PX = 2.5
FACE_BOX_EMA_NEW = 0.25
FACE_BOX_SNAP_IOU = 0.45

# Stage 3.1: upscale padded face ROI before shape_predictor for sub-pixel EAR.
# 1 = disabled (integer path); 2 = default; 3 only if FPS budget allows.
LANDMARK_ROI_UPSCALE = 2
LANDMARK_ROI_PAD_RATIO = 0.08

# Stage 3.5: intensity aperture as 2nd closedness channel (confirm on credit).
# False → callers get None (3.4 FSM-only behaviour).
INTENSITY_APERTURE_ENABLED = True
APERTURE_MIN_CROP_W = 8
APERTURE_MIN_CROP_H = 6
APERTURE_PAD_RATIO = 0.20
APERTURE_SCANLINES = 5
APERTURE_X_LO = 0.15
APERTURE_X_HI = 0.85

# Stage 7: OCEC confirm (2nd closedness, credit only). Corpus join A/B + live
# soak held 2026-08-14. Revert only if JSONL storms / clipped blinks return.
# Not a detector_backend — landmarks stay dlib 68-pt.
OCEC_ENABLED = True
OCEC_PAD_RATIO = 0.35
OCEC_MIN_CROP_W = 8
OCEC_MIN_CROP_H = 6


def get_landmark_roi_upscale() -> int:
	return int(LANDMARK_ROI_UPSCALE)


def set_landmark_roi_upscale(scale: int) -> int:
	"""Set ROI upscale factor (≥1). Returns the applied value."""
	global LANDMARK_ROI_UPSCALE
	try:
		value = int(scale)
	except (TypeError, ValueError):
		value = 1
	LANDMARK_ROI_UPSCALE = max(1, value)
	return LANDMARK_ROI_UPSCALE


def get_intensity_aperture_enabled() -> bool:
	return bool(INTENSITY_APERTURE_ENABLED)


def set_intensity_aperture_enabled(enabled: bool) -> bool:
	"""Enable/disable Stage 3.5 aperture. Returns applied value."""
	global INTENSITY_APERTURE_ENABLED
	INTENSITY_APERTURE_ENABLED = bool(enabled)
	return INTENSITY_APERTURE_ENABLED


def get_ocec_enabled() -> bool:
	return bool(OCEC_ENABLED)


def set_ocec_enabled(enabled: bool) -> bool:
	"""Enable/disable Stage 7 OCEC scoring. Returns applied value."""
	global OCEC_ENABLED
	OCEC_ENABLED = bool(enabled)
	return OCEC_ENABLED


def crop_eye_bgr(image, eye_pts, pad_ratio=OCEC_PAD_RATIO):
	"""
	Padded 6-pt eye crop for OCEC (BGR or gray→BGR).

	Returns a small uint8 HxWx3 crop, or None when the box is unusable.
	"""
	if image is None or eye_pts is None:
		return None
	pts = np.asarray(eye_pts, dtype=np.float64)
	if pts.shape != (6, 2):
		return None
	xs = pts[:, 0]
	ys = pts[:, 1]
	eye_width = float(xs.max() - xs.min())
	if eye_width < 4.0:
		return None
	pad = eye_width * float(pad_ratio)
	x0 = int(np.floor(xs.min() - pad))
	y0 = int(np.floor(ys.min() - pad))
	x1 = int(np.ceil(xs.max() + pad))
	y1 = int(np.ceil(ys.max() + pad))
	h_img, w_img = image.shape[:2]
	x0, y0, x1, y1 = _clamp_roi(x0, y0, x1, y1, w_img, h_img)
	if (x1 - x0) < OCEC_MIN_CROP_W or (y1 - y0) < OCEC_MIN_CROP_H:
		return None
	crop = image[y0:y1, x0:x1]
	if crop.size == 0:
		return None
	if crop.ndim == 2:
		return cv2.cvtColor(crop, cv2.COLOR_GRAY2BGR)
	if crop.ndim == 3 and crop.shape[2] >= 3:
		return crop[:, :, :3]
	return None


def eye_intensity_aperture(gray, eye_pts):
	"""
	Lid aperture from vertical intensity gradients in a 6-pt eye crop.

	Returns mean open height / eye_width (EAR-like scale), or None when the
	crop is unusable / feature disabled. Does not use mean-luma (look-down
	darkens iris without blinking).
	"""
	if not INTENSITY_APERTURE_ENABLED:
		return None
	if gray is None or eye_pts is None:
		return None
	pts = np.asarray(eye_pts, dtype=np.float64)
	if pts.shape != (6, 2):
		return None

	xs = pts[:, 0]
	ys = pts[:, 1]
	eye_width = float(xs.max() - xs.min())
	if eye_width < 4.0:
		return None

	pad = eye_width * APERTURE_PAD_RATIO
	x0 = int(np.floor(xs.min() - pad))
	y0 = int(np.floor(ys.min() - pad))
	x1 = int(np.ceil(xs.max() + pad))
	y1 = int(np.ceil(ys.max() + pad))
	h_img, w_img = gray.shape[:2]
	x0, y0, x1, y1 = _clamp_roi(x0, y0, x1, y1, w_img, h_img)
	crop_w = x1 - x0
	crop_h = y1 - y0
	if crop_w < APERTURE_MIN_CROP_W or crop_h < APERTURE_MIN_CROP_H:
		return None

	# dlib eye order: 0 outer, 1–2 upper, 3 inner, 4–5 lower (inner→outer).
	outer = pts[0]
	inner = pts[3]
	upper_a, upper_b = pts[1], pts[2]
	lower_a, lower_b = pts[5], pts[4]

	heights: list[float] = []
	n = max(2, int(APERTURE_SCANLINES))
	for i in range(n):
		u = APERTURE_X_LO + (APERTURE_X_HI - APERTURE_X_LO) * (
			i / (n - 1)
		)
		px = outer[0] + u * (inner[0] - outer[0])
		py_u = upper_a[1] + u * (upper_b[1] - upper_a[1])
		py_l = lower_a[1] + u * (lower_b[1] - lower_a[1])
		if py_l <= py_u + 1.0:
			heights.append(0.0)
			continue

		cx = int(round(px))
		if cx < x0 or cx >= x1:
			continue
		# Search a little outside landmark lids for intensity edges.
		margin = max(1.0, 0.15 * (py_l - py_u))
		yt = int(np.floor(py_u - margin))
		yb = int(np.ceil(py_l + margin))
		yt = max(y0, min(yt, y1 - 2))
		yb = max(yt + 2, min(yb, y1))
		col = gray[yt:yb, cx].astype(np.float64)
		if col.size < 3:
			continue
		grad = np.abs(np.gradient(col))
		n_band = max(1, col.size // 3)
		top_i = int(np.argmax(grad[: max(n_band, 1)]))
		bot_slice = grad[-n_band:]
		bot_i = col.size - n_band + int(np.argmax(bot_slice))
		if bot_i <= top_i:
			# Closed / flat: fall back to landmark span (often ~0–2 px).
			heights.append(max(0.0, py_l - py_u))
			continue
		heights.append(float(bot_i - top_i))

	if not heights:
		return None
	return float(sum(heights) / len(heights)) / eye_width


class PreallocatedBuffers:
	def __init__(self, max_points=68):
		# float32 so Stage-3 ROI upscale can keep sub-pixel landmark coords.
		self.landmarks_array = np.zeros((max_points, 2), dtype=np.float32)
		self.left_eye = np.zeros((6, 2), dtype=np.float32)
		self.right_eye = np.zeros((6, 2), dtype=np.float32)
		self.temp_frame = None
		self.ear_diffs = np.zeros((3, 2), dtype=np.float32)
		self.ear_distances = np.zeros(3, dtype=np.float32)
		self.concatenated_eyes = np.zeros((12, 2), dtype=np.float32)
		self.normalized_landmarks = [
			{"x": 0.0, "y": 0.0} for _ in range(12)
		]
		self.clahe_roi_count = 0
		self._clahe = None
		self._hog_detect_clahe = None
		self._upscale_patch = None
		self.last_yunet_rect = None
		self.last_yunet_keypoints = None
		self.last_refine_kind = None
		self.yunet_input_size = None
		self.reset_detect_stats()

	def reset_detect_stats(self):
		"""Per-call locate counters for camera_health (C170 triage)."""
		for name in DETECT_STAT_NAMES:
			setattr(self, f"stat_{name}", 0)

	def bump_detect_stat(self, name):
		attr = f"stat_{name}"
		setattr(self, attr, int(getattr(self, attr, 0)) + 1)

	def clear_landmark_track(self):
		"""Kept for detector face-loss calls; landmarks are not temporally held."""
		return

	def clahe(self):
		if self._clahe is None:
			self._clahe = cv2.createCLAHE(
				clipLimit=CLAHE_CLIP_LIMIT,
				tileGridSize=CLAHE_TILE_SIZE,
			)
		return self._clahe

	def hog_detect_clahe(self):
		"""Milder full-frame CLAHE used only on HOG miss retry."""
		if self._hog_detect_clahe is None:
			self._hog_detect_clahe = cv2.createCLAHE(
				clipLimit=HOG_DETECT_CLAHE_CLIP,
				tileGridSize=HOG_DETECT_CLAHE_TILE,
			)
		return self._hog_detect_clahe


def _clamp_roi(x0, y0, x1, y1, width, height):
	x0 = max(0, min(int(x0), width - 1))
	y0 = max(0, min(int(y0), height - 1))
	x1 = max(x0 + 1, min(int(x1), width))
	y1 = max(y0 + 1, min(int(y1), height))
	return x0, y0, x1, y1


def roi_from_face(face, frame_shape, pad_ratio=FACE_ROI_PAD_RATIO):
	"""Padded face rect — stable ROI from HOG (not landmark-chasing)."""
	if face is None:
		return None
	height, width = frame_shape[:2]
	pad_x = face.width() * pad_ratio
	pad_y = face.height() * pad_ratio
	return _clamp_roi(
		face.left() - pad_x,
		face.top() - pad_y,
		face.right() + pad_x,
		face.bottom() + pad_y,
		width,
		height,
	)


def _ensure_temp_gray(buffers, gray):
	"""Copy gray into buffers.temp_frame (reuse allocation when shape matches)."""
	if (
		buffers.temp_frame is None
		or buffers.temp_frame.shape != gray.shape
		or buffers.temp_frame.dtype != gray.dtype
	):
		buffers.temp_frame = np.empty_like(gray)
	np.copyto(buffers.temp_frame, gray)
	return buffers.temp_frame


def apply_clahe_roi_blended(gray_out, gray_src, roi, clahe, blend=CLAHE_BLEND):
	"""CLAHE face patch, blend with raw, paste into gray_out. Returns 1 or 0."""
	if roi is None:
		return 0
	x0, y0, x1, y1 = roi
	patch = gray_src[y0:y1, x0:x1]
	if patch.size < 64:
		return 0
	enhanced = clahe.apply(patch)
	alpha = max(0.0, min(1.0, float(blend)))
	if alpha >= 1.0 - 1e-6:
		gray_out[y0:y1, x0:x1] = enhanced
	elif alpha <= 1e-6:
		return 0
	else:
		mixed = cv2.addWeighted(enhanced, alpha, patch, 1.0 - alpha, 0.0)
		gray_out[y0:y1, x0:x1] = mixed
	return 1


def _mean_u8(gray) -> float:
	if gray is None or getattr(gray, "size", 0) == 0:
		return 0.0
	return float(np.mean(gray))


def compress_highlights(gray, alpha=HIGHLIGHT_COMPRESS_ALPHA):
	"""Darken a bright gray for locate retry. Not used by the predictor."""
	if gray is None or gray.size < 64:
		return None
	try:
		return cv2.convertScaleAbs(gray, alpha=float(alpha), beta=0)
	except Exception:
		return None


def enhance_bgr_for_detect(bgr, buffers=None):
	"""LAB-CLAHE on L — YuNet miss retry for side light / blown highlights."""
	if bgr is None or getattr(bgr, "ndim", 0) != 3 or bgr.size < 64:
		return None
	try:
		lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)
		light, a_ch, b_ch = cv2.split(lab)
		if buffers is not None:
			clahe = buffers.hog_detect_clahe()
		else:
			clahe = cv2.createCLAHE(
				clipLimit=HOG_DETECT_CLAHE_CLIP,
				tileGridSize=HOG_DETECT_CLAHE_TILE,
			)
		light = clahe.apply(light)
		return cv2.cvtColor(
			cv2.merge((light, a_ch, b_ch)), cv2.COLOR_LAB2BGR
		)
	except Exception:
		return None


def _bump_detect_stat(buffers, name):
	if buffers is not None:
		buffers.bump_detect_stat(name)


def _remember_yunet(buffers, yunet_face, kind, yunet_keypoints=None):
	if buffers is None:
		return
	buffers.last_yunet_rect = yunet_face
	buffers.last_refine_kind = kind
	if yunet_keypoints is not None:
		buffers.last_yunet_keypoints = yunet_keypoints


def yunet_row_to_keypoints(row):
	"""Five YuNet facial keypoints in pixel coords (right eye, left eye, nose)."""
	try:
		return {
			"right_eye": (float(row[4]), float(row[5])),
			"left_eye": (float(row[6]), float(row[7])),
			"nose": (float(row[8]), float(row[9])),
		}
	except (TypeError, ValueError, IndexError):
		return None


def _rect_matches(a, b):
	if a is None or b is None:
		return False
	try:
		return (
			int(a.left()) == int(b.left())
			and int(a.top()) == int(b.top())
			and int(a.width()) == int(b.width())
			and int(a.height()) == int(b.height())
		)
	except (TypeError, ValueError, AttributeError):
		return False


def _select_plausible_yunet_face(faces, gray, select_largest):
	"""Largest plausible YuNet row as (dlib.rectangle, keypoints dict)."""
	if faces is None:
		return None, None
	try:
		rows = list(faces)
	except TypeError:
		return None, None
	if not rows:
		return None, None
	if gray is None or gray.size == 0:
		height, width = 480, 640
	else:
		height, width = gray.shape[:2]
	candidates = []
	for row in rows:
		rect = yunet_row_to_rect(row, width, height)
		if rect is None:
			continue
		if gray is not None and gray.size > 0:
			if not face_bbox_plausible(rect, width, height):
				continue
		kps = yunet_row_to_keypoints(row)
		candidates.append((rect, kps))
	if not candidates:
		return None, None
	rects = [rect for rect, _kps in candidates]
	best_rect = select_largest(rects)
	if best_rect is None:
		return None, None
	for rect, kps in candidates:
		if _rect_matches(rect, best_rect):
			return rect, kps
	return candidates[0]


def fit_processing_size(native_wh, preset_wh):
	"""Largest size inside the quality preset that keeps native aspect.

	C170 MSMF is 640×360; High/Ultra preset is 640×480. Stretching 16:9
	into 4:3 warps faces and YuNet/HOG miss in daylight. Fit, don't stretch.
	"""
	try:
		nw = int(native_wh[0])
		nh = int(native_wh[1])
		pw = int(preset_wh[0])
		ph = int(preset_wh[1])
	except (TypeError, ValueError, IndexError):
		try:
			return (int(preset_wh[0]), int(preset_wh[1]))
		except (TypeError, ValueError, IndexError):
			return (320, 240)
	if nw < 2 or nh < 2:
		return (max(2, pw), max(2, ph))
	if pw < 2 or ph < 2:
		return (nw, nh)
	scale = min(pw / float(nw), ph / float(nh))
	width = max(2, int(round(nw * scale)))
	height = max(2, int(round(nh * scale)))
	return (width, height)


def resize_to_processing(frame, preset_wh):
	"""Software resize that preserves aspect (quality preset is a cap)."""
	if frame is None or getattr(frame, "size", 0) == 0:
		return frame
	try:
		native_wh = (int(frame.shape[1]), int(frame.shape[0]))
	except (TypeError, AttributeError, ValueError, IndexError):
		return frame
	target = fit_processing_size(native_wh, preset_wh)
	if native_wh == target:
		return frame
	interp = (
		cv2.INTER_AREA
		if target[0] * target[1] < native_wh[0] * native_wh[1]
		else cv2.INTER_LINEAR
	)
	return cv2.resize(frame, target, interpolation=interp)


def prepare_hog_detect_gray(gray, buffers):
	"""
	Full-frame mild CLAHE for HOG miss retry only.

	Returns enhanced gray (buffers.temp_frame) or None if gray is unusable.
	Does not depend on CLAHE_ENABLED (landmark path stays parked).
	"""
	if gray is None or buffers is None:
		return None
	if gray.size < 64:
		return None
	applied = buffers.hog_detect_clahe().apply(gray)
	return _ensure_temp_gray(buffers, applied)


def hog_detect_rects(detector, gray, upsample, min_score=HOG_MIN_SCORE):
	"""
	Run HOG and drop weak scores when detector.run is available.

	Callables without .run (unit fakes) keep every rectangle.
	"""
	run = getattr(detector, "run", None)
	if callable(run):
		try:
			result = run(gray, upsample, 0.0)
		except TypeError:
			result = None
		if result is not None and len(result) >= 2:
			rects, scores = result[0], result[1]
			kept = []
			for rect, score in zip(rects, scores):
				try:
					if float(score) >= min_score:
						kept.append(rect)
				except (TypeError, ValueError):
					kept.append(rect)
			return kept
	faces = detector(gray, upsample)
	if not faces:
		return []
	return list(faces)


def _select_plausible_face(faces, gray, select_largest):
	if gray is None or gray.size == 0:
		return select_largest(faces)
	height, width = gray.shape[:2]
	kept = [face for face in faces if face_bbox_plausible(face, width, height)]
	return select_largest(kept)


def _hog_plausible(detector, search_gray, frame_gray, select_largest, upsample=0):
	faces = hog_detect_rects(detector, search_gray, upsample)
	return _select_plausible_face(faces, frame_gray, select_largest)


def _hog_compress_retry(detector, search_gray, frame_gray, select_largest):
	if _mean_u8(search_gray) < HIGHLIGHT_COMPRESS_LUMA:
		return None
	compressed = compress_highlights(search_gray)
	if compressed is None:
		return None
	return _hog_plausible(detector, compressed, frame_gray, select_largest)


def run_hog_face_detect(detector, gray, select_largest, buffers=None):
	"""
	HOG face detect with miss-only retries.

	Order: raw upsample=0 → full-frame CLAHE upsample=0 → highlight
	compress (bright frames) → raw upsample=1.
	Drops weak HOG scores and small edge-glued boxes (clutter FPs).
	Returns (face_or_None, retry_kind) where retry_kind is
	None|"clahe"|"compress"|"upsample".
	"""
	face = _hog_plausible(detector, gray, gray, select_largest, 0)
	if face is not None:
		return face, None

	enhanced = prepare_hog_detect_gray(gray, buffers)
	if enhanced is not None:
		face = _hog_plausible(detector, enhanced, gray, select_largest, 0)
		if face is not None:
			return face, "clahe"

	face = _hog_compress_retry(detector, gray, gray, select_largest)
	if face is not None:
		return face, "compress"

	face = _hog_plausible(detector, gray, gray, select_largest, 1)
	if face is not None:
		return face, "upsample"
	return None, None


def _offset_rect(rect, dx, dy):
	return dlib.rectangle(
		int(rect.left() + dx),
		int(rect.top() + dy),
		int(rect.right() + dx),
		int(rect.bottom() + dy),
	)


def hog_refine_yunet_box(detector, gray, yunet_rect, select_largest, buffers=None):
	"""HOG inside an expanded YuNet ROI — native dlib crop for 68-pt."""
	if detector is None or gray is None or yunet_rect is None:
		return None, None
	try:
		height, width = gray.shape[:2]
	except (TypeError, AttributeError, ValueError):
		return None, None
	box = pad_xywh_to_box(
		yunet_rect.left(),
		yunet_rect.top(),
		yunet_rect.width(),
		yunet_rect.height(),
		width,
		height,
		pad_x=HOG_REFINE_PAD,
		pad_y=HOG_REFINE_PAD,
	)
	if box is None:
		return None, None
	x0, y0, x1, y1 = box
	roi = gray[y0:y1, x0:x1]
	if roi.size < 64:
		return None, None
	yunet_box = _ltrb(yunet_rect)

	def _pick(roi_gray, upsample):
		faces = hog_detect_rects(detector, roi_gray, upsample)
		mapped = [_offset_rect(face, x0, y0) for face in faces]
		overlapping = [
			face
			for face in mapped
			if box_iou(_ltrb(face), yunet_box) >= HOG_REFINE_MIN_IOU
		]
		return _select_plausible_face(overlapping, gray, select_largest)

	face = _pick(roi, 0)
	if face is not None:
		return face, None
	if buffers is not None:
		try:
			enhanced = buffers.hog_detect_clahe().apply(roi)
		except Exception:
			enhanced = None
		if enhanced is not None:
			face = _pick(enhanced, 0)
			if face is not None:
				return face, "clahe"
	if _mean_u8(roi) >= HIGHLIGHT_COMPRESS_LUMA:
		compressed = compress_highlights(roi)
		if compressed is not None:
			face = _pick(compressed, 0)
			if face is not None:
				return face, "compress"
	# No upsample=1 here: YuNet already sized a real face. Pyramid on the
	# ROI was extra cost and the old eye-as-face vector. Full-frame
	# upsample stays on the YuNet-miss path only.
	return None, None


def pad_xywh_to_box(x, y, w, h, frame_w, frame_h, pad_x=YUNET_PAD_X, pad_y=YUNET_PAD_Y):
	"""Expand a detection box and clamp to the frame. Returns (l, t, r, b)."""
	try:
		width = int(frame_w)
		height = int(frame_h)
		box_w = float(w)
		box_h = float(h)
		px = box_w * float(pad_x)
		py = box_h * float(pad_y)
		left = int(round(float(x) - px))
		top = int(round(float(y) - py))
		right = int(round(float(x) + box_w + px))
		bottom = int(round(float(y) + box_h + py))
	except (TypeError, ValueError):
		return None
	if width < 2 or height < 2:
		return None
	left = max(0, min(left, width - 2))
	top = max(0, min(top, height - 2))
	right = max(left + 1, min(right, width - 1))
	bottom = max(top + 1, min(bottom, height - 1))
	return left, top, right, bottom


def yunet_row_to_rect(row, frame_w, frame_h):
	"""dlib.rectangle from one FaceDetectorYN row (xywh + small pad)."""
	try:
		x, y, w, h = row[0], row[1], row[2], row[3]
	except (TypeError, ValueError, IndexError):
		return None
	box = pad_xywh_to_box(x, y, w, h, frame_w, frame_h)
	return _rect_from_box(box)


def _rect_from_box(box):
	if box is None:
		return None
	left, top, right, bottom = box
	return dlib.rectangle(int(left), int(top), int(right), int(bottom))


def _ltrb(face):
	try:
		return (
			float(face.left()),
			float(face.top()),
			float(face.right()),
			float(face.bottom()),
		)
	except (TypeError, ValueError, AttributeError):
		return None


def box_iou(a, b):
	"""IoU of two (l, t, r, b) boxes. 0 if either is invalid."""
	if a is None or b is None:
		return 0.0
	al, at, ar, ab = a
	bl, bt, br, bb = b
	iw = min(ar, br) - max(al, bl)
	ih = min(ab, bb) - max(at, bt)
	if iw <= 0 or ih <= 0:
		return 0.0
	inter = iw * ih
	area_a = max(0.0, ar - al) * max(0.0, ab - at)
	area_b = max(0.0, br - bl) * max(0.0, bb - bt)
	union = area_a + area_b - inter
	if union <= 0:
		return 0.0
	return inter / union


def _rects_nearly_same(prev, new):
	"""True when two boxes are within the face-box hold (jitter, not a move)."""
	if prev is None or new is None:
		return False
	prev_box = _ltrb(prev)
	new_box = _ltrb(new)
	if prev_box is None or new_box is None:
		return False
	iou = box_iou(prev_box, new_box)
	pcx = (prev_box[0] + prev_box[2]) * 0.5
	pcy = (prev_box[1] + prev_box[3]) * 0.5
	ncx = (new_box[0] + new_box[2]) * 0.5
	ncy = (new_box[1] + new_box[3]) * 0.5
	center_dist = ((ncx - pcx) ** 2 + (ncy - pcy) ** 2) ** 0.5
	return iou >= FACE_BOX_HOLD_IOU and center_dist <= FACE_BOX_HOLD_CENTER_PX


def stabilize_face_rect(prev, new):
	"""
	Hold/EMA a detection box so detector pixel jitter does not shake EAR.

	Nearly-identical boxes keep `prev` (integer-stable for the predictor).
	Moderate overlap EMA-blends. Low IoU snaps to `new` (re-acquire / turn).
	"""
	if new is None:
		return None
	if prev is None:
		return new
	if _rects_nearly_same(prev, new):
		return prev
	prev_box = _ltrb(prev)
	new_box = _ltrb(new)
	if prev_box is None or new_box is None:
		return new
	iou = box_iou(prev_box, new_box)
	if iou < FACE_BOX_SNAP_IOU:
		return new
	alpha = FACE_BOX_EMA_NEW
	blended = tuple(
		(1.0 - alpha) * p + alpha * n for p, n in zip(prev_box, new_box)
	)
	rect = _rect_from_box(blended)
	return rect if rect is not None else new


def yunet_faces_to_hits(faces, frame_w, frame_h):
	"""List of dlib.rectangles from FaceDetectorYN rows."""
	if faces is None:
		return []
	try:
		rows = list(faces)
	except TypeError:
		return []
	rects = []
	for row in rows:
		rect = yunet_row_to_rect(row, frame_w, frame_h)
		if rect is not None:
			rects.append(rect)
	return rects


def yunet_faces_to_rects(faces, frame_w, frame_h):
	"""Convert FaceDetectorYN rows to lightly padded rectangles."""
	return yunet_faces_to_hits(faces, frame_w, frame_h)


def run_yunet_face_detect(yunet, bgr, select_largest, buffers=None):
	"""
	YuNet on BGR. Returns (face_or_None, input_size_or_None).

	input_size is (width, height) last passed to setInputSize — tests assert it.
	"""
	if yunet is None or bgr is None:
		return None, None
	try:
		height, width = bgr.shape[:2]
	except (TypeError, AttributeError, ValueError):
		return None, None
	if width < 2 or height < 2:
		return None, None
	size = (int(width), int(height))
	try:
		prev_size = getattr(buffers, "yunet_input_size", None) if buffers is not None else None
		if prev_size != size:
			yunet.setInputSize(size)
			if buffers is not None:
				buffers.yunet_input_size = size
		_retval, faces = yunet.detect(bgr)
	except Exception:
		return None, size
	face, keypoints = _select_plausible_yunet_face(faces, bgr, select_largest)
	if buffers is not None:
		if face is not None:
			buffers.last_yunet_keypoints = keypoints
		else:
			buffers.last_yunet_keypoints = None
	return face, size


def run_face_detect(
	detector,
	gray,
	select_largest,
	buffers=None,
	bgr=None,
	yunet=None,
	prev_face=None,
	heavy_retries=True,
):
	"""
	YuNet locates; HOG-refine supplies the 68-pt crop when it can.

	If YuNet hits, HOG runs inside that ROI unless the YuNet box has not
	moved since the last successful refine (reuse prev_face). Prefer the
	HOG rect for the predictor. YuNet+HOG-miss on a plausible box uses
	the YuNet rect (`kind="yunet"`) — do not fall through to full-frame
	HOG (eye-as-face). Raw YuNet miss retries LAB-CLAHE BGR.

	Idle miss (`heavy_retries=False`) with YuNet present stops after that
	locate (+ LAB-CLAHE retry) — skip the full-frame HOG pyramid. Burst
	re-acquire, hog-only (no YuNet), and default callers keep the miss
	chain (CLAHE / compress / upsample=1). Size gate still applies.
	Returns (face_or_None, kind) where kind is
	"hog"|"clahe"|"compress"|"upsample"|"yunet"|None.
	"""
	if buffers is not None:
		buffers.reset_detect_stats()
	if yunet is not None and bgr is not None:
		yunet_face, _size = run_yunet_face_detect(
			yunet, bgr, select_largest, buffers=buffers
		)
		enhanced_hit = False
		if yunet_face is None:
			enhanced = enhance_bgr_for_detect(bgr, buffers)
			if enhanced is not None:
				yunet_face, _size = run_yunet_face_detect(
					yunet, enhanced, select_largest, buffers=buffers
				)
				enhanced_hit = yunet_face is not None
		if yunet_face is not None:
			_bump_detect_stat(buffers, "yunet_hit")
			if enhanced_hit:
				_bump_detect_stat(buffers, "yunet_enhanced_hit")
			last_yunet = (
				getattr(buffers, "last_yunet_rect", None)
				if buffers is not None
				else None
			)
			if prev_face is not None and _rects_nearly_same(last_yunet, yunet_face):
				held_kind = getattr(buffers, "last_refine_kind", None) or "hog"
				return prev_face, held_kind
			hog_face, hog_kind = hog_refine_yunet_box(
				detector,
				gray,
				yunet_face,
				select_largest,
				buffers,
			)
			if hog_face is not None:
				_remember_yunet(
					buffers,
					yunet_face,
					hog_kind or "hog",
					getattr(buffers, "last_yunet_keypoints", None),
				)
				return hog_face, hog_kind or "hog"
			_bump_detect_stat(buffers, "hog_refine_miss")
			_bump_detect_stat(buffers, "yunet_crop")
			_remember_yunet(
				buffers,
				yunet_face,
				"yunet",
				getattr(buffers, "last_yunet_keypoints", None),
			)
			return yunet_face, "yunet"
		if buffers is not None:
			buffers.last_yunet_rect = None
			buffers.last_yunet_keypoints = None
			buffers.last_refine_kind = None
		if not heavy_retries:
			return None, None
	face, kind = run_hog_face_detect(detector, gray, select_largest, buffers)
	if face is not None:
		_bump_detect_stat(buffers, "hog_full_hit")
		if buffers is not None:
			buffers.last_yunet_keypoints = None
	if face is not None and kind is None:
		return face, "hog"
	return face, kind


def prepare_predictor_gray(
	gray,
	face,
	buffers,
	prev_left_eye=None,
	prev_right_eye=None,
):
	"""
	Default HOG uses raw gray (+ miss-only retry elsewhere); predictor may get
	a dark-gated face CLAHE copy when CLAHE_ENABLED.

	prev_* eyes ignored (kept for call-site compat) — eye-ROI CLAHE caused
	landmark feedback shake and bright-room FP credits.
	"""
	del prev_left_eye, prev_right_eye
	buffers.clahe_roi_count = 0
	if gray is None or face is None or not CLAHE_ENABLED:
		return gray, 0

	face_roi = roi_from_face(face, gray.shape)
	if face_roi is None:
		return gray, 0

	x0, y0, x1, y1 = face_roi
	face_patch = gray[y0:y1, x0:x1]
	if face_patch.size < 64:
		return gray, 0
	face_luma = float(np.mean(face_patch))
	if face_luma >= CLAHE_MAX_FACE_LUMA:
		# Bright enough — raw gray is stabler for 68-pt + EAR.
		return gray, 0

	enhanced = _ensure_temp_gray(buffers, gray)
	count = apply_clahe_roi_blended(
		enhanced,
		gray,
		face_roi,
		buffers.clahe(),
		blend=CLAHE_BLEND,
	)
	buffers.clahe_roi_count = count
	return enhanced, count


def _face_rect_in_roi(face, x0, y0, x1, y1, scale):
	"""Map full-frame dlib face rect into an upscaled ROI image."""
	left = int(round((face.left() - x0) * scale))
	top = int(round((face.top() - y0) * scale))
	right = int(round((face.right() - x0) * scale))
	bottom = int(round((face.bottom() - y0) * scale))
	width = max(1, (x1 - x0) * scale)
	height = max(1, (y1 - y0) * scale)
	left = max(0, min(left, width - 2))
	top = max(0, min(top, height - 2))
	right = max(left + 1, min(right, width - 1))
	bottom = max(top + 1, min(bottom, height - 1))
	return dlib.rectangle(left, top, right, bottom)


def _predict_shape_on_gray(predictor, gray_pred, face, buffers, upscale):
	"""
	Run shape_predictor; optionally on an upscaled face ROI.

	Returns (shape, x0, y0, scale) for mapping parts back to frame coords.
	"""
	scale = max(1, int(upscale))
	if scale <= 1:
		return predictor(gray_pred, face), 0.0, 0.0, 1.0

	roi = roi_from_face(face, gray_pred.shape, pad_ratio=LANDMARK_ROI_PAD_RATIO)
	if roi is None:
		return predictor(gray_pred, face), 0.0, 0.0, 1.0

	x0, y0, x1, y1 = roi
	patch = gray_pred[y0:y1, x0:x1]
	if patch.size < 64:
		return predictor(gray_pred, face), 0.0, 0.0, 1.0

	up_w = max(1, int(round((x1 - x0) * scale)))
	up_h = max(1, int(round((y1 - y0) * scale)))
	upscaled = cv2.resize(
		patch,
		(up_w, up_h),
		interpolation=cv2.INTER_CUBIC,
	)
	buffers._upscale_patch = upscaled
	face_roi = _face_rect_in_roi(face, x0, y0, x1, y1, scale)
	shape = predictor(upscaled, face_roi)
	return shape, float(x0), float(y0), float(scale)


def _fill_landmarks_from_shape(shape, buffers, x0, y0, scale, eye_only=False):
	"""Write shape parts into buffers (frame coords, float)."""
	inv = 1.0 / scale
	if eye_only:
		for index in range(6):
			point = shape.part(36 + index)
			buffers.left_eye[index, 0] = point.x * inv + x0
			buffers.left_eye[index, 1] = point.y * inv + y0
			point = shape.part(42 + index)
			buffers.right_eye[index, 0] = point.x * inv + x0
			buffers.right_eye[index, 1] = point.y * inv + y0
		return

	for index in range(68):
		point = shape.part(index)
		buffers.landmarks_array[index, 0] = point.x * inv + x0
		buffers.landmarks_array[index, 1] = point.y * inv + y0
	buffers.left_eye[:, :] = buffers.landmarks_array[36:42]
	buffers.right_eye[:, :] = buffers.landmarks_array[42:48]


def get_eye_landmarks_only(
	predictor,
	gray,
	face,
	buffers,
	prev_left_eye=None,
	prev_right_eye=None,
	upscale=None,
):
	gray_pred, _count = prepare_predictor_gray(
		gray,
		face,
		buffers,
		prev_left_eye=prev_left_eye,
		prev_right_eye=prev_right_eye,
	)
	scale = get_landmark_roi_upscale() if upscale is None else max(1, int(upscale))
	shape, x0, y0, used_scale = _predict_shape_on_gray(
		predictor, gray_pred, face, buffers, scale
	)
	_fill_landmarks_from_shape(
		shape, buffers, x0, y0, used_scale, eye_only=True
	)
	return buffers.left_eye, buffers.right_eye


def get_face_landmarks(
	predictor,
	gray,
	face,
	buffers,
	prev_left_eye=None,
	prev_right_eye=None,
	upscale=None,
):
	"""Fill 68-pt buffer plus eye slices; used for EAR + pose gates."""
	del prev_left_eye, prev_right_eye
	gray_pred, _count = prepare_predictor_gray(
		gray,
		face,
		buffers,
	)
	scale = get_landmark_roi_upscale() if upscale is None else max(1, int(upscale))
	shape, x0, y0, used_scale = _predict_shape_on_gray(
		predictor, gray_pred, face, buffers, scale
	)
	_fill_landmarks_from_shape(shape, buffers, x0, y0, used_scale)
	return buffers.landmarks_array, buffers.left_eye, buffers.right_eye


def prepare_preview_frame(frame, max_width=PREVIEW_MAX_WIDTH):
	"""Downscale wide frames before JPEG so preview encode stays cheap."""
	if frame is None or max_width is None or max_width <= 0:
		return frame
	height, width = frame.shape[:2]
	if width <= max_width:
		return frame
	scale = max_width / float(width)
	new_size = (max_width, max(1, int(round(height * scale))))
	return cv2.resize(frame, new_size, interpolation=cv2.INTER_AREA)


def encode_frame(frame, max_width=PREVIEW_MAX_WIDTH, quality=None):
	preview = prepare_preview_frame(frame, max_width=max_width)
	params = ENCODE_PARAMS
	if quality is not None:
		params = [cv2.IMWRITE_JPEG_QUALITY, int(quality)]
	_, buffer = cv2.imencode(".jpg", preview, params)
	return base64.b64encode(buffer).decode("utf-8")
