import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChildProcessRegistry } from "../../../electron/infrastructure/process/child-process-registry";
import { BlinkDetectorSidecar } from "../../../electron/infrastructure/sidecar/blink-detector-sidecar";
import {
	isBenignSidecarStderr,
	SIDECAR_STATUS,
} from "../../../electron/infrastructure/sidecar/protocol";
import { DEFAULT_PREFERENCES } from "../../../shared/preferences";

type FakeChild = EventEmitter & {
	pid: number;
	killed: boolean;
	stdin: { write: (chunk: string) => boolean };
	stdout: EventEmitter;
	stderr: EventEmitter;
};

function createFakeChild(): { child: FakeChild; stdinChunks: string[] } {
	const stdinChunks: string[] = [];
	const child = new EventEmitter() as FakeChild;
	child.pid = 4242;
	child.killed = false;
	child.stdin = {
		write: (chunk: string) => {
			stdinChunks.push(chunk);
			return true;
		},
	};
	child.stdout = new EventEmitter();
	child.stderr = new EventEmitter();
	return { child, stdinChunks };
}

function parseWrites(chunks: string[]): Record<string, unknown>[] {
	return chunks
		.join("")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** Bypass spawn/binary path; attach a fake child as if start() succeeded. */
function attachRunningProcess(
	sidecar: BlinkDetectorSidecar,
	fakeChild: FakeChild,
): void {
	const internal = sidecar as unknown as {
		process: FakeChild | null;
		running: boolean;
		readStdout: (process: FakeChild) => void;
		setCameraReady: (next: boolean) => void;
		clearCameraFlush: () => void;
		cancelEarCalibration: (reason?: string) => void;
		failListWaiters: () => void;
		callbacks: { onError: (message: string) => void };
	};
	internal.process = fakeChild;
	internal.running = true;
	internal.readStdout(fakeChild);
	// Mirror start() exit/error so capture-status tests can emit without spawning.
	fakeChild.on("exit", () => {
		if (internal.process === fakeChild) internal.process = null;
		internal.running = false;
		internal.setCameraReady(false);
		internal.clearCameraFlush();
		internal.cancelEarCalibration("Blink detector stopped");
		internal.failListWaiters();
	});
	fakeChild.on("error", (error: Error) => {
		internal.callbacks.onError(`Process error: ${error.message}`);
		if (internal.process === fakeChild) internal.process = null;
		internal.running = false;
		internal.setCameraReady(false);
		internal.clearCameraFlush();
		internal.cancelEarCalibration("Blink detector error");
		internal.failListWaiters();
	});
}

describe("BlinkDetectorSidecar preview restore", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	function createSidecar(isCameraWindowOpen: () => boolean) {
		const { child, stdinChunks } = createFakeChild();
		const sidecar = new BlinkDetectorSidecar(
			{
				root: "/app",
				publicDir: "/app/public",
				preload: "/app/preload.js",
			} as never,
			false,
			new ChildProcessRegistry(),
			{ ...DEFAULT_PREFERENCES },
			{
				onBlink: vi.fn(),
				onFaceData: vi.fn(),
				onVideoStream: vi.fn(),
				onError: vi.fn(),
				onCameraReady: vi.fn(),
				shouldRetryCamera: () => true,
				isCameraWindowOpen,
			},
		);
		attachRunningProcess(sidecar, child);
		return { sidecar, stdinChunks, child };
	}

	it("re-requests video after stop→start flush when preview window is open", () => {
		const { sidecar, stdinChunks } = createSidecar(() => true);
		expect(sidecar.startCamera()).toBe(true);
		vi.advanceTimersByTime(75);
		const afterStart = parseWrites(stdinChunks);
		expect(afterStart.some((m) => m.start_camera === true)).toBe(true);
		expect(afterStart.some((m) => m.request_video === true)).toBe(true);

		stdinChunks.length = 0;
		sidecar.stopCamera();
		expect(sidecar.startCamera()).toBe(true);
		vi.advanceTimersByTime(75);
		const afterRestart = parseWrites(stdinChunks);
		expect(afterRestart.some((m) => m.stop_camera === true)).toBe(true);
		expect(afterRestart.some((m) => m.start_camera === true)).toBe(true);
		expect(afterRestart.some((m) => m.request_video === true)).toBe(true);
	});

	it("does not request video after flush start when preview window is closed", () => {
		const { sidecar, stdinChunks } = createSidecar(() => false);
		expect(sidecar.startCamera()).toBe(true);
		vi.advanceTimersByTime(75);
		const writes = parseWrites(stdinChunks);
		expect(writes.some((m) => m.start_camera === true)).toBe(true);
		expect(writes.some((m) => m.request_video === true)).toBe(false);
	});

	it("re-requests video on cameraStarted when preview window is open", () => {
		const { sidecar, stdinChunks, child } = createSidecar(() => true);
		stdinChunks.length = 0;
		child.stdout.emit(
			"data",
			Buffer.from(
				`${JSON.stringify({ status: SIDECAR_STATUS.cameraStarted })}\n`,
			),
		);
		expect(sidecar.isCameraReady).toBe(true);
		expect(parseWrites(stdinChunks)).toEqual([{ request_video: true }]);
	});

	it("does not request video on cameraStarted when preview window is closed", () => {
		const { sidecar, stdinChunks, child } = createSidecar(() => false);
		stdinChunks.length = 0;
		child.stdout.emit(
			"data",
			Buffer.from(
				`${JSON.stringify({ status: SIDECAR_STATUS.cameraStarted })}\n`,
			),
		);
		expect(sidecar.isCameraReady).toBe(true);
		expect(parseWrites(stdinChunks)).toEqual([]);
	});

	it("stopVideo writes stop_video without stop_camera", () => {
		const { sidecar, stdinChunks } = createSidecar(() => false);
		stdinChunks.length = 0;
		sidecar.stopVideo();
		expect(parseWrites(stdinChunks)).toEqual([{ stop_video: true }]);
	});
});

describe("BlinkDetectorSidecar EAR calibration samples", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	function createSidecar() {
		const { child } = createFakeChild();
		const sidecar = new BlinkDetectorSidecar(
			{
				root: "/app",
				publicDir: "/app/public",
				preload: "/app/preload.js",
			} as never,
			false,
			new ChildProcessRegistry(),
			{ ...DEFAULT_PREFERENCES },
			{
				onBlink: vi.fn(),
				onFaceData: vi.fn(),
				onVideoStream: vi.fn(),
				onError: vi.fn(),
				onCameraReady: vi.fn(),
				shouldRetryCamera: () => true,
			},
		);
		attachRunningProcess(sidecar, child);
		return { sidecar, child };
	}

	function emitFaceData(
		child: FakeChild,
		faceData: Record<string, unknown>,
	): void {
		child.stdout.emit("data", Buffer.from(`${JSON.stringify({ faceData })}\n`));
	}

	it("samples Phase A EAR only when faceStatus is ok", () => {
		const { sidecar, child } = createSidecar();
		expect(sidecar.startEarCalibration()).toBe(true);
		const internal = sidecar as unknown as { calibrationSamples: number[] };

		emitFaceData(child, {
			faceDetected: true,
			faceStatus: "too_far",
			ear: 0.214,
		});
		emitFaceData(child, {
			faceDetected: true,
			faceStatus: "none",
			ear: 0.2,
		});
		emitFaceData(child, {
			faceDetected: true,
			faceStatus: "ok",
			ear: 0.28,
		});

		expect(internal.calibrationSamples).toEqual([0.28]);
	});

	it("ignores too_close and unreliable_landmarks like too_far", () => {
		const { sidecar, child } = createSidecar();
		expect(sidecar.startEarCalibration()).toBe(true);
		const internal = sidecar as unknown as { calibrationSamples: number[] };

		emitFaceData(child, {
			faceDetected: false,
			faceStatus: "too_close",
			ear: 0.28,
		});
		emitFaceData(child, {
			faceDetected: false,
			faceStatus: "unreliable_landmarks",
			ear: 0.27,
		});
		emitFaceData(child, {
			faceDetected: true,
			faceStatus: "ok",
			ear: 0.26,
		});

		expect(internal.calibrationSamples).toEqual([0.26]);
	});

	it("ignores head_too_low like other weak statuses", () => {
		const { sidecar, child } = createSidecar();
		expect(sidecar.startEarCalibration()).toBe(true);
		const internal = sidecar as unknown as { calibrationSamples: number[] };

		emitFaceData(child, {
			faceDetected: false,
			faceStatus: "head_too_low",
			ear: 0.29,
		});
		emitFaceData(child, {
			faceDetected: true,
			faceStatus: "ok",
			ear: 0.25,
		});

		expect(internal.calibrationSamples).toEqual([0.25]);
	});
});

describe("isBenignSidecarStderr", () => {
	it("ignores OpenCV YuNet graph-engine target warn", () => {
		expect(
			isBenignSidecarStderr(
				"[ WARN:0@0.239] global net_impl_backend.cpp:345 cv::dnn::dnn5_v20260605::Net::Impl::setPreferableTarget Targets are not supported by the new graph engine for now",
			),
		).toBe(true);
		expect(isBenignSidecarStderr("camera open failed")).toBe(false);
	});
});

describe("BlinkDetectorSidecar NDJSON routing", () => {
	function createSidecar() {
		const { child } = createFakeChild();
		const callbacks = {
			onBlink: vi.fn(),
			onFaceData: vi.fn(),
			onVideoStream: vi.fn(),
			onError: vi.fn(),
			onCameraReady: vi.fn(),
			onCameraCaptureChange: vi.fn(),
			shouldRetryCamera: () => false,
		};
		const sidecar = new BlinkDetectorSidecar(
			{
				root: "/app",
				publicDir: "/app/public",
				preload: "/app/preload.js",
			} as never,
			false,
			new ChildProcessRegistry(),
			{ ...DEFAULT_PREFERENCES },
			callbacks,
		);
		attachRunningProcess(sidecar, child);
		return { sidecar, child, callbacks };
	}

	function emitJson(child: FakeChild, payload: Record<string, unknown>): void {
		child.stdout.emit("data", Buffer.from(`${JSON.stringify(payload)}\n`));
	}

	it("routes blink, faceData, error, cameraReady, and videoStream", () => {
		const { sidecar, child, callbacks } = createSidecar();

		emitJson(child, { blink: true, ear: 0.12, time: 1.5 });
		expect(callbacks.onBlink).toHaveBeenCalledWith({
			blink: true,
			ear: 0.12,
			time: 1.5,
		});

		const faceData = { faceDetected: true, faceStatus: "ok", ear: 0.28 };
		emitJson(child, { faceData });
		expect(callbacks.onFaceData).toHaveBeenCalledWith(faceData);

		emitJson(child, { error: "permission denied for camera" });
		expect(callbacks.onError).toHaveBeenCalledWith(
			"permission denied for camera",
		);

		emitJson(child, { status: SIDECAR_STATUS.cameraReady });
		expect(sidecar.isCameraReady).toBe(true);
		expect(callbacks.onCameraReady).toHaveBeenCalledOnce();
		expect(callbacks.onCameraCaptureChange).toHaveBeenCalledWith(true);

		const frame = { jpeg: "abc" };
		emitJson(child, { videoStream: frame });
		expect(callbacks.onVideoStream).toHaveBeenCalledWith(frame);
	});

	it("ACK emits onCameraCaptureChange(true) once and still fires onCameraReady", () => {
		const { sidecar, child, callbacks } = createSidecar();
		expect(sidecar.isCameraReady).toBe(false);

		emitJson(child, { status: SIDECAR_STATUS.cameraReady });
		expect(sidecar.isCameraReady).toBe(true);
		expect(callbacks.onCameraCaptureChange).toHaveBeenCalledTimes(1);
		expect(callbacks.onCameraCaptureChange).toHaveBeenCalledWith(true);
		expect(callbacks.onCameraReady).toHaveBeenCalledOnce();

		emitJson(child, { status: SIDECAR_STATUS.cameraStarted });
		expect(callbacks.onCameraCaptureChange).toHaveBeenCalledTimes(1);
		expect(callbacks.onCameraReady).toHaveBeenCalledOnce();
	});

	it("notifies capture change false on stop, error, exit, and mark unavailable", () => {
		const { sidecar, child, callbacks } = createSidecar();
		emitJson(child, { status: SIDECAR_STATUS.cameraStarted });
		expect(callbacks.onCameraCaptureChange).toHaveBeenLastCalledWith(true);
		callbacks.onCameraCaptureChange.mockClear();
		callbacks.onCameraReady.mockClear();

		sidecar.stopCamera();
		expect(sidecar.isCameraReady).toBe(false);
		expect(callbacks.onCameraCaptureChange).toHaveBeenCalledWith(false);
		expect(callbacks.onCameraReady).not.toHaveBeenCalled();

		callbacks.onCameraCaptureChange.mockClear();
		sidecar.stopCamera();
		expect(callbacks.onCameraCaptureChange).not.toHaveBeenCalled();

		emitJson(child, { status: SIDECAR_STATUS.cameraReady });
		callbacks.onCameraCaptureChange.mockClear();
		emitJson(child, { error: "camera permission denied" });
		expect(callbacks.onCameraCaptureChange).toHaveBeenCalledWith(false);

		emitJson(child, { status: SIDECAR_STATUS.cameraReady });
		callbacks.onCameraCaptureChange.mockClear();
		sidecar.markCameraUnavailable();
		expect(callbacks.onCameraCaptureChange).toHaveBeenCalledWith(false);

		emitJson(child, { status: SIDECAR_STATUS.cameraReady });
		callbacks.onCameraCaptureChange.mockClear();
		child.emit("exit", 0);
		expect(callbacks.onCameraCaptureChange).toHaveBeenCalledWith(false);
		expect(sidecar.isCameraReady).toBe(false);

		const { child: errorChild } = createFakeChild();
		attachRunningProcess(sidecar, errorChild);
		emitJson(errorChild, { status: SIDECAR_STATUS.cameraReady });
		callbacks.onCameraCaptureChange.mockClear();
		callbacks.onError.mockClear();
		errorChild.emit("error", new Error("spawn failed"));
		expect(callbacks.onCameraCaptureChange).toHaveBeenCalledWith(false);
		expect(callbacks.onError).toHaveBeenCalledWith("Process error: spawn failed");
		expect(sidecar.isCameraReady).toBe(false);
	});

	it("restartCamera notifies false before reopen ACK; no duplicate when already false", () => {
		const { sidecar, child, callbacks } = createSidecar();
		emitJson(child, { status: SIDECAR_STATUS.cameraStarted });
		callbacks.onCameraCaptureChange.mockClear();
		expect(sidecar.restartCamera()).toBe(true);
		expect(sidecar.isCameraReady).toBe(false);
		expect(callbacks.onCameraCaptureChange).toHaveBeenCalledTimes(1);
		expect(callbacks.onCameraCaptureChange).toHaveBeenCalledWith(false);

		callbacks.onCameraCaptureChange.mockClear();
		expect(sidecar.restartCamera()).toBe(true);
		expect(callbacks.onCameraCaptureChange).not.toHaveBeenCalled();

		callbacks.onCameraCaptureChange.mockClear();
		emitJson(child, { status: SIDECAR_STATUS.cameraStarted });
		expect(callbacks.onCameraCaptureChange).toHaveBeenCalledWith(true);
		expect(callbacks.onCameraReady).toHaveBeenCalled();
		expect(sidecar.isCameraReady).toBe(true);
	});

	it("ignores cameraState without treating it as a user-facing error", () => {
		const { child, callbacks } = createSidecar();
		emitJson(child, {
			cameraState: { open: true, backend: "MSMF", black_ratio: 0 },
		});
		expect(callbacks.onError).not.toHaveBeenCalled();
		expect(callbacks.onBlink).not.toHaveBeenCalled();
		expect(callbacks.onFaceData).not.toHaveBeenCalled();
		expect(callbacks.onCameraReady).not.toHaveBeenCalled();
	});

	it("skips invalid JSON lines without calling callbacks", () => {
		const { child, callbacks } = createSidecar();
		child.stdout.emit("data", Buffer.from("not-json\n"));
		expect(callbacks.onBlink).not.toHaveBeenCalled();
		expect(callbacks.onError).not.toHaveBeenCalled();
	});

	it("assembles a blink message split across stdout chunks", () => {
		const { child, callbacks } = createSidecar();
		child.stdout.emit("data", Buffer.from('{"blink":true,'));
		expect(callbacks.onBlink).not.toHaveBeenCalled();
		child.stdout.emit("data", Buffer.from('"ear":0.2}\n'));
		expect(callbacks.onBlink).toHaveBeenCalledWith({
			blink: true,
			ear: 0.2,
		});
	});
});

describe("BlinkDetectorSidecar camera device picker", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	function createSidecar(preferences = { ...DEFAULT_PREFERENCES }) {
		const { child, stdinChunks } = createFakeChild();
		const callbacks = {
			onBlink: vi.fn(),
			onFaceData: vi.fn(),
			onVideoStream: vi.fn(),
			onError: vi.fn(),
			onCameraReady: vi.fn(),
			onCameraDevices: vi.fn(),
			onCameraDeviceNotice: vi.fn(),
			onCameraOpened: vi.fn(),
			shouldRetryCamera: () => false,
		};
		const sidecar = new BlinkDetectorSidecar(
			{
				root: "/app",
				publicDir: "/app/public",
				preload: "/app/preload.js",
			} as never,
			false,
			new ChildProcessRegistry(),
			preferences,
			callbacks,
		);
		attachRunningProcess(sidecar, child);
		return { sidecar, child, stdinChunks, callbacks };
	}

	function emitJson(child: FakeChild, payload: Record<string, unknown>): void {
		child.stdout.emit("data", Buffer.from(`${JSON.stringify(payload)}\n`));
	}

	it("includes preferred camera_device on start_camera", () => {
		const preferences = {
			...DEFAULT_PREFERENCES,
			cameraDevice: { id: "pnp-1", index: 1, name: "USB Webcam" },
		};
		const { sidecar, stdinChunks } = createSidecar(preferences);
		expect(sidecar.startCamera()).toBe(true);
		vi.advanceTimersByTime(75);
		const writes = parseWrites(stdinChunks);
		const start = writes.find((m) => m.start_camera === true);
		expect(start).toMatchObject({
			start_camera: true,
			camera_device: { id: "pnp-1", index: 1, name: "USB Webcam" },
		});
	});

	it("restartCamera emits stop+start even when cameraReady", () => {
		const { sidecar, stdinChunks, child } = createSidecar();
		emitJson(child, { status: SIDECAR_STATUS.cameraStarted });
		expect(sidecar.isCameraReady).toBe(true);
		stdinChunks.length = 0;
		expect(sidecar.restartCamera()).toBe(true);
		vi.advanceTimersByTime(75);
		const writes = parseWrites(stdinChunks);
		expect(writes.some((m) => m.stop_camera === true)).toBe(true);
		expect(writes.some((m) => m.start_camera === true)).toBe(true);
	});

	it("listDevices writes list_cameras and does not start capture", async () => {
		const { sidecar, stdinChunks, child, callbacks } = createSidecar();
		const pending = sidecar.listDevices();
		const listed = parseWrites(stdinChunks);
		expect(listed.some((m) => m.list_cameras === true)).toBe(true);
		expect(listed.some((m) => m.start_camera === true)).toBe(false);

		emitJson(child, {
			cameraState: {
				kind: "camera_devices",
				devices: [{ index: 0, name: "Integrated", id: "pnp-0" }],
				names: ["Integrated"],
				count: 1,
				index_match: "soft",
			},
		});
		await expect(pending).resolves.toEqual({
			devices: [{ index: 0, name: "Integrated", id: "pnp-0" }],
		});
		expect(callbacks.onCameraDevices).toHaveBeenCalledOnce();
	});

	it("forwards missing/fallback notices and open-result index", () => {
		const { child, callbacks } = createSidecar();
		emitJson(child, {
			cameraState: {
				kind: "camera_device_missing",
				requested_name: "USB Webcam",
			},
		});
		expect(callbacks.onCameraDeviceNotice).toHaveBeenCalledWith({
			code: "missing",
			name: "USB Webcam",
		});
		emitJson(child, {
			cameraState: {
				kind: "camera_device_fallback",
				requested_name: "USB Webcam",
			},
		});
		expect(callbacks.onCameraDeviceNotice).toHaveBeenCalledWith({
			code: "fallback",
			name: "USB Webcam",
		});
		emitJson(child, {
			cameraState: {
				kind: "camera_open_result",
				ok: true,
				index: 1,
				device_name: "USB Webcam",
				device_id: "pnp-1",
			},
		});
		expect(callbacks.onCameraOpened).toHaveBeenCalledWith({
			index: 1,
			name: "USB Webcam",
			id: "pnp-1",
		});
		expect(callbacks.onError).not.toHaveBeenCalled();
	});
});
