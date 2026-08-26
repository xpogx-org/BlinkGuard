import json
import os
import subprocess
import sys
import time
from contextlib import contextmanager

import cv2

# OpenCV MSMF + HW transforms often fails stream selection on Win10/11;
# disable unless the user already set the env.
if sys.platform == "win32":
	os.environ.setdefault("OPENCV_VIDEOIO_MSMF_ENABLE_HW_TRANSFORMS", "0")

TARGET_FPS = 10
PROCESSING_RESOLUTION = (320, 240)

# Frames below this mean luma (0–255) are treated as black / unusable.
BLACK_LUMA_THRESHOLD = 12.0
WARMUP_READS = 12
WARMUP_MIN_GOOD = 2
# Runtime: reopen/failover after this many consecutive black seconds.
BLACK_STREAK_S = 2.0
# After open: if frames flow but no usable face, try the next backend (DSHOW↔MSMF).
NO_FACE_FAILOVER_S = 5.0
# Cap no-face failovers per process so an empty room does not spin forever.
MAX_NO_FACE_FAILOVERS = 2
HEALTH_INTERVAL_S = 3.0


def mean_luma(frame) -> float:
	"""Average brightness of a BGR/gray frame (0–255)."""
	if frame is None or getattr(frame, "size", 0) == 0:
		return 0.0
	# cv2.mean is one pass — avoid split() copies on every detector frame.
	channels = cv2.mean(frame)
	if len(frame.shape) == 2:
		return float(channels[0])
	b, g, r = channels[0], channels[1], channels[2]
	return float(0.114 * b + 0.587 * g + 0.299 * r)


def is_black_frame(frame, threshold=BLACK_LUMA_THRESHOLD) -> bool:
	return mean_luma(frame) < threshold


def backend_name(backend) -> str:
	names = {
		getattr(cv2, "CAP_DSHOW", -1): "DSHOW",
		getattr(cv2, "CAP_MSMF", -1): "MSMF",
		getattr(cv2, "CAP_AVFOUNDATION", -1): "AVFOUNDATION",
		getattr(cv2, "CAP_V4L2", -1): "V4L2",
		getattr(cv2, "CAP_ANY", -1): "ANY",
	}
	return names.get(backend, str(backend))


def fourcc_to_str(value) -> str:
	try:
		code = int(value)
	except (TypeError, ValueError):
		return ""
	if code <= 0:
		return ""
	chars = "".join(chr((code >> (8 * i)) & 0xFF) for i in range(4))
	return chars.strip("\x00") or ""


def is_mjpg_fourcc(code: str) -> bool:
	"""True for MJPG or endian-swapped GPJM from some CAP_PROP getters."""
	normalized = (code or "").upper().replace("\x00", "")
	return normalized in ("MJPG", "GPJM")


def enumerate_camera_device_names() -> list[str]:
	"""Friendly names only (tests / debug). Prefer enumerate_camera_devices()."""
	return [item["name"] for item in enumerate_camera_devices() if item.get("name")]


def enumerate_camera_devices() -> list[dict]:
	"""Best-effort OS inventory: [{name, id}, ...] (not OpenCV CAP indices).

	Index order may not match OpenCV's CAP_* enumeration — treat as a device
	inventory, and only as a soft hint when using the same numeric index.
	"""
	if sys.platform == "win32":
		return _enumerate_windows_camera_devices()
	if sys.platform == "darwin":
		return _enumerate_darwin_camera_devices()
	return _enumerate_linux_camera_devices()


def _dedupe_devices(devices: list[dict]) -> list[dict]:
	cleaned = []
	seen = set()
	for item in devices:
		name = (item.get("name") or "").strip()
		device_id = (item.get("id") or "").strip()
		if not name and not device_id:
			continue
		key = device_id.lower() if device_id else f"name:{name.lower()}"
		if key in seen:
			continue
		seen.add(key)
		cleaned.append({"name": name, "id": device_id})
	return cleaned


def _enumerate_windows_camera_devices() -> list[dict]:
	# PnP Camera/Image class — no extra Python deps (PyInstaller-friendly).
	creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
	try:
		completed = subprocess.run(
			[
				"powershell",
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				(
					"Get-CimInstance Win32_PnPEntity | "
					"Where-Object { $_.PNPClass -eq 'Camera' -or $_.PNPClass -eq 'Image' } | "
					"ForEach-Object { '{0}`t{1}' -f $_.Name, $_.PNPDeviceID }"
				),
			],
			capture_output=True,
			text=True,
			timeout=8,
			creationflags=creationflags,
		)
	except Exception:
		return []
	if completed.returncode != 0:
		return []
	devices = []
	for line in (completed.stdout or "").splitlines():
		raw = line.strip()
		if not raw:
			continue
		if "\t" in raw:
			name, device_id = raw.split("\t", 1)
		else:
			name, device_id = raw, ""
		devices.append({"name": name.strip(), "id": device_id.strip()})
	return _dedupe_devices(devices)


def _enumerate_darwin_camera_devices() -> list[dict]:
	try:
		completed = subprocess.run(
			["system_profiler", "SPCameraDataType", "-json"],
			capture_output=True,
			text=True,
			timeout=8,
		)
	except Exception:
		return []
	if completed.returncode != 0 or not completed.stdout:
		return []
	try:
		payload = json.loads(completed.stdout)
	except Exception:
		return []
	devices = []
	for item in payload.get("SPCameraDataType") or []:
		name = (item.get("_name") or item.get("name") or "").strip()
		device_id = (
			item.get("unique_id")
			or item.get("spcamera_unique-id")
			or item.get("unique-id")
			or ""
		)
		if isinstance(device_id, str):
			device_id = device_id.strip()
		else:
			device_id = str(device_id) if device_id else ""
		devices.append({"name": name, "id": device_id})
	return _dedupe_devices(devices)


def _enumerate_linux_camera_devices() -> list[dict]:
	base = "/sys/class/video4linux"
	if not os.path.isdir(base):
		return []
	try:
		entries = sorted(os.listdir(base))
	except OSError:
		return []
	devices = []
	for entry in entries:
		if not entry.startswith("video"):
			continue
		name_path = os.path.join(base, entry, "name")
		try:
			with open(name_path, encoding="utf-8", errors="replace") as handle:
				name = handle.read().strip()
		except OSError:
			name = entry
		devices.append({"name": name or entry, "id": f"/dev/{entry}"})
	return _dedupe_devices(devices)


@contextmanager
def opencv_quiet_warnings():
	"""Drop OpenCV WARN spam (e.g. MSMF initStream) during probe/open."""
	getter = getattr(cv2, "getLogLevel", None)
	setter = getattr(cv2, "setLogLevel", None)
	if getter is None or setter is None:
		yield
		return
	previous = getter()
	try:
		setter(getattr(cv2, "LOG_LEVEL_ERROR", 2))
		yield
	finally:
		setter(previous)


class OpenCVCamera:
	def __init__(self, transport):
		self.transport = transport
		self.capture = None
		self.active = False
		self.target_fps = TARGET_FPS
		self.processing_resolution = PROCESSING_RESOLUTION
		self.camera_index = None
		self.backend = None
		self.fourcc = None
		# Last successful open — tried first on the next start.
		self._preferred_index = None
		self._preferred_backend = None
		self._failover_cursor = 0
		self._no_face_failovers = 0
		# Soft device inventory for diagnostics (may not match OpenCV indices).
		self._device_names: list[str] = []
		self._device_ids: list[str] = []
		# User picker (Electron prefs). Empty = Automatic scan.
		self._requested_id = ""
		self._requested_name = ""
		self._requested_index = None

	def emit_camera_state(self, kind, **fields):
		payload = {"kind": kind, **fields}
		# Dual-channel: structured cameraState for tooling + short debug for
		# support zips that only skim message text.
		self.transport.send(
			{
				"cameraState": payload,
				"debug": f"cameraState {kind}",
			}
		)

	def _device_name_for_index(self, index) -> str | None:
		if index is None or index < 0 or index >= len(self._device_names):
			return None
		return self._device_names[index]

	def _device_id_for_index(self, index) -> str | None:
		if index is None or index < 0 or index >= len(self._device_ids):
			return None
		value = self._device_ids[index]
		return value or None

	def set_preferred_device(self, device):
		"""Apply Electron `camera_device` (or None / {} for Automatic)."""
		if not isinstance(device, dict):
			self._requested_id = ""
			self._requested_name = ""
			self._requested_index = None
			return
		self._requested_id = str(device.get("id") or "").strip()
		self._requested_name = str(device.get("name") or "").strip()
		raw_index = device.get("index")
		try:
			index = int(raw_index)
		except (TypeError, ValueError):
			index = None
		if index is not None and 0 <= index <= 4:
			self._requested_index = index
		else:
			self._requested_index = None

	def refresh_inventory(self):
		self._refresh_device_inventory()

	def _has_requested_device(self) -> bool:
		return bool(self._requested_id or self._requested_name)

	def _inventory_index_for_requested(self):
		if self._requested_id:
			wanted = self._requested_id.casefold()
			for i, device_id in enumerate(self._device_ids):
				if device_id and device_id.casefold() == wanted:
					return i
		if self._requested_name:
			wanted = self._requested_name.casefold()
			for i, name in enumerate(self._device_names):
				if name and name.casefold() == wanted:
					return i
		return None

	def _inventory_contains_requested(self) -> bool:
		return self._inventory_index_for_requested() is not None

	def _pin_failover_to_current_index(self) -> bool:
		return (
			self._inventory_contains_requested()
			and self.camera_index is not None
		)

	def _opened_matches_request(self) -> bool:
		# Soft inventory index ≠ OpenCV index. Reject only when a friendly
		# name exists at this OpenCV index and disagrees with lastKnownName.
		if not self._inventory_contains_requested() or not self._requested_name:
			return True
		got_name = self._device_name_for_index(self.camera_index)
		if not got_name:
			return True
		return got_name.casefold() == self._requested_name.casefold()

	def _reject_opened(self, capture):
		try:
			capture.release()
		except Exception:
			pass
		self.camera_index = None
		self.backend = None

	def _emit_requested_notice(self, kind):
		self.emit_camera_state(
			kind,
			requested_id=self._requested_id or None,
			requested_name=self._requested_name or None,
			requested_index=self._requested_index,
		)

	def _refresh_device_inventory(self):
		raw = enumerate_camera_devices()
		self._device_names = [item.get("name") or "" for item in raw]
		self._device_ids = [item.get("id") or "" for item in raw]
		devices = [
			{
				"index": i,
				"name": self._device_names[i],
				"id": self._device_ids[i],
			}
			for i in range(len(self._device_names))
		]
		self.emit_camera_state(
			"camera_devices",
			devices=devices,
			names=list(self._device_names),
			count=len(self._device_names),
			index_match="soft",
		)
		if self._device_names:
			joined = "; ".join(
				f"{i}={name}" for i, name in enumerate(self._device_names)
			)
			self.transport.send({"debug": f"Camera devices: {joined}"})
		else:
			self.transport.send({"debug": "Camera devices: (none enumerated)"})

	def _platform_backends(self):
		if sys.platform == "win32":
			# LOCKED (field-validated, built-in laptop cam, diagnostics 20260809, post-2.4.0):
			# Prefer MSMF first. Do NOT switch back to DSHOW-first without new
			# Export diagnostics — DSHOW + forced MJPG + 4:3 snap produced
			# sustained black frames (luma≈0.3) on that machine; MSMF worked.
			# (Logitech C170 / Fatar: healthy capture, daylight detect miss —
			# fix locate in vision.py / aspect-fit, not this open path.)
			# DSHOW remains failover. Skip CAP_ANY (re-enters MSMF).
			# Also locked: no FOURCC / size / FPS CAP_PROP on open.
			return [cv2.CAP_MSMF, cv2.CAP_DSHOW]
		if sys.platform == "darwin":
			return [cv2.CAP_AVFOUNDATION, cv2.CAP_ANY]
		return [cv2.CAP_V4L2, cv2.CAP_ANY]

	def _candidate_pairs(self):
		"""Ordered (index, backend) attempts: preferred first, then scan.

		Index-major order: try camera 0 on every backend before probing 1–4.
		Cold start otherwise hammers empty indices before a working @0 pair.
		"""
		backends = self._platform_backends()
		pairs = []
		seen = set()

		def add(index, backend):
			key = (index, backend)
			if key in seen:
				return
			seen.add(key)
			pairs.append(key)

		if self._requested_index is not None:
			for backend in backends:
				add(self._requested_index, backend)

		if (
			self._preferred_index is not None
			and self._preferred_backend is not None
		):
			add(self._preferred_index, self._preferred_backend)

		hint = self._inventory_index_for_requested()
		if hint is not None:
			for backend in backends:
				add(hint, backend)

		for index in range(5):
			for backend in backends:
				add(index, backend)
		return pairs

	def _apply_capture_props(self, capture=None):
		cap = capture if capture is not None else self.capture
		if cap is None:
			return
		# Native stream: do not negotiate FOURCC / size / FPS. Those CAP_PROP
		# sets are what blacked out a built-in laptop cam (2.4.0: DSHOW + MJPG
		# + 4:3 snap) and still break odd UVC modes. Quality preset is software
		# only (detector resize + frame throttle). BUFFERSIZE is latency, not
		# format. LOCKED with _platform_backends — do not reintroduce size /
		# FOURCC / FPS sets without fresh Export diagnostics.
		fourcc_actual = fourcc_to_str(cap.get(cv2.CAP_PROP_FOURCC))

		try:
			cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
		except Exception:
			pass

		actual_width = cap.get(cv2.CAP_PROP_FRAME_WIDTH)
		actual_height = cap.get(cv2.CAP_PROP_FRAME_HEIGHT)
		actual_fps = cap.get(cv2.CAP_PROP_FPS)
		actual_fourcc = fourcc_to_str(cap.get(cv2.CAP_PROP_FOURCC)) or fourcc_actual
		self.fourcc = actual_fourcc or self.fourcc
		self.emit_camera_state(
			"camera_props",
			requested_wh=None,
			requested_fps=None,
			requested_fourcc=None,
			size_prop_set=False,
			fps_prop_set=False,
			processing_resolution=list(self.processing_resolution),
			target_fps=self.target_fps,
			actual_wh=[actual_width, actual_height],
			actual_fps=actual_fps,
			fourcc=actual_fourcc,
			backend=self.backend,
			backend_name=backend_name(self.backend)
			if self.backend is not None
			else None,
			index=self.camera_index,
		)
		self.transport.send(
			{
				"debug": (
					"Camera native stream: "
					f"{actual_width}x{actual_height}, FPS: {actual_fps}, "
					f"fourcc={actual_fourcc or '?'}; "
					f"process={self.processing_resolution[0]}x"
					f"{self.processing_resolution[1]} @{self.target_fps}"
				)
			}
		)

	def _warm_up(self, capture, index, backend):
		"""Discard early frames; require non-black samples before accepting."""
		good = 0
		last_luma = 0.0
		reject_reason = "read_fail"
		for i in range(WARMUP_READS):
			ret, frame = capture.read()
			if not ret or frame is None:
				reject_reason = "read_fail"
				continue
			last_luma = mean_luma(frame)
			if is_black_frame(frame):
				reject_reason = "black"
				continue
			good += 1
			reject_reason = None
			if good >= WARMUP_MIN_GOOD:
				return True, last_luma, i + 1, None
		return False, last_luma, WARMUP_READS, reject_reason or "black"

	def _try_open_pair(self, index, backend):
		name = backend_name(backend)
		device_name = self._device_name_for_index(index)
		fields = {
			"index": index,
			"backend": backend,
			"backend_name": name,
			"device_name": device_name,
			"device_id": self._device_id_for_index(index),
		}
		self.emit_camera_state(
			"camera_open_attempt",
			**fields,
			requested_wh=None,
			requested_fps=None,
			requested_fourcc=None,
			processing_resolution=list(self.processing_resolution),
			target_fps=self.target_fps,
		)
		self.transport.send(
			{
				"debug": (
					f"Trying camera index {index} with backend {backend} ({name})"
					+ (f" device={device_name!r}" if device_name else "")
				)
			}
		)
		capture = None
		try:
			capture = cv2.VideoCapture(index, backend)
			if not capture.isOpened():
				self.emit_camera_state(
					"camera_open_result",
					ok=False,
					**fields,
					reject_reason="not_opened",
				)
				capture.release()
				return None

			self.camera_index = index
			self.backend = backend
			self._apply_capture_props(capture)
			ok, luma, warm_frames, reject = self._warm_up(
				capture, index, backend
			)
			actual_wh = [
				capture.get(cv2.CAP_PROP_FRAME_WIDTH),
				capture.get(cv2.CAP_PROP_FRAME_HEIGHT),
			]
			actual_fps = capture.get(cv2.CAP_PROP_FPS)
			if not ok:
				self.emit_camera_state(
					"camera_open_result",
					ok=False,
					**fields,
					actual_wh=actual_wh,
					actual_fps=actual_fps,
					mean_luma=luma,
					warm_frames=warm_frames,
					reject_reason=reject,
				)
				self.transport.send(
					{
						"debug": (
							f"Camera {index}/{name} rejected: {reject} "
							f"(luma={luma:.1f}"
							+ (
								f", device={device_name!r}"
								if device_name
								else ""
							)
							+ ")"
						)
					}
				)
				capture.release()
				self.camera_index = None
				self.backend = None
				return None

			self.emit_camera_state(
				"camera_open_result",
				ok=True,
				**fields,
				actual_wh=actual_wh,
				actual_fps=actual_fps,
				mean_luma=luma,
				warm_frames=warm_frames,
				fourcc=self.fourcc,
			)
			self.transport.send(
				{
					"debug": (
						f"Success! Camera {index} working with backend "
						f"{backend} ({name}), luma={luma:.1f}"
						+ (f", device={device_name!r}" if device_name else "")
					)
				}
			)
			self.transport.send(
				{"status": f"Found working camera at index {index}"}
			)
			return capture
		except Exception as error:
			self.emit_camera_state(
				"camera_open_result",
				ok=False,
				**fields,
				reject_reason=f"exception:{error}",
			)
			self.transport.send(
				{
					"debug": (
						f"Exception testing camera {index} "
						f"with backend {backend}: {str(error)}"
					)
				}
			)
			if capture is not None:
				try:
					capture.release()
				except Exception:
					pass
			self.camera_index = None
			self.backend = None
			return None

	def _release_capture(self):
		if self.capture is not None:
			try:
				self.capture.release()
			except Exception:
				pass
			self.capture = None

	def _try_open_scan(self, require_name_match: bool):
		for index, backend in self._candidate_pairs():
			opened = self._try_open_pair(index, backend)
			if opened is None:
				continue
			if require_name_match and not self._opened_matches_request():
				self.transport.send(
					{
						"debug": (
							"Opened index "
							f"{index} name={self._device_name_for_index(index)!r} "
							"does not match requested "
							f"{self._requested_name!r}; continuing"
						)
					}
				)
				self._reject_opened(opened)
				continue
			return opened
		return None

	def start(self, reset_detection):
		self.transport.send({"debug": "start_camera() called"})
		if self.active and self.capture is not None:
			self.transport.send({"debug": "Camera already active"})
			return True

		self._refresh_device_inventory()
		self._release_capture()
		self.active = False

		missing = (
			self._has_requested_device()
			and not self._inventory_contains_requested()
		)
		if missing:
			self._emit_requested_notice("camera_device_missing")

		require_match = (
			self._inventory_contains_requested()
			and bool(self._requested_name)
			and any(self._device_names)
		)

		max_retries = 10
		retry_delay = 2
		with opencv_quiet_warnings():
			for attempt in range(max_retries):
				self.transport.send(
					{
						"debug": (
							f"Camera start attempt {attempt + 1}/{max_retries}"
						)
					}
				)
				self.transport.send({"debug": "Starting camera detection..."})
				opened = self._try_open_scan(require_match)
				if opened is None and require_match:
					self._emit_requested_notice("camera_device_fallback")
					opened = self._try_open_scan(False)

				if opened is None:
					self.transport.send(
						{
							"debug": (
								"No working camera found on attempt "
								f"{attempt + 1}"
							)
						}
					)
					if attempt < max_retries - 1:
						time.sleep(retry_delay)
						continue
					self.transport.send(
						{"error": "No working camera found after all attempts"}
					)
					return False

				self.capture = opened
				self.active = True
				self._preferred_index = self.camera_index
				self._preferred_backend = self.backend
				self._failover_cursor = 0
				self.transport.send({"status": "Camera opened successfully"})
				reset_detection()
				return True

		return False

	def stop(self, reason="stop_camera"):
		self.transport.send({"debug": "stop_camera() called"})
		was_active = self.active
		self._release_capture()
		self.active = False
		if was_active or reason:
			self.emit_camera_state(
				"camera_stop",
				reason=reason,
				index=self.camera_index,
				backend=self.backend,
				backend_name=backend_name(self.backend)
				if self.backend is not None
				else None,
				device_name=self._device_name_for_index(self.camera_index),
			)
		self.transport.send({"status": "Camera released"})

	def update_target_fps(self, target_fps):
		self.target_fps = int(target_fps)
		# Software throttle only — never CAP_PROP_FPS (open or mid-stream).

	def update_processing_resolution(self, processing_resolution):
		self.processing_resolution = tuple(processing_resolution)
		# Detector loop resizes to processing_resolution; never CAP_PROP size.

	def snapshot_meta(self):
		wh = None
		fps = None
		if self.capture is not None:
			wh = [
				self.capture.get(cv2.CAP_PROP_FRAME_WIDTH),
				self.capture.get(cv2.CAP_PROP_FRAME_HEIGHT),
			]
			fps = self.capture.get(cv2.CAP_PROP_FPS)
		return {
			"index": self.camera_index,
			"backend": self.backend,
			"backend_name": backend_name(self.backend)
			if self.backend is not None
			else None,
			"device_name": self._device_name_for_index(self.camera_index),
			"device_id": self._device_id_for_index(self.camera_index),
			"fourcc": self.fourcc,
			"capture_wh": wh,
			"capture_fps": fps,
			"processing_resolution": list(self.processing_resolution),
			"target_fps": self.target_fps,
		}

	def _windows_peer_backend(self):
		"""Opposite of the current Windows backend (MSMF↔DSHOW), else None."""
		if sys.platform != "win32" or self.backend is None:
			return None
		msmf = getattr(cv2, "CAP_MSMF", None)
		dshow = getattr(cv2, "CAP_DSHOW", None)
		if self.backend == msmf:
			return dshow
		if self.backend == dshow:
			return msmf
		return None

	def _failover_order(self):
		"""Next (index, backend) pairs after the current open.

		On Windows, prefer flipping MSMF↔DSHOW on the same index before
		scanning other indices — the common “opens but no face” case.
		When the user picked a device that is still in inventory, stay on
		that OpenCV index (do not jump to virtual cams).
		"""
		current = (self.camera_index, self.backend)
		ordered = []
		seen = set()
		peer = self._windows_peer_backend()

		def add_pair(pair):
			if pair in seen or pair == current:
				return
			seen.add(pair)
			ordered.append(pair)

		if self._pin_failover_to_current_index():
			index = self.camera_index
			if peer is not None:
				add_pair((index, peer))
			for backend in self._platform_backends():
				add_pair((index, backend))
			return ordered

		pairs = self._candidate_pairs()

		def add(pair):
			if pair in seen or pair not in pairs:
				return
			seen.add(pair)
			ordered.append(pair)

		if peer is not None and self.camera_index is not None:
			add((self.camera_index, peer))

		for pair in pairs:
			if pair != current:
				add(pair)
		return ordered

	def recover_from_black_frames(self, reset_detection, streak_ms, mean_luma_value):
		"""Reopen with next backend/index after a sustained black streak."""
		return self.failover_capture(
			reset_detection,
			reason="black_streak",
			streak_ms=streak_ms,
			mean_luma=mean_luma_value,
		)

	def recover_from_no_face(self, reset_detection, streak_ms):
		"""Reopen after sustained no-face despite non-black frames."""
		if self._no_face_failovers >= MAX_NO_FACE_FAILOVERS:
			self.transport.send(
				{
					"debug": (
						"No-face failover cap reached "
						f"({MAX_NO_FACE_FAILOVERS}); keeping current capture"
					)
				}
			)
			return False
		ok = self.failover_capture(
			reset_detection,
			reason="no_face",
			streak_ms=streak_ms,
		)
		if ok:
			self._no_face_failovers += 1
		return ok

	def failover_capture(self, reset_detection, reason, **extra):
		"""Release current capture and try the next backend/index."""
		from_meta = self.snapshot_meta()
		self.emit_camera_state(
			"camera_failover_begin",
			reason=reason,
			action="failover",
			**extra,
			**{k: from_meta[k] for k in ("index", "backend", "backend_name")},
		)
		ordered = self._failover_order()
		self._release_capture()
		self.active = False

		with opencv_quiet_warnings():
			for index, backend in ordered:
				opened = self._try_open_pair(index, backend)
				if opened is None:
					continue
				to_name = backend_name(backend)
				self.emit_camera_state(
					"camera_failover",
					from_index=from_meta.get("index"),
					from_backend=from_meta.get("backend"),
					from_backend_name=from_meta.get("backend_name"),
					to_index=index,
					to_backend=backend,
					to_backend_name=to_name,
					reason=reason,
				)
				self.capture = opened
				self.active = True
				self._preferred_index = index
				self._preferred_backend = backend
				reset_detection()
				self.transport.send({"status": "Camera opened successfully"})
				return True

		self.transport.send(
			{"error": f"Camera {reason} failover exhausted all backends"}
		)
		return False
