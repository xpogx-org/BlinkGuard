import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import {
	CLASSIFIER_CALIBRATION_BLINK_DURATION_MS,
	CLASSIFIER_SIDE_YAW_WAIVE,
	type CalibrationCompletePayload,
	type CalibrationPhase,
	type CalibrationProgressPayload,
	type ClassifierCalibrationPayload,
	isValidClassifierBias,
	isValidClassifierThreshold,
	personalBiasFromScores,
	personalThresholdFromScores,
} from "../../../shared/classifier-calibration";
import {
	EAR_CALIBRATION_DURATION_MS,
	isValidEarCalibration,
	medianEarCalibration,
} from "../../../shared/ear-calibration";
import {
	isCameraQuality,
	toSidecarCameraQualityMessage,
} from "../../../shared/camera-quality";
import type { FaceStatus } from "../../../shared/face-status";
import { isReliableFaceStatus } from "../../../shared/face-status";
import {
	type CameraDeviceInfo,
	type CameraDeviceNotice,
	type CameraDevicePref,
	type CameraDevicesPayload,
	LIST_CAMERAS_TIMEOUT_MS,
	emptyCameraDevicesPayload,
	sanitizeCameraDeviceNotice,
	sanitizeCameraDevicesPayload,
	toSidecarCameraDeviceMessage,
} from "../../../shared/camera-devices";
import type {
	AppPreferences,
	CameraQuality,
} from "../../../shared/preferences";
import type { BlinkDetectorDebugLogger } from "../logging/blink-detector-debug-logger";
import type { AppPaths } from "../paths/app-paths";
import type { ChildProcessRegistry } from "../process/child-process-registry";
import { NdjsonBuffer, SIDECAR_STATUS, encodeSidecarMessage, isBenignSidecarStderr, parseBaselineDriftNudge, type BaselineDriftNudgePayload } from "./protocol";

interface SidecarCallbacks {
	onBlink: (data: { ear?: number; time?: number }) => void;
	onFaceData: (data: unknown) => void;
	onVideoStream: (data: unknown) => void;
	onError: (message: string) => void;
	onCameraReady: () => void;
	/** Fired when capture open/closed flips (ACK true / local false). */
	onCameraCaptureChange?: (capturing: boolean) => void;
	shouldRetryCamera: () => boolean;
	/** True while the camera preview BrowserWindow is open. */
	isCameraWindowOpen?: () => boolean;
	onCalibrationProgress?: (payload: CalibrationProgressPayload) => void;
	onCalibrationComplete?: (payload: CalibrationCompletePayload) => void;
	onCameraDevices?: (payload: CameraDevicesPayload) => void;
	onCameraDeviceNotice?: (notice: CameraDeviceNotice) => void;
	onCameraOpened?: (meta: {
		index: number;
		name: string;
		id: string;
	}) => void;
	/** Sidecar session baseline drifted; do not persist the nudged EAR. */
	onBaselineDriftNudge?: (payload: BaselineDriftNudgePayload) => void;
}

interface FaceDataSample {
	faceDetected?: boolean;
	faceStatus?: FaceStatus;
	ear?: number;
	blink?: boolean;
	blink_phase?: string;
}

export class BlinkDetectorSidecar {
	private process: ChildProcessWithoutNullStreams | null = null;
	private running = false;
	private cameraReady = false;
	private retryCount = 0;
	private readonly maxRetries = 20;
	private calibrationSamples: number[] = [];
	private calibrationBlinkScores: number[] = [];
	private calibrationActive = false;
	private calibrationPhase: CalibrationPhase = "open_eye";
	private pendingEarBaseline: number | null = null;
	private calibrationStartedAt = 0;
	private calibrationDurationMs = EAR_CALIBRATION_DURATION_MS;
	private calibrationTimer: ReturnType<typeof setTimeout> | null = null;
	private calibrationProgressTimer: ReturnType<typeof setInterval> | null =
		null;
	private calibrationFaceDetected = false;
	/** Coalesce stop/start so quality+restart land in one Python command batch. */
	private cameraFlushTimer: ReturnType<typeof setTimeout> | null = null;
	private pendingCameraStop = false;
	private pendingCameraStart = false;
	private devicesCache: CameraDeviceInfo[] = [];
	private listWaiters: Array<(payload: CameraDevicesPayload) => void> = [];

	constructor(
		private readonly paths: AppPaths,
		private readonly isProd: boolean,
		private readonly processes: ChildProcessRegistry,
		private readonly preferences: AppPreferences,
		private readonly callbacks: SidecarCallbacks,
		private readonly debugLogger?: BlinkDetectorDebugLogger,
	) {}

	get isRunning(): boolean {
		return this.running;
	}

	get isCameraReady(): boolean {
		return this.cameraReady;
	}

	get isCalibrating(): boolean {
		return this.calibrationActive;
	}

	start(): void {
		if (this.running) return;
		if (this.process?.pid && !this.process.killed) {
			this.running = true;
			return;
		}
		const basePath = this.isProd
			? path.join(
					process.resourcesPath,
					"app.asar.unpacked",
					"electron",
					"resources",
					"blink_detector",
				)
			: path.join(
					this.paths.root,
					"electron",
					"resources",
					"blink_detector",
				);
		const executablePath =
			process.platform === "win32" ? `${basePath}.exe` : basePath;
		if (!existsSync(executablePath)) {
			console.error(
				"Blink detector binary not found. Please run the build script first: cd python && ./build_and_install.sh",
			);
			return;
		}

		this.running = true;
		const child = spawn(executablePath, [], {
			stdio: ["pipe", "pipe", "pipe"],
			env: {
				...process.env,
				// Softens OpenCV MSMF init on Win10/11 (Frame Server / old UVC).
				...(process.platform === "win32" &&
				process.env.OPENCV_VIDEOIO_MSMF_ENABLE_HW_TRANSFORMS === undefined
					? { OPENCV_VIDEOIO_MSMF_ENABLE_HW_TRANSFORMS: "0" }
					: {}),
			},
			...(process.platform === "win32" && {
				windowsHide: true,
				detached: false,
				shell: false,
			}),
		});
		this.process = child;
		this.processes.add(child);
		child.on("exit", (code) => {
			console.log(`Blink detector process exited with code: ${code}`);
			this.processes.delete(child);
			if (this.process === child) this.process = null;
			this.running = false;
			this.setCameraReady(false);
			this.clearCameraFlush();
			this.cancelEarCalibration("Blink detector stopped");
			this.failListWaiters();
		});
		child.on("error", (error) => {
			console.error("Blink detector process error:", error);
			this.callbacks.onError(`Process error: ${error.message}`);
			this.processes.delete(child);
			if (this.process === child) this.process = null;
			this.running = false;
			this.setCameraReady(false);
			this.clearCameraFlush();
			this.cancelEarCalibration("Blink detector error");
			this.failListWaiters();
		});
		this.readStdout(child);
		// OpenCV/MSMF often prints [WARN] to stderr while capture still works —
		// never promote raw stderr to the settings error banner (NDJSON `error` is enough).
		child.stderr.on("data", (data: Buffer) => {
			const text = data.toString();
			if (isBenignSidecarStderr(text)) return;
			console.error("Blink detector stderr:", text);
		});
	}

	startCamera(): boolean {
		if (!this.running || !this.process?.stdin) {
			console.error("Blink detector not running");
			return false;
		}
		// Already live — refresh config + video without stop/start thrash.
		if (this.cameraReady && !this.pendingCameraStop) {
			this.applySessionConfig();
			this.requestVideo();
			return true;
		}
		this.pendingCameraStart = true;
		this.scheduleCameraFlush();
		return true;
	}

	/** Force stop+start even when capture is already live (device switch). */
	restartCamera(): boolean {
		if (!this.running || !this.process?.stdin) {
			console.error("Blink detector not running");
			return false;
		}
		this.pendingCameraStop = true;
		this.pendingCameraStart = true;
		this.setCameraReady(false);
		this.scheduleCameraFlush();
		return true;
	}

	stopCamera(): void {
		if (!this.running || !this.process?.stdin) {
			this.setCameraReady(false);
			return;
		}
		this.pendingCameraStart = false;
		this.pendingCameraStop = true;
		this.setCameraReady(false);
		this.scheduleCameraFlush();
	}

	requestVideo(): void {
		this.write({ request_video: true });
	}

	/** Stop JPEG preview encode without releasing capture (tracking stays on). */
	stopVideo(): void {
		this.write({ stop_video: true });
	}

	/** Push the given (or current) quality preset to a live sidecar. */
	applyCameraQuality(quality?: CameraQuality): void {
		const resolved = quality ?? this.preferences.cameraQuality;
		if (!isCameraQuality(resolved)) return;
		this.write(toSidecarCameraQualityMessage(resolved));
	}

	private clearCameraFlush(): void {
		if (this.cameraFlushTimer) {
			clearTimeout(this.cameraFlushTimer);
			this.cameraFlushTimer = null;
		}
		this.pendingCameraStop = false;
		this.pendingCameraStart = false;
	}

	private scheduleCameraFlush(): void {
		if (this.cameraFlushTimer) return;
		this.cameraFlushTimer = setTimeout(() => {
			this.cameraFlushTimer = null;
			this.flushCameraIntent();
		}, 75);
	}

	private flushCameraIntent(): void {
		const stop = this.pendingCameraStop;
		const start = this.pendingCameraStart;
		this.pendingCameraStop = false;
		this.pendingCameraStart = false;
		if (!this.running || !this.process?.stdin) return;
		if (stop) {
			this.write({ stop_camera: true });
		}
		if (start) {
			// Quality/EAR/device before start so software resize/throttle use the preset.
			this.applySessionConfig();
			this.write({
				start_camera: true,
				...toSidecarCameraDeviceMessage(this.preferences.cameraDevice),
			});
			// stop_camera clears Python send_video; restore preview if window open.
			this.requestVideoIfPreviewOpen();
		}
	}

	/** Re-enable JPEG preview after stop→start without forcing encode when closed. */
	private requestVideoIfPreviewOpen(): void {
		if (this.callbacks.isCameraWindowOpen?.()) {
			this.requestVideo();
		}
	}

	/** Push personal open-eye EAR baseline (or clear with null). */
	applyEarCalibration(baseline?: number | null): void {
		const resolved =
			baseline === undefined
				? this.preferences.earCalibration
				: baseline;
		if (resolved === null) {
			this.write({ ear_calibration: null });
			return;
		}
		if (!isValidEarCalibration(resolved)) return;
		this.write({ ear_calibration: resolved });
	}

	/** Push Stage 5 personal classifier overlay (or clear with null). */
	applyClassifierCalibration(
		payload?: ClassifierCalibrationPayload | null,
	): void {
		const resolved =
			payload === undefined
				? {
						bias: this.preferences.classifierBias,
						threshold: this.preferences.classifierThreshold,
					}
				: payload;
		if (
			resolved === null ||
			(resolved.bias === null && resolved.threshold === null)
		) {
			this.write({ classifier_calibration: null });
			return;
		}
		this.write({
			classifier_calibration: {
				bias: isValidClassifierBias(resolved.bias) ? resolved.bias : 0,
				threshold: isValidClassifierThreshold(resolved.threshold)
					? resolved.threshold
					: null,
			},
		});
	}

	/** Push preferred capture device (or Automatic with null). */
	applyCameraDevice(device?: CameraDevicePref | null): void {
		const resolved =
			device === undefined ? this.preferences.cameraDevice : device;
		this.write(toSidecarCameraDeviceMessage(resolved ?? null));
	}

	/** Apply quality + calibration after models are ready. */
	applySessionConfig(): void {
		this.applyCameraQuality();
		this.applyEarCalibration();
		this.applyClassifierCalibration();
		this.applyCameraDevice();
	}

	listDevices(
		timeoutMs = LIST_CAMERAS_TIMEOUT_MS,
	): Promise<CameraDevicesPayload> {
		if (!this.running || !this.process?.stdin) {
			return Promise.resolve({
				...emptyCameraDevicesPayload(),
				unavailable: true,
			});
		}
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				this.listWaiters = this.listWaiters.filter((wait) => wait !== onPayload);
				resolve({
					devices: this.devicesCache,
					unavailable: this.devicesCache.length === 0,
				});
			}, timeoutMs);
			const onPayload = (payload: CameraDevicesPayload) => {
				clearTimeout(timer);
				resolve(payload);
			};
			this.listWaiters.push(onPayload);
			this.write({ list_cameras: true });
		});
	}

	/** Start Stage-0 EAR NDJSON recording in the sidecar (absolute path). */
	startTraceRecording(filePath: string): boolean {
		if (!this.running || !this.process?.stdin) return false;
		const trimmed = filePath.trim();
		if (!trimmed) return false;
		this.write({ record_trace: trimmed });
		return true;
	}

	/** Stop Stage-0 EAR NDJSON recording. */
	stopTraceRecording(): boolean {
		if (!this.running || !this.process?.stdin) return false;
		this.write({ stop_trace: true });
		return true;
	}

	startEarCalibration(durationMs = EAR_CALIBRATION_DURATION_MS): boolean {
		if (this.calibrationActive) return false;
		if (!this.running) {
			this.callbacks.onCalibrationComplete?.({
				baseline: null,
				error: "Blink detector is not running",
			});
			return false;
		}

		this.calibrationActive = true;
		this.calibrationSamples = [];
		this.calibrationBlinkScores = [];
		this.pendingEarBaseline = null;
		this.calibrationFaceDetected = false;
		this.beginCalibrationPhase("open_eye", durationMs);
		return true;
	}

	cancelEarCalibration(reason?: string): void {
		if (!this.calibrationActive) return;
		this.finishCalibrationSession({
			baseline: null,
			error: reason ?? "Calibration cancelled",
		});
	}

	markCameraUnavailable(): void {
		this.setCameraReady(false);
	}

	/** Single seam for capture flag — notify only on change. */
	private setCameraReady(next: boolean): void {
		if (this.cameraReady === next) return;
		this.cameraReady = next;
		this.callbacks.onCameraCaptureChange?.(next);
		if (next) this.callbacks.onCameraReady();
	}

	private beginCalibrationPhase(
		phase: CalibrationPhase,
		durationMs: number,
	): void {
		this.clearCalibrationTimers();
		this.calibrationPhase = phase;
		this.calibrationStartedAt = Date.now();
		this.calibrationDurationMs = durationMs;
		this.calibrationFaceDetected = false;

		this.calibrationProgressTimer = setInterval(() => {
			if (!this.calibrationActive) return;
			this.emitCalibrationProgress();
		}, 250);

		this.calibrationTimer = setTimeout(() => {
			this.finishCalibrationPhase();
		}, durationMs);

		this.emitCalibrationProgress();
	}

	private emitCalibrationProgress(): void {
		this.callbacks.onCalibrationProgress?.({
			elapsedMs: Date.now() - this.calibrationStartedAt,
			sampleCount:
				this.calibrationPhase === "open_eye"
					? this.calibrationSamples.length
					: this.calibrationBlinkScores.length,
			durationMs: this.calibrationDurationMs,
			faceDetected: this.calibrationFaceDetected,
			phase: this.calibrationPhase,
			blinkCount: this.calibrationBlinkScores.length,
		});
	}

	private finishCalibrationPhase(): void {
		if (!this.calibrationActive) return;
		if (this.calibrationPhase === "open_eye") {
			const baseline = medianEarCalibration(this.calibrationSamples);
			if (baseline === null) {
				this.finishCalibrationSession({
					baseline: null,
					error:
						"Not enough open-eye samples. Keep your face centered with eyes open.",
				});
				return;
			}
			this.pendingEarBaseline = baseline;
			// Phase B needs the fresh open-eye baseline or FSM gates stay on
			// the old/default EAR and deliberate blinks often never complete.
			this.applyEarCalibration(baseline);
			this.beginCalibrationPhase(
				"blinks",
				CLASSIFIER_CALIBRATION_BLINK_DURATION_MS,
			);
			return;
		}

		const scores = this.calibrationBlinkScores;
		const bias = personalBiasFromScores(scores);
		const baseline = this.pendingEarBaseline;
		if (bias === null) {
			this.finishCalibrationSession({
				baseline,
				classifierBias: null,
				classifierThreshold: null,
				error:
					"Not enough blinks for classifier calibration. EAR baseline was saved.",
			});
			return;
		}
		this.finishCalibrationSession({
			baseline,
			classifierBias: bias,
			classifierThreshold: personalThresholdFromScores(scores, bias),
		});
	}

	private finishCalibrationSession(payload: CalibrationCompletePayload): void {
		this.clearCalibrationTimers();
		this.calibrationActive = false;
		this.calibrationSamples = [];
		this.calibrationBlinkScores = [];
		this.pendingEarBaseline = null;
		if (payload.baseline === null) {
			// Cancel / Phase A fail: drop the live pending EAR.
			this.applyEarCalibration();
		}
		this.callbacks.onCalibrationComplete?.(payload);
	}

	private clearCalibrationTimers(): void {
		if (this.calibrationTimer) {
			clearTimeout(this.calibrationTimer);
			this.calibrationTimer = null;
		}
		if (this.calibrationProgressTimer) {
			clearInterval(this.calibrationProgressTimer);
			this.calibrationProgressTimer = null;
		}
	}

	private sampleFaceDataForCalibration(data: FaceDataSample): void {
		if (!this.calibrationActive) return;
		const reliable = isReliableFaceStatus(
			Boolean(data.faceDetected),
			data.faceStatus,
		);
		this.calibrationFaceDetected = reliable;
		if (this.calibrationPhase !== "open_eye") return;
		if (!reliable) return;
		if (data.blink) return;
		if (data.blink_phase === "start" || data.blink_phase === "complete") {
			return;
		}
		const ear = data.ear;
		if (typeof ear !== "number" || !Number.isFinite(ear)) return;
		this.calibrationSamples.push(ear);
	}

	private sampleBlinkDebugForCalibration(debug: Record<string, unknown>): void {
		if (!this.calibrationActive || this.calibrationPhase !== "blinks") {
			return;
		}
		const phase = debug.phase;
		if (phase !== "complete" && phase !== "reject_classifier") return;
		// Do not skip look_down: laptop webcams sit above the screen, so
		// pitch_delta > ~0.05 (pose_weight > 0) on a normal "look at camera"
		// pose and would drop almost every sample. Side-yaw is the frontal gate.
		const yaw = typeof debug.yaw === "number" ? debug.yaw : 0;
		if (Math.abs(yaw) >= CLASSIFIER_SIDE_YAW_WAIVE) return;
		const p = debug.clf_p;
		if (typeof p !== "number" || !Number.isFinite(p) || p <= 0 || p > 1) {
			return;
		}
		this.calibrationBlinkScores.push(p);
		this.calibrationFaceDetected = true;
	}

	private readStdout(child: ChildProcessWithoutNullStreams): void {
		const buffer = new NdjsonBuffer();
		child.stdout.on("data", (data: Buffer) => {
			for (const line of buffer.push(data)) {
				try {
					this.handleMessage(JSON.parse(line));
				} catch (error) {
					console.error("Failed to parse blink detector output:", error);
				}
			}
		});
	}

	private failListWaiters(): void {
		const waiters = this.listWaiters;
		this.listWaiters = [];
		const payload: CameraDevicesPayload = {
			...emptyCameraDevicesPayload(),
			unavailable: true,
		};
		for (const wait of waiters) wait(payload);
	}

	private publishCameraDevices(payload: CameraDevicesPayload): void {
		this.devicesCache = payload.devices;
		const waiters = this.listWaiters;
		this.listWaiters = [];
		for (const wait of waiters) wait(payload);
		this.callbacks.onCameraDevices?.(payload);
	}

	private handleCameraState(state: Record<string, unknown>): void {
		const kind = state.kind;
		if (kind === "camera_devices") {
			this.publishCameraDevices(sanitizeCameraDevicesPayload(state));
			return;
		}
		if (kind === "camera_device_missing" || kind === "camera_device_fallback") {
			const notice = sanitizeCameraDeviceNotice({
				code: kind === "camera_device_missing" ? "missing" : "fallback",
				name: state.requested_name,
			});
			if (notice) this.callbacks.onCameraDeviceNotice?.(notice);
			return;
		}
		if (kind === "camera_open_result" && state.ok === true) {
			const index =
				typeof state.index === "number" && Number.isInteger(state.index)
					? state.index
					: null;
			if (index === null) return;
			this.callbacks.onCameraOpened?.({
				index,
				name: typeof state.device_name === "string" ? state.device_name : "",
				id: typeof state.device_id === "string" ? state.device_id : "",
			});
		}
	}

	private handleMessage(message: Record<string, any>): void {
		this.debugLogger?.captureSidecarMessage(message);
		if (message.cameraState && typeof message.cameraState === "object") {
			this.handleCameraState(message.cameraState as Record<string, unknown>);
		}
		if (message.blinkDebug) {
			this.sampleBlinkDebugForCalibration(
				message.blinkDebug as Record<string, unknown>,
			);
			const drift = parseBaselineDriftNudge(message.blinkDebug);
			if (drift) this.callbacks.onBaselineDriftNudge?.(drift);
		}
		if (message.blink) {
			this.callbacks.onBlink(message);
			return;
		}
		if (message.error) {
			this.handleCameraError(String(message.error));
			return;
		}
		if (message.status) {
			if (message.status === SIDECAR_STATUS.modelsReady) {
				this.applySessionConfig();
			} else if (
				message.status === SIDECAR_STATUS.cameraReady ||
				message.status === SIDECAR_STATUS.cameraStarted
			) {
				this.retryCount = 0;
				// Cover races where stop cleared send_video after an earlier request_video.
				this.requestVideoIfPreviewOpen();
				this.setCameraReady(true);
			}
			return;
		}
		if (message.faceData) {
			this.sampleFaceDataForCalibration(message.faceData as FaceDataSample);
			this.callbacks.onFaceData(message.faceData);
			return;
		}
		if (message.videoStream) {
			this.callbacks.onVideoStream(message.videoStream);
		}
	}

	private handleCameraError(message: string): void {
		console.error("Blink detector error:", message);
		this.callbacks.onError(message);
		const lower = message.toLowerCase();
		this.setCameraReady(false);
		const isCameraError = ["camera", "permission", "access"].some((term) =>
			lower.includes(term),
		);
		if (!isCameraError || !this.callbacks.shouldRetryCamera()) return;
		this.retryCount++;
		if (this.retryCount > this.maxRetries) {
			this.callbacks.onError(
				"Camera access failed after multiple attempts. Please check camera permissions and restart tracking.",
			);
			this.retryCount = 0;
			return;
		}
		setTimeout(() => {
			if (this.callbacks.shouldRetryCamera() && this.running) {
				this.startCamera();
			}
		}, 3000);
	}

	private write(message: object): void {
		if (this.process?.stdin) {
			this.process.stdin.write(encodeSidecarMessage(message));
		}
	}
}
