import json
import os
import sys
import time
from pathlib import Path

import cv2

from blink_detector_package.domain import (
	BLINK_DISPLAY_DURATION,
	DEFAULT_POSE_STRICTNESS,
	MIN_FACE_AREA_PX,
	MIN_INTEROCULAR_PX,
	BlinkDetectionState,
	LandmarkTrustDebouncer,
	face_bbox_area,
	face_bbox_plausible,
	face_area_fraction,
	evaluate_landmark_trust,
	interocular_distance_px,
	is_face_too_close,
	landmark_fail_face_status,
	select_largest_face,
)
from blink_detector_package.infrastructure.head_pose import estimate_head_pose
from blink_detector_package.domain.blink_detection import (
	DEFAULT_TARGET_FPS,
	FACE_IDLE_DETECT_INTERVAL,
	FACE_MISS_HOLD_FRAMES,
	FACE_QUALITY_HOLD_FRAMES,
	FACE_REACQUIRE_FRAMES,
)
from blink_detector_package.domain.classifier import CLASSIFIER_SIDE_YAW_WAIVE
from blink_detector_package.domain.ear import calculate_ear_fast
from blink_detector_package.infrastructure.camera import (
	BLACK_STREAK_S,
	HEALTH_INTERVAL_S,
	NO_FACE_FAILOVER_S,
	OpenCVCamera,
	is_black_frame,
	mean_luma,
)
from blink_detector_package.infrastructure.models import load_models
from blink_detector_package.infrastructure.transport import NdjsonTransport
from blink_detector_package.infrastructure.vision import (
	DETECT_STAT_NAMES,
	FACE_RETRY_LOG_KINDS,
	PreallocatedBuffers,
	encode_frame,
	eye_intensity_aperture,
	get_face_landmarks,
	get_ocec_enabled,
	resize_to_processing,
	run_face_detect,
	stabilize_face_rect,
)
from blink_detector_package.infrastructure.ocec import load_ocec, score_eye_open
from blink_detector_package.infrastructure.process_qos import (
	boost_capture,
	is_boosted,
	release_capture,
)

NO_FACE_DATA = json.dumps(
	{
		"faceData": {
			"faceDetected": False,
			"faceStatus": "none",
			"ear": 0.0,
			"blink": False,
			"faceRect": {"x": 0, "y": 0, "width": 0, "height": 0},
			"eyeLandmarks": [],
		}
	}
)
# Idle none IPC — edge plus ~3 Hz. Toast debounce already lives in Electron.
NO_FACE_EMIT_INTERVAL_S = 1.0 / 3.0
# Wake often enough to drain stdin; do not 1ms-spin while waiting for the next frame.
PACE_COMMAND_SLICE_S = 0.02


def pace_wait_s(
	now,
	last_frame_time,
	frame_interval,
	slice_s=PACE_COMMAND_SLICE_S,
):
	"""Seconds to sleep before the next paced frame (0 = process now)."""
	try:
		interval = float(frame_interval)
	except (TypeError, ValueError):
		return 0.0
	if interval <= 0:
		return 0.0
	remaining = interval - (now - last_frame_time)
	if remaining <= 0:
		return 0.0
	try:
		cap = float(slice_s)
	except (TypeError, ValueError):
		cap = PACE_COMMAND_SLICE_S
	if cap <= 0:
		return remaining
	return remaining if remaining < cap else cap


class TraceRecorder:
	"""NDJSON EAR/pose dump + sidecar MJPG AVI for Stage-0 labeling."""

	def __init__(self):
		self._file = None
		self._writer = None
		self.path = None
		self.video_path = None
		self.frames = 0
		self._fps = 15.0
		self._video_error = None

	@property
	def active(self):
		return self._file is not None

	def start(self, path, header=None, target_fps=None):
		self.stop()
		target = Path(path)
		if not str(path).strip():
			raise ValueError("empty trace path")
		target.parent.mkdir(parents=True, exist_ok=True)
		if target.suffix.lower() not in (".ndjson", ".jsonl"):
			target = target.with_suffix(".ndjson")
		handle = target.open("w", encoding="utf-8")
		self._file = handle
		self.path = str(target.resolve())
		self.video_path = str(target.with_suffix(".avi").resolve())
		self.frames = 0
		self._writer = None
		self._video_error = None
		try:
			fps = float(target_fps) if target_fps is not None else 15.0
		except (TypeError, ValueError):
			fps = 15.0
		self._fps = max(5.0, min(fps, 60.0))
		meta = {
			"type": "header",
			"schema": "blinkguard.ear_trace.v1",
			"video": Path(self.video_path).name,
			"video_fps": self._fps,
			"video_codec": "MJPG",
		}
		if header:
			meta.update(header)
			# Keep video keys authoritative after header merge.
			meta["video"] = Path(self.video_path).name
			meta["video_fps"] = self._fps
			meta["video_codec"] = "MJPG"
		handle.write(json.dumps(meta) + "\n")
		handle.flush()
		return self.path

	def _ensure_writer(self, bgr):
		if self._writer is not None or self.video_path is None:
			return
		if bgr is None or getattr(bgr, "size", 0) == 0:
			return
		height, width = bgr.shape[:2]
		fourcc = cv2.VideoWriter_fourcc(*"MJPG")
		writer = cv2.VideoWriter(
			self.video_path,
			fourcc,
			float(self._fps),
			(int(width), int(height)),
		)
		if not writer.isOpened():
			self._video_error = f"VideoWriter failed ({width}x{height} @ {self._fps})"
			writer.release()
			self._writer = None
			return
		self._writer = writer

	def write_frame(self, payload, bgr=None):
		if self._file is None:
			return
		row = dict(payload)
		row["video_index"] = self.frames
		self._file.write(json.dumps(row) + "\n")
		if bgr is not None:
			self._ensure_writer(bgr)
			if self._writer is not None:
				self._writer.write(bgr)
		self.frames += 1
		if self.frames % 5 == 0:
			self._file.flush()

	def stop(self):
		if self._file is None:
			return None
		path = self.path
		video_path = self.video_path
		frames = self.frames
		video_error = self._video_error
		try:
			self._file.flush()
			self._file.close()
		finally:
			self._file = None
			self.path = None
		if self._writer is not None:
			try:
				self._writer.release()
			except Exception:
				pass
			self._writer = None
		self.video_path = None
		self.frames = 0
		self._video_error = None
		# Drop header-only files so failed starts do not look like sessions.
		if frames <= 0:
			for dead in (path, video_path):
				if not dead:
					continue
				try:
					Path(dead).unlink(missing_ok=True)
				except OSError:
					pass
			return {
				"path": path,
				"video_path": video_path,
				"frames": 0,
				"deleted_empty": True,
			}
		result = {
			"path": path,
			"video_path": video_path,
			"frames": frames,
		}
		if video_error:
			result["video_error"] = video_error
		elif video_path and not Path(video_path).exists():
			result["video_error"] = "video file missing after stop"
		return result



class BlinkDetectorApplication:
	def __init__(self, transport=None):
		self.transport = transport or NdjsonTransport()
		self._should_exit = False
		self.camera = OpenCVCamera(self.transport)
		self.detection = BlinkDetectionState(
			target_fps=self.camera.target_fps,
		)
		self.send_video = False
		self.last_blink_display_time = 0.0
		# Phase 3 hooks — defaults match Phase 2 / prior every-frame detect.
		self.face_detect_interval = 1
		self.pose_strictness = DEFAULT_POSE_STRICTNESS
		self._cached_face = None
		self._frames_since_face_detect = 0
		self._face_miss_streak = 0
		self._quality_miss_streak = 0
		self._landmark_trust_debouncer = LandmarkTrustDebouncer()
		self._face_reacquire_frames = 0
		self._last_no_face_emit = 0.0
		self._last_emitted_face_status = None
		self._last_clahe_roi_count = 0
		self._last_skip_debug_time = 0.0
		self._last_skip_debug_phase = None
		self._last_near_miss_debug_time = 0.0
		self._last_hog_retry_log_time = 0.0
		self._last_face_detect = None
		self._yunet = None
		self._ocec = None
		self._vision_buffers = None
		# Preview follows target_fps (Ultra=30); encode stays light via size/q.
		self._last_video_emit = 0.0
		self._video_min_interval = 1.0 / max(8, int(self.camera.target_fps or 10))
		self._loop_dt_ema = 0.0
		self._last_gate_fps_update = 0.0
		self._last_processed_frame_time = 0.0
		self.trace = TraceRecorder()
		self._reset_capture_health()

	def _reset_capture_health(self):
		self._reset_health_window()
		self._black_streak_start = None
		self._no_face_streak_start = None
		self._session_face_ok = 0
		self._session_frames = 0
		self._last_health_emit = 0.0
		self._health_window_start = time.time()
		self._last_no_face_emit = 0.0
		self._last_emitted_face_status = None

	def _reset_health_window(self, current_time=None):
		self._health_frames = 0
		self._health_black = 0
		self._health_luma_sum = 0.0
		self._health_face_ok = 0
		self._health_face_none = 0
		self._health_face_too_far = 0
		for name in DETECT_STAT_NAMES:
			setattr(self, f"_health_{name}", 0)
		if current_time is not None:
			self._health_window_start = current_time
			self._last_health_emit = current_time

	def _frame_luma_and_black(self, frame, current_time):
		"""Track black streak / luma without committing faceStatus counts yet."""
		luma = mean_luma(frame)
		black = is_black_frame(frame)
		if black:
			if self._black_streak_start is None:
				self._black_streak_start = current_time
		else:
			self._black_streak_start = None
		return black, luma

	def _commit_frame_health(self, luma, black, face_status, current_time):
		self._health_frames += 1
		self._health_luma_sum += luma
		self._session_frames += 1
		if black:
			self._health_black += 1
		if face_status == "ok":
			self._health_face_ok += 1
			self._session_face_ok += 1
			self._no_face_streak_start = None
		elif face_status == "too_far":
			self._health_face_too_far += 1
			# too_far still means capture works — do not count as no-face failover.
			self._no_face_streak_start = None
		else:
			self._health_face_none += 1
			if not black and self._session_face_ok == 0:
				if self._no_face_streak_start is None:
					self._no_face_streak_start = current_time
		if current_time - self._last_health_emit >= HEALTH_INTERVAL_S:
			self._emit_camera_health(current_time)

	def _maybe_failover_no_face(self, current_time):
		"""MSMF can report Success yet never yield a detectable face — try DSHOW."""
		if self._session_face_ok > 0:
			return False
		if self._no_face_streak_start is None:
			return False
		if current_time - self._no_face_streak_start < NO_FACE_FAILOVER_S:
			return False
		if self._session_frames < 5:
			return False
		streak_ms = int((current_time - self._no_face_streak_start) * 1000)
		ok = self.camera.recover_from_no_face(self.detection.reset, streak_ms)
		self._cached_face = None
		self._clear_landmark_track()
		self._reset_capture_health()
		if ok:
			self._begin_face_reacquire(force=True)
		return ok

	def _emit_camera_health(self, current_time):
		frames = max(1, self._health_frames)
		meta = self.camera.snapshot_meta()
		black_ratio = self._health_black / frames
		face_ok = self._health_face_ok
		face_none = self._health_face_none
		mean = self._health_luma_sum / frames
		loop_fps = (
			round(1.0 / self._loop_dt_ema, 2) if self._loop_dt_ema > 0 else None
		)
		detect_stats = {
			name: int(getattr(self, f"_health_{name}", 0) or 0)
			for name in DETECT_STAT_NAMES
		}
		self.camera.emit_camera_state(
			"camera_health",
			frames=self._health_frames,
			mean_luma=mean,
			black_ratio=black_ratio,
			face_ok=face_ok,
			face_none=face_none,
			face_too_far=self._health_face_too_far,
			send_video=self.send_video,
			window_s=round(current_time - self._health_window_start, 3),
			loop_fps=loop_fps,
			gate_fps=round(float(self.detection.target_fps), 2),
			**meta,
			**detect_stats,
		)
		self.transport.send(
			{
				"debug": (
					"camera_health "
					f"frames={self._health_frames} "
					f"luma={mean:.1f} black={black_ratio:.2f} "
					f"face_ok={face_ok} face_none={face_none} "
					f"yunet_hit={detect_stats['yunet_hit']} "
					f"yunet_enh={detect_stats['yunet_enhanced_hit']} "
					f"hog_refine_miss={detect_stats['hog_refine_miss']} "
					f"yunet_crop={detect_stats['yunet_crop']} "
					f"hog_full={detect_stats['hog_full_hit']} "
					f"loop_fps={loop_fps} gate_fps={self.detection.target_fps:.1f} "
					f"backend={meta.get('backend_name')}"
				)
			}
		)
		self._reset_health_window(current_time)

	def process_commands(self):
		"""Drain stdin batch: apply config before stop/start to avoid MSMF thrash."""
		batch = []
		while not self.transport.command_queue.empty():
			try:
				line = self.transport.command_queue.get_nowait()
				batch.append(json.loads(line))
			except json.JSONDecodeError as error:
				self.transport.send(
					{"debug": f"JSON decode error: {str(error)}"}
				)
			except Exception as error:
				self.transport.send(
					{"debug": f"Command read error: {str(error)}"}
				)

		if not batch:
			return

		for data in batch:
			self.transport.send({"debug": f"Processing command: {data}"})

		merged = {}
		want_stop = False
		want_start = False
		want_video = False
		want_stop_video = False
		want_list = False
		record_trace_path = None
		want_stop_trace = False
		for data in batch:
			for key in (
				"target_fps",
				"processing_resolution",
				"face_detect_interval",
				"pose_strictness",
				"ear_calibration",
				"classifier_calibration",
				"camera_device",
			):
				if key in data:
					merged[key] = data[key]
			if "stop_camera" in data:
				want_stop = True
				want_start = False
			if "start_camera" in data:
				want_start = True
			if "stop_video" in data:
				want_stop_video = True
				want_video = False
			if "request_video" in data:
				if data.get("request_video"):
					want_video = True
					want_stop_video = False
				else:
					want_stop_video = True
					want_video = False
			if data.get("list_cameras"):
				want_list = True
			if "record_trace" in data:
				record_trace_path = data["record_trace"]
			if data.get("stop_trace"):
				want_stop_trace = True
			if data.get("quit"):
				self._should_exit = True

		try:
			self._apply_config_dict(merged)

			if want_stop_trace or record_trace_path is not None:
				# stop_trace before starting a new path in the same batch.
				if want_stop_trace or (
					record_trace_path is not None and self.trace.active
				):
					stopped = self.trace.stop()
					if stopped:
						if stopped.get("frames", 0) <= 0:
							self.transport.send(
								{
									"error": (
										"Trace recording produced 0 frames "
										"(is the camera active?). Empty file removed."
									)
								}
							)
						else:
							msg = (
								"Trace recording stopped "
								f"path={stopped['path']} "
								f"frames={stopped['frames']}"
							)
							if stopped.get("video_path"):
								msg += f" video={stopped['video_path']}"
							if stopped.get("video_error"):
								msg += f" video_error={stopped['video_error']}"
							self.transport.send({"status": msg})
							if stopped.get("video_error"):
								self.transport.send(
									{
										"error": (
											"EAR trace saved but video failed: "
											f"{stopped['video_error']}"
										)
									}
								)
					elif want_stop_trace:
						self.transport.send(
							{"status": "Trace recording was not active"}
						)
				if record_trace_path is not None:
					if not isinstance(record_trace_path, str) or not record_trace_path.strip():
						self.transport.send(
							{
								"error": (
									"record_trace requires a filesystem path string"
								)
							}
						)
					else:
						try:
							path = self.trace.start(
								record_trace_path,
								header=self._trace_header(),
								target_fps=self.camera.target_fps,
							)
							self.transport.send(
								{
									"status": (
										"Trace recording started "
										f"path={path} "
										f"video={self.trace.video_path}"
									)
								}
							)
						except (OSError, ValueError, TypeError) as error:
							self.transport.send(
								{
									"error": (
										f"Failed to start trace recording: {error}"
									)
								}
							)

			if want_stop:
				# Do NOT stop EAR-trace here — users often record → camera on →
				# scenario → camera off → stop recording. stop_camera must not
				# close an empty/partial trace mid-session.
				self.camera.stop(reason="stop_camera")
				self._set_capture_qos(False)
				self.send_video = False
				self._cached_face = None
				self._clear_landmark_track()
				self._face_miss_streak = 0
				self._reset_capture_health()
				self.transport.send({"status": "Camera stopped"})
				if self.trace.active:
					self.transport.send(
						{
							"debug": (
								"Trace recording still active after camera stop "
								f"frames_so_far={self.trace.frames} "
								f"path={self.trace.path}"
							)
						}
					)

			if want_list:
				self.camera.refresh_inventory()

			if want_start:
				if self.camera.start(self.detection.reset):
					self._set_capture_qos(True)
					self._cached_face = None
					self._clear_landmark_track()
					self._face_miss_streak = 0
					self._frames_since_face_detect = 0
					self._reset_capture_health()
					self.transport.send(
						{"status": "Camera started successfully"}
					)
				else:
					self.transport.send({"error": "Failed to start camera"})

			if want_stop_video:
				self.send_video = False
				self.transport.send({"status": "Video streaming disabled"})

			if want_video:
				self.send_video = True
				self._sync_video_emit_interval()
				self.transport.send({"status": "Video streaming enabled"})
		except Exception as error:
			self.transport.send(
				{"debug": f"Command processing error: {str(error)}"}
			)

	def _set_capture_qos(self, hold):
		"""Best-effort OS boost while capture is live — never a camera-error."""
		try:
			result = boost_capture() if hold else release_capture()
		except Exception as error:
			result = f"failed:{error}"
		self.transport.send({"debug": f"process_qos {result}"})

	def _trace_header(self):
		return {
			"target_fps": int(self.camera.target_fps),
			"processing_resolution": list(self.camera.processing_resolution),
			"face_detect_interval": int(self.face_detect_interval),
			"pose_strictness": self.pose_strictness,
			"ear_calibration": self.detection.ear_calibration,
			"started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
		}

	def _record_trace_frame(
		self,
		*,
		current_time,
		face_status,
		luma,
		frame=None,
		left_ear=None,
		right_ear=None,
		avg_ear=None,
		pose=None,
		face_area=None,
		interocular=None,
		left_aperture=None,
		right_aperture=None,
		left_ocec=None,
		right_ocec=None,
	):
		if not self.trace.active:
			return
		payload = {
			"t": float(current_time),
			"left_ear": float(left_ear) if left_ear is not None else None,
			"right_ear": float(right_ear) if right_ear is not None else None,
			"avg_ear": float(avg_ear) if avg_ear is not None else None,
			"yaw": float(pose["yaw"]) if pose and pose.get("valid") else 0.0,
			"pitch": (
				float(pose["pitch"]) if pose and pose.get("valid") else 0.0
			),
			"pose_valid": bool(pose.get("valid")) if pose else False,
			"face_status": face_status or "none",
			"face_area": int(face_area) if face_area is not None else None,
			"interocular": (
				float(interocular) if interocular is not None else None
			),
			"luma": float(luma) if luma is not None else None,
			"left_aperture": (
				float(left_aperture) if left_aperture is not None else None
			),
			"right_aperture": (
				float(right_aperture) if right_aperture is not None else None
			),
			"left_ocec": (
				float(left_ocec) if left_ocec is not None else None
			),
			"right_ocec": (
				float(right_ocec) if right_ocec is not None else None
			),
		}
		self.trace.write_frame(payload, bgr=frame)

	def _sync_video_emit_interval(self):
		"""Match preview cadence to quality preset (not a hard 10 FPS cap)."""
		try:
			fps = int(self.camera.target_fps)
		except (TypeError, ValueError):
			fps = 15
		fps = max(8, min(fps, 30))
		self._video_min_interval = 1.0 / float(fps)

	def _preview_encode_options(self):
		"""Lighter JPEG at higher target FPS so encode does not add lag."""
		try:
			fps = int(self.camera.target_fps)
		except (TypeError, ValueError):
			fps = 15
		if fps >= 25:
			return {"max_width": 400, "quality": 40}
		if fps >= 18:
			return {"max_width": 480, "quality": 45}
		return {"max_width": 480, "quality": 50}

	def _apply_config_dict(self, data):
		if "camera_device" in data:
			self.camera.set_preferred_device(data["camera_device"])
		if "target_fps" in data:
			self.camera.update_target_fps(data["target_fps"])
			self.detection.set_target_fps(self.camera.target_fps)
			self._sync_video_emit_interval()
			self.transport.send(
				{
					"status": (
						"Updated target FPS to "
						f"{self.camera.target_fps}"
					)
				}
			)
		if "processing_resolution" in data:
			self.camera.update_processing_resolution(
				data["processing_resolution"]
			)
			self.transport.send(
				{
					"status": (
						"Updated processing resolution to "
						f"{self.camera.processing_resolution}"
					)
				}
			)
		if "face_detect_interval" in data:
			try:
				interval = int(data["face_detect_interval"])
			except (TypeError, ValueError):
				interval = 1
			self.face_detect_interval = max(1, interval)
			self._frames_since_face_detect = 0
			self.transport.send(
				{
					"status": (
						"Updated face detect interval to "
						f"{self.face_detect_interval}"
					)
				}
			)
		if "pose_strictness" in data:
			value = data["pose_strictness"]
			if value in ("loose", "normal", "strict"):
				self.pose_strictness = value
				self.detection.pose_strictness = value
				self.transport.send(
					{
						"status": (
							"Updated pose strictness to "
							f"{self.pose_strictness}"
						)
					}
				)
			else:
				self.transport.send(
					{
						"debug": (
							"Ignored invalid pose_strictness: "
							f"{value}"
						)
					}
				)

		if "ear_calibration" in data:
			value = data["ear_calibration"]
			if value is None or value == 0:
				self.detection.set_ear_calibration(None)
				self.transport.send({"status": "Cleared EAR calibration"})
			else:
				applied = self.detection.set_ear_calibration(value)
				if applied:
					self.transport.send(
						{
							"status": (
								"Applied EAR calibration "
								f"{self.detection.ear_calibration:.4f}"
							)
						}
					)
				else:
					self.transport.send(
						{
							"debug": (
								"Ignored invalid ear_calibration: "
								f"{value}"
							)
						}
					)

		if "classifier_calibration" in data:
			from blink_detector_package.domain.classifier import (
				clear_personal,
				personal_overlay,
				set_personal,
			)

			value = data["classifier_calibration"]
			if value is None:
				clear_personal()
				self.transport.send({"status": "Cleared classifier calibration"})
			elif isinstance(value, dict):
				set_personal(
					value.get("bias"),
					value.get("threshold"),
				)
				overlay = personal_overlay()
				self.transport.send(
					{
						"status": (
							"Applied classifier calibration "
							f"bias={overlay['bias']:.3f} "
							f"t={overlay['threshold']}"
						)
					}
				)
			else:
				self.transport.send(
					{
						"debug": (
							"Ignored invalid classifier_calibration: "
							f"{value}"
						)
					}
				)

	def _emit_video_stream(self, frame, face_data=None):
		"""JPEG plus same-frame overlay so preview dots/box stay locked to video.

		Cadence tracks target_fps (Ultra → 30). Encode is downscaled/quality-
		scaled so high presets stay responsive without a fixed 10 FPS cap.
		"""
		now = time.time()
		# Half-interval slack: avoid skipping a paced loop frame on tiny jitter.
		if now - self._last_video_emit < self._video_min_interval * 0.5:
			return
		self._last_video_emit = now
		frame_base64 = encode_frame(frame, **self._preview_encode_options())
		payload = {"jpeg": frame_base64}
		if face_data:
			payload["faceRect"] = face_data.get("faceRect")
			payload["eyeLandmarks"] = face_data.get("eyeLandmarks")
			payload["faceStatus"] = face_data.get("faceStatus")
			payload["faceDetected"] = face_data.get("faceDetected")
		self.transport.send({"videoStream": payload})

	def _update_measured_gate_fps(self, current_time, frame_dt):
		"""Drive blink gates from achieved loop rate, not just the quality preset."""
		if frame_dt <= 0 or frame_dt > 1.0:
			return
		if self._loop_dt_ema <= 0:
			self._loop_dt_ema = frame_dt
		else:
			self._loop_dt_ema = (0.85 * self._loop_dt_ema) + (0.15 * frame_dt)
		if current_time - self._last_gate_fps_update < 1.0:
			return
		self._last_gate_fps_update = current_time
		measured = 1.0 / max(self._loop_dt_ema, 1e-3)
		# Never invent a higher rate than the configured target.
		configured = float(self.camera.target_fps or DEFAULT_TARGET_FPS)
		gate_fps = max(8.0, min(configured, measured))
		self.detection.set_target_fps(gate_fps)

	def _clear_landmark_track(self):
		buf = getattr(self, "_vision_buffers", None)
		if buf is not None:
			buf.clear_landmark_track()

	def _begin_face_reacquire(self, force=False):
		"""Start the every-frame heavy-locate burst after a real loss / reopen."""
		if force or self._face_reacquire_frames <= 0:
			self._face_reacquire_frames = FACE_REACQUIRE_FRAMES

	def _face_detect_interval_now(self):
		interval = max(1, int(self.face_detect_interval))
		if self._cached_face is None and self._face_reacquire_frames <= 0:
			return max(interval, FACE_IDLE_DETECT_INTERVAL)
		return interval

	def _should_run_face_detect(self):
		if self._face_reacquire_frames > 0:
			return True
		if self._frames_since_face_detect <= 0:
			return True
		return self._frames_since_face_detect >= self._face_detect_interval_now()

	def _use_heavy_face_retries(self):
		"""Full HOG miss chain: no YuNet, or still in the re-acquire burst."""
		return self._yunet is None or self._face_reacquire_frames > 0

	def _resolve_face(self, detector, gray, buffers=None, frame=None):
		"""Run face detect on interval; otherwise reuse largest bbox.

		YuNet locates a real face; HOG-refine inside that ROI is the preferred
		crop for shape_predictor. Skip HOG-refine while the YuNet box is still
		(reuse last crop). If refine misses, keep a plausible YuNet box rather
		than dropping the face. Hold/EMA tiny box jitter so the crop (and
		68-pt) stay still.
		After a hard face loss (had a cache), force every-frame detect with
		heavy retries for FACE_REACQUIRE_FRAMES. Then idle-miss uses
		FACE_IDLE_DETECT_INTERVAL and YuNet-only locate. Do not reset the
		burst on every subsequent miss. Brief miss hold keeps last bbox.

		Micro-boxes (eye-as-face, ~44px on 480) fail face_bbox_plausible and
		count as miss, not too_far.
		"""
		if self._should_run_face_detect():
			face, retry_kind = run_face_detect(
				detector,
				gray,
				select_largest_face,
				buffers,
				bgr=frame,
				yunet=self._yunet,
				prev_face=self._cached_face,
				heavy_retries=self._use_heavy_face_retries(),
			)
			self._harvest_detect_stats(buffers)
			if face is not None:
				self._last_face_detect = retry_kind or "hog"
				if (
					retry_kind in FACE_RETRY_LOG_KINDS
					and face is not self._cached_face
				):
					self._maybe_log_hog_retry(retry_kind)
				face = stabilize_face_rect(self._cached_face, face)
				self._cached_face = face
				self._face_miss_streak = 0
				self._frames_since_face_detect = 1
				if self._face_reacquire_frames > 0:
					self._face_reacquire_frames -= 1
				return face
			self._face_miss_streak += 1
			if (
				self._cached_face is not None
				and self._face_miss_streak <= FACE_MISS_HOLD_FRAMES
			):
				self._frames_since_face_detect = 1
				return self._cached_face
			had_cache = self._cached_face is not None
			self._cached_face = None
			self._last_face_detect = None
			self._clear_landmark_track()
			if had_cache:
				self._begin_face_reacquire()
			elif self._face_reacquire_frames > 0:
				self._face_reacquire_frames -= 1
			self._frames_since_face_detect = 1
			return None

		self._frames_since_face_detect += 1
		return self._cached_face

	def _harvest_detect_stats(self, buffers):
		"""Fold per-call locate flags into the 3s camera_health window."""
		if buffers is None:
			return
		for name in DETECT_STAT_NAMES:
			value = int(getattr(buffers, f"stat_{name}", 0) or 0)
			attr = f"_health_{name}"
			setattr(self, attr, getattr(self, attr) + value)

	def _maybe_log_hog_retry(self, retry_kind):
		"""Rate-limited debug when miss-only HOG retry recovers a face."""
		now = time.time()
		if now - self._last_hog_retry_log_time < 2.0:
			return
		self._last_hog_retry_log_time = now
		self.transport.send(
			{"debug": f"Face recovered via retry face_detect={retry_kind}"}
		)

	def _face_quality_ok(self, face, landmarks, frame_w=0, frame_h=0):
		"""Reject tiny / junk faces before EAR (symmetric noise bypasses asymmetry)."""
		area = face_bbox_area(face) if face is not None else 0
		interocular = interocular_distance_px(landmarks)
		ok = area >= MIN_FACE_AREA_PX and interocular >= MIN_INTEROCULAR_PX
		if ok and frame_w > 0 and frame_h > 0:
			ok = face_bbox_plausible(face, frame_w, frame_h)
		return ok, area, interocular

	def _drop_junk_hog_face(self, face_data, current_time):
		"""Clutter HOG hit — no overlay, same as a hard miss."""
		self._cached_face = None
		self._clear_landmark_track()
		self._face_miss_streak = 0
		self._quality_miss_streak = 0
		self._landmark_trust_debouncer.reset()
		self._begin_face_reacquire()
		self._last_clahe_roi_count = 0
		had_candidate = False
		if self.detection.blink_in_progress:
			had_candidate = self.detection.cancel_on_face_lost(current_time)
		else:
			self.detection.mark_face_absent(current_time)
		self._emit_face_lost(current_time, had_candidate)
		face_data["faceDetected"] = False
		face_data["faceStatus"] = "none"

	def _suppress_actionable_hints(self, face_data, face, frame_width, frame_height):
		"""During re-acquire burst: keep bbox, emit ok, skip EAR/blink."""
		face_data["faceRect"] = {
			"x": float(face.left() / frame_width),
			"y": float(face.top() / frame_height),
			"width": float(face.width() / frame_width),
			"height": float(face.height() / frame_height),
		}
		face_data["faceDetected"] = True
		face_data["faceStatus"] = "ok"
		face_data["eyeLandmarks"] = []

	def _emit_soft_face_quality_skip(
		self,
		face_data,
		face,
		frame_width,
		frame_height,
		current_time,
		face_area,
		interocular,
	):
		"""Skip EAR on quality blip; hold face; cancel only after hold expires."""
		if self._face_reacquire_frames > 0:
			self._suppress_actionable_hints(
				face_data, face, frame_width, frame_height
			)
			return
		self._quality_miss_streak += 1
		soft_hold = self._quality_miss_streak <= FACE_QUALITY_HOLD_FRAMES
		face_data["faceRect"] = {
			"x": float(face.left() / frame_width),
			"y": float(face.top() / frame_height),
			"width": float(face.width() / frame_width),
			"height": float(face.height() / frame_height),
		}
		had_candidate = False
		if soft_hold:
			# Keep bbox / faceDetected — do not cancel mid-blink on 1–2 frame
			# quality noise (POG L1 Phase C).
			face_data["faceDetected"] = True
			face_data["faceStatus"] = "ok"
		else:
			if self.detection.blink_in_progress:
				had_candidate = self.detection.cancel_on_face_lost(current_time)
			else:
				self.detection.mark_face_absent(current_time)
			face_data["faceDetected"] = False
			face_data["faceStatus"] = "too_far"

		if had_candidate or self._should_emit_skip(
			"skip_face_quality",
			current_time,
		):
			if had_candidate:
				self._last_skip_debug_phase = "skip_face_quality"
				self._last_skip_debug_time = current_time
			self._emit_blink_outcome(
				{
					"phase": "skip_face_quality",
					"baseline": self.detection.current_baseline_ear,
					"drop": 0.0,
					"ear": 0.0,
					"face_area": face_area,
					"interocular": interocular,
					"quality_miss_streak": self._quality_miss_streak,
					"soft_hold": soft_hold,
					"look_down": False,
					"ear_depressed": self.detection.ear_depressed,
					"live_open_ear": self.detection.live_open_ear,
					"pose_strictness": self.pose_strictness,
					"resting_pitch": self.detection.resting_pitch,
					"min_velocity": 0.0,
					"duration": 0.0,
					"cooldown_remaining": 0.0,
					"absolute_drop": 0.0,
				},
				face=face,
				credited=False,
			)

	def _emit_track_quality_fail(
		self,
		face_data,
		face,
		frame_width,
		frame_height,
		current_time,
		face_area,
		interocular,
		status,
		reason,
		trust_metrics=None,
	):
		"""Landmark / close-up gate — honest status, no eye dots."""
		if self._face_reacquire_frames > 0:
			self._suppress_actionable_hints(
				face_data, face, frame_width, frame_height
			)
			return
		self._quality_miss_streak += 1
		face_data["faceRect"] = {
			"x": float(face.left() / frame_width),
			"y": float(face.top() / frame_height),
			"width": float(face.width() / frame_width),
			"height": float(face.height() / frame_height),
		}
		face_data["eyeLandmarks"] = []
		face_data["faceDetected"] = False
		face_data["faceStatus"] = status
		had_candidate = False
		if self._quality_miss_streak > FACE_QUALITY_HOLD_FRAMES:
			if self.detection.blink_in_progress:
				had_candidate = self.detection.cancel_on_face_lost(current_time)
			else:
				self.detection.mark_face_absent(current_time)
		if had_candidate or self._should_emit_skip(
			"skip_landmark_quality",
			current_time,
		):
			if had_candidate:
				self._last_skip_debug_phase = "skip_landmark_quality"
				self._last_skip_debug_time = current_time
			payload = {
				"phase": "skip_landmark_quality",
				"baseline": self.detection.current_baseline_ear,
				"drop": 0.0,
				"ear": 0.0,
				"face_area": face_area,
				"interocular": interocular,
				"area_frac": face_area_fraction(
					face, frame_width, frame_height
				),
				"quality_miss_streak": self._quality_miss_streak,
				"soft_hold": self._quality_miss_streak <= FACE_QUALITY_HOLD_FRAMES,
				"landmark_reason": reason,
				"trust_reason": reason,
				"face_status": status,
				"look_down": False,
				"ear_depressed": self.detection.ear_depressed,
				"live_open_ear": self.detection.live_open_ear,
				"pose_strictness": self.pose_strictness,
				"resting_pitch": self.detection.resting_pitch,
				"min_velocity": 0.0,
				"duration": 0.0,
				"cooldown_remaining": 0.0,
				"absolute_drop": 0.0,
			}
			if trust_metrics:
				if trust_metrics.get("yunet_eye_offset") is not None:
					payload["yunet_eye_offset"] = trust_metrics["yunet_eye_offset"]
				if trust_metrics.get("reproj_err_iod") is not None:
					payload["reproj_err_iod"] = trust_metrics["reproj_err_iod"]
			self._emit_blink_outcome(
				payload,
				face=face,
				credited=False,
			)

	def _should_emit_skip(self, phase, current_time):
		"""Emit immediately on phase change; throttle repeats of same skip."""
		if phase != self._last_skip_debug_phase:
			self._last_skip_debug_phase = phase
			self._last_skip_debug_time = current_time
			return True
		if current_time - self._last_skip_debug_time >= 0.5:
			self._last_skip_debug_time = current_time
			return True
		return False

	def _emit_face_lost(self, current_time, had_candidate):
		"""Emit skip_face_lost only when an in-progress candidate was cancelled."""
		if not had_candidate:
			return
		self._last_skip_debug_phase = "skip_face_lost"
		self._last_skip_debug_time = current_time
		self._emit_blink_outcome(
			{
				"phase": "skip_face_lost",
				"baseline": self.detection.current_baseline_ear,
				"drop": 0.0,
				"ear": 0.0,
				"ear_raw": 0.0,
				"ear_smooth": 0.0,
				"peak_velocity": 0.0,
				"peak_velocity_raw": 0.0,
				"peak_velocity_effective": 0.0,
				"peak_opening_velocity": 0.0,
				"closed_frames": 0,
				"min_velocity": 0.0,
				"duration": 0.0,
				"cooldown_remaining": 0.0,
				"absolute_drop": 0.0,
				"yaw": 0.0,
				"pitch": 0.0,
				"pitch_delta": 0.0,
				"look_down": False,
				"ear_depressed": self.detection.ear_depressed,
				"treat_as_look_down": False,
				"live_open_ear": self.detection.live_open_ear,
				"pose_strictness": self.pose_strictness,
				"resting_pitch": self.detection.resting_pitch,
			},
			face=None,
			credited=False,
		)

	def _should_emit_no_face(self, current_time):
		"""Emit immediately on ok/too_far → none; throttle idle none repeats."""
		edge = self._last_emitted_face_status != "none"
		if (
			not edge
			and (current_time - self._last_no_face_emit) < NO_FACE_EMIT_INTERVAL_S
		):
			return False
		self._last_emitted_face_status = "none"
		self._last_no_face_emit = current_time
		return True

	def _emit_face_data(self, face_data, current_time):
		status = face_data.get("faceStatus") or "none"
		if status == "none":
			if not self._should_emit_no_face(current_time):
				return
			self.transport.send_serialized(NO_FACE_DATA)
			return
		self._last_emitted_face_status = status
		self.transport.send({"faceData": face_data})

	def _blink_debug_payload(self, blink_info, face=None, credited=False):
		"""Structured + human-readable blink debug for tuning."""
		baseline = float(blink_info.get("baseline") or 0.0)
		drop = float(blink_info.get("drop") or 0.0)
		max_drop_ear = blink_info.get("max_drop_ear")
		if max_drop_ear is None and baseline > 0:
			max_drop_ear = baseline * (1.0 - drop)
		max_drop_ear = float(max_drop_ear or 0.0)
		absolute_drop = float(
			blink_info.get("absolute_drop")
			if blink_info.get("absolute_drop") is not None
			else (baseline - max_drop_ear)
		)
		left_ear = blink_info.get("left_ear")
		right_ear = blink_info.get("right_ear")
		resting = blink_info.get("resting_pitch")
		face_area = None
		if face is not None:
			try:
				face_area = int(face.width()) * int(face.height())
			except Exception:
				face_area = None

		def _opt_float(key):
			value = blink_info.get(key)
			return float(value) if value is not None else None

		payload = {
			"credited": bool(credited),
			"phase": blink_info.get("phase"),
			"ear": float(blink_info["ear"])
			if blink_info.get("ear") is not None
			else None,
			"ear_raw": _opt_float("ear_raw"),
			"ear_smooth": _opt_float("ear_smooth"),
			"baseline": baseline,
			"drop": drop,
			"drop_pct": drop * 100.0,
			"absolute_drop": absolute_drop,
			"max_drop_ear": max_drop_ear,
			"left_ear": float(left_ear) if left_ear is not None else None,
			"right_ear": float(right_ear) if right_ear is not None else None,
			"asymmetry": float(blink_info["asymmetry"])
			if blink_info.get("asymmetry") is not None
			else None,
			"yaw": float(blink_info.get("yaw") or 0.0),
			"pitch": float(blink_info.get("pitch") or 0.0),
			"pitch_delta": float(blink_info.get("pitch_delta") or 0.0),
			"resting_pitch": float(resting) if resting is not None else None,
			"pose_weight": _opt_float("pose_weight"),
			"look_down": bool(blink_info.get("look_down", False)),
			"ear_depressed": bool(blink_info.get("ear_depressed", False)),
			"treat_as_look_down": bool(
				blink_info.get("treat_as_look_down", False)
			),
			"live_open_ear": _opt_float("live_open_ear"),
			"pose_strictness": blink_info.get("pose_strictness")
			or self.pose_strictness,
			"peak_velocity": float(
				blink_info.get("peak_velocity")
				or blink_info.get("velocity")
				or 0.0
			),
			"peak_velocity_raw": _opt_float("peak_velocity_raw"),
			"peak_velocity_effective": _opt_float("peak_velocity_effective"),
			"peak_opening_velocity": float(
				blink_info.get("peak_opening_velocity") or 0.0
			),
			"closed_frames": int(blink_info.get("closed_frames") or 0),
			"min_velocity": float(blink_info.get("min_velocity") or 0.0),
			"duration": float(blink_info.get("duration") or 0.0),
			"cooldown_remaining": float(
				blink_info.get("cooldown_remaining") or 0.0
			),
			"threshold": float(blink_info.get("threshold") or 0.0),
			"merge": blink_info.get("merge"),
			"left_drop": _opt_float("left_drop"),
			"right_drop": _opt_float("right_drop"),
			"left_aperture": _opt_float("left_aperture"),
			"right_aperture": _opt_float("right_aperture"),
			"aperture_drop": _opt_float("aperture_drop"),
			"aperture_ok": (
				bool(blink_info["aperture_ok"])
				if blink_info.get("aperture_ok") is not None
				else None
			),
			"left_ocec": _opt_float("left_ocec"),
			"right_ocec": _opt_float("right_ocec"),
			"ocec_l": _opt_float("left_ocec"),
			"ocec_r": _opt_float("right_ocec"),
			"ocec_drop": _opt_float("ocec_drop"),
			"ocec_ok": (
				bool(blink_info["ocec_ok"])
				if blink_info.get("ocec_ok") is not None
				else None
			),
			"clf_p": _opt_float("clf_p"),
			"clf_veto": (
				bool(blink_info["clf_veto"])
				if blink_info.get("clf_veto") is not None
				else None
			),
			"waives": (
				[str(w) for w in blink_info["waives"]]
				if isinstance(blink_info.get("waives"), list)
				else []
			),
			"reject_gate": (
				str(blink_info["reject_gate"])
				if blink_info.get("reject_gate")
				else None
			),
			"live_open_aperture": _opt_float("live_open_aperture"),
			"face_area": (
				int(blink_info["face_area"])
				if blink_info.get("face_area") is not None
				else face_area
			),
			"interocular": _opt_float("interocular"),
			# Camera preset vs measured gate FPS (gates use detection.target_fps).
			"target_fps": int(self.camera.target_fps),
			"gate_fps": round(float(self.detection.target_fps), 2),
			"face_detect_interval": int(self.face_detect_interval),
			"processing_resolution": list(self.camera.processing_resolution),
			"detector_backend": "dlib",
			"face_detect": self._last_face_detect,
			"clahe": self._last_clahe_roi_count > 0,
			"clahe_roi_count": int(self._last_clahe_roi_count),
			"landmark_reason": blink_info.get("landmark_reason")
			or blink_info.get("trust_reason"),
			"trust_reason": blink_info.get("trust_reason")
			or blink_info.get("landmark_reason"),
			"yunet_eye_offset": _opt_float("yunet_eye_offset"),
			"reproj_err_iod": _opt_float("reproj_err_iod"),
		}

		phase = payload["phase"] or "?"
		prefix = "Blink credited" if credited else f"Blink rejected ({phase})"
		resting_s = (
			f"{payload['resting_pitch']:.2f}"
			if payload["resting_pitch"] is not None
			else "n/a"
		)
		left_s = (
			f"{payload['left_ear']:.3f}"
			if payload["left_ear"] is not None
			else "n/a"
		)
		right_s = (
			f"{payload['right_ear']:.3f}"
			if payload["right_ear"] is not None
			else "n/a"
		)
		asym_s = (
			f"{payload['asymmetry']:.2f}"
			if payload["asymmetry"] is not None
			else "n/a"
		)
		ear_raw_s = (
			f"{payload['ear_raw']:.3f}"
			if payload["ear_raw"] is not None
			else "n/a"
		)
		ear_smooth_s = (
			f"{payload['ear_smooth']:.3f}"
			if payload["ear_smooth"] is not None
			else "n/a"
		)
		clf_s = (
			f"{payload['clf_p']:.2f}"
			if payload.get("clf_p") is not None
			else "n/a"
		)
		line = (
			f"{prefix}: EAR={max_drop_ear:.3f}, baseline={baseline:.3f}, "
			f"drop={drop:.1%}, abs={absolute_drop:.3f}, "
			f"dur={payload['duration']:.3f}s, "
			f"vel={payload['peak_velocity']:.2f}/{payload['min_velocity']:.2f}, "
			f"openVel={payload['peak_opening_velocity']:.2f}, "
			f"closed={payload['closed_frames']}, "
			f"raw/smooth={ear_raw_s}/{ear_smooth_s}, "
			f"L/R={left_s}/{right_s} asym={asym_s}, "
			f"yaw={payload['yaw']:.2f}, pitch={payload['pitch']:.2f}, "
			f"dPitch={payload['pitch_delta']:.2f}, restPitch={resting_s}, "
			f"lookDown={payload['look_down']}, "
			f"clfP={clf_s} veto={payload.get('clf_veto')}, "
			f"strict={payload['pose_strictness']}, "
			f"backend={payload['detector_backend']}, "
			f"faceDetect={payload.get('face_detect')}, "
			f"cdLeft={payload['cooldown_remaining']:.3f}s, "
			f"fps={payload['target_fps']}, "
			f"fInt={payload['face_detect_interval']}, "
			f"res={payload['processing_resolution']}, "
			f"faceArea={face_area}"
		)
		return payload, line

	def _emit_blink_outcome(self, blink_info, face=None, credited=False):
		payload, line = self._blink_debug_payload(
			blink_info, face=face, credited=credited
		)
		self.transport.send({"debug": line})
		self.transport.send({"blinkDebug": payload})
		return payload

	def _fill_eye_landmarks_ui(self, face_data, left_eye, right_eye, buffers, frame_width, frame_height):
		buffers.concatenated_eyes[:6] = left_eye
		buffers.concatenated_eyes[6:] = right_eye
		for index in range(12):
			buffers.normalized_landmarks[index]["x"] = float(
				buffers.concatenated_eyes[index, 0] / frame_width
			)
			buffers.normalized_landmarks[index]["y"] = float(
				buffers.concatenated_eyes[index, 1] / frame_height
			)
		face_data["eyeLandmarks"] = buffers.normalized_landmarks.copy()

	def _score_ocec_eyes(self, frame, left_eye, right_eye, pose):
		"""OCEC prob_open per eye, or (None, None) when disabled / side yaw."""
		if self._ocec is None:
			return None, None
		yaw = 0.0
		if isinstance(pose, dict):
			try:
				yaw = float(pose.get("yaw") or 0.0)
			except (TypeError, ValueError):
				yaw = 0.0
		if abs(yaw) >= CLASSIFIER_SIDE_YAW_WAIVE:
			return None, None
		return (
			score_eye_open(self._ocec, frame, left_eye),
			score_eye_open(self._ocec, frame, right_eye),
		)

	def _handle_detection(
		self,
		face_data,
		avg_ear,
		current_time,
		left_ear,
		right_ear,
		pose,
		face,
		left_aperture=None,
		right_aperture=None,
		left_ocec=None,
		right_ocec=None,
	):
		blink_detected, blink_info = self.detection.detect(
			avg_ear,
			current_time,
			left_ear=left_ear,
			right_ear=right_ear,
			pose=pose,
			left_aperture=left_aperture,
			right_aperture=right_aperture,
			left_ocec=left_ocec,
			right_ocec=right_ocec,
		)
		phase = (blink_info or {}).get("phase")
		if blink_detected and blink_info:
			self.last_blink_display_time = current_time
			face_data["blink"] = True
			max_drop_ear = blink_info.get(
				"max_drop_ear",
				avg_ear,
			)
			self.transport.send(
				{
					"blink": True,
					"ear": float(max_drop_ear),
					"baseline": float(blink_info["baseline"]),
					"drop_percentage": float(blink_info["drop"]),
					"duration": float(blink_info["duration"]),
					"time": float(current_time),
				}
			)
			debug_payload = self._emit_blink_outcome(
				blink_info,
				face=face,
				credited=True,
			)
			face_data["blinkDebug"] = debug_payload
		elif phase and str(phase).startswith("reject_"):
			debug_payload = self._emit_blink_outcome(
				blink_info,
				face=face,
				credited=False,
			)
			face_data["blinkDebug"] = debug_payload
		elif phase == "start":
			debug_payload = self._emit_blink_outcome(
				blink_info,
				face=face,
				credited=False,
			)
			face_data["blinkDebug"] = debug_payload
		elif phase == "baseline_drift_nudge":
			debug_payload = self._emit_blink_outcome(
				blink_info,
				face=face,
				credited=False,
			)
			face_data["blinkDebug"] = debug_payload
		elif phase in (
			"skip_yaw",
			"skip_yaw_hold",
			"skip_degraded",
			"skip_eyes_closed",
			"skip_await_open",
			"skip_cooldown",
			"skip_face_quality",
		):
			if self._should_emit_skip(phase, current_time):
				debug_payload = self._emit_blink_outcome(
					{
						**blink_info,
						"ear": avg_ear,
						"left_ear": left_ear,
						"right_ear": right_ear,
						"pose_strictness": self.pose_strictness,
						"resting_pitch": self.detection.resting_pitch,
						"look_down": blink_info.get("look_down", False),
						"min_velocity": blink_info.get("min_velocity", 0.0),
						"duration": 0.0,
						"absolute_drop": blink_info.get("absolute_drop", 0.0),
					},
					face=face,
					credited=False,
				)
				face_data["blinkDebug"] = debug_payload
		elif phase == "monitoring" and blink_info:
			vel = float(blink_info.get("velocity") or 0.0)
			min_vel = float(blink_info.get("min_velocity") or 0.35)
			ref = float(
				blink_info.get("live_open_ear")
				or blink_info.get("baseline")
				or 0.0
			)
			close_band = blink_info.get("close_band_ear")
			ear_s = float(blink_info.get("ear_smooth") or avg_ear)
			near_band = (
				close_band is not None
				and ref > 0
				and ear_s <= float(close_band) * 1.02
				and ear_s > float(close_band)
			)
			# Velocity-only near_miss spammed look-down chat (~90/min) with
			# drop≈0 (POG 2026-08-10). Require some EAR drop for the vel path.
			drop_pct = float(blink_info.get("drop") or 0.0)
			near_vel = vel >= min_vel * 0.90 and drop_pct >= 0.08
			if (near_band or near_vel) and (
				current_time - self._last_near_miss_debug_time >= 2.0
			):
				self._last_near_miss_debug_time = current_time
				debug_payload = self._emit_blink_outcome(
					{
						**blink_info,
						"phase": "near_miss",
						"ear": avg_ear,
						"left_ear": left_ear,
						"right_ear": right_ear,
						"duration": 0.0,
					},
					face=face,
					credited=False,
				)
				face_data["blinkDebug"] = debug_payload
		elif (
			current_time - self.last_blink_display_time
		) < BLINK_DISPLAY_DURATION:
			face_data["blink"] = True

		if blink_info and self.detection.current_baseline_ear > 0:
			face_data["baseline"] = float(
				self.detection.current_baseline_ear
			)
			face_data["blink_phase"] = blink_info.get(
				"phase",
				"monitoring",
			)
			if blink_info.get("phase") == "monitoring":
				smooth = blink_info.get("ear_smooth", avg_ear)
				current_ear_drop_absolute = (
					self.detection.current_baseline_ear - smooth
				)
				if current_ear_drop_absolute > 0:
					face_data["ear_drop_absolute"] = float(
						current_ear_drop_absolute
					)
					face_data["ear_drop_percentage"] = float(
						current_ear_drop_absolute
						/ self.detection.current_baseline_ear
					)
		elif self.detection.current_baseline_ear == 0:
			face_data["blink_phase"] = "initializing"

	def run(self):
		self.transport.send(
			{"status": "Starting blink detector in standby mode..."}
		)
		detector, predictor, predictor_path, yunet = load_models()
		self._yunet = yunet
		self._ocec = load_ocec() if get_ocec_enabled() else None
		if detector is None or predictor is None:
			self.transport.send(
				{
					"error": (
						"Facial landmark model not found at: "
						f"{predictor_path}"
					)
				}
			)
			sys.exit(1)

		buffers = PreallocatedBuffers()
		self._vision_buffers = buffers
		self.transport.send(
			{
				"status": (
					"Models loaded successfully, ready for camera activation"
				)
			}
		)
		self.transport.send(
			{
				"debug": (
					"Face detect: yunet+hog"
					if self._yunet is not None
					else "Face detect: hog-only (YuNet ONNX missing)"
				)
			}
		)
		if get_ocec_enabled():
			self.transport.send(
				{
					"debug": (
						"OCEC confirm: on"
						if self._ocec is not None
						else "OCEC confirm: on but ONNX missing (skip)"
					)
				}
			)
		else:
			self.transport.send({"debug": "OCEC confirm: off"})
		self.transport.send(
			{
				"debug": (
					"Advanced blink detection with dynamic baseline, "
					"EAR smooth, velocity, bilateral, and pose gates is active"
				)
			}
		)
		try:
			exe_path = Path(sys.executable)
			if getattr(sys, "frozen", False):
				mtime = os.path.getmtime(exe_path)
				self.transport.send(
					{
						"debug": (
							f"Blink binary: {exe_path} "
							f"mtime_utc={time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(mtime))}"
						)
					}
				)
		except OSError:
			pass

		frame_count = 0
		last_frame_time = time.time()
		default_face_data = {
			"faceDetected": False,
			"faceStatus": "none",
			"ear": 0.0,
			"blink": False,
			"faceRect": {
				"x": 0,
				"y": 0,
				"width": 0,
				"height": 0,
			},
			"eyeLandmarks": [],
		}
		self.transport.start_input_thread()

		try:
			while True:
				self.process_commands()
				if self._should_exit:
					break
				if (
					not self.camera.active
					or self.camera.capture is None
				):
					if is_boosted():
						self._set_capture_qos(False)
					time.sleep(0.1)
					continue

				current_time = time.time()
				# Recompute each frame so live target_fps updates take effect.
				frame_interval = 1.0 / self.camera.target_fps
				wait_s = pace_wait_s(
					current_time, last_frame_time, frame_interval
				)
				if wait_s > 0:
					time.sleep(wait_s)
					continue
				last_frame_time = current_time

				ret, frame = self.camera.capture.read()
				if not ret or frame is None:
					self.transport.send({"error": "Failed to read frame"})
					time.sleep(0.1)
					continue

				# Native capture size; quality preset is an aspect-preserving cap.
				frame = resize_to_processing(
					frame, self.camera.processing_resolution
				)

				face_data = default_face_data.copy()
				# Black / empty capture: skip HOG (avoids junk mouth boxes) but
				# still stream preview + health so diagnostics stay honest.
				black, luma = self._frame_luma_and_black(frame, current_time)
				if black:
					self._commit_frame_health(
						luma, True, "none", current_time
					)
					if (
						self._black_streak_start is not None
						and current_time - self._black_streak_start
						>= BLACK_STREAK_S
					):
						streak_ms = int(
							(current_time - self._black_streak_start) * 1000
						)
						self.camera.recover_from_black_frames(
							self.detection.reset,
							streak_ms,
							luma,
						)
						self._cached_face = None
						self._clear_landmark_track()
						self._reset_capture_health()
						self._begin_face_reacquire(force=True)
						if self._last_processed_frame_time > 0:
							self._update_measured_gate_fps(
								current_time,
								current_time - self._last_processed_frame_time,
							)
						self._last_processed_frame_time = current_time
						continue

					self._cached_face = None
					self._clear_landmark_track()
					had_candidate = self.detection.cancel_on_face_lost(
						current_time
					)
					self._emit_face_lost(current_time, had_candidate)
					self._record_trace_frame(
						current_time=current_time,
						face_status="none",
						luma=luma,
						frame=frame,
					)
					self._emit_face_data(
						{"faceStatus": "none"}, current_time
					)
					if self.send_video:
						self._emit_video_stream(frame)
					if self._last_processed_frame_time > 0:
						self._update_measured_gate_fps(
							current_time,
							current_time - self._last_processed_frame_time,
						)
					self._last_processed_frame_time = current_time
					frame_count += 1
					continue

				frame_width = frame.shape[1]
				frame_height = frame.shape[0]
				face = None
				left_eye = None
				right_eye = None
				landmarks = None
				trace_left = None
				trace_right = None
				trace_avg = None
				trace_pose = None
				trace_area = None
				trace_iod = None
				trace_left_ap = None
				trace_right_ap = None
				trace_left_ocec = None
				trace_right_ocec = None

				gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
				# YuNet locates; HOG-refine is the 68-pt crop.
				# Landmark CLAHE stays parked (CLAHE_ENABLED / L2-A).
				face = self._resolve_face(detector, gray, buffers, frame=frame)
				if face is not None:
					landmarks, left_eye, right_eye = get_face_landmarks(
						predictor,
						gray,
						face,
						buffers,
					)
					self._last_clahe_roi_count = int(
						buffers.clahe_roi_count or 0
					)

				if face is not None and left_eye is not None:
					quality_ok, face_area, interocular = self._face_quality_ok(
						face,
						landmarks,
						frame_width,
						frame_height,
					)
					trace_area = face_area
					trace_iod = interocular
					if not quality_ok:
						if not face_bbox_plausible(
							face, frame_width, frame_height
						):
							self._drop_junk_hog_face(
								face_data, current_time
							)
						else:
							self._fill_eye_landmarks_ui(
								face_data,
								left_eye,
								right_eye,
								buffers,
								frame_width,
								frame_height,
							)
							self._emit_soft_face_quality_skip(
								face_data,
								face,
								frame_width,
								frame_height,
								current_time,
								face_area,
								interocular,
							)
					else:
						too_close = is_face_too_close(
							face, frame_width, frame_height
						)
						yunet_kps = None
						# YuNet keypoints only apply when this frame's locate came
						# from YuNet→HOG refine, not stale kps vs a hog/clahe box.
						if self._last_face_detect in ("hog", "yunet"):
							if buffers is not None and int(
								getattr(buffers, "stat_yunet_hit", 0) or 0
							) > 0:
								yunet_kps = getattr(
									buffers, "last_yunet_keypoints", None
								)
						pose = estimate_head_pose(
							landmarks,
							image_size=(frame_width, frame_height),
						)
						frame_trusted, trust_reason, trust_metrics = (
							evaluate_landmark_trust(
								face,
								landmarks,
								pose,
								yunet_kps=yunet_kps,
							)
						)
						emit_trusted = (
							self._landmark_trust_debouncer.should_emit_trusted(
								frame_trusted
							)
						)
						if too_close:
							self._landmark_trust_debouncer.reset()
							self._emit_track_quality_fail(
								face_data,
								face,
								frame_width,
								frame_height,
								current_time,
								face_area,
								interocular,
								"too_close",
								"area_frac",
							)
						elif not emit_trusted:
							self._emit_track_quality_fail(
								face_data,
								face,
								frame_width,
								frame_height,
								current_time,
								face_area,
								interocular,
								landmark_fail_face_status(trust_reason),
								trust_reason,
								trust_metrics=trust_metrics,
							)
						else:
							self._quality_miss_streak = 0
							left_ear = calculate_ear_fast(left_eye, buffers)
							right_ear = calculate_ear_fast(right_eye, buffers)
							avg_ear = (left_ear + right_ear) * 0.5
							left_aperture = eye_intensity_aperture(gray, left_eye)
							right_aperture = eye_intensity_aperture(
								gray, right_eye
							)
							left_ocec, right_ocec = self._score_ocec_eyes(
								frame, left_eye, right_eye, pose
							)
							trace_left = left_ear
							trace_right = right_ear
							trace_avg = avg_ear
							trace_pose = pose
							trace_left_ap = left_aperture
							trace_right_ap = right_aperture
							trace_left_ocec = left_ocec
							trace_right_ocec = right_ocec
							face_data["faceDetected"] = True
							face_data["faceStatus"] = "ok"
							face_data["ear"] = float(avg_ear)
							face_data["faceRect"] = {
								"x": float(face.left() / frame_width),
								"y": float(face.top() / frame_height),
								"width": float(face.width() / frame_width),
								"height": float(face.height() / frame_height),
							}
							self._fill_eye_landmarks_ui(
								face_data,
								left_eye,
								right_eye,
								buffers,
								frame_width,
								frame_height,
							)
							self._handle_detection(
								face_data,
								avg_ear,
								current_time,
								left_ear,
								right_ear,
								pose,
								face,
								left_aperture=left_aperture,
								right_aperture=right_aperture,
								left_ocec=left_ocec,
								right_ocec=right_ocec,
							)
				else:
					if face is not None:
						if not face_bbox_plausible(
							face, frame_width, frame_height
						):
							self._drop_junk_hog_face(
								face_data, current_time
							)
						else:
							# HOG ok but landmarks missing — same soft hold as
							# quality floors (area/IOD). Keep bbox; avoid UI flash.
							area = face_bbox_area(face)
							trace_area = area
							trace_iod = 0.0
							self._emit_soft_face_quality_skip(
								face_data,
								face,
								frame_width,
								frame_height,
								current_time,
								area,
								0.0,
							)
					else:
						self._quality_miss_streak = 0
						self._last_clahe_roi_count = 0
						had_candidate = self.detection.cancel_on_face_lost(
							current_time
						)
						self._emit_face_lost(current_time, had_candidate)

				self._record_trace_frame(
					current_time=current_time,
					face_status=face_data.get("faceStatus") or "none",
					luma=luma,
					frame=frame,
					left_ear=trace_left,
					right_ear=trace_right,
					avg_ear=trace_avg,
					pose=trace_pose,
					face_area=trace_area,
					interocular=trace_iod,
					left_aperture=trace_left_ap,
					right_aperture=trace_right_ap,
					left_ocec=trace_left_ocec,
					right_ocec=trace_right_ocec,
				)
				self._commit_frame_health(
					luma,
					False,
					face_data.get("faceStatus") or "none",
					current_time,
				)
				if self._maybe_failover_no_face(current_time):
					frame_count += 1
					continue

				self._emit_face_data(face_data, current_time)

				if self.send_video:
					self._emit_video_stream(frame, face_data)
				if self._last_processed_frame_time > 0:
					self._update_measured_gate_fps(
						current_time,
						current_time - self._last_processed_frame_time,
					)
				self._last_processed_frame_time = current_time
				frame_count += 1
		except KeyboardInterrupt:
			self.transport.send(
				{"status": "Stopping blink detector..."}
			)
		finally:
			stopped = self.trace.stop()
			if stopped:
				self.transport.send(
					{
						"status": (
							"Trace recording stopped "
							f"path={stopped['path']} "
							f"frames={stopped['frames']}"
						)
					}
				)
			self.camera.stop(reason="detector_exit")
			self._set_capture_qos(False)
			self.transport.send({"status": "Blink detector stopped"})
			self.transport.stop()


def run():
	BlinkDetectorApplication().run()
