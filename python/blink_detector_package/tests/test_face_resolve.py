"""Idle-miss backoff for _resolve_face (no camera / no real dlib)."""

from __future__ import annotations

import queue
import unittest

import numpy as np

from blink_detector_package.application.detector import (
	BlinkDetectorApplication,
	NO_FACE_DATA,
	NO_FACE_EMIT_INTERVAL_S,
	PACE_COMMAND_SLICE_S,
	pace_wait_s,
)
from blink_detector_package.domain.blink_detection import (
	FACE_IDLE_DETECT_INTERVAL,
	FACE_MISS_HOLD_FRAMES,
	FACE_REACQUIRE_FRAMES,
)
from blink_detector_package.infrastructure.vision import PreallocatedBuffers


class _FakeFace:
	def __init__(self, w=140, h=160, left=170, top=80):
		self._w = w
		self._h = h
		self._left = left
		self._top = top

	def left(self):
		return self._left

	def top(self):
		return self._top

	def right(self):
		return self._left + self._w

	def bottom(self):
		return self._top + self._h

	def width(self):
		return self._w

	def height(self):
		return self._h


class _MissYunet:
	def __init__(self):
		self.detect_calls = 0

	def setInputSize(self, size):
		del size

	def detect(self, bgr):
		del bgr
		self.detect_calls += 1
		return 1, None


class _CountingHog:
	def __init__(self):
		self.calls = 0

	def __call__(self, gray, upsample=0):
		del gray, upsample
		self.calls += 1
		return []


class _Transport:
	def __init__(self):
		self.command_queue = queue.Queue()
		self.events = []

	def send(self, payload):
		self.events.append(payload)

	def send_serialized(self, line):
		self.events.append(line)

	def start_input_thread(self):
		return None

	def stop(self):
		return None


def _gray(h=360, w=480):
	return np.zeros((h, w), dtype=np.uint8)


def _bgr(h=360, w=480):
	return np.zeros((h, w, 3), dtype=np.uint8)


class FaceResolveBackoffTests(unittest.TestCase):
	def _app(self):
		app = BlinkDetectorApplication(transport=_Transport())
		app._yunet = _MissYunet()
		return app

	def test_idle_miss_does_not_detect_every_frame(self):
		app = self._app()
		hog = _CountingHog()
		gray = _gray()
		bgr = _bgr()
		buffers = PreallocatedBuffers()

		app._resolve_face(hog, gray, buffers, frame=bgr)
		self.assertEqual(hog.calls, 0)
		first_yunet = app._yunet.detect_calls
		self.assertGreaterEqual(first_yunet, 1)

		for _ in range(FACE_IDLE_DETECT_INTERVAL - 1):
			app._resolve_face(hog, gray, buffers, frame=bgr)
		self.assertEqual(app._yunet.detect_calls, first_yunet)
		self.assertEqual(hog.calls, 0)

		app._resolve_face(hog, gray, buffers, frame=bgr)
		self.assertGreater(app._yunet.detect_calls, first_yunet)
		self.assertEqual(hog.calls, 0)

	def test_reacquire_starts_once_after_hold_expires(self):
		app = self._app()
		hog = _CountingHog()
		gray = _gray()
		bgr = _bgr()
		buffers = PreallocatedBuffers()
		app._cached_face = _FakeFace()
		app._frames_since_face_detect = 1
		app.face_detect_interval = 1

		for _ in range(FACE_MISS_HOLD_FRAMES):
			face = app._resolve_face(hog, gray, buffers, frame=bgr)
			self.assertIsNotNone(face)
		self.assertEqual(app._face_reacquire_frames, 0)
		self.assertEqual(hog.calls, 0)

		face = app._resolve_face(hog, gray, buffers, frame=bgr)
		self.assertIsNone(face)
		self.assertEqual(app._face_reacquire_frames, FACE_REACQUIRE_FRAMES)
		self.assertEqual(hog.calls, 0)

		app._resolve_face(hog, gray, buffers, frame=bgr)
		self.assertGreater(hog.calls, 0)
		remaining = app._face_reacquire_frames
		self.assertLess(remaining, FACE_REACQUIRE_FRAMES)

		app._resolve_face(hog, gray, buffers, frame=bgr)
		self.assertEqual(app._face_reacquire_frames, remaining - 1)
		self.assertGreater(hog.calls, 0)

	def test_no_face_emit_throttles_repeats(self):
		app = self._app()
		t = 1000.0
		app._emit_face_data({"faceStatus": "none"}, t)
		self.assertEqual(app.transport.events, [NO_FACE_DATA])

		app._emit_face_data({"faceStatus": "none"}, t + 0.1)
		self.assertEqual(len(app.transport.events), 1)

		app._emit_face_data(
			{"faceStatus": "none"}, t + NO_FACE_EMIT_INTERVAL_S
		)
		self.assertEqual(len(app.transport.events), 2)

		app._emit_face_data(
			{"faceStatus": "ok", "faceDetected": True}, t + 1.0
		)
		self.assertEqual(len(app.transport.events), 3)

		app._emit_face_data({"faceStatus": "none"}, t + 1.01)
		self.assertEqual(len(app.transport.events), 4)


class ReacquireHintSuppressTests(unittest.TestCase):
	def test_track_quality_fail_suppresses_during_reacquire(self):
		app = BlinkDetectorApplication(transport=_Transport())
		app._face_reacquire_frames = FACE_REACQUIRE_FRAMES
		face = _FakeFace()
		face_data = {}
		app._emit_track_quality_fail(
			face_data,
			face,
			480,
			360,
			1000.0,
			0.2,
			80.0,
			"unreliable_landmarks",
			"pnp_high_error",
		)
		self.assertTrue(face_data["faceDetected"])
		self.assertEqual(face_data["faceStatus"], "ok")
		self.assertEqual(face_data["eyeLandmarks"], [])
		self.assertIn("faceRect", face_data)
		self.assertEqual(app._quality_miss_streak, 0)

	def test_soft_quality_skip_suppresses_too_far_during_reacquire(self):
		app = BlinkDetectorApplication(transport=_Transport())
		app._face_reacquire_frames = FACE_REACQUIRE_FRAMES
		app._quality_miss_streak = 99
		face = _FakeFace()
		face_data = {}
		app._emit_soft_face_quality_skip(
			face_data,
			face,
			480,
			360,
			1000.0,
			0.05,
			40.0,
		)
		self.assertTrue(face_data["faceDetected"])
		self.assertEqual(face_data["faceStatus"], "ok")
		self.assertEqual(app._quality_miss_streak, 99)


class PaceWaitTests(unittest.TestCase):
	def test_due_frame_does_not_sleep(self):
		self.assertEqual(pace_wait_s(1.10, 1.00, 0.05), 0.0)

	def test_caps_long_waits_so_stdin_stays_responsive(self):
		self.assertEqual(pace_wait_s(1.00, 1.00, 0.10), PACE_COMMAND_SLICE_S)

	def test_short_remainder_sleeps_the_gap(self):
		self.assertAlmostEqual(pace_wait_s(1.00, 1.00, 0.01), 0.01)
