from collections import deque
from statistics import median

from blink_detector_package.domain.classifier import (
	CLASSIFIER_SIDE_YAW_WAIVE,
	score as classifier_score,
)
from blink_detector_package.domain.pose import (
	PITCH_WEIGHT_SPAN,
	evaluate_pose_gate,
	get_pose_profile,
	lerp,
)

BLINK_COOLDOWN = 0.55
# Look-down echo burst after a real blink (POG 2026-08-10: +2–3 @ ~1.2s).
LOOK_DOWN_COOLDOWN = 0.90
BLINK_DISPLAY_DURATION = 0.2
BLINK_MIN_EAR_DROP = 0.19
BLINK_MIN_ABSOLUTE_EAR_DROP = 0.03
# Floor used inside min_blink_duration_s; actual min scales with target_fps.
BLINK_DURATION_MIN = 0.05
BLINK_DURATION_MAX = 0.6
BLINK_RECOVERY_THRESHOLD = 0.7
BASELINE_WINDOW_SIZE = 15

# Rolling mean on raw EAR before FSM (cuts 1-frame landmark jitter).
EAR_SMOOTH_WINDOW = 3
# EMA on closing velocity so a single-frame ΔEAR/Δt spike does not dominate.
VELOCITY_SMOOTH_ALPHA = 0.55
# Frames with smoothed EAR in the close band required before credit.
# Start frame counts as 1. Requiring 2+ rejected ~80% of real 20 FPS blinks
# (POG logs 2026-08-07: duration≈0.05, closed_frames=1 → reject_duration).
# Anti-jitter comes from EAR smooth + velocity EMA, not multi-frame hold.
MIN_CLOSED_FRAMES = 1
# Opening (reopen) velocity for V-shape; waived if closed_frames is deep enough.
# Gaming/center: soft reopen still real (POG reject_opening).
MIN_OPENING_VELOCITY = 0.06
# Look-down multi-frame reopen floor (closed≥2 can also use strong-peak waive).
LOOK_DOWN_MIN_OPENING_VELOCITY = 0.15
# One-frame LD: depth + (reopen or strong peak).
# Post-1.05/0.040: still ~154 reject_opening (POG 2026-08-10 evening) —
# real blinks at peak≈0.7–1.0, abs≈0.032–0.038, openV often missed.
LOOK_DOWN_ONE_FRAME_MIN_OPENING = 0.19
LOOK_DOWN_ONE_FRAME_MIN_DROP = 0.12
LOOK_DOWN_ONE_FRAME_MIN_ABS = 0.035
LOOK_DOWN_ONE_FRAME_STRONG_PEAK = 0.85
# Sub-60ms OCEC opening carve-out: exclude gaze/synthetic storm peaks
# (POG 2026-08-22 vertical saccade peak≈3.1; real LD micro-blinks ~0.9–2.4).
SUB60_OCEC_OPENING_MAX_PEAK = 2.5
# Wall-clock floor when LD peak clears short gate — gate_fps often < camera
# preset, so frame_dt*0.95 still rejected real 33–35ms blinks (reject_duration).
LOOK_DOWN_ONE_FRAME_DURATION_MIN = 0.028
DEFAULT_TARGET_FPS = 15
# Frames of closing |dEAR/dt| kept before blink start — smooth lag means the
# real close spike is often 1–2 frames before FSM enters the close band.
CLOSING_HISTORY_FRAMES = 5

# Peak closing |dEAR/dt| (EAR units / second). Tuned for ~10–15 FPS.
BLINK_MIN_CLOSING_VELOCITY = 0.35
# Short candidates: FPS-aware floors via short_frontal_velocity() /
# short_look_down_velocity().
SHORT_BLINK_DURATION = 0.09

# Mid-blink yaw: tolerate brief flicker over yaw_extreme before cancel.
# Hard-cancel immediately when |yaw| >= yaw_extreme + this margin.
YAW_EXTREME_CANCEL_STREAK = 3
YAW_EXTREME_HARD_MARGIN = 0.10

# |L-R| / mean — above this → degraded / asymmetric; skip frame, no credit.
# Side-monitor glances often land ~0.46–0.50; keep headroom below true junk.
EAR_ASYMMETRY_SKIP = 0.55

# Max relative |L-R| drop spread vs mean drop for bilateral agreement.
BILATERAL_MAX_SPREAD = 0.95

# Stage 7: OCEC prob_open confirm (1=open, 0=closed). Relative drop vs live
# open; missing samples skip (legacy NDJSON). Do not retune with LOOK_DOWN_*.
OCEC_CONFIRM_MIN_DROP = 0.35
# Slow look-down EAR + real OCEC close (POG 2026-08-16: 101 LD
# reject_velocity, peak p50≈0.36 vs short_ld 0.55, ocec_drop p50≈0.53,
# duration p50≈0.08). Do not waive sub-60ms jitter (1 Hz storm path).
# Do not retune short_look_down_velocity / LOOK_DOWN_* in this pass.
OCEC_VELOCITY_MIN_DURATION = 0.06
# 1-frame (~34ms) EAR dips must not get ocec_opening / threshold /
# aperture / clf — OCEC also fires on vertical gaze (POG 2026-08-22:
# ocec_drop 0.80–0.99 with openV=0). Do not retune LOOK_DOWN_* / 0.35.
# Short+shallow opening kill / no peak-waive. The 2026-08-12 down-left 1 Hz
# storm was yaw≈1.1; CLASSIFIER_SIDE_YAW_WAIVE (0.35) is the crop/veto band
# and was too broad — chat-bottom often lands |yaw| 0.35–0.80
# (POG 2026-08-14 reject_opening FN).
SIDE_GLANCE_OPENING_KILL_YAW = 0.80

# EMA for session resting pitch (webcam-on-top bias compensation).
RESTING_PITCH_ALPHA = 0.08
# Only update resting pitch when eyes are near open baseline.
RESTING_PITCH_OPEN_DROP_MAX = 0.12
# Allow tiny upward noise; larger rises are look-down and must not chase
# resting (POG 2026-08-09: resting climb killed look_down → frontal FP storm).
RESTING_PITCH_UP_EPS = 0.01
# Too-low seed (camera-look then desk) never climbed, so screen-center stayed
# full look-down (POG 2026-08-15: rest≈−0.05 vs desk≈0.17). Recover only after
# open-eye pitch holds a tight band longer than a glance (chase test is 2s).
RESTING_PITCH_STABLE_S = 6.0
RESTING_PITCH_STABLE_BAND = 0.04
RESTING_PITCH_UP_ALPHA = 0.02
# Recent samples in the current rise band (≈8s at 30 FPS).
RESTING_PITCH_RISE_SAMPLES = 240
# Typical desk pitch = 20th percentile over this window. A 6s look-down hold
# must not become the new rest (POG 2026-08-15: rest climbed to ~0.19, bottom
# blinks ran frontal gates and died).
RESTING_PITCH_FLOOR_S = 30.0
RESTING_PITCH_FLOOR_Q = 0.20
# Keep laptop desk below the look-down deadzone by half the weight span so
# pose_w stays ~0.5 (not ~0.24 → frontal aperture FN). Preview/MSMF reopen
# must not wipe rest (POG 2026-08-15: reset re-seeded rest≈0.009).
RESTING_PITCH_DESK_MARGIN = PITCH_WEIGHT_SPAN * 0.5

# Live open-eye EAR tracks *current* lid height (frontal or look-down).
# Gates use this ref so look-down open (~0.73 of frontal) is "open", not
# half-closed — absolute frontal ratios caused skip_eyes_closed while chatting
# at screen bottom (POG 2026-08-09).
LIVE_OPEN_RISE_ALPHA = 0.35
LIVE_OPEN_FALL_ALPHA = 0.08
# Only lower live open when lids are stable (posture), never during a close.
LIVE_OPEN_FALL_MAX_CLOSING_VEL = 0.12
LIVE_OPEN_FALL_MAX_DELTA = 0.008
LIVE_OPEN_FALL_HOLD_S = 0.40
# live_open << session baseline → treat like look-down for synthetic/short vel.
LOOK_DOWN_EAR_CEILING = 0.88

# Sustained low EAR vs *live* open ref — not a stream of micro-blinks.
EYES_CLOSED_RATIO = 0.52
EYES_OPEN_RATIO = 0.70
# Soft clear band for look-down open (~0.73–0.85 of live ref).
EYES_OPEN_SOFT_RATIO = 0.85
# Look-down await clear (frontal still uses close-band ~0.84 anti-FP).
# Chat open often sits ~0.70–0.82 of live — requiring close-band made
# skip_await_open sticky while looking at screen bottom (POG 2026-08-09).
LOOK_DOWN_AWAIT_CLEAR_RATIO = 0.70
# Credit recovery for look-down (stricter than await-clear). 0.70 credited
# talk-jaw EAR dips; 0.80/0.78 still timed out real chat blinks stuck at
# ear/live≈0.70–0.73 with strong peak+openV (POG 2026-08-09 post-L1 logs).
LOOK_DOWN_CREDIT_RECOVERY_RATIO = 0.74
EYES_CLOSED_HOLD_S = 0.18
# Must stay near-open this long to clear eyes_closed (noise while lids shut).
EYES_OPEN_HOLD_S = 0.12
EYES_OPEN_SOFT_HOLD_S = 0.10
# Safety: drop awaiting after this; latch eyes_closed only if clearly shut
# (mid-band must not latch — skip_cooldown covers bounce; POG 2026-08-09).
AWAITING_REOPEN_MAX_S = 0.35
# Walk-away: after face missing this long, clear eyes_closed/await on return
# and re-seed live_open (POG 2026-08-09: <2 min away → sticky skip_eyes_closed).
FACE_ABSENT_CLEAR_GATES_S = 1.0
FACE_ABSENT_RESEED_LIVE_S = 1.5
# Glance/saccade: 2D EAR collapses without lids shutting. Do not latch
# skip_eyes_closed while pose is still moving (POG 2026-08-22 soak).
EYES_CLOSED_MOTION_SKIP = 0.08
# Look-down open vs stale frontal live_open often sits 0.55–0.68.
# Requiring 0.70 left skip_eyes_closed stuck with open lids (POG soak).
LOOK_DOWN_CLOSED_RELEASE_RATIO = 0.58

# Opening waive when effective close peak is strong but reopen velocity missed.
# Applies frontal *and* look-down / ear_depressed (POG 2026-08-09 reject_opening).
FRONTAL_OPENING_PEAK_WAIVE = 0.95
# Look-down without reopen: need deeper trough than talk jitter (~drop 0.25).
LOOK_DOWN_SHORT_OPEN_DROP = 0.35
LOOK_DOWN_SHORT_OPEN_CLOSED = 3
# Dark/Ultra LD: strong measured close can waive reopen (closed≥2).
LOOK_DOWN_SHORT_STRONG_PEAK = 0.85
LOOK_DOWN_SHORT_STRONG_DROP = 0.12
LOOK_DOWN_SHORT_STRONG_CLOSED = 2
# Synthetic peak must beat measured by this to count as "invented" (needs V-shape).
SYNTHETIC_PEAK_EPS = 0.20
# Short shallow dips without a strong measured close → reject (POG FP).
SHORT_SHALLOW_ABS_FLOOR = 0.06
# Synthetic short frontal: invent-V needs real depth (POG rawV≈0 @ 50ms credits).
SYNTHETIC_SHORT_MIN_DROP = 0.28
SYNTHETIC_SHORT_MIN_ABS = 0.07
# Frontal short peak-waive without reopen still needs some depth.
FRONTAL_SHORT_WAIVE_ABS = 0.07
FRONTAL_SHORT_WAIVE_DROP = 0.22
# Cumulative |Δyaw|+|Δpitch| during candidate → reject_motion (head nod FP).
# 0.12 killed real blinks with peak≈2–5 (POG 2026-08-09 post-excellence).
MOTION_REJECT_DELTA = 0.22
# Strong measured blinks: waive motion (nod often coincides with real blink).
MOTION_WAIVE_PEAK = 1.2
MOTION_WAIVE_DROP = 0.35
# Per-frame pose step EMA — one-frame candidates never accumulate pose_delta
# (POG 2026-08-10: all completes had pose_delta=0; head moves still credited).
MOTION_RECENT_ALPHA = 0.40
# Seeded into candidate at start; same waive as MOTION_REJECT_DELTA.


def get_adaptive_ear_drop_threshold(baseline_ear):
	"""Calculate the adaptive EAR drop percentage."""
	if baseline_ear <= 0.0:
		return BLINK_MIN_EAR_DROP

	min_ear = 0.15
	max_ear = 0.35
	max_threshold = 0.20
	min_threshold = 0.15
	clamped_ear = max(min_ear, min(baseline_ear, max_ear))
	slope = (max_threshold - min_threshold) / (max_ear - min_ear)
	return max_threshold - slope * (clamped_ear - min_ear)


def short_frontal_velocity(fps):
	"""FPS-aware short-blink closing velocity for frontal (non look-down)."""
	try:
		rate = float(fps)
	except (TypeError, ValueError):
		rate = DEFAULT_TARGET_FPS
	# Softened for center/gaming (POG dlib reject_velocity peak_p50≈0.07).
	if rate >= 18:
		return 0.40
	if rate >= 12:
		return 0.45
	return 0.50


def short_look_down_velocity(fps):
	"""
	Short-blink closing velocity for look-down.

	0.75 at ≥18 FPS rejected real Ultra blinks (POG 2026-08-10:
	reject_velocity peak p50≈0.59). Keep above talk jitter (~0.45).
	"""
	try:
		rate = float(fps)
	except (TypeError, ValueError):
		rate = DEFAULT_TARGET_FPS
	if rate >= 18:
		return 0.55
	if rate >= 12:
		return 0.55
	return 0.50


# Strong drop can cover a short-velocity miss (smooth lag under-reports peak).
SHORT_BLINK_STRONG_DROP = 0.20
SHORT_BLINK_STRONG_ABS = 0.05

# Face / landmark quality (junk boxes produce symmetric-but-useless EAR).
# Absolute floors suit 320×240–640×480 processing resolutions.
MIN_FACE_AREA_PX = 1600  # ~40×40
MIN_INTEROCULAR_PX = 12.0
# HOG can miss several frames while talking / expression; hold last bbox.
FACE_MISS_HOLD_FRAMES = 12
# Landmark quality blip mid-blink: skip EAR but do not cancel yet.
FACE_QUALITY_HOLD_FRAMES = 2
# After face loss, force every-frame locate (heavy retries) for this many frames.
FACE_REACQUIRE_FRAMES = 15
# After the re-acquire burst, skip full-frame detect this often while idle-miss.
# 6 frames ≈ 0.4s at medium 15 FPS — YuNet still sees a walk-back quickly.
FACE_IDLE_DETECT_INTERVAL = 6
# Session baseline drift vs live_open → gentle auto-recalibrate (frontal only).
BASELINE_DRIFT_RATIO = 0.12
BASELINE_DRIFT_HOLD_S = 60.0
BASELINE_DRIFT_NUDGE_ALPHA = 0.15


def min_blink_duration_s(fps):
	"""
	Minimum blink wall-clock duration.

	Do not use MIN_CLOSED_FRAMES/fps as a high floor (that made 0.10s at
	20 FPS and mass-rejected real blinks). At high FPS a one-frame
	start→reopen can be shorter than 50ms — keep a ~one-frame floor.
	"""
	try:
		rate = float(fps)
	except (TypeError, ValueError):
		rate = DEFAULT_TARGET_FPS
	if rate <= 0:
		rate = DEFAULT_TARGET_FPS
	one_frame = 1.0 / rate
	# ≈ one frame at target FPS, capped by the classic 50ms floor, floored
	# so sub-frame jitter cannot credit.
	return max(0.016, min(BLINK_DURATION_MIN, one_frame * 0.95))


def _ear_asymmetry(left_ear, right_ear):
	mean = (left_ear + right_ear) * 0.5
	if mean <= 1e-6:
		return 1.0
	return abs(left_ear - right_ear) / mean


def _bilateral_drops_agree(left_drop, right_drop, required_drop):
	"""True when both eyes show a real drop and magnitudes agree."""
	# Softened for near-threshold frontal (POG 2026-08-08: reject_bilateral
	# with peak≈1.45 but one eye slightly shallower).
	min_each = required_drop * 0.28
	if left_drop < min_each or right_drop < min_each:
		return False
	mean_drop = (left_drop + right_drop) * 0.5
	if mean_drop <= 1e-6:
		return False
	spread = abs(left_drop - right_drop) / mean_drop
	return spread <= BILATERAL_MAX_SPREAD


def _min_eye_drop(required_drop):
	return float(required_drop) * 0.28


class EyeTrack:
	"""Per-eye EAR smooth / velocity / candidate stats (Stage 3.4)."""

	def __init__(self):
		self._ear_window = deque(maxlen=EAR_SMOOTH_WINDOW)
		self.prev_ear = None
		self.prev_time = None
		self._smoothed_closing = 0.0
		self._closing_history = deque(maxlen=CLOSING_HISTORY_FRAMES)
		self.peak_closing = 0.0
		self.peak_closing_measured = 0.0
		self.peak_opening = 0.0
		self.max_drop = 0.0
		self.closed_frames = 0
		self.smooth = 0.0
		self.raw = None

	def clear_stream(self):
		self.prev_ear = None
		self.prev_time = None
		self._smoothed_closing = 0.0
		self._closing_history.clear()
		self._ear_window.clear()
		self.smooth = 0.0
		self.raw = None

	def reset_candidate(self):
		self.peak_closing = 0.0
		self.peak_closing_measured = 0.0
		self.peak_opening = 0.0
		self.max_drop = 0.0
		self.closed_frames = 0

	def pre_blink_closing_peak(self):
		if not self._closing_history:
			return 0.0
		return max(self._closing_history)

	def update(
		self,
		ear_raw,
		current_time,
		*,
		blink_in_progress,
		ref,
		close_band_ear,
	):
		"""Update smooth + velocity; accumulate candidate stats when active."""
		if ear_raw is None:
			self.raw = None
			return 0.0, 0.0
		ear = float(ear_raw)
		self.raw = ear
		self._ear_window.append(ear)
		self.smooth = sum(self._ear_window) / len(self._ear_window)

		closing_raw = 0.0
		opening = 0.0
		if self.prev_ear is not None and self.prev_time is not None:
			dt = current_time - self.prev_time
			if dt > 1e-4:
				raw = (ear - self.prev_ear) / dt
				closing_raw = -raw if raw < 0 else 0.0
				opening = raw if raw > 0 else 0.0
				alpha = VELOCITY_SMOOTH_ALPHA
				self._smoothed_closing = (
					alpha * closing_raw
					+ (1.0 - alpha) * self._smoothed_closing
				)
				self._closing_history.append(closing_raw)
				if blink_in_progress:
					if closing_raw > self.peak_closing:
						self.peak_closing = closing_raw
					if closing_raw > self.peak_closing_measured:
						self.peak_closing_measured = closing_raw
					if opening > self.peak_opening:
						self.peak_opening = opening

		self.prev_ear = ear
		self.prev_time = current_time

		if blink_in_progress and ref > 0:
			drop = max(0.0, (ref - self.smooth) / ref)
			if drop > self.max_drop:
				self.max_drop = drop
			if self.smooth < close_band_ear and opening <= 1e-6:
				self.closed_frames += 1

		return closing_raw, opening


def merge_eye_drops(
	left_drop,
	right_drop,
	*,
	required_drop,
	pose_w,
	yaw,
	has_both,
):
	"""
	Stage 3.4 drop merge.

	Returns (ok, merge_label, reject_phase_or_None).
	merge_label: both|stronger|single|None

	- both: each eye ≥ min_each and magnitudes agree
	- stronger: both ≥ min_each but spread large, OR non-frontal with one eye
	- anti-talk: frontal + only one eye dipped → reject_bilateral
	"""
	if not has_both:
		return True, "single", None
	min_each = _min_eye_drop(required_drop)
	left_ok = float(left_drop) >= min_each
	right_ok = float(right_drop) >= min_each
	# Match prior require_bilateral pose band; slightly softer pose_w for 3.3 lerp.
	frontal_strict = float(pose_w) <= 0.25 and abs(float(yaw)) < 0.35

	if left_ok and right_ok:
		if _bilateral_drops_agree(left_drop, right_drop, required_drop):
			return True, "both", None
		return True, "stronger", None

	if left_ok or right_ok:
		if frontal_strict:
			return False, None, "reject_bilateral"
		# Look-down / high yaw: allow stronger without symmetric second eye.
		return True, "stronger", None

	return False, None, "reject_bilateral"


# Soft pull of live baseline toward personal open-eye calibration.
CALIBRATION_ANCHOR_WEIGHT = 0.1
# Plausible open-eye EAR clamp (matches shared/ear-calibration.ts).
EAR_CALIBRATION_MIN = 0.12
EAR_CALIBRATION_MAX = 0.45


class BlinkDetectionState:
	def __init__(self, pose_strictness="normal", target_fps=DEFAULT_TARGET_FPS):
		self.baseline_ear_values = deque(maxlen=BASELINE_WINDOW_SIZE)
		self.current_baseline_ear = 0.0
		self.blink_in_progress = False
		self.blink_start_time = 0.0
		self.last_blink_time = 0.0
		self.baseline_smoothing_factor = 0.3
		self.max_drop_percentage = 0.0
		self.pose_strictness = pose_strictness
		self.prev_ear = None
		self.prev_time = None
		self.peak_closing_velocity = 0.0
		# Measured closing peak only (raw deltas + pre-blink history).
		# Gate decisions may still use effective_peak (synthetic short-frontal).
		self.peak_closing_velocity_measured = 0.0
		self.peak_opening_velocity = 0.0
		self._smoothed_closing_velocity = 0.0
		self._closing_history = deque(maxlen=CLOSING_HISTORY_FRAMES)
		self.closed_frames = 0
		self.max_left_drop = 0.0
		self.max_right_drop = 0.0
		self._ear_window = deque(maxlen=EAR_SMOOTH_WINDOW)
		self.target_fps = float(target_fps) if target_fps else DEFAULT_TARGET_FPS
		# Personal open-eye EAR from Electron calibration; None when unset.
		self.ear_calibration = None
		# Session resting pitch (EMA); None until first open-eye sample.
		self.resting_pitch = None
		self._resting_rise_center = None
		self._resting_rise_open_s = 0.0
		self._resting_rise_last_t = None
		self._resting_rise_pitches = deque(maxlen=RESTING_PITCH_RISE_SAMPLES)
		self._resting_pitch_hist = deque()
		# After credit (or sustained low EAR): must see open eyes before next start.
		self.awaiting_reopen = False
		self.awaiting_reopen_since = None
		self.eyes_closed = False
		self._low_ear_since = None
		self._open_ear_since = None
		# Current open-lid EAR (adapts to look-down); gates use this, not only
		# the frontal session baseline.
		self.live_open_ear = 0.0
		self.ear_depressed = False
		self._live_open_stable_since = None
		self._prev_ear_for_live = None
		# Wall-clock when usable face EAR stopped (walk-away / too-far).
		self._face_absent_since = None
		# Sustained |live_open - session baseline| → gentle nudge clock.
		self._baseline_drift_since = None
		# Pose at candidate start for head-motion reject.
		self._candidate_yaw = None
		self._candidate_pitch = None
		self._candidate_pose_delta = 0.0
		self._prev_gate_yaw = None
		self._prev_gate_pitch = None
		self._recent_pose_motion = 0.0
		# Consecutive extreme-yaw frames while a candidate is active.
		self._extreme_yaw_streak = 0
		# Stage 3.4 per-eye tracks (avg stream still used for live_open / ref).
		self.left_track = EyeTrack()
		self.right_track = EyeTrack()
		self._merge_label = None
		# Stage 3.5 intensity aperture confirm (optional 2nd channel).
		self.live_open_aperture = 0.0
		self.max_left_ap_drop = 0.0
		self.max_right_ap_drop = 0.0
		self._had_left_aperture = False
		self._had_right_aperture = False
		self._confirm_aperture_ok = None
		self._confirm_aperture_drop = None
		# Stage 7 OCEC confirm (optional; skip when samples missing).
		self.live_open_ocec = 0.0
		self.max_left_ocec_drop = 0.0
		self.max_right_ocec_drop = 0.0
		self._had_left_ocec = False
		self._had_right_ocec = False
		self._confirm_ocec_ok = None
		self._confirm_ocec_drop = None

	def set_target_fps(self, fps):
		"""Update expected camera FPS for duration / short-velocity gates."""
		try:
			value = float(fps)
		except (TypeError, ValueError):
			return False
		if value <= 0:
			return False
		self.target_fps = value
		return True

	@staticmethod
	def calculate_baseline_ear(ear_values):
		if len(ear_values) < 5:
			return None

		weights = [
			0.5 + index * 0.5 / (len(ear_values) - 1)
			for index in range(len(ear_values))
		]
		weighted_sum = sum(
			ear * weight for ear, weight in zip(ear_values, weights)
		)
		return weighted_sum / sum(weights)

	def _seed_baseline(self, value):
		"""Fill the rolling window and set current baseline to value."""
		self.baseline_ear_values.clear()
		for _ in range(BASELINE_WINDOW_SIZE):
			self.baseline_ear_values.append(value)
		self.current_baseline_ear = value
		self.live_open_ear = float(value)

	def _ref_ear(self):
		"""Open-eye reference for drop / close / closed ratios."""
		if self.live_open_ear > 0:
			return self.live_open_ear
		return self.current_baseline_ear

	def _ref_aperture(self):
		"""Open-lid intensity aperture reference for Stage 3.5 confirm."""
		return float(self.live_open_aperture or 0.0)

	def _compute_aperture_drop(self, aperture):
		ref = self._ref_aperture()
		if ref <= 0 or aperture is None:
			return None
		return max(0.0, (ref - float(aperture)) / ref)

	def _accumulate_aperture_drops(self, left_aperture, right_aperture):
		"""Update peak per-eye aperture drops while a candidate is active."""
		left_d = self._compute_aperture_drop(left_aperture)
		right_d = self._compute_aperture_drop(right_aperture)
		if left_d is not None:
			self._had_left_aperture = True
			if left_d > self.max_left_ap_drop:
				self.max_left_ap_drop = left_d
		if right_d is not None:
			self._had_right_aperture = True
			if right_d > self.max_right_ap_drop:
				self.max_right_ap_drop = right_d

	def _confirm_aperture_for_credit(
		self, adaptive_threshold, *, pose_w=0.0, yaw=0.0
	):
		"""
		Stage 3.5 credit confirm.

		Returns (ok, strong_aperture_drop_or_None).
		No aperture samples → skip confirm (legacy traces / disabled).
		Side + look-down: require a full adaptive drop (min_each is too soft
		for landmark/aperture jitter — POG 2026-08-12 1 Hz storm).
		"""
		had_any = self._had_left_aperture or self._had_right_aperture
		if not had_any:
			return True, None
		min_drop = _min_eye_drop(adaptive_threshold)
		if float(pose_w) >= 0.5 and abs(float(yaw)) >= 0.35:
			min_drop = float(adaptive_threshold)
		# Stronger EAR eye (same rule as merge stronger).
		use_left = self.max_left_drop >= self.max_right_drop
		if use_left and self._had_left_aperture:
			drop = self.max_left_ap_drop
			return drop >= min_drop, drop
		if (not use_left) and self._had_right_aperture:
			drop = self.max_right_ap_drop
			return drop >= min_drop, drop
		# Stronger eye never produced aperture — do not FN; skip confirm.
		return True, None

	def _update_live_open_aperture(self, left_aperture, right_aperture, closing_velocity):
		"""
		Track open aperture height (same rise/fall spirit as live_open_ear).

		Frozen during an active candidate so drops are vs pre-blink open.
		"""
		samples = [
			float(v)
			for v in (left_aperture, right_aperture)
			if v is not None
		]
		if not samples:
			return
		ap = sum(samples) / len(samples)
		if ap <= 0:
			return
		if self.live_open_aperture <= 0:
			self.live_open_aperture = ap
			return
		if self.blink_in_progress:
			return
		if ap >= self.live_open_aperture * 0.92:
			alpha = LIVE_OPEN_RISE_ALPHA
			self.live_open_aperture = (
				(1 - alpha) * self.live_open_aperture + alpha * ap
			)
			return
		if closing_velocity <= LIVE_OPEN_FALL_MAX_CLOSING_VEL:
			alpha = LIVE_OPEN_FALL_ALPHA
			self.live_open_aperture = (
				(1 - alpha) * self.live_open_aperture + alpha * ap
			)

	def _ref_ocec(self):
		"""Open-lid OCEC prob_open reference for Stage 7 confirm."""
		return float(self.live_open_ocec or 0.0)

	def _compute_ocec_drop(self, ocec):
		ref = self._ref_ocec()
		if ref <= 0 or ocec is None:
			return None
		return max(0.0, (ref - float(ocec)) / ref)

	def _accumulate_ocec_drops(self, left_ocec, right_ocec):
		"""Update peak per-eye OCEC drops while a candidate is active."""
		left_d = self._compute_ocec_drop(left_ocec)
		right_d = self._compute_ocec_drop(right_ocec)
		if left_d is not None:
			self._had_left_ocec = True
			if left_d > self.max_left_ocec_drop:
				self.max_left_ocec_drop = left_d
		if right_d is not None:
			self._had_right_ocec = True
			if right_d > self.max_right_ocec_drop:
				self.max_right_ocec_drop = right_d

	def _confirm_ocec_for_credit(self, yaw=0.0):
		"""
		Stage 7 credit confirm.

		Returns (ok, strong_ocec_drop_or_None).
		No OCEC samples → skip confirm (legacy traces / disabled).
		`|yaw| ≥ CLASSIFIER_SIDE_YAW_WAIVE` → skip (side crop unreliable;
		same band as Stage 4 logistic). Do not retune LOOK_DOWN_*.
		"""
		had_any = self._had_left_ocec or self._had_right_ocec
		if not had_any:
			return True, None
		use_left = self.max_left_drop >= self.max_right_drop
		drop = None
		if use_left and self._had_left_ocec:
			drop = self.max_left_ocec_drop
		elif (not use_left) and self._had_right_ocec:
			drop = self.max_right_ocec_drop
		if drop is None:
			return True, None
		if abs(float(yaw or 0.0)) >= CLASSIFIER_SIDE_YAW_WAIVE:
			return True, drop
		return drop >= float(OCEC_CONFIRM_MIN_DROP), drop

	def _ocec_waives_ear_miss(
		self, yaw, ocec_ok, strong_ocec_drop, duration=0.0
	):
		"""True when OCEC saw a close in the scored yaw band (not side crop)."""
		if float(duration or 0.0) < OCEC_VELOCITY_MIN_DURATION:
			return False
		return (
			bool(ocec_ok)
			and strong_ocec_drop is not None
			and strong_ocec_drop >= OCEC_CONFIRM_MIN_DROP
			and abs(float(yaw or 0.0)) < CLASSIFIER_SIDE_YAW_WAIVE
		)

	def _update_live_open_ocec(self, left_ocec, right_ocec, closing_velocity):
		"""
		Track open OCEC prob_open (same rise/fall as live_open_aperture).

		Frozen during an active candidate so drops are vs pre-blink open.
		"""
		samples = [
			float(v)
			for v in (left_ocec, right_ocec)
			if v is not None
		]
		if not samples:
			return
		val = sum(samples) / len(samples)
		if val <= 0:
			return
		if self.live_open_ocec <= 0:
			self.live_open_ocec = val
			return
		if self.blink_in_progress:
			return
		if val >= self.live_open_ocec * 0.92:
			alpha = LIVE_OPEN_RISE_ALPHA
			self.live_open_ocec = (
				(1 - alpha) * self.live_open_ocec + alpha * val
			)
			return
		if closing_velocity <= LIVE_OPEN_FALL_MAX_CLOSING_VEL:
			alpha = LIVE_OPEN_FALL_ALPHA
			self.live_open_ocec = (
				(1 - alpha) * self.live_open_ocec + alpha * val
			)

	def _update_live_open_ear(
		self, ear_smooth, closing_velocity, current_time, pose_w=0.0
	):
		"""
		Track current open-lid height so look-down open is not 'half-closed'.

		Rises quickly when lids open wider. Falls only after a stable low-velocity
		hold — never while lids are closing (slow blinks must not collapse ref
		before start; POG 2026-08-09 empty-log FN).
		"""
		ear = float(ear_smooth)
		if ear <= 0:
			return
		if self.live_open_ear <= 0:
			self.live_open_ear = ear
			self._prev_ear_for_live = ear
			self._live_open_stable_since = current_time
			return
		# Freeze only during an active candidate, or while lids are *clearly*
		# shut. Mid-band eyes_closed must still let live_open fall — otherwise
		# walk-away leaves a stale-high ref and skip_eyes_closed forever.
		if self.blink_in_progress:
			self._live_open_stable_since = None
			self._prev_ear_for_live = ear
			return
		# Frontal true-shut only. Look-down compressed EAR vs a stale frontal
		# live_open must still fall, or skip_eyes_closed deadlocks (POG soak).
		if (
			self.eyes_closed
			and float(pose_w) < 0.5
			and ear < self.live_open_ear * EYES_CLOSED_RATIO
		):
			self._live_open_stable_since = None
			self._prev_ear_for_live = ear
			return

		# Sticky presence gates + noisy mid-band EAR (top webcam, eyes on
		# screen bottom): LIVE_OPEN_FALL stable-hold never arms, live stays
		# frontal-high, ear/live≈0.55–0.68 → skip_eyes_closed / skip_await
		# for tens of seconds (POG 2026-08-10). Ease ref without stability.
		if (
			(self.eyes_closed or self.awaiting_reopen)
			and ear < self.live_open_ear * 0.92
		):
			if ear < self.live_open_ear:
				alpha = LIVE_OPEN_FALL_ALPHA
				self.live_open_ear = (
					(1 - alpha) * self.live_open_ear + alpha * ear
				)
			self._live_open_stable_since = None
			self._prev_ear_for_live = ear
			self._refresh_ear_depressed()
			return

		if ear >= self.live_open_ear * 0.92:
			alpha = LIVE_OPEN_RISE_ALPHA
			self.live_open_ear = (1 - alpha) * self.live_open_ear + alpha * ear
			self._live_open_stable_since = current_time
			self._prev_ear_for_live = ear
			self._refresh_ear_depressed()
			return

		delta = 0.0
		if self._prev_ear_for_live is not None:
			delta = abs(ear - self._prev_ear_for_live)
		self._prev_ear_for_live = ear

		stable = (
			closing_velocity <= LIVE_OPEN_FALL_MAX_CLOSING_VEL
			and delta <= LIVE_OPEN_FALL_MAX_DELTA
		)
		if not stable:
			self._live_open_stable_since = None
			self._refresh_ear_depressed()
			return

		if self._live_open_stable_since is None:
			self._live_open_stable_since = current_time
			self._refresh_ear_depressed()
			return

		if (
			current_time - self._live_open_stable_since
		) < LIVE_OPEN_FALL_HOLD_S:
			self._refresh_ear_depressed()
			return

		alpha = LIVE_OPEN_FALL_ALPHA
		self.live_open_ear = (1 - alpha) * self.live_open_ear + alpha * ear
		self._refresh_ear_depressed()

	def _refresh_ear_depressed(self):
		session = self.current_baseline_ear
		if session > 0 and self.live_open_ear > 0:
			self.ear_depressed = (
				self.live_open_ear / session
			) < LOOK_DOWN_EAR_CEILING
		else:
			self.ear_depressed = False

	def set_ear_calibration(self, baseline):
		"""
		Apply or clear a personal open-eye EAR baseline.

		Pass None / non-positive to clear the anchor (live baseline kept).
		"""
		if baseline is None:
			self.ear_calibration = None
			return False

		try:
			value = float(baseline)
		except (TypeError, ValueError):
			return False

		if value <= 0:
			self.ear_calibration = None
			return False

		value = max(EAR_CALIBRATION_MIN, min(EAR_CALIBRATION_MAX, value))
		self.ear_calibration = value
		self._seed_baseline(value)
		return True

	def _smooth_ear(self, raw_ear):
		self._ear_window.append(float(raw_ear))
		return sum(self._ear_window) / len(self._ear_window)

	def maybe_drift_recalibrate(self, current_time, look_down=False):
		"""
		Nudge session baseline toward live_open after sustained frontal drift.

		No multi-profile UI — soft adapt when lighting / distance shifts.
		Returns a debug dict when a nudge is applied, else None.
		"""
		if (
			look_down
			or self.ear_depressed
			or self.blink_in_progress
			or self.eyes_closed
			or self.awaiting_reopen
		):
			self._baseline_drift_since = None
			return None

		session = float(self.current_baseline_ear or 0.0)
		live = float(self.live_open_ear or 0.0)
		if session <= 0 or live <= 0:
			self._baseline_drift_since = None
			return None

		rel = abs(live - session) / session
		if rel < BASELINE_DRIFT_RATIO:
			self._baseline_drift_since = None
			return None

		now = float(current_time)
		if self._baseline_drift_since is None:
			self._baseline_drift_since = now
			return None

		if now - self._baseline_drift_since < BASELINE_DRIFT_HOLD_S:
			return None

		alpha = BASELINE_DRIFT_NUDGE_ALPHA
		before = session
		nudged = (1.0 - alpha) * session + alpha * live
		self.current_baseline_ear = nudged
		if self.ear_calibration and self.ear_calibration > 0:
			cal = (1.0 - alpha) * float(self.ear_calibration) + alpha * live
			self.ear_calibration = max(
				EAR_CALIBRATION_MIN,
				min(EAR_CALIBRATION_MAX, cal),
			)
		self._baseline_drift_since = None
		return {
			"phase": "baseline_drift_nudge",
			"baseline_before": before,
			"baseline": nudged,
			"live_open_ear": live,
			"ear_calibration": self.ear_calibration,
			"drift_ratio": rel,
			"drop": 0.0,
			"threshold": 0.0,
		}

	def _update_baseline(self, current_ear, look_down=False):
		"""Append/smooth open-eye baseline only when not blinking / not closed."""
		if self.blink_in_progress or self.eyes_closed or self.awaiting_reopen:
			return

		# Never pull baseline toward half-closed / shut EAR. Without this,
		# held-closed lids collapse baseline (~0.28→0.22) so shut eyes look
		# "open" and credit as a blink every cooldown (POG JSONL storm).
		if self.current_baseline_ear > 0:
			drop = (
				self.current_baseline_ear - float(current_ear)
			) / self.current_baseline_ear
			if drop > RESTING_PITCH_OPEN_DROP_MAX:
				return

		self.baseline_ear_values.append(current_ear)
		if len(self.baseline_ear_values) < 5:
			return

		new_baseline = self.calculate_baseline_ear(self.baseline_ear_values)
		if not new_baseline:
			return

		if self.current_baseline_ear > 0:
			self.current_baseline_ear = (
				self.baseline_smoothing_factor * new_baseline
				+ (1 - self.baseline_smoothing_factor)
				* self.current_baseline_ear
			)
		else:
			self.current_baseline_ear = new_baseline

		# Soft-anchor toward personal calibration so session drift stays bounded.
		# Skip while looking down — frontal calibration would keep baseline too
		# high and make screen-bottom blinks look like shallow / instant events.
		if (
			not look_down
			and self.ear_calibration
			and self.ear_calibration > 0
		):
			weight = CALIBRATION_ANCHOR_WEIGHT
			self.current_baseline_ear = (
				(1 - weight) * self.current_baseline_ear
				+ weight * self.ear_calibration
			)

	def _update_velocity(self, current_ear, current_time):
		"""
		Closing / opening from raw EAR deltas.

		Peak closing uses the unsmoothed spike — EAR rolling mean already
		stabilizes FSM bands; EMA-only peaks were too weak for real 20 FPS
		blinks (POG reject_velocity after duration fix).

		Also keep a short pre-blink closing history: start often fires after
		the trough, so the spike would otherwise be discarded (peak≈0 rejects).
		"""
		closing_raw = 0.0
		opening = 0.0
		if self.prev_ear is not None and self.prev_time is not None:
			dt = current_time - self.prev_time
			if dt > 1e-4:
				raw = (current_ear - self.prev_ear) / dt
				closing_raw = -raw if raw < 0 else 0.0
				opening = raw if raw > 0 else 0.0
				alpha = VELOCITY_SMOOTH_ALPHA
				self._smoothed_closing_velocity = (
					alpha * closing_raw
					+ (1.0 - alpha) * self._smoothed_closing_velocity
				)
				self._closing_history.append(closing_raw)
				if self.blink_in_progress and closing_raw > self.peak_closing_velocity:
					self.peak_closing_velocity = closing_raw
				if (
					self.blink_in_progress
					and closing_raw > self.peak_closing_velocity_measured
				):
					self.peak_closing_velocity_measured = closing_raw
				if (
					self.blink_in_progress
					and opening > self.peak_opening_velocity
				):
					self.peak_opening_velocity = opening

		self.prev_ear = current_ear
		self.prev_time = current_time
		return closing_raw, opening

	def _pre_blink_closing_peak(self):
		if not self._closing_history:
			return 0.0
		return max(self._closing_history)

	def _reset_blink_tracking(self):
		self.blink_in_progress = False
		self.peak_closing_velocity = 0.0
		self.peak_closing_velocity_measured = 0.0
		self.peak_opening_velocity = 0.0
		self.closed_frames = 0
		self.max_left_drop = 0.0
		self.max_right_drop = 0.0
		self.max_drop_percentage = 0.0
		self._candidate_yaw = None
		self._candidate_pitch = None
		self._candidate_pose_delta = 0.0
		self._extreme_yaw_streak = 0
		self.left_track.reset_candidate()
		self.right_track.reset_candidate()
		self._merge_label = None
		self.max_left_ap_drop = 0.0
		self.max_right_ap_drop = 0.0
		self._had_left_aperture = False
		self._had_right_aperture = False
		self._confirm_aperture_ok = None
		self._confirm_aperture_drop = None
		self.max_left_ocec_drop = 0.0
		self.max_right_ocec_drop = 0.0
		self._had_left_ocec = False
		self._had_right_ocec = False
		self._confirm_ocec_ok = None
		self._confirm_ocec_drop = None

	def cancel_on_face_lost(self, current_time=None):
		"""
		Cancel an in-progress blink when the face disappears mid-candidate.

		Keeps baseline + EAR calibration. Clears velocity / EAR smooth so the
		next face frame does not inherit stale ΔEAR/Δt.
		Marks face absence so a longer walk-away can clear eyes_closed on return.
		Returns True when a candidate was cancelled.
		"""
		had_candidate = self.blink_in_progress
		if had_candidate:
			self._reset_blink_tracking()
		self.prev_ear = None
		self.prev_time = None
		self._smoothed_closing_velocity = 0.0
		self._closing_history.clear()
		self._ear_window.clear()
		self.left_track.clear_stream()
		self.right_track.clear_stream()
		if current_time is not None:
			self.mark_face_absent(current_time)
		return had_candidate

	def mark_face_absent(self, current_time):
		"""Start / keep face-absence timer (walk-away, too-far, black frame)."""
		if self._face_absent_since is None:
			self._face_absent_since = float(current_time)

	def _maybe_clear_after_face_return(self, current_time, ear_smooth):
		"""
		After a sustained face gap, drop presence gates and re-seed live_open.

		Short flicker (< FACE_ABSENT_CLEAR_GATES_S) keeps anti-FP latches.
		"""
		absent_since = self._face_absent_since
		if absent_since is None:
			return False
		gap = float(current_time) - float(absent_since)
		self._face_absent_since = None
		if gap < FACE_ABSENT_CLEAR_GATES_S:
			return False
		self.eyes_closed = False
		self.awaiting_reopen = False
		self.awaiting_reopen_since = None
		self._open_ear_since = None
		self._low_ear_since = None
		ear = float(ear_smooth) if ear_smooth is not None else 0.0
		if gap >= FACE_ABSENT_RESEED_LIVE_S and ear > 0:
			self.live_open_ear = ear
			self._prev_ear_for_live = ear
			self._live_open_stable_since = current_time
			self._refresh_ear_depressed()
		return True

	def _eye_drop(self, eye_ear):
		ref = self._ref_ear()
		if ref <= 0 or eye_ear is None:
			return 0.0
		return max(0.0, (ref - eye_ear) / ref)

	def _reset_resting_rise_band(self, pitch=None):
		self._resting_rise_open_s = 0.0
		self._resting_rise_center = pitch
		self._resting_rise_pitches.clear()
		if pitch is not None:
			self._resting_rise_pitches.append(float(pitch))

	def _record_open_pitch(self, now, pitch):
		"""Keep a 30s open-eye pitch history for the desk-floor percentile."""
		self._resting_pitch_hist.append((float(now), float(pitch)))
		cutoff = float(now) - RESTING_PITCH_FLOOR_S
		while self._resting_pitch_hist and self._resting_pitch_hist[0][0] < cutoff:
			self._resting_pitch_hist.popleft()

	def _pitch_floor_q(self, q=None):
		vals = [p for _t, p in self._resting_pitch_hist]
		if not vals:
			return None
		frac = RESTING_PITCH_FLOOR_Q if q is None else float(q)
		ordered = sorted(vals)
		index = int(round((len(ordered) - 1) * frac))
		index = max(0, min(len(ordered) - 1, index))
		return float(ordered[index])

	def _update_resting_pitch(self, pose, ear_drop_percentage, current_time):
		"""
		Track resting pitch while eyes are open (webcam bias compensation).

		Do not raise resting into a look-down — chasing pitch_delta→0
		disables look_down gates (brief glance *or* a 6s chat-bottom hold).
		A too-low camera-look seed may slowly rise toward the *desk* floor
		(20th percentile of ~30s) minus the look-down deadzone and half the
		weight span, not toward the current look-down band. Camera reset
		keeps rest (session posture), not a first-frame re-seed.
		"""
		now = float(current_time)
		if not pose or not pose.get("valid", False):
			self._reset_resting_rise_band()
			self._resting_rise_last_t = now
			return
		if (
			self.blink_in_progress
			or self.eyes_closed
			or self.awaiting_reopen
			or ear_drop_percentage > RESTING_PITCH_OPEN_DROP_MAX
		):
			# Pause the rise clock; do not count blink/hold gaps as open-eye.
			self._resting_rise_last_t = now
			return
		pitch = float(pose.get("pitch", 0.0))
		self._record_open_pitch(now, pitch)
		if self.resting_pitch is None:
			self.resting_pitch = pitch
			self._reset_resting_rise_band(pitch)
			self._resting_rise_last_t = now
			return

		dt = 0.0
		if self._resting_rise_last_t is not None:
			dt = max(0.0, now - float(self._resting_rise_last_t))
		self._resting_rise_last_t = now

		# Higher pitch = more look-down in our landmark heuristic.
		if pitch > self.resting_pitch + RESTING_PITCH_UP_EPS:
			self._accumulate_resting_rise(pitch, dt)
			return
		self._reset_resting_rise_band(pitch)
		alpha = RESTING_PITCH_ALPHA
		self.resting_pitch = (
			(1 - alpha) * self.resting_pitch + alpha * pitch
		)

	def _accumulate_resting_rise(self, pitch, dt):
		center = self._resting_rise_center
		if (
			center is None
			or abs(pitch - float(center)) > RESTING_PITCH_STABLE_BAND
		):
			self._reset_resting_rise_band(pitch)
			return
		self._resting_rise_open_s += float(dt)
		self._resting_rise_pitches.append(float(pitch))
		if self._resting_rise_open_s + 1e-9 < RESTING_PITCH_STABLE_S:
			return
		if not self._resting_rise_pitches:
			return
		band_median = float(median(self._resting_rise_pitches))
		floor_q = self._pitch_floor_q()
		if floor_q is None:
			return
		# Band is a look-down excursion vs typical desk — do not climb rest.
		if abs(band_median - floor_q) > RESTING_PITCH_STABLE_BAND:
			return
		d0 = float(
			get_pose_profile(self.pose_strictness)["pitch_look_down_delta"]
		)
		target = min(band_median, floor_q) - d0 - RESTING_PITCH_DESK_MARGIN
		if target <= float(self.resting_pitch):
			return
		gap = target - float(self.resting_pitch)
		if gap <= RESTING_PITCH_UP_EPS:
			self.resting_pitch = target
			return
		alpha = RESTING_PITCH_UP_ALPHA
		self.resting_pitch = float(self.resting_pitch) + alpha * gap

	def _update_recent_pose_motion(self, gate, pose=None):
		"""EMA of per-frame |Δyaw|+|Δpitch| for one-frame motion rejects."""
		# Invalid / missing pose must not invent a jump from yaw=0 → real pose
		# (unit tests seed without pose; field face-loss flickers do the same).
		if not pose or not pose.get("valid", False):
			self._prev_gate_yaw = None
			self._prev_gate_pitch = None
			self._recent_pose_motion *= 1.0 - MOTION_RECENT_ALPHA
			return
		yaw = float(gate.get("yaw") or 0.0)
		pitch = float(gate.get("pitch") or 0.0)
		if self._prev_gate_yaw is not None and self._prev_gate_pitch is not None:
			step = abs(yaw - self._prev_gate_yaw) + abs(
				pitch - self._prev_gate_pitch
			)
			alpha = MOTION_RECENT_ALPHA
			self._recent_pose_motion = (
				(1 - alpha) * self._recent_pose_motion + alpha * step
			)
		self._prev_gate_yaw = yaw
		self._prev_gate_pitch = pitch

	def _cooldown_s(self, pose_w):
		return lerp(BLINK_COOLDOWN, LOOK_DOWN_COOLDOWN, pose_w)

	def _update_eyes_closed_state(
		self, current_ear, current_time, pose_w=0.0
	):
		"""
		Track sustained low EAR and post-credit reopen vs *live* open ref.

		Ratios are against live_open_ear so look-down open clears await/closed
		instead of sticking in skip_eyes_closed (POG 2026-08-09). Soft clear
		at EYES_OPEN_SOFT_RATIO unsticks chat look-down without full 0.70 hold.

		Frontal await clear must sit at/above the close band — clearing at 0.70
		while close≈0.84 re-arms start in the mid-band (~1 Hz FP). Look-down /
		ear_depressed use LOOK_DOWN_AWAIT_CLEAR_RATIO so chat open is not
		sticky skip_await_open. Stage 3.3 blends via pose_w.
		"""
		ref = self._ref_ear()
		if ref <= 0:
			return

		open_ratio = current_ear / ref
		close_ratio = 1.0 - get_adaptive_ear_drop_threshold(ref)
		frontal_clear = max(EYES_OPEN_RATIO, close_ratio)
		ld_clear = max(EYES_OPEN_RATIO, LOOK_DOWN_AWAIT_CLEAR_RATIO)
		clear_open_ratio = lerp(frontal_clear, ld_clear, pose_w)

		if (
			self.awaiting_reopen
			and self.awaiting_reopen_since is not None
			and (current_time - self.awaiting_reopen_since) >= AWAITING_REOPEN_MAX_S
		):
			if open_ratio < EYES_CLOSED_RATIO:
				# Clearly shut → latch closed.
				self.awaiting_reopen = False
				self.awaiting_reopen_since = None
				self.eyes_closed = True
				self._open_ear_since = None
			elif open_ratio < close_ratio:
				if pose_w >= 0.5:
					# Look-down resting open often sits under frontal close band;
					# do not refresh await forever (POG skip_await_open sticky).
					self.awaiting_reopen = False
					self.awaiting_reopen_since = None
				else:
					# Frontal mid-band — keep blocking; live_open may fall.
					self.awaiting_reopen_since = current_time
			else:
				self.awaiting_reopen = False
				self.awaiting_reopen_since = None

		if open_ratio >= clear_open_ratio:
			self._low_ear_since = None
			if self._open_ear_since is None:
				self._open_ear_since = current_time
			# Clear closed/await only after a short sustained open (anti noise).
			if (current_time - self._open_ear_since) >= EYES_OPEN_HOLD_S:
				self.eyes_closed = False
				self.awaiting_reopen = False
				self.awaiting_reopen_since = None
			return

		# Look-down open lids vs stale frontal live_open (field 0.55–0.68).
		ld_release = max(
			EYES_CLOSED_RATIO + 0.03,
			LOOK_DOWN_CLOSED_RELEASE_RATIO,
		)
		if (
			pose_w >= 0.5
			and open_ratio >= ld_release
			and (self.eyes_closed or self.awaiting_reopen)
		):
			self._low_ear_since = None
			if self._open_ear_since is None:
				self._open_ear_since = current_time
			elif (
				current_time - self._open_ear_since
			) >= EYES_OPEN_HOLD_S:
				self.eyes_closed = False
				self.awaiting_reopen = False
				self.awaiting_reopen_since = None
			return

		# Soft clear: look-down "open" often sits ~0.73–0.85 of live ref.
		if open_ratio >= EYES_OPEN_SOFT_RATIO and (
			self.eyes_closed or self.awaiting_reopen
		):
			self._low_ear_since = None
			if self._open_ear_since is None:
				self._open_ear_since = current_time
			elif (
				current_time - self._open_ear_since
			) >= EYES_OPEN_SOFT_HOLD_S:
				self.eyes_closed = False
				self.awaiting_reopen = False
				self.awaiting_reopen_since = None
			return

		self._open_ear_since = None

		if open_ratio < EYES_CLOSED_RATIO:
			if self._recent_pose_motion >= EYES_CLOSED_MOTION_SKIP:
				# Saccade / glance: EAR is junk, not a held close.
				self._low_ear_since = None
			elif self._low_ear_since is None:
				self._low_ear_since = current_time
			elif (current_time - self._low_ear_since) >= EYES_CLOSED_HOLD_S:
				# Latch even while a candidate is active so held-shut lids
				# become eyes_closed as soon as the candidate ends.
				self.eyes_closed = True
		else:
			# Between closed and open — clear sustained-closed timer only.
			self._low_ear_since = None

	def detect(
		self,
		current_ear,
		current_time,
		left_ear=None,
		right_ear=None,
		pose=None,
		left_aperture=None,
		right_aperture=None,
		left_ocec=None,
		right_ocec=None,
	):
		"""
		Run blink state machine.

		Optional left/right EAR enable bilateral gates.
		Optional pose dict (yaw/pitch/valid) enables pose gates.
		Optional left/right intensity aperture (Stage 3.5) confirms credit.
		Optional left/right OCEC prob_open (Stage 7) confirms credit.
		`current_ear` is raw avg EAR; FSM uses a short rolling mean.
		"""
		ear_raw = float(current_ear)
		ear_smooth = self._smooth_ear(ear_raw)
		self._maybe_clear_after_face_return(current_time, ear_smooth)

		# Pre-drop estimate for resting-pitch updates (uses current baseline).
		pre_drop = 0.0
		if self.current_baseline_ear > 0:
			pre_drop = max(
				0.0,
				(self.current_baseline_ear - ear_smooth)
				/ self.current_baseline_ear,
			)
		self._update_resting_pitch(pose, pre_drop, current_time)

		gate = evaluate_pose_gate(
			pose,
			self.pose_strictness,
			resting_pitch=self.resting_pitch,
		)
		self._update_recent_pose_motion(gate, pose=pose)

		ear_fields = {
			"ear": ear_smooth,
			"ear_raw": ear_raw,
			"ear_smooth": ear_smooth,
			"closed_frames": self.closed_frames,
			"peak_opening_velocity": self.peak_opening_velocity,
		}

		# Extreme yaw (near profile): no credit. Mid-blink: tolerate brief
		# flicker over the threshold; hard-cancel on streak or hard margin.
		if gate["extreme_yaw"]:
			yaw_abs = abs(float(gate.get("yaw") or 0.0))
			yaw_extreme = float(
				gate.get("profile", {}).get("yaw_extreme")
				or get_pose_profile(self.pose_strictness)["yaw_extreme"]
			)
			hard = yaw_abs >= yaw_extreme + YAW_EXTREME_HARD_MARGIN
			if self.blink_in_progress and not hard:
				self._extreme_yaw_streak += 1
				if self._extreme_yaw_streak < YAW_EXTREME_CANCEL_STREAK:
					# Soft hold: keep candidate, still update velocity.
					self._update_velocity(ear_raw, current_time)
					return False, {
						"baseline": self.current_baseline_ear,
						"drop": 0.0,
						"phase": "skip_yaw_hold",
						"threshold": 0.0,
						"yaw": gate["yaw"],
						"pitch": gate["pitch"],
						"pitch_delta": gate.get("pitch_delta", 0.0),
						"extreme_yaw_streak": self._extreme_yaw_streak,
						**ear_fields,
					}
			if self.blink_in_progress:
				self._reset_blink_tracking()
			else:
				self._extreme_yaw_streak = 0
			self._update_velocity(ear_raw, current_time)
			return False, {
				"baseline": self.current_baseline_ear,
				"drop": 0.0,
				"phase": "skip_yaw",
				"threshold": 0.0,
				"yaw": gate["yaw"],
				"pitch": gate["pitch"],
				"pitch_delta": gate.get("pitch_delta", 0.0),
				**ear_fields,
			}
		self._extreme_yaw_streak = 0

		# Strong L/R asymmetry → degraded landmarks; skip frame, no credit.
		if left_ear is not None and right_ear is not None:
			asymmetry = _ear_asymmetry(left_ear, right_ear)
			if asymmetry > EAR_ASYMMETRY_SKIP:
				if self.blink_in_progress:
					self._reset_blink_tracking()
				self._update_velocity(ear_raw, current_time)
				return False, {
					"baseline": self.current_baseline_ear,
					"drop": 0.0,
					"phase": "skip_degraded",
					"threshold": 0.0,
					"asymmetry": asymmetry,
					"yaw": gate["yaw"],
					"pitch": gate["pitch"],
					"pitch_delta": gate.get("pitch_delta", 0.0),
					**ear_fields,
				}

		self._update_baseline(ear_smooth, look_down=gate["look_down"])
		closing_velocity, opening_velocity = self._update_velocity(
			ear_raw,
			current_time,
		)
		pose_w_early = float(gate.get("pose_weight") or 0.0)
		if self.ear_depressed:
			pose_w_early = 1.0
		self._update_live_open_ear(
			ear_smooth,
			closing_velocity,
			current_time,
			pose_w=pose_w_early,
		)
		self._update_live_open_aperture(
			left_aperture, right_aperture, closing_velocity
		)
		self._update_live_open_ocec(left_ocec, right_ocec, closing_velocity)

		if len(self.baseline_ear_values) < 5 and self.current_baseline_ear <= 0:
			return False, None

		ref = self._ref_ear()
		if ref <= 0:
			return False, None

		pose_w = float(gate.get("pose_weight") or 0.0)
		if self.ear_depressed:
			pose_w = 1.0
		treat_as_look_down = pose_w > 0.0
		self._update_eyes_closed_state(
			ear_smooth,
			current_time,
			pose_w=pose_w,
		)
		# Tick every usable frame so eyes_closed / look_down clear the hold
		# (do not nudge after a long skip_* gap with a stale timer).
		drift_nudge = self.maybe_drift_recalibrate(
			current_time,
			look_down=treat_as_look_down,
		)
		if drift_nudge is not None:
			return False, {
				**drift_nudge,
				"yaw": gate["yaw"],
				"pitch": gate["pitch"],
				"pitch_delta": gate.get("pitch_delta", 0.0),
				"pose_weight": pose_w,
				"look_down": treat_as_look_down,
				"ear_depressed": self.ear_depressed,
				**ear_fields,
			}

		ear_drop_percentage = (ref - ear_smooth) / ref
		ear_drop_absolute = ref - ear_smooth
		adaptive_threshold = get_adaptive_ear_drop_threshold(
			ref
		) * gate["threshold_mult"]
		min_velocity = BLINK_MIN_CLOSING_VELOCITY * gate["velocity_mult"]
		recovery_threshold = gate.get(
			"recovery_threshold",
			BLINK_RECOVERY_THRESHOLD,
		)
		# Hysteresis close band vs live open height.
		close_band_ear = ref * (1.0 - adaptive_threshold)
		start_band_ear = close_band_ear
		duration_min = min_blink_duration_s(self.target_fps)

		has_both = left_ear is not None and right_ear is not None
		# Stage 3.4: per-eye smooth/velocity/candidate stats.
		self.left_track.update(
			left_ear,
			current_time,
			blink_in_progress=self.blink_in_progress,
			ref=ref,
			close_band_ear=close_band_ear,
		)
		self.right_track.update(
			right_ear,
			current_time,
			blink_in_progress=self.blink_in_progress,
			ref=ref,
			close_band_ear=close_band_ear,
		)
		if self.blink_in_progress and has_both:
			left_drop = self.left_track.max_drop
			right_drop = self.right_track.max_drop
		else:
			left_drop = self._eye_drop(
				self.left_track.smooth
				if self.left_track.raw is not None
				else left_ear
			)
			right_drop = self._eye_drop(
				self.right_track.smooth
				if self.right_track.raw is not None
				else right_ear
			)

		info_pose = {
			"yaw": gate["yaw"],
			"pitch": gate["pitch"],
			"pitch_delta": gate.get("pitch_delta", 0.0),
			"pose_weight": pose_w,
			"look_down": gate["look_down"],
			"ear_depressed": self.ear_depressed,
			"treat_as_look_down": treat_as_look_down,
			"live_open_ear": self.live_open_ear,
			"live_open_aperture": self.live_open_aperture,
			"live_open_ocec": self.live_open_ocec,
			"close_band_ear": close_band_ear,
			"resting_pitch": self.resting_pitch,
			"pose_strictness": self.pose_strictness,
			"min_velocity": min_velocity,
			"left_ear": left_ear,
			"right_ear": right_ear,
			"left_aperture": left_aperture,
			"right_aperture": right_aperture,
			"left_ocec": left_ocec,
			"right_ocec": right_ocec,
			"eyes_closed": self.eyes_closed,
			"awaiting_reopen": self.awaiting_reopen,
			"target_fps": self.target_fps,
			"merge": self._merge_label,
			"left_drop": left_drop,
			"right_drop": right_drop,
			"aperture_drop": self._confirm_aperture_drop,
			"aperture_ok": self._confirm_aperture_ok,
			"ocec_drop": self._confirm_ocec_drop,
			"ocec_ok": self._confirm_ocec_ok,
			**ear_fields,
		}
		if has_both:
			info_pose["asymmetry"] = _ear_asymmetry(left_ear, right_ear)

		# Track per-eye aperture drops during an active candidate.
		if self.blink_in_progress:
			self._accumulate_aperture_drops(left_aperture, right_aperture)
			self._accumulate_ocec_drops(left_ocec, right_ocec)

		# Block new blink starts until lids clearly reopen (anti look-down storm).
		if (
			not self.blink_in_progress
			and (self.eyes_closed or self.awaiting_reopen)
		):
			return False, {
				"baseline": ref,
				"drop": ear_drop_percentage,
				"phase": (
					"skip_eyes_closed"
					if self.eyes_closed
					else "skip_await_open"
				),
				"threshold": adaptive_threshold,
				"velocity": closing_velocity,
				"peak_velocity": self.peak_closing_velocity,
				**info_pose,
			}

		# Do not start a new candidate during cooldown — avoids FSM churn and
		# reject_cooldown storms from same-blink bounce (POG 2026-08-08: ~42%).
		cooldown_remaining = max(
			0.0,
			self._cooldown_s(pose_w)
			- (current_time - self.last_blink_time),
		)
		# Start: either eye (or avg when single) enters close band.
		# Recovery/credit still use smooth avg for open-ref stability.
		if has_both:
			l_hit = self.left_track.raw is not None and (
				self.left_track.smooth < start_band_ear
				or self.left_track.raw < start_band_ear
			)
			r_hit = self.right_track.raw is not None and (
				self.right_track.smooth < start_band_ear
				or self.right_track.raw < start_band_ear
			)
			start_ear_hit = l_hit or r_hit
			start_drop_abs = max(
				ear_drop_absolute,
				ref - ear_raw,
				(
					ref - self.left_track.smooth
					if self.left_track.raw is not None
					else 0.0
				),
				(
					ref - self.right_track.smooth
					if self.right_track.raw is not None
					else 0.0
				),
			)
		else:
			start_ear_hit = (
				ear_smooth < start_band_ear or ear_raw < start_band_ear
			)
			start_drop_abs = max(ear_drop_absolute, ref - ear_raw)
		start_drop_pct = start_drop_abs / ref if ref > 0 else 0.0
		if (
			not self.blink_in_progress
			and cooldown_remaining > 0
			and start_ear_hit
			and start_drop_abs > BLINK_MIN_ABSOLUTE_EAR_DROP
			and start_drop_pct > 0
		):
			return False, {
				"baseline": ref,
				"drop": ear_drop_percentage,
				"phase": "skip_cooldown",
				"threshold": adaptive_threshold,
				"velocity": closing_velocity,
				"peak_velocity": self.peak_closing_velocity,
				"cooldown_remaining": cooldown_remaining,
				**info_pose,
			}

		# Start: smoothed EAR enters close band (hysteresis) with absolute floor.
		if (
			not self.blink_in_progress
			and start_ear_hit
			and start_drop_abs > BLINK_MIN_ABSOLUTE_EAR_DROP
			and start_drop_pct > 0
		):
			self.blink_in_progress = True
			self.blink_start_time = current_time
			self.max_drop_percentage = max(ear_drop_percentage, start_drop_pct)
			# Close spike is often 1–2 frames before smooth enters the band.
			frame_dt = 1.0 / max(float(self.target_fps), 1.0)
			raw_drop = max(0.0, ref - ear_raw)
			implied_close = 0.0
			if raw_drop > ear_drop_absolute + 0.015:
				implied_close = raw_drop / max(frame_dt, 1e-3)
			pre_peak = self._pre_blink_closing_peak()
			pre_left = self.left_track.pre_blink_closing_peak()
			pre_right = self.right_track.pre_blink_closing_peak()
			# Look-down / ear-depressed: keep pre-blink history (real close
			# spikes), but do not invent implied close from band-cross alone.
			if pose_w > 0.25:
				implied_close = 0.0
			measured = max(
				closing_velocity,
				self.peak_closing_velocity_measured,
				pre_peak,
				pre_left,
				pre_right,
			)
			self.peak_closing_velocity_measured = measured
			# Effective peak for gates may include frontal implied_close seed.
			self.peak_closing_velocity = max(measured, implied_close)
			self.peak_opening_velocity = 0.0
			self.closed_frames = 1
			self.left_track.reset_candidate()
			self.right_track.reset_candidate()
			for track in (self.left_track, self.right_track):
				if track.raw is None or ref <= 0:
					continue
				drop = max(0.0, (ref - track.smooth) / ref)
				track.max_drop = drop
				track.closed_frames = 1 if track.smooth < close_band_ear else 0
				pre = track.pre_blink_closing_peak()
				track.peak_closing_measured = pre
				track.peak_closing = pre
			if has_both:
				left_drop = self.left_track.max_drop
				right_drop = self.right_track.max_drop
				self.max_drop_percentage = max(
					self.max_drop_percentage,
					left_drop,
					right_drop,
				)
				info_pose["left_drop"] = left_drop
				info_pose["right_drop"] = right_drop
			self.max_left_drop = left_drop
			self.max_right_drop = right_drop
			self.max_left_ap_drop = 0.0
			self.max_right_ap_drop = 0.0
			self._had_left_aperture = False
			self._had_right_aperture = False
			self._confirm_aperture_ok = None
			self._confirm_aperture_drop = None
			self._accumulate_aperture_drops(left_aperture, right_aperture)
			self.max_left_ocec_drop = 0.0
			self.max_right_ocec_drop = 0.0
			self._had_left_ocec = False
			self._had_right_ocec = False
			self._confirm_ocec_ok = None
			self._confirm_ocec_drop = None
			self._accumulate_ocec_drops(left_ocec, right_ocec)
			self._candidate_yaw = float(gate.get("yaw") or 0.0)
			self._candidate_pitch = float(gate.get("pitch") or 0.0)
			# One-frame blinks never accumulate in-candidate Δpose — seed with
			# recent head motion so nods still hit reject_motion.
			self._candidate_pose_delta = float(self._recent_pose_motion)
			info_pose["closed_frames"] = self.closed_frames
			info_pose["peak_opening_velocity"] = self.peak_opening_velocity
			info_pose["pose_delta"] = self._candidate_pose_delta
			info_pose["aperture_drop"] = max(
				self.max_left_ap_drop, self.max_right_ap_drop
			) or None
			info_pose["ocec_drop"] = max(
				self.max_left_ocec_drop, self.max_right_ocec_drop
			) or None
			return False, {
				"baseline": ref,
				"drop": ear_drop_percentage,
				"phase": "start",
				"threshold": adaptive_threshold,
				"velocity": closing_velocity,
				"peak_velocity": self.peak_closing_velocity,
				"peak_velocity_raw": self.peak_closing_velocity_measured,
				"peak_velocity_effective": self.peak_closing_velocity,
				**info_pose,
			}

		if self.blink_in_progress:
			# Track head motion during candidate (open-source stability practice).
			if (
				self._candidate_yaw is not None
				and self._candidate_pitch is not None
			):
				dy = abs(float(gate.get("yaw") or 0.0) - self._candidate_yaw)
				dp = abs(
					float(gate.get("pitch") or 0.0) - self._candidate_pitch
				)
				self._candidate_pose_delta = max(
					self._candidate_pose_delta, dy + dp
				)
			if has_both:
				# Shared peaks / drop / closed = max blend from per-eye tracks.
				self.max_left_drop = self.left_track.max_drop
				self.max_right_drop = self.right_track.max_drop
				left_drop = self.max_left_drop
				right_drop = self.max_right_drop
				info_pose["left_drop"] = left_drop
				info_pose["right_drop"] = right_drop
				self.max_drop_percentage = max(
					self.max_drop_percentage,
					ear_drop_percentage,
					self.max_left_drop,
					self.max_right_drop,
				)
				self.peak_closing_velocity_measured = max(
					self.peak_closing_velocity_measured,
					self.left_track.peak_closing_measured,
					self.right_track.peak_closing_measured,
				)
				self.peak_closing_velocity = max(
					self.peak_closing_velocity,
					self.left_track.peak_closing,
					self.right_track.peak_closing,
					self.peak_closing_velocity_measured,
				)
				self.peak_opening_velocity = max(
					self.peak_opening_velocity,
					self.left_track.peak_opening,
					self.right_track.peak_opening,
				)
				self.closed_frames = max(
					self.closed_frames,
					self.left_track.closed_frames,
					self.right_track.closed_frames,
				)
			else:
				# Count trough/hold frames only — do not inflate during reopen
				# while smoothed EAR is still below the close band.
				if ear_smooth < close_band_ear and opening_velocity <= 1e-6:
					self.closed_frames += 1
				if ear_drop_percentage > self.max_drop_percentage:
					self.max_drop_percentage = ear_drop_percentage
				if left_drop > self.max_left_drop:
					self.max_left_drop = left_drop
				if right_drop > self.max_right_drop:
					self.max_right_drop = right_drop

			info_pose["closed_frames"] = self.closed_frames
			info_pose["peak_opening_velocity"] = self.peak_opening_velocity
			info_pose["pose_delta"] = self._candidate_pose_delta

			blink_duration = current_time - self.blink_start_time
			clearly_shut = ear_smooth < ref * EYES_CLOSED_RATIO
			# Held-closed lids: do not run credit/reject gates on duration-max —
			# latch eyes_closed so noise cannot start the next candidate.
			if blink_duration > BLINK_DURATION_MAX + 1e-3 and clearly_shut:
				self._reset_blink_tracking()
				self.eyes_closed = True
				self.awaiting_reopen = False
				self.awaiting_reopen_since = None
				self._open_ear_since = None
				return False, {
					"baseline": ref,
					"drop": ear_drop_percentage,
					"phase": "skip_eyes_closed",
					"threshold": adaptive_threshold,
					"velocity": closing_velocity,
					"peak_velocity": self.peak_closing_velocity,
					"absolute_drop": ear_drop_absolute,
					**info_pose,
				}

			# Must leave the close band to complete. recovery_threshold (0.7) sits
			# *below* close≈0.84 — mid-band EAR credited every cooldown (POG
			# 2026-08-09 center-screen ~1 Hz storm).
			# Stage 3.3: blend frontal close-band floor → LD credit recovery.
			frontal_recovery = max(ref * recovery_threshold, close_band_ear)
			ld_recovery = ref * LOOK_DOWN_CREDIT_RECOVERY_RATIO
			recovery_level = lerp(frontal_recovery, ld_recovery, pose_w)
			recovered = ear_smooth > recovery_level
			if (
				recovered
				or blink_duration > BLINK_DURATION_MAX + 1e-3
			):
				waives: list[str] = []
				velocity_ok = self.peak_closing_velocity >= min_velocity
				absolute_drop = ref * self.max_drop_percentage
				# Short frontal: if history/seed missed the spike, infer from
				# depth/duration. Look-down / ear-depressed: measured only
				# (synthetic would credit soft eyelid drifts at screen-bottom).
				frame_dt = 1.0 / max(float(self.target_fps), 1.0)
				measured_peak = self.peak_closing_velocity_measured
				effective_peak = self.peak_closing_velocity
				used_synthetic = False
				allow_frontal_extras = pose_w <= 0.25
				if (
					allow_frontal_extras
					and 0 < blink_duration < SHORT_BLINK_DURATION
				):
					synthetic = absolute_drop / max(blink_duration, frame_dt)
					if synthetic > effective_peak + 1e-9:
						used_synthetic = (
							synthetic > measured_peak + SYNTHETIC_PEAK_EPS
						)
					effective_peak = max(effective_peak, synthetic)
					if used_synthetic:
						waives.append("synthetic_peak")
				short_frontal = short_frontal_velocity(self.target_fps)
				short_ld = short_look_down_velocity(self.target_fps)
				short_min = min_velocity
				if blink_duration < SHORT_BLINK_DURATION:
					short_min = lerp(short_frontal, short_ld, pose_w)
					velocity_ok = (
						effective_peak >= max(min_velocity, short_min)
					)
					# Strong blink shape: deep drop can cover a soft peak miss.
					if (
						not velocity_ok
						and allow_frontal_extras
						and self.max_drop_percentage >= SHORT_BLINK_STRONG_DROP
						and absolute_drop >= SHORT_BLINK_STRONG_ABS
						and effective_peak >= (min_velocity * 0.5)
					):
						velocity_ok = True
						waives.append("short_strong_drop")
				# V-shape: opening spike, multi-frame hold, or a strong *measured*
				# close peak when reopen velocity was missed. Do not waive on
				# synthetic effective_peak — abs/duration invents ≥0.95 for any
				# short mid-band dip (POG center FP storm).
				opening_floor = lerp(
					MIN_OPENING_VELOCITY,
					LOOK_DOWN_MIN_OPENING_VELOCITY,
					pose_w,
				)
				opening_ok = (
					self.peak_opening_velocity >= opening_floor
					or self.closed_frames >= max(2, MIN_CLOSED_FRAMES + 1)
				)
				# Extreme side glance: 34ms landmark jitter has huge fake
				# peak/openV (POG 2026-08-12 down-left: 5–10 credits/s,
				# drop≈0.20, yaw≈1.1). Real blinks in this pose are deeper
				# than LOOK_DOWN_SHORT_OPEN_DROP. Mild yaw (chat-bottom) must
				# not use this kill — see SIDE_GLANCE_OPENING_KILL_YAW.
				side_glance = (
					abs(float(gate["yaw"])) >= SIDE_GLANCE_OPENING_KILL_YAW
				)
				if (
					side_glance
					and blink_duration < SHORT_BLINK_DURATION
					and self.max_drop_percentage < LOOK_DOWN_SHORT_OPEN_DROP
				):
					opening_ok = False
				# Look-down / ear-depressed: closed≥2 + tiny openV credited
				# talk/chat EAR noise (POG 2026-08-10). Require real reopen,
				# deep multi-frame trough, or strong peak with closed≥2 —
				# at any duration (not only shortish). Applied when w≥0.5.
				# Side + look-down: landmark ΔEAR/Δt is junk — do not waive
				# on peak alone (POG 2026-08-12: 34ms credits every cooldown).
				side_and_down = pose_w >= 0.5 and side_glance
				if pose_w >= 0.5:
					if self.closed_frames < 2:
						# One-frame: reopen+depth only. Peak-without-openV
						# credited vertical saccades (POG 2026-08-22:
						# 34ms openV=0 ocec≈0.9 ld_one_frame_peak).
						one_drop = lerp(
							0.0, LOOK_DOWN_ONE_FRAME_MIN_DROP, pose_w
						)
						one_abs = lerp(
							0.0, LOOK_DOWN_ONE_FRAME_MIN_ABS, pose_w
						)
						one_open = lerp(
							MIN_OPENING_VELOCITY,
							LOOK_DOWN_ONE_FRAME_MIN_OPENING,
							pose_w,
						)
						depth_ok = (
							self.max_drop_percentage >= one_drop
							and absolute_drop >= one_abs
						)
						opening_ok = depth_ok and (
							self.peak_opening_velocity >= one_open
						)
					else:
						ld_reopen = (
							self.peak_opening_velocity >= opening_floor
						)
						ld_deep = (
							self.closed_frames >= LOOK_DOWN_SHORT_OPEN_CLOSED
							and self.max_drop_percentage
							>= LOOK_DOWN_SHORT_OPEN_DROP
						)
						ld_strong = (
							not side_and_down
							and measured_peak >= LOOK_DOWN_SHORT_STRONG_PEAK
							and self.max_drop_percentage
							>= LOOK_DOWN_SHORT_STRONG_DROP
							and self.closed_frames
							>= LOOK_DOWN_SHORT_STRONG_CLOSED
						)
						opening_ok = ld_reopen or ld_deep or ld_strong
						if opening_ok and not ld_reopen:
							if ld_deep:
								waives.append("ld_deep_trough")
							elif ld_strong:
								waives.append("ld_strong_peak")
					# Re-apply short side-glance depth floor after LD overwrites.
					if (
						side_glance
						and blink_duration < SHORT_BLINK_DURATION
						and self.max_drop_percentage < LOOK_DOWN_SHORT_OPEN_DROP
					):
						opening_ok = False
				if (
					not opening_ok
					and measured_peak >= FRONTAL_OPENING_PEAK_WAIVE
					and allow_frontal_extras
					and self.closed_frames >= 2
					and blink_duration >= OCEC_VELOCITY_MIN_DURATION
				):
					if blink_duration < SHORT_BLINK_DURATION:
						# Frontal short peak-waive still needs depth (open0 FP).
						opening_ok = (
							absolute_drop >= FRONTAL_SHORT_WAIVE_ABS
							and self.max_drop_percentage
							>= FRONTAL_SHORT_WAIVE_DROP
						)
					else:
						opening_ok = True
					if opening_ok:
						waives.append("frontal_opening_peak")
				# Synthetic-boosted short frontal must still show a real reopen
				# or multi-frame trough (POG excellence: invented-V FP).
				if used_synthetic and not (
					self.peak_opening_velocity >= MIN_OPENING_VELOCITY
					or self.closed_frames >= max(2, MIN_CLOSED_FRAMES + 1)
				):
					opening_ok = False
				# Invented peak + shallow drop (rawV≈0, drop≈0.16 @ 50ms).
				if used_synthetic and (
					self.max_drop_percentage < SYNTHETIC_SHORT_MIN_DROP
					or absolute_drop < SYNTHETIC_SHORT_MIN_ABS
					or measured_peak < short_frontal * 0.5
				):
					opening_ok = False
				bilateral_ok = True
				merge_label = "single"
				merge_reject = None
				if has_both:
					bilateral_ok, merge_label, merge_reject = merge_eye_drops(
						self.max_left_drop,
						self.max_right_drop,
						required_drop=adaptive_threshold,
						pose_w=pose_w,
						yaw=gate["yaw"],
						has_both=True,
					)
					# Stronger path: stronger eye must clear velocity/opening
					# (shared peaks already blend max of eyes; if merge is
					# stronger with one shallow eye, require that eye's shape).
					if bilateral_ok and merge_label == "stronger":
						strong = (
							self.left_track
							if self.max_left_drop >= self.max_right_drop
							else self.right_track
						)
						strong_vel = max(
							strong.peak_closing,
							strong.peak_closing_measured,
						)
						strong_open = (
							strong.peak_opening >= opening_floor
							or strong.closed_frames
							>= max(2, MIN_CLOSED_FRAMES + 1)
						)
						# Shared gates may already pass via the strong eye's
						# contribution to blended peaks; if not, fall back to
						# per-eye shape so one deep eye can still credit on LD.
						if not (velocity_ok and opening_ok):
							eye_vel_ok = strong_vel >= min_velocity
							if blink_duration < SHORT_BLINK_DURATION:
								eye_vel_ok = strong_vel >= max(
									min_velocity, short_min
								)
							# Extreme-side 34ms one-eye jitter has huge fake
							# peak/openV (POG 2026-08-12 right monitor: credits
							# every cooldown, drop≈0.16–0.27). Do not undo the
							# SIDE_GLANCE_OPENING_KILL_YAW short+shallow kill.
							side_short_shallow = (
								side_glance
								and blink_duration < SHORT_BLINK_DURATION
								and self.max_drop_percentage
								< LOOK_DOWN_SHORT_OPEN_DROP
							)
							if (
								eye_vel_ok
								and strong_open
								and not side_short_shallow
							):
								velocity_ok = True
								opening_ok = True
								waives.append("stronger_eye")
					self._merge_label = merge_label
					info_pose["merge"] = merge_label
				else:
					self._merge_label = "single"
					info_pose["merge"] = "single"

				closed_ok = self.closed_frames >= MIN_CLOSED_FRAMES
				# Look-down: allow sub-gate-fps one-frame blinks when peak is
				# clearly above talk jitter (POG reject_duration @ 33–35ms).
				effective_duration_min = duration_min
				if (
					pose_w >= 0.5
					and measured_peak >= short_ld
				):
					effective_duration_min = min(
						duration_min,
						frame_dt * 0.95,
						LOOK_DOWN_ONE_FRAME_DURATION_MIN,
					)
					if effective_duration_min < duration_min:
						waives.append("ld_short_duration")
				# Min + closed only. BLINK_DURATION_MAX forces eval / latch
				# eyes_closed — do NOT put the upper bound in duration_ok
				# (POG 2026-08-09: all reject_duration were ~0.65s timeouts
				# with real peak/drop; upper bound auto-failed every timeout).
				duration_ok = (
					blink_duration + 1e-3 >= effective_duration_min
					and closed_ok
				)
				threshold_ok = (
					self.max_drop_percentage > adaptive_threshold
					and absolute_drop > BLINK_MIN_ABSOLUTE_EAR_DROP
				)
				# Short shallow without strong measured close → not a blink.
				if blink_duration < SHORT_BLINK_DURATION:
					shallow_vel_floor = max(min_velocity, short_min)
					if (
						absolute_drop < SHORT_SHALLOW_ABS_FLOOR
						and measured_peak < shallow_vel_floor
					):
						threshold_ok = False
				motion_ok = self._candidate_pose_delta <= MOTION_REJECT_DELTA
				if not motion_ok and (
					measured_peak >= MOTION_WAIVE_PEAK
					and self.max_drop_percentage >= MOTION_WAIVE_DROP
				):
					motion_ok = True
					waives.append("motion_peak")
				aperture_ok, strong_ap_drop = self._confirm_aperture_for_credit(
					adaptive_threshold,
					pose_w=pose_w,
					yaw=gate["yaw"],
				)
				self._confirm_aperture_ok = aperture_ok
				self._confirm_aperture_drop = strong_ap_drop
				info_pose["aperture_ok"] = aperture_ok
				info_pose["aperture_drop"] = strong_ap_drop
				ocec_ok, strong_ocec_drop = self._confirm_ocec_for_credit(
					yaw=gate["yaw"],
				)
				self._confirm_ocec_ok = ocec_ok
				self._confirm_ocec_drop = strong_ocec_drop
				info_pose["ocec_ok"] = ocec_ok
				info_pose["ocec_drop"] = strong_ocec_drop
				# Look-down one-frame abs often lands 0.031–0.034 vs 0.035
				# (compressed live_open). If OCEC actually saw a close, that
				# is independent V/closedness — do not skip-waive (drop None)
				# or side-yaw skip (crop untrusted).
				ocec_ear_waive = self._ocec_waives_ear_miss(
					gate["yaw"],
					ocec_ok,
					strong_ocec_drop,
					duration=blink_duration,
				)
				if ocec_ear_waive:
					if not opening_ok:
						opening_ok = True
						waives.append("ocec_opening")
					if not threshold_ok:
						threshold_ok = True
						waives.append("ocec_threshold")
					if (
						not velocity_ok
						and blink_duration >= OCEC_VELOCITY_MIN_DURATION
					):
						velocity_ok = True
						waives.append("ocec_velocity")
					# Intensity aperture often stays open on small laptop
					# crops while OCEC/EAR see a real close (POG 2026-08-21:
					# 113 reject_aperture, 29 with ocec≥0.35; smoking-gun
					# 0.33s frontal closed=5 ocec=0.92 aperture_drop=0.03).
					if not aperture_ok:
						aperture_ok = True
						self._confirm_aperture_ok = True
						info_pose["aperture_ok"] = True
						waives.append("ocec_aperture")
				# Laptop look-down: OCEC crop stays open (drop≈0) on real
				# EAR blinks (POG 2026-08-15 soak: 60 LD closed≥2
				# reject_ocec, ocec_drop p50=0). Do not skip confirm on
				# closed≥2 alone — that credited 34ms saccades (POG
				# 2026-08-22). Rescue crop-miss only when duration already
				# clears SHORT_BLINK_DURATION. Do not lower
				# OCEC_CONFIRM_MIN_DROP.
				if (
					not ocec_ok
					and treat_as_look_down
					and blink_duration >= SHORT_BLINK_DURATION
				):
					ocec_ok = True
					self._confirm_ocec_ok = True
					info_pose["ocec_ok"] = True
					waives.append("ocec_look_down")
				# Sub-60ms + no reopen is a saccade/crop glitch unless OCEC
				# confirms a real lid close with a strong measured peak
				# (POG 2026-08-22 gaze FP at peak≈3.1; 2026-09-04 ld_strong
				# + ocec still reject_opening).
				strong_sub60_opening_ok = False
				if (
					blink_duration < OCEC_VELOCITY_MIN_DURATION
					and self.peak_opening_velocity < MIN_OPENING_VELOCITY
					and abs(float(gate["yaw"])) < CLASSIFIER_SIDE_YAW_WAIVE
					and strong_ocec_drop is not None
					and strong_ocec_drop >= OCEC_CONFIRM_MIN_DROP
					and absolute_drop >= LOOK_DOWN_ONE_FRAME_MIN_ABS
					and not side_and_down
				):
					path_a = (
						self.closed_frames >= LOOK_DOWN_SHORT_STRONG_CLOSED
						and measured_peak >= LOOK_DOWN_SHORT_STRONG_PEAK
					)
					path_b = (
						self.closed_frames < LOOK_DOWN_SHORT_STRONG_CLOSED
						and measured_peak >= LOOK_DOWN_ONE_FRAME_STRONG_PEAK
						and measured_peak < SUB60_OCEC_OPENING_MAX_PEAK
					)
					if path_a or path_b:
						strong_sub60_opening_ok = True
						if not opening_ok:
							opening_ok = True
						waives.append("ocec_sub60_opening")
				if (
					blink_duration < OCEC_VELOCITY_MIN_DURATION
					and self.peak_opening_velocity < MIN_OPENING_VELOCITY
					and abs(float(gate["yaw"])) < CLASSIFIER_SIDE_YAW_WAIVE
					and not strong_sub60_opening_ok
				):
					opening_ok = False
				gates_ok = (
					duration_ok
					and threshold_ok
					and velocity_ok
					and opening_ok
					and bilateral_ok
					and motion_ok
					and aperture_ok
					and ocec_ok
					and gate["allow_credit"]
					# Never credit on duration-max while still mid/closed —
					# must have reopened past recovery_level.
					and recovered
				)
				cooldown_remaining = max(
					0.0,
					self._cooldown_s(pose_w)
					- (current_time - self.last_blink_time),
				)
				peak_vel = effective_peak
				peak_open = self.peak_opening_velocity
				max_drop = self.max_drop_percentage
				max_drop_ear = ref * (1 - max_drop)
				closed_at_end = self.closed_frames
				pose_delta_at_end = self._candidate_pose_delta
				left_drop_at_end = self.max_left_drop
				right_drop_at_end = self.max_right_drop
				clf_p = None
				clf_veto = False
				if gates_ok:
					clf_p, clf_veto = classifier_score(
						{
							**info_pose,
							"drop": max_drop,
							"duration": blink_duration,
							"closed_frames": closed_at_end,
							"absolute_drop": ref - max_drop_ear,
							"peak_velocity_raw": measured_peak,
							"peak_opening_velocity": peak_open,
							"pose_delta": pose_delta_at_end,
							"left_drop": left_drop_at_end,
							"right_drop": right_drop_at_end,
							"aperture_drop": strong_ap_drop,
							"merge": self._merge_label or merge_label,
						}
					)

				def _outcome(phase, credited=False):
					# info_pose first so explicit end-of-candidate fields win.
					return credited, {
						**info_pose,
						"baseline": ref,
						"drop": max_drop,
						"max_drop_ear": max_drop_ear,
						"duration": blink_duration,
						"phase": phase,
						"threshold": adaptive_threshold,
						"velocity": peak_vel,
						# peak_velocity stays effective for backward-compat logs.
						"peak_velocity": peak_vel,
						"peak_velocity_raw": measured_peak,
						"peak_velocity_effective": peak_vel,
						"peak_opening_velocity": peak_open,
						"closed_frames": closed_at_end,
						"cooldown_remaining": cooldown_remaining,
						"absolute_drop": ref - max_drop_ear,
						"merge": self._merge_label or merge_label,
						"left_drop": left_drop_at_end,
						"right_drop": right_drop_at_end,
						"aperture_drop": strong_ap_drop,
						"aperture_ok": aperture_ok,
						"ocec_drop": strong_ocec_drop,
						"ocec_ok": ocec_ok,
						"pose_delta": pose_delta_at_end,
						"ear": ear_smooth,
						"ear_raw": ear_raw,
						"ear_smooth": ear_smooth,
						"waives": list(waives),
						"clf_p": clf_p,
						"clf_veto": clf_veto,
						"reject_gate": (
							None if credited or phase == "complete" else phase
						),
					}

				def _arm_await_if_still_closed():
					# Reject while still in close band must not free start.
					if ear_smooth < close_band_ear:
						self.awaiting_reopen = True
						self.awaiting_reopen_since = current_time
						self._open_ear_since = None

				if gates_ok:
					if cooldown_remaining <= 0:
						# Logistic was fit on EAR-only corpus completes
						# (mean dur≈0.19, pose_weight≈0). Live frontal with a
						# real OCEC close scores p≈0.14 < t=0.25 (POG 2026-08-14
						# 2nd start: 62 reject_classifier, ocec_drop p50=0.95).
						# Look-down pose_weight hid this; do not veto a confirmed
						# close. Missing OCEC → keep Stage 4 veto.
						if (
							clf_veto
							and blink_duration >= OCEC_VELOCITY_MIN_DURATION
							and strong_ocec_drop is not None
							and strong_ocec_drop >= OCEC_CONFIRM_MIN_DROP
						):
							clf_veto = False
							waives.append("ocec_clf")
						if clf_veto:
							self._reset_blink_tracking()
							_arm_await_if_still_closed()
							return _outcome("reject_classifier")
						self.last_blink_time = current_time
						self._reset_blink_tracking()
						# Must fully reopen before another blink can start.
						self.awaiting_reopen = True
						self.awaiting_reopen_since = current_time
						self._low_ear_since = None
						self._open_ear_since = None
						return _outcome("complete", credited=True)

					self._reset_blink_tracking()
					_arm_await_if_still_closed()
					return _outcome("reject_cooldown")

				# Prefer velocity over threshold when both fail so logs are not
				# dominated by reject_threshold for slow+shallow noise.
				if not duration_ok:
					reason = "reject_duration"
				elif not recovered:
					# Distinct from too-short duration (Phase 0 was mixing these).
					reason = "reject_recovery"
				elif not velocity_ok:
					reason = "reject_velocity"
				elif not opening_ok:
					reason = "reject_opening"
				elif not threshold_ok:
					reason = "reject_threshold"
				elif not bilateral_ok:
					reason = "reject_bilateral"
				elif not aperture_ok:
					reason = "reject_aperture"
				elif not ocec_ok:
					reason = "reject_ocec"
				elif not motion_ok:
					reason = "reject_motion"
				else:
					reason = "reject_yaw"

				self._reset_blink_tracking()
				_arm_await_if_still_closed()
				return _outcome(reason)

		return False, {
			"baseline": ref,
			"drop": ear_drop_percentage,
			"phase": "monitoring",
			"threshold": adaptive_threshold,
			"velocity": closing_velocity,
			"peak_velocity": self.peak_closing_velocity,
			**info_pose,
		}

	def reset(self):
		self.baseline_ear_values.clear()
		self.current_baseline_ear = 0.0
		self.live_open_ear = 0.0
		self.live_open_aperture = 0.0
		self.live_open_ocec = 0.0
		self.ear_depressed = False
		self._live_open_stable_since = None
		self._prev_ear_for_live = None
		self._face_absent_since = None
		self._baseline_drift_since = None
		self._candidate_yaw = None
		self._candidate_pitch = None
		self._candidate_pose_delta = 0.0
		self._prev_gate_yaw = None
		self._prev_gate_pitch = None
		self._recent_pose_motion = 0.0
		self._extreme_yaw_streak = 0
		self.blink_in_progress = False
		self.blink_start_time = 0.0
		self.last_blink_time = 0.0
		self.baseline_smoothing_factor = 0.3
		self.max_drop_percentage = 0.0
		self.prev_ear = None
		self.prev_time = None
		self.peak_closing_velocity = 0.0
		self.peak_closing_velocity_measured = 0.0
		self.peak_opening_velocity = 0.0
		self._smoothed_closing_velocity = 0.0
		self._closing_history.clear()
		self.closed_frames = 0
		self.max_left_drop = 0.0
		self.max_right_drop = 0.0
		self.max_left_ap_drop = 0.0
		self.max_right_ap_drop = 0.0
		self._had_left_aperture = False
		self._had_right_aperture = False
		self._confirm_aperture_ok = None
		self._confirm_aperture_drop = None
		self.max_left_ocec_drop = 0.0
		self.max_right_ocec_drop = 0.0
		self._had_left_ocec = False
		self._had_right_ocec = False
		self._confirm_ocec_ok = None
		self._confirm_ocec_drop = None
		self._ear_window.clear()
		self.left_track = EyeTrack()
		self.right_track = EyeTrack()
		self._merge_label = None
		# Keep resting_pitch + 30s hist across camera reopen (preview / MSMF
		# / no-face recover). Reset only the rise clock so a long pause is
		# not one 6s hold. Same idea as ear_calibration below.
		self._reset_resting_rise_band()
		self._resting_rise_last_t = None
		self.awaiting_reopen = False
		self.awaiting_reopen_since = None
		self.eyes_closed = False
		self._low_ear_since = None
		self._open_ear_since = None
		# Keep ear_calibration across camera restarts; re-seed if set.
		if self.ear_calibration and self.ear_calibration > 0:
			self._seed_baseline(self.ear_calibration)
