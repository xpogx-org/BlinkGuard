import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRuntimeState } from "../../../electron/application/app-runtime-state";
import type { PreferenceStore } from "../../../electron/application/ports/preference-store";
import type {
	BlinkDetectorPort,
} from "../../../electron/application/ports/runtime-ports";
import { ReminderService } from "../../../electron/application/reminder-service";
import { stopTrackingSession } from "../../../electron/application/tracking-session";
import {
	BLINK_CREDIT_DEBOUNCE_MS,
	BLINK_SNOOZE_MS,
	FACE_RETURN_DEBOUNCE_MS,
	NO_FACE_DEBOUNCE_MS,
	nextTimerReminderDelay,
	REMINDER_POPUP_VISIBLE_MS,
	STREAK_CHEER_COOLDOWN_MS,
	STREAK_CHEER_HEALTHY_MS,
} from "../../../electron/domain/reminder-policy";
import {
	type AppPreferences,
	DEFAULT_PREFERENCES,
} from "../../../shared/preferences";
import { defaultPopupMessage, t } from "../../../shared/i18n";
import {
	BLINK_CAMERA_MESSAGE_POOL_KEYS,
	BLINK_TIMER_MESSAGE_POOL_KEYS,
} from "../../../electron/domain/reminder-prompt-policy";

function createStore(): PreferenceStore {
	const data = new Map<string, unknown>();
	return {
		get<T>(key: string, defaultValue?: T): T {
			if (data.has(key)) return data.get(key) as T;
			return defaultValue as T;
		},
		set<T>(key: string, value: T): void {
			data.set(key, value);
		},
		has(key: string): boolean {
			return data.has(key);
		},
		clear(): void {
			data.clear();
		},
	};
}

function createPreferences(
	overrides: Partial<AppPreferences> = {},
): AppPreferences {
	return {
		...DEFAULT_PREFERENCES,
		isTracking: true,
		cameraEnabled: true,
		mgdMode: false,
		reminderInterval: 3000,
		...overrides,
	};
}

function createWindows() {
	const api = {
		reminderOpen: false,
		ambientOpen: false,
		hasNoFaceWindow: false,
		lastPopup: null as unknown,
		showReminder: vi.fn(
			(
				_kind: "starting" | "blink" | "stopped",
				_options?: { force?: boolean; message?: string },
			) => {
				api.reminderOpen = true;
				api.lastPopup = { id: Math.random() };
				return api.lastPopup;
			},
		),
		closeReminder: vi.fn(() => {
			api.reminderOpen = false;
		}),
		closeReminderIfCurrent: vi.fn((token: unknown) => {
			if (token === api.lastPopup) {
				api.reminderOpen = false;
				return true;
			}
			return false;
		}),
		hasReminder: vi.fn(() => api.reminderOpen),
		showAmbient: vi.fn(() => {
			api.ambientOpen = true;
		}),
		hideAmbient: vi.fn(() => {
			api.ambientOpen = false;
		}),
		hasAmbient: vi.fn(() => api.ambientOpen),
		showNoFace: vi.fn(() => {
			api.hasNoFaceWindow = true;
		}),
		hideNoFace: vi.fn(() => {
			api.hasNoFaceWindow = false;
		}),
		hasNoFace: vi.fn(() => api.hasNoFaceWindow),
		showCalibrationNudge: vi.fn(),
		hideCalibrationNudge: vi.fn(),
		hasCalibrationNudge: vi.fn(() => false),
		showCheerToast: vi.fn(),
		closeCamera: vi.fn(),
		sendToMain: vi.fn(),
		sendPreferences: vi.fn(),
	};
	return api;
}

function createStats(
	overrides: {
		blinksPerMinute?: number;
		blinkRateReady?: boolean;
	} = {},
) {
	return {
		recordBlink: vi.fn(),
		onTrackingStart: vi.fn(),
		onTrackingStop: vi.fn(),
		onFaceVisibility: vi.fn(),
		setFaceCoverageMode: vi.fn(),
		getSnapshot: vi.fn(() => ({
			blinksPerMinute: overrides.blinksPerMinute ?? 0,
			blinkRateReady: overrides.blinkRateReady ?? false,
		})),
	};
}

function createSidecar(
	overrides: Partial<BlinkDetectorPort> = {},
): BlinkDetectorPort {
	return {
		isRunning: true,
		isCameraReady: true,
		start: vi.fn(),
		startCamera: vi.fn(() => true),
		stopCamera: vi.fn(),
		requestVideo: vi.fn(),
		stopVideo: vi.fn(),
		markCameraUnavailable: vi.fn(),
		...overrides,
	};
}

function createSound() {
	return { play: vi.fn(), stop: vi.fn() };
}

function createOs(shown = true) {
	return {
		isSupported: vi.fn(() => true),
		show: vi.fn(() => ({ shown })),
		dismiss: vi.fn(),
		dismissAll: vi.fn(),
		setActivationHandlers: vi.fn(),
	};
}

function expectBlinkOverlayShown(
	windows: ReturnType<typeof createWindows>,
): void {
	expect(
		windows.showReminder.mock.calls.some((call) => call[0] === "blink"),
	).toBe(true);
}

function expectBlinkOverlayNotShown(
	windows: ReturnType<typeof createWindows>,
): void {
	expect(
		windows.showReminder.mock.calls.some((call) => call[0] === "blink"),
	).toBe(false);
}

describe("ReminderService credit semantics", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("creditBlink sources update lastBlinkTime but not lastReminderShownAt", () => {
		const preferences = createPreferences();
		const state = new AppRuntimeState();
		const windows = createWindows();
		const service = new ReminderService(
			preferences,
			state,
			windows,
			createSidecar(),
			createSound(),
			createStore(),
		);

		const blinkBefore = state.lastBlinkTime;
		const reminderBefore = state.lastReminderShownAt;
		vi.advanceTimersByTime(500);

		expect(service.creditBlink("face-return")).toBe(true);
		expect(state.lastBlinkTime).toBeGreaterThan(blinkBefore);
		expect(state.lastReminderShownAt).toBe(reminderBefore);

		const afterFace = state.lastBlinkTime;
		vi.advanceTimersByTime(500);
		expect(service.creditBlink("camera-ready")).toBe(true);
		expect(state.lastBlinkTime).toBeGreaterThan(afterFace);
		expect(state.lastReminderShownAt).toBe(reminderBefore);

		const afterCamera = state.lastBlinkTime;
		vi.advanceTimersByTime(500);
		expect(service.creditBlink("sleep")).toBe(true);
		expect(state.lastBlinkTime).toBeGreaterThan(afterCamera);
		expect(state.lastReminderShownAt).toBe(reminderBefore);
	});

	it("onBlink debounces detected credits within BLINK_CREDIT_DEBOUNCE_MS", () => {
		const preferences = createPreferences();
		const state = new AppRuntimeState();
		const windows = createWindows();
		windows.reminderOpen = true;
		const stats = {
			recordBlink: vi.fn(),
			onTrackingStart: vi.fn(),
			onTrackingStop: vi.fn(),
			onFaceVisibility: vi.fn(),
			setFaceCoverageMode: vi.fn(),
		};
		const service = new ReminderService(
			preferences,
			state,
			windows,
			createSidecar(),
			createSound(),
			createStore(),
			stats,
		);

		expect(service.onBlink()).toBe(true);
		const first = state.lastBlinkTime;
		expect(windows.closeReminder).toHaveBeenCalledTimes(1);
		expect(stats.recordBlink).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(BLINK_CREDIT_DEBOUNCE_MS - 1);
		expect(service.onBlink()).toBe(false);
		expect(state.lastBlinkTime).toBe(first);
		expect(windows.closeReminder).toHaveBeenCalledTimes(1);
		expect(stats.recordBlink).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(1);
		expect(service.onBlink()).toBe(true);
		expect(state.lastBlinkTime).toBeGreaterThan(first);
		expect(windows.closeReminder).toHaveBeenCalledTimes(2);
		expect(stats.recordBlink).toHaveBeenCalledTimes(2);
	});

	it("onBlink ignores detected blinks when tracking is off", () => {
		const preferences = createPreferences({ isTracking: false });
		const state = new AppRuntimeState();
		const windows = createWindows();
		windows.reminderOpen = true;
		const stats = {
			recordBlink: vi.fn(),
			onTrackingStart: vi.fn(),
			onTrackingStop: vi.fn(),
			onFaceVisibility: vi.fn(),
			setFaceCoverageMode: vi.fn(),
		};
		const service = new ReminderService(
			preferences,
			state,
			windows,
			createSidecar(),
			createSound(),
			createStore(),
			stats,
		);
		const blinkBefore = state.lastBlinkTime;

		expect(service.onBlink()).toBe(false);
		expect(state.lastBlinkTime).toBe(blinkBefore);
		expect(stats.recordBlink).not.toHaveBeenCalled();
		expect(windows.closeReminder).not.toHaveBeenCalled();
	});

	it("start and stop notify blink stats for tracking sessions", () => {
		const preferences = createPreferences({
			isTracking: false,
			cameraEnabled: false,
		});
		const state = new AppRuntimeState();
		const stats = {
			recordBlink: vi.fn(),
			onTrackingStart: vi.fn(),
			onTrackingStop: vi.fn(),
			onFaceVisibility: vi.fn(),
			setFaceCoverageMode: vi.fn(),
		};
		const service = new ReminderService(
			preferences,
			state,
			createWindows(),
			createSidecar({ isRunning: false, isCameraReady: false }),
			createSound(),
			createStore(),
			stats,
		);

		service.start(3000);
		expect(stats.onTrackingStart).toHaveBeenCalledTimes(1);
		expect(preferences.isTracking).toBe(true);

		service.ensureStopped();
		expect(stats.onTrackingStop).toHaveBeenCalledTimes(1);
		expect(preferences.isTracking).toBe(false);
	});

	it("marks lastReminderShownAt on show and keeps overlay past 2.5s until blink", () => {
		const preferences = createPreferences({
			reminderInterval: 1000,
			soundEnabled: true,
		});
		const state = new AppRuntimeState();
		state.isFaceDetected = true;
		state.lastBlinkTime = Date.now() - 5000;
		state.lastReminderShownAt = Date.now() - 5000;
		const windows = createWindows();
		const sidecar = createSidecar();
		const sound = createSound();
		const service = new ReminderService(
			preferences,
			state,
			windows,
			sidecar,
			sound,
			createStore(),
		);

		// Drive face-aware loop via sync (camera already ready).
		service.syncCameraLoopForMgdMode();
		expect(state.cameraMonitoringInterval).not.toBeNull();

		vi.advanceTimersByTime(100);
		expectBlinkOverlayShown(windows);
		expect(sound.play).not.toHaveBeenCalledWith("blink");
		const blinkAtShow = state.lastBlinkTime;
		const reminderAtShow = state.lastReminderShownAt;
		expect(reminderAtShow).toBeGreaterThan(0);

		vi.advanceTimersByTime(REMINDER_POPUP_VISIBLE_MS);
		expect(windows.closeReminderIfCurrent).not.toHaveBeenCalled();
		expect(windows.hasReminder()).toBe(true);
		expect(state.lastBlinkTime).toBe(blinkAtShow);

		service.onBlink();
		expect(windows.closeReminder).toHaveBeenCalled();
		expect(windows.hideAmbient).toHaveBeenCalled();
	});

	it("syncCameraLoopForMgdMode restarts the MGD loop mid-session", () => {
		const preferences = createPreferences({ mgdMode: false });
		const state = new AppRuntimeState();
		state.isFaceDetected = true;
		const windows = createWindows();
		const service = new ReminderService(
			preferences,
			state,
			windows,
			createSidecar(),
			createSound(),
			createStore(),
		);

		service.syncCameraLoopForMgdMode();
		expect(state.cameraMonitoringInterval).not.toBeNull();
		expect(state.mgdReminderLoopActive).toBe(false);

		preferences.mgdMode = true;
		service.syncCameraLoopForMgdMode();
		expect(state.cameraMonitoringInterval).toBeNull();
		expect(state.mgdReminderLoopActive).toBe(true);
		expect(state.blinkInterval).not.toBeNull();
	});

	it("applyReminderInterval reschedules without stopping the camera", () => {
		const preferences = createPreferences({
			reminderInterval: 3000,
			mgdMode: false,
		});
		const state = new AppRuntimeState();
		state.isFaceDetected = true;
		const windows = createWindows();
		const sidecar = createSidecar();
		const service = new ReminderService(
			preferences,
			state,
			windows,
			sidecar,
			createSound(),
			createStore(),
		);

		service.syncCameraLoopForMgdMode();
		const loopBefore = state.cameraMonitoringInterval;
		expect(loopBefore).not.toBeNull();

		preferences.reminderInterval = 5000;
		service.applyReminderInterval();

		expect(sidecar.stopCamera).not.toHaveBeenCalled();
		expect(preferences.isTracking).toBe(true);
		expect(windows.closeReminder).toHaveBeenCalled();
		expect(state.cameraMonitoringInterval).not.toBeNull();
		expect(state.cameraMonitoringInterval).not.toBe(loopBefore);
	});

	it("applyReminderInterval re-arms timer mode without stopping tracking", () => {
		const preferences = createPreferences({
			cameraEnabled: false,
			reminderInterval: 3000,
		});
		const state = new AppRuntimeState();
		const windows = createWindows();
		const sidecar = createSidecar({
			isRunning: false,
			isCameraReady: false,
		});
		const service = new ReminderService(
			preferences,
			state,
			windows,
			sidecar,
			createSound(),
			createStore(),
		);

		service.start(3000);
		expect(state.blinkInterval).not.toBeNull();
		expect(sidecar.stopCamera).toHaveBeenCalled(); // start() ensureStopped first
		vi.mocked(sidecar.stopCamera).mockClear();
		windows.showReminder.mockClear();

		preferences.reminderInterval = 5000;
		service.applyReminderInterval();

		expect(sidecar.stopCamera).not.toHaveBeenCalled();
		expect(preferences.isTracking).toBe(true);
		expect(state.blinkInterval).not.toBeNull();
		expect(state.blinkReminderActive).toBe(true);
		// Mid-session tweak must not fire an immediate blink popup.
		expect(windows.showReminder).not.toHaveBeenCalled();
	});

	it("applyReminderInterval is a no-op when not tracking", () => {
		const preferences = createPreferences({ isTracking: false });
		const state = new AppRuntimeState();
		const windows = createWindows();
		const sidecar = createSidecar();
		const service = new ReminderService(
			preferences,
			state,
			windows,
			sidecar,
			createSound(),
			createStore(),
		);

		service.applyReminderInterval();
		expect(sidecar.stopCamera).not.toHaveBeenCalled();
		expect(windows.closeReminder).not.toHaveBeenCalled();
		expect(state.cameraMonitoringInterval).toBeNull();
	});

	it("resyncLoopsForCameraModeChange starts camera when flipping timer→camera while tracking", () => {
		const preferences = createPreferences({
			cameraEnabled: false,
			reminderInterval: 3000,
		});
		const state = new AppRuntimeState();
		const windows = createWindows();
		const sidecar = createSidecar({
			isRunning: false,
			isCameraReady: false,
		});
		const service = new ReminderService(
			preferences,
			state,
			windows,
			sidecar,
			createSound(),
			createStore(),
		);

		service.start(3000);
		expect(state.blinkInterval).not.toBeNull();
		vi.mocked(sidecar.startCamera).mockClear();
		vi.mocked(sidecar.start).mockClear();

		preferences.cameraEnabled = true;
		service.resyncLoopsForCameraModeChange();

		expect(preferences.isTracking).toBe(true);
		expect(state.blinkInterval).toBeNull();
		expect(sidecar.start).toHaveBeenCalled();
		expect(sidecar.startCamera).toHaveBeenCalled();
	});

	it("resyncLoopsForCameraModeChange releases camera and arms timer when flipping camera→timer", () => {
		const preferences = createPreferences({
			cameraEnabled: true,
			reminderInterval: 3000,
		});
		const state = new AppRuntimeState();
		state.isFaceDetected = true;
		const windows = createWindows();
		const sidecar = createSidecar();
		const service = new ReminderService(
			preferences,
			state,
			windows,
			sidecar,
			createSound(),
			createStore(),
		);

		service.syncCameraLoopForMgdMode();
		expect(state.cameraMonitoringInterval).not.toBeNull();
		vi.mocked(sidecar.stopCamera).mockClear();

		preferences.cameraEnabled = false;
		service.resyncLoopsForCameraModeChange();

		expect(preferences.isTracking).toBe(true);
		expect(sidecar.stopCamera).toHaveBeenCalled();
		expect(state.cameraMonitoringInterval).toBeNull();
		expect(state.blinkInterval).not.toBeNull();
		expect(state.blinkReminderActive).toBe(true);
	});

	it("markReminderShown does not touch lastBlinkTime", () => {
		const state = new AppRuntimeState();
		const service = new ReminderService(
			createPreferences(),
			state,
			createWindows(),
			createSidecar(),
			createSound(),
			createStore(),
		);
		const blinkBefore = state.lastBlinkTime;
		vi.advanceTimersByTime(200);
		service.markReminderShown();
		expect(state.lastBlinkTime).toBe(blinkBefore);
		expect(state.lastReminderShownAt).toBeGreaterThan(blinkBefore);
	});

	it("snooze suppresses blink popups for snoozeMinutes then resumes", () => {
		const preferences = createPreferences({
			isTracking: false,
			cameraEnabled: false,
			microBreakInterval: 3000,
			snoozeMinutes: 5,
		});
		const state = new AppRuntimeState();
		const windows = createWindows();
		const sound = createSound();
		const service = new ReminderService(
			preferences,
			state,
			windows,
			createSidecar({ isRunning: false, isCameraReady: false }),
			sound,
			createStore(),
		);

		service.start(3000);
		expectBlinkOverlayShown(windows);
		expect(windows.showReminder).toHaveBeenCalledTimes(1);
		expect(sound.play).not.toHaveBeenCalledWith("blink");

		service.snooze();
		expect(windows.closeReminder).toHaveBeenCalled();
		expect(state.blinkSnoozeUntil).toBeGreaterThan(Date.now());
		windows.showReminder.mockClear();

		vi.advanceTimersByTime(BLINK_SNOOZE_MS - 1);
		expect(windows.showReminder).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1 + nextTimerReminderDelay(3000));
		expectBlinkOverlayShown(windows);
		expect(state.blinkSnoozeUntil).toBe(0);
	});

	it("snooze duration follows snoozeMinutes preference", () => {
		const preferences = createPreferences({
			isTracking: false,
			cameraEnabled: false,
			microBreakInterval: 3000,
			snoozeMinutes: 1,
		});
		const state = new AppRuntimeState();
		const windows = createWindows();
		const service = new ReminderService(
			preferences,
			state,
			windows,
			createSidecar({ isRunning: false, isCameraReady: false }),
			createSound(),
			createStore(),
		);

		service.start(3000);
		service.snooze();
		windows.showReminder.mockClear();

		vi.advanceTimersByTime(60_000 - 1);
		expect(windows.showReminder).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1 + nextTimerReminderDelay(3000));
		expectBlinkOverlayShown(windows);
	});

	it("snooze does not forge blink credit; onBlink still works", () => {
		const preferences = createPreferences({
			isTracking: false,
			cameraEnabled: false,
		});
		const state = new AppRuntimeState();
		const windows = createWindows();
		const stats = {
			recordBlink: vi.fn(),
			onTrackingStart: vi.fn(),
			onTrackingStop: vi.fn(),
			onFaceVisibility: vi.fn(),
			setFaceCoverageMode: vi.fn(),
		};
		const service = new ReminderService(
			preferences,
			state,
			windows,
			createSidecar({ isRunning: false, isCameraReady: false }),
			createSound(),
			createStore(),
			stats,
		);

		service.start(3000);
		const blinkBefore = state.lastBlinkTime;
		vi.advanceTimersByTime(200);

		service.snooze();
		expect(stats.recordBlink).not.toHaveBeenCalled();
		expect(state.lastBlinkTime).toBe(blinkBefore);
		expect(state.lastReminderShownAt).toBeGreaterThan(blinkBefore);

		expect(service.onBlink()).toBe(true);
		expect(stats.recordBlink).toHaveBeenCalledTimes(1);
		expect(state.lastBlinkTime).toBeGreaterThan(blinkBefore);
		expect(windows.closeReminder).toHaveBeenCalled();
	});
});

describe("ReminderService auto-stop on no face", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("stops tracking and sends preferences after N minutes without a face", () => {
		const preferences = createPreferences({
			autoStopNoFaceEnabled: true,
			autoStopNoFaceMinutes: 2,
		});
		const state = new AppRuntimeState();
		const windows = createWindows();
		const store = createStore();
		const service = new ReminderService(
			preferences,
			state,
			windows,
			createSidecar(),
			createSound(),
			store,
		);

		service.onFaceDetection(false);
		vi.advanceTimersByTime(NO_FACE_DEBOUNCE_MS);
		expect(state.noFaceAutoStopTimer).not.toBeNull();
		expect(windows.showNoFace).toHaveBeenCalled();

		vi.advanceTimersByTime(2 * 60 * 1000 - 1);
		expect(preferences.isTracking).toBe(true);

		vi.advanceTimersByTime(1);
		expect(preferences.isTracking).toBe(false);
		expect(store.get("isTracking")).toBe(false);
		expect(windows.showReminder).toHaveBeenCalledWith("stopped");
		expect(windows.sendPreferences).toHaveBeenCalled();
		expect(state.noFaceAutoStopTimer).toBeNull();
	});

	it("cancels auto-stop when the face returns before the timeout", () => {
		const preferences = createPreferences({
			autoStopNoFaceEnabled: true,
			autoStopNoFaceMinutes: 2,
		});
		const state = new AppRuntimeState();
		const windows = createWindows();
		const service = new ReminderService(
			preferences,
			state,
			windows,
			createSidecar(),
			createSound(),
			createStore(),
		);

		service.onFaceDetection(false);
		vi.advanceTimersByTime(NO_FACE_DEBOUNCE_MS);
		expect(state.noFaceAutoStopTimer).not.toBeNull();

		service.onFaceDetection(true);
		expect(state.noFaceAutoStopTimer).not.toBeNull();
		expect(state.isFaceDetected).toBe(false);
		expect(windows.hideNoFace).not.toHaveBeenCalled();

		vi.advanceTimersByTime(FACE_RETURN_DEBOUNCE_MS);
		expect(state.noFaceAutoStopTimer).toBeNull();
		expect(state.isFaceDetected).toBe(true);
		expect(windows.hideNoFace).toHaveBeenCalled();

		vi.advanceTimersByTime(2 * 60 * 1000);
		expect(preferences.isTracking).toBe(true);
		expect(windows.sendPreferences).not.toHaveBeenCalled();
	});

	it("does not arm auto-stop when the feature is disabled", () => {
		const preferences = createPreferences({
			autoStopNoFaceEnabled: false,
			autoStopNoFaceMinutes: 2,
		});
		const state = new AppRuntimeState();
		const windows = createWindows();
		const service = new ReminderService(
			preferences,
			state,
			windows,
			createSidecar(),
			createSound(),
			createStore(),
		);

		service.onFaceDetection(false);
		vi.advanceTimersByTime(NO_FACE_DEBOUNCE_MS);
		expect(state.noFaceAutoStopTimer).toBeNull();
		expect(preferences.isTracking).toBe(true);

		vi.advanceTimersByTime(2 * 60 * 1000);
		expect(preferences.isTracking).toBe(true);
		expect(windows.sendPreferences).not.toHaveBeenCalled();
	});

	it("cancels a pending auto-stop when soft-pausing for focus", () => {
		const preferences = createPreferences({
			autoStopNoFaceEnabled: true,
			autoStopNoFaceMinutes: 2,
		});
		const state = new AppRuntimeState();
		const windows = createWindows();
		const service = new ReminderService(
			preferences,
			state,
			windows,
			createSidecar(),
			createSound(),
			createStore(),
		);

		service.onFaceDetection(false);
		vi.advanceTimersByTime(NO_FACE_DEBOUNCE_MS);
		expect(state.noFaceAutoStopTimer).not.toBeNull();

		service.pauseCameraForFocus();
		expect(state.noFaceAutoStopTimer).toBeNull();
		expect(service.isCameraSoftPaused).toBe(true);

		vi.advanceTimersByTime(2 * 60 * 1000);
		expect(preferences.isTracking).toBe(true);
		expect(windows.sendPreferences).not.toHaveBeenCalled();
	});

	it("calls the bound tracking-session stop after the no-face timeout", () => {
		const preferences = createPreferences({
			autoStopNoFaceEnabled: true,
			autoStopNoFaceMinutes: 2,
		});
		const state = new AppRuntimeState();
		const windows = createWindows();
		const service = new ReminderService(
			preferences,
			state,
			windows,
			createSidecar(),
			createSound(),
			createStore(),
		);
		const trackingSessionStop = vi.fn();
		service.bindTrackingSessionStop(trackingSessionStop);

		service.onFaceDetection(false);
		vi.advanceTimersByTime(NO_FACE_DEBOUNCE_MS);
		vi.advanceTimersByTime(2 * 60 * 1000);

		expect(trackingSessionStop).toHaveBeenCalledWith(true);
		expect(windows.sendPreferences).toHaveBeenCalled();
		expect(windows.showReminder).not.toHaveBeenCalled();
	});

	it("pauses eye-care on auto-stop when coupled to tracking", () => {
		const preferences = createPreferences({
			autoStopNoFaceEnabled: true,
			autoStopNoFaceMinutes: 2,
			eyeCareIndependentOfTracking: false,
		});
		const state = new AppRuntimeState();
		const windows = createWindows();
		const service = new ReminderService(
			preferences,
			state,
			windows,
			createSidecar(),
			createSound(),
			createStore(),
		);
		const exercises = { start: vi.fn(), stop: vi.fn(), resetTimer: vi.fn() };
		const lookAway = { start: vi.fn(), stop: vi.fn(), resetTimer: vi.fn() };
		service.bindTrackingSessionStop((showStatus) =>
			stopTrackingSession(
				{ reminders: service, exercises, lookAway, preferences },
				showStatus,
			),
		);

		service.onFaceDetection(false);
		vi.advanceTimersByTime(NO_FACE_DEBOUNCE_MS);
		vi.advanceTimersByTime(2 * 60 * 1000);

		expect(preferences.isTracking).toBe(false);
		expect(exercises.stop).toHaveBeenCalledOnce();
		expect(lookAway.stop).toHaveBeenCalledOnce();
		expect(windows.showReminder).toHaveBeenCalledWith("stopped");
		expect(windows.sendPreferences).toHaveBeenCalled();
	});
});

describe("ReminderService no-face toast hysteresis", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("does not hide the toast on a one-frame face hit", () => {
		const state = new AppRuntimeState();
		const windows = createWindows();
		const service = new ReminderService(
			createPreferences(),
			state,
			windows,
			createSidecar(),
			createSound(),
			createStore(),
		);

		service.onFaceDetection(false);
		vi.advanceTimersByTime(NO_FACE_DEBOUNCE_MS);
		expect(windows.showNoFace).toHaveBeenCalledOnce();
		expect(windows.hasNoFace()).toBe(true);

		service.onFaceDetection(true);
		expect(windows.hideNoFace).not.toHaveBeenCalled();
		expect(windows.hasNoFace()).toBe(true);

		service.onFaceDetection(false);
		vi.advanceTimersByTime(FACE_RETURN_DEBOUNCE_MS);
		expect(windows.hideNoFace).not.toHaveBeenCalled();
		expect(windows.hasNoFace()).toBe(true);
		expect(state.isFaceDetected).toBe(false);
	});

	it("hides the toast and credits face-return after a confirmed face", () => {
		const state = new AppRuntimeState();
		const windows = createWindows();
		const service = new ReminderService(
			createPreferences(),
			state,
			windows,
			createSidecar(),
			createSound(),
			createStore(),
		);
		const blinkBefore = state.lastBlinkTime;

		service.onFaceDetection(false);
		vi.advanceTimersByTime(NO_FACE_DEBOUNCE_MS);

		service.onFaceDetection(true);
		vi.advanceTimersByTime(FACE_RETURN_DEBOUNCE_MS);

		expect(windows.hideNoFace).toHaveBeenCalledOnce();
		expect(state.isFaceDetected).toBe(true);
		expect(state.lastBlinkTime).toBeGreaterThan(blinkBefore);
	});

	it("does not call hideNoFace on every true frame once the face is confirmed", () => {
		const state = new AppRuntimeState();
		state.isFaceDetected = true;
		const windows = createWindows();
		const service = new ReminderService(
			createPreferences(),
			state,
			windows,
			createSidecar(),
			createSound(),
			createStore(),
		);

		service.onFaceDetection(true);
		service.onFaceDetection(true);
		expect(windows.hideNoFace).not.toHaveBeenCalled();
		expect(state.faceReturnDebounceTimer).toBeNull();
	});
});

describe("ReminderService preview camera", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("ensureCameraActive starts capture without starting tracking", () => {
		const preferences = createPreferences({
			isTracking: false,
			cameraEnabled: true,
		});
		const sidecar = createSidecar({
			isRunning: true,
			isCameraReady: false,
		});
		const service = new ReminderService(
			preferences,
			new AppRuntimeState(),
			createWindows(),
			sidecar,
			createSound(),
			createStore(),
		);

		service.ensureCameraActive();

		expect(preferences.isTracking).toBe(false);
		expect(sidecar.startCamera).toHaveBeenCalledOnce();
		expect(sidecar.stopCamera).not.toHaveBeenCalled();
	});

	it("ensureCameraActive requests video when capture is already live", () => {
		const preferences = createPreferences({
			isTracking: false,
			cameraEnabled: true,
		});
		const sidecar = createSidecar({
			isRunning: true,
			isCameraReady: true,
		});
		const service = new ReminderService(
			preferences,
			new AppRuntimeState(),
			createWindows(),
			sidecar,
			createSound(),
			createStore(),
		);

		service.ensureCameraActive();

		expect(preferences.isTracking).toBe(false);
		expect(sidecar.requestVideo).toHaveBeenCalledOnce();
		expect(sidecar.startCamera).not.toHaveBeenCalled();
	});

	it("stopCameraIfIdle releases capture when tracking is off", () => {
		const preferences = createPreferences({
			isTracking: false,
			cameraEnabled: true,
		});
		const sidecar = createSidecar();
		const service = new ReminderService(
			preferences,
			new AppRuntimeState(),
			createWindows(),
			sidecar,
			createSound(),
			createStore(),
		);

		service.stopCameraIfIdle();

		expect(sidecar.stopCamera).toHaveBeenCalledOnce();
		expect(sidecar.stopVideo).not.toHaveBeenCalled();
	});

	it("stopCameraIfIdle keeps capture while tracking", () => {
		const preferences = createPreferences({
			isTracking: true,
			cameraEnabled: true,
		});
		const sidecar = createSidecar();
		const service = new ReminderService(
			preferences,
			new AppRuntimeState(),
			createWindows(),
			sidecar,
			createSound(),
			createStore(),
		);

		service.stopCameraIfIdle();

		expect(sidecar.stopCamera).not.toHaveBeenCalled();
		expect(sidecar.stopVideo).toHaveBeenCalledOnce();
	});

	it("pauseForSession keeps isTracking and stops stats without a stopped popup", () => {
		const preferences = createPreferences({
			isTracking: false,
			cameraEnabled: true,
		});
		const store = createStore();
		const stats = {
			recordBlink: vi.fn(),
			onTrackingStart: vi.fn(),
			onTrackingStop: vi.fn(),
			onFaceVisibility: vi.fn(),
			setFaceCoverageMode: vi.fn(),
		};
		const sidecar = createSidecar();
		const windows = createWindows();
		const sound = createSound();
		const service = new ReminderService(
			preferences,
			new AppRuntimeState(),
			windows,
			sidecar,
			sound,
			store,
			stats,
		);

		service.start(3000);
		expect(preferences.isTracking).toBe(true);
		expect(store.get("isTracking")).toBe(true);
		vi.mocked(sidecar.stopCamera).mockClear();
		stats.onTrackingStop.mockClear();
		windows.showReminder.mockClear();
		vi.mocked(sound.play).mockClear();

		service.pauseForSession();

		expect(preferences.isTracking).toBe(true);
		expect(store.get("isTracking")).toBe(true);
		expect(stats.onTrackingStop).toHaveBeenCalledTimes(1);
		expect(sidecar.stopCamera).toHaveBeenCalled();
		expect(service.isCameraSoftPaused).toBe(true);
		expect(windows.showReminder).not.toHaveBeenCalledWith("stopped");
		expect(sound.play).not.toHaveBeenCalledWith("stopped");
	});

	it("resumeAfterSleep does not persist a tracking restart when already on", () => {
		const preferences = createPreferences({
			isTracking: false,
			cameraEnabled: false,
		});
		const store = createStore();
		const stats = {
			recordBlink: vi.fn(),
			onTrackingStart: vi.fn(),
			onTrackingStop: vi.fn(),
			onFaceVisibility: vi.fn(),
			setFaceCoverageMode: vi.fn(),
		};
		const service = new ReminderService(
			preferences,
			new AppRuntimeState(),
			createWindows(),
			createSidecar({ isRunning: false, isCameraReady: false }),
			createSound(),
			store,
			stats,
		);

		service.start(3000);
		service.pauseForSession();
		stats.onTrackingStart.mockClear();
		const setTrackingWrites: unknown[] = [];
		const innerSet = store.set.bind(store);
		store.set = (key, value) => {
			if (key === "isTracking") setTrackingWrites.push(value);
			innerSet(key, value);
		};

		service.resumeAfterSleep();

		expect(preferences.isTracking).toBe(true);
		expect(setTrackingWrites).toEqual([]);
		expect(stats.onTrackingStart).toHaveBeenCalledTimes(1);
	});

	it("keeps the camera paused when session still holds after focus resume", () => {
		const preferences = createPreferences({ cameraEnabled: true });
		const sidecar = createSidecar({ isCameraReady: false });
		const service = new ReminderService(
			preferences,
			new AppRuntimeState(),
			createWindows(),
			sidecar,
			createSound(),
			createStore(),
		);

		service.pauseCameraForFocus("session");
		vi.mocked(sidecar.startCamera).mockClear();
		service.resumeCameraIfNeeded("focus");
		expect(service.isCameraSoftPaused).toBe(true);
		expect(sidecar.startCamera).not.toHaveBeenCalled();

		service.resumeCameraIfNeeded("session");
		expect(service.isCameraSoftPaused).toBe(false);
		expect(sidecar.startCamera).toHaveBeenCalled();
	});

	it("pauseCameraForClamshell keeps tracking and falls back to timer reminders", () => {
		const preferences = createPreferences({ cameraEnabled: true });
		const sidecar = createSidecar();
		const state = new AppRuntimeState();
		const service = new ReminderService(
			preferences,
			state,
			createWindows(),
			sidecar,
			createSound(),
			createStore(),
		);

		service.start(3000);
		vi.mocked(sidecar.stopCamera).mockClear();
		service.pauseCameraForClamshell();

		expect(preferences.isTracking).toBe(true);
		expect(service.isCameraSoftPaused).toBe(true);
		expect(sidecar.stopCamera).toHaveBeenCalled();
		expect(state.blinkReminderActive).toBe(true);
		expect(state.blinkInterval).not.toBeNull();
		service.ensureStopped();
	});

	it("does not show a blink overlay or toast when the gate is closed", () => {
		const preferences = createPreferences({
			isTracking: false,
			cameraEnabled: false,
			reminderInterval: 3000,
			notificationStyle: "both",
		});
		const windows = createWindows();
		const sound = createSound();
		const os = createOs();
		const service = new ReminderService(
			preferences,
			new AppRuntimeState(),
			windows,
			createSidecar({ isRunning: false, isCameraReady: false }),
			sound,
			createStore(),
			null,
			{
				notificationsAllowed: () => false,
				pauseReason: () => "quiet-hours",
			},
			null,
			null,
			os,
		);

		service.start(3000);

		expect(windows.showReminder).not.toHaveBeenCalled();
		expect(os.show).not.toHaveBeenCalled();
		expect(sound.play).not.toHaveBeenCalled();
		service.ensureStopped();
	});

	it("shows a native blink toast without an overlay", () => {
		const preferences = createPreferences({
			isTracking: false,
			cameraEnabled: false,
			microBreakInterval: 3000,
			notificationStyle: "native",
		});
		const windows = createWindows();
		const sound = createSound();
		const os = createOs();
		const service = new ReminderService(
			preferences,
			new AppRuntimeState(),
			windows,
			createSidecar({ isRunning: false, isCameraReady: false }),
			sound,
			createStore(),
			null,
			undefined,
			null,
			null,
			os,
		);

		service.start(3000);

		expect(os.show).toHaveBeenCalledOnce();
		expect(os.show).toHaveBeenCalledWith(
			"blink",
			expect.objectContaining({
				title: expect.any(String),
				body: expect.any(String),
			}),
			expect.any(Object),
		);
		expect(windows.showReminder).not.toHaveBeenCalled();
		expect(sound.play).not.toHaveBeenCalledWith("blink");
		service.ensureStopped();
	});

	it("shows overlay and native blink toast when style is both", () => {
		const preferences = createPreferences({
			isTracking: false,
			cameraEnabled: false,
			microBreakInterval: 3000,
			notificationStyle: "both",
		});
		const windows = createWindows();
		const sound = createSound();
		const os = createOs();
		const service = new ReminderService(
			preferences,
			new AppRuntimeState(),
			windows,
			createSidecar({ isRunning: false, isCameraReady: false }),
			sound,
			createStore(),
			null,
			undefined,
			null,
			null,
			os,
		);

		service.start(3000);

		expectBlinkOverlayShown(windows);
		expect(os.show).toHaveBeenCalledOnce();
		expect(sound.play).not.toHaveBeenCalledWith("blink");
		service.ensureStopped();
	});

	it("native blink stays until blink; escalate chimes after another interval", () => {
		const preferences = createPreferences({
			reminderInterval: 1000,
			notificationStyle: "native",
			soundEnabled: true,
		});
		const state = new AppRuntimeState();
		state.isFaceDetected = true;
		state.lastBlinkTime = Date.now() - 5000;
		state.lastReminderShownAt = Date.now() - 5000;
		const windows = createWindows();
		const sound = createSound();
		const os = createOs();
		const service = new ReminderService(
			preferences,
			state,
			windows,
			createSidecar(),
			sound,
			createStore(),
			null,
			undefined,
			null,
			null,
			os,
		);

		service.syncCameraLoopForMgdMode();
		vi.advanceTimersByTime(100);
		expect(os.show).toHaveBeenCalledOnce();
		expect(windows.showReminder).not.toHaveBeenCalled();
		expect(sound.play).not.toHaveBeenCalledWith("blink");
		const shownAt = state.lastReminderShownAt;

		vi.advanceTimersByTime(2000);
		expect(sound.play).toHaveBeenCalledWith("blink");
		// Stay-until-blink: native toast was not torn down by a 2.5s auto-dismiss.
		expect(os.show).toHaveBeenCalledOnce();
		expect(state.lastReminderShownAt).toBeGreaterThanOrEqual(shownAt);
		service.ensureStopped();
	});

	it("starting overlay does not show a native toast", () => {
		const preferences = createPreferences({
			isTracking: false,
			notificationStyle: "native",
		});
		const windows = createWindows();
		const sound = createSound();
		const os = createOs();
		const service = new ReminderService(
			preferences,
			new AppRuntimeState(),
			windows,
			createSidecar(),
			sound,
			createStore(),
			null,
			undefined,
			null,
			null,
			os,
		);

		service.start(3000);

		expect(windows.showReminder).toHaveBeenCalledWith("starting");
		expect(os.show).not.toHaveBeenCalled();
		expect(sound.play).toHaveBeenCalledWith("starting");
		service.ensureStopped();
	});
});

describe("ReminderService prompt ladder", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("Standard first overlay is silent; escalates once after another reminderInterval", () => {
		const preferences = createPreferences({
			reminderInterval: 1000,
			blinkPromptProfile: "standard",
			soundEnabled: true,
		});
		const state = new AppRuntimeState();
		state.isFaceDetected = true;
		state.lastBlinkTime = Date.now() - 5000;
		state.lastReminderShownAt = Date.now() - 5000;
		const windows = createWindows();
		const sound = createSound();
		const service = new ReminderService(
			preferences,
			state,
			windows,
			createSidecar(),
			sound,
			createStore(),
		);

		service.syncCameraLoopForMgdMode();
		vi.advanceTimersByTime(100);
		expectBlinkOverlayShown(windows);
		expect(sound.play).not.toHaveBeenCalledWith("blink");
		expect(windows.showAmbient).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1100);
		expect(sound.play).toHaveBeenCalledWith("blink");
		expect(sound.play).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(2000);
		expect(sound.play).toHaveBeenCalledTimes(1);
		service.ensureStopped();
	});

	it("Gentle first step is ambient-only; overlay on next miss; sound waits for escalate", () => {
		const preferences = createPreferences({
			reminderInterval: 1000,
			blinkPromptProfile: "gentle",
			soundEnabled: true,
			blinkRateCoachingEnabled: false,
		});
		const state = new AppRuntimeState();
		state.isFaceDetected = true;
		state.lastBlinkTime = Date.now() - 5000;
		state.lastReminderShownAt = Date.now() - 5000;
		const windows = createWindows();
		const sound = createSound();
		const service = new ReminderService(
			preferences,
			state,
			windows,
			createSidecar(),
			sound,
			createStore(),
			createStats({ blinkRateReady: false }),
		);

		service.syncCameraLoopForMgdMode();
		vi.advanceTimersByTime(100);
		expect(windows.showAmbient).toHaveBeenCalled();
		expectBlinkOverlayNotShown(windows);
		expect(sound.play).not.toHaveBeenCalledWith("blink");
		expect(windows.hasAmbient()).toBe(true);
		windows.hideAmbient.mockClear();

		vi.advanceTimersByTime(1100);
		expectBlinkOverlayShown(windows);
		expect(windows.hasAmbient()).toBe(true);
		expect(windows.hideAmbient).not.toHaveBeenCalled();
		expect(sound.play).not.toHaveBeenCalledWith("blink");

		vi.advanceTimersByTime(1100);
		expect(sound.play).toHaveBeenCalledWith("blink");
		expect(windows.hasAmbient()).toBe(true);
		expect(windows.hideAmbient).not.toHaveBeenCalled();
		service.ensureStopped();
	});

	it("Strong first miss shows glow, overlay, and sound together", () => {
		const preferences = createPreferences({
			reminderInterval: 1000,
			blinkPromptProfile: "strong",
			soundEnabled: true,
			blinkRateCoachingEnabled: false,
		});
		const state = new AppRuntimeState();
		state.isFaceDetected = true;
		state.lastBlinkTime = Date.now() - 5000;
		state.lastReminderShownAt = Date.now() - 5000;
		const windows = createWindows();
		const sound = createSound();
		const service = new ReminderService(
			preferences,
			state,
			windows,
			createSidecar(),
			sound,
			createStore(),
			createStats({ blinkRateReady: false }),
		);

		service.syncCameraLoopForMgdMode();
		vi.advanceTimersByTime(100);
		expect(windows.showAmbient).toHaveBeenCalled();
		expectBlinkOverlayShown(windows);
		expect(sound.play).toHaveBeenCalledWith("blink");
		expect(windows.hasAmbient()).toBe(true);

		windows.hideAmbient.mockClear();
		vi.mocked(sound.play).mockClear();
		vi.advanceTimersByTime(1100);
		expect(sound.play).not.toHaveBeenCalledWith("blink");
		expect(windows.hideAmbient).not.toHaveBeenCalled();
		expect(windows.hasAmbient()).toBe(true);
		service.ensureStopped();
	});

	it("FR-6 low ready BPM with coaching + sound escalates on first Standard overlay", () => {
		const preferences = createPreferences({
			reminderInterval: 1000,
			blinkPromptProfile: "standard",
			soundEnabled: true,
			blinkRateCoachingEnabled: true,
			blinkRateThresholdPerMin: 4,
		});
		const state = new AppRuntimeState();
		state.isFaceDetected = true;
		state.lastBlinkTime = Date.now() - 5000;
		state.lastReminderShownAt = Date.now() - 5000;
		const windows = createWindows();
		const sound = createSound();
		const service = new ReminderService(
			preferences,
			state,
			windows,
			createSidecar(),
			sound,
			createStore(),
			createStats({ blinksPerMinute: 2, blinkRateReady: true }),
		);

		service.syncCameraLoopForMgdMode();
		vi.advanceTimersByTime(100);
		expectBlinkOverlayShown(windows);
		expect(sound.play).toHaveBeenCalledWith("blink");
		service.ensureStopped();
	});

	it("FR-6 coaching off ignores low BPM for instant escalate", () => {
		const preferences = createPreferences({
			reminderInterval: 1000,
			blinkPromptProfile: "standard",
			soundEnabled: true,
			blinkRateCoachingEnabled: false,
			blinkRateThresholdPerMin: 4,
		});
		const state = new AppRuntimeState();
		state.isFaceDetected = true;
		state.lastBlinkTime = Date.now() - 5000;
		state.lastReminderShownAt = Date.now() - 5000;
		const windows = createWindows();
		const sound = createSound();
		const service = new ReminderService(
			preferences,
			state,
			windows,
			createSidecar(),
			sound,
			createStore(),
			createStats({ blinksPerMinute: 2, blinkRateReady: true }),
		);

		service.syncCameraLoopForMgdMode();
		vi.advanceTimersByTime(100);
		expectBlinkOverlayShown(windows);
		expect(sound.play).not.toHaveBeenCalledWith("blink");
		service.ensureStopped();
	});

	it("MGD shows overlay immediately with no ambient; sound waits for escalate", () => {
		const preferences = createPreferences({
			reminderInterval: 1000,
			mgdMode: true,
			blinkPromptProfile: "gentle",
			soundEnabled: true,
		});
		const state = new AppRuntimeState();
		state.isFaceDetected = true;
		const windows = createWindows();
		const sound = createSound();
		const service = new ReminderService(
			preferences,
			state,
			windows,
			createSidecar(),
			sound,
			createStore(),
		);

		service.syncCameraLoopForMgdMode();
		expect(state.mgdReminderLoopActive).toBe(true);

		vi.advanceTimersByTime(1000);
		expectBlinkOverlayShown(windows);
		expect(windows.showAmbient).not.toHaveBeenCalled();
		expect(sound.play).not.toHaveBeenCalledWith("blink");

		vi.advanceTimersByTime(1000);
		expect(sound.play).toHaveBeenCalledWith("blink");
		service.ensureStopped();
	});

	it("timer uses microBreakInterval, escalates when cue stays, then replaces", () => {
		const preferences = createPreferences({
			isTracking: false,
			cameraEnabled: false,
			microBreakInterval: 5000,
			blinkPromptProfile: "standard",
			soundEnabled: true,
		});
		const windows = createWindows();
		const sound = createSound();
		const service = new ReminderService(
			preferences,
			new AppRuntimeState(),
			windows,
			createSidecar({ isRunning: false, isCameraReady: false }),
			sound,
			createStore(),
		);

		service.start(3000);
		expectBlinkOverlayShown(windows);
		expect(sound.play).not.toHaveBeenCalledWith("blink");
		const showsAfterStart = windows.showReminder.mock.calls.length;

		vi.advanceTimersByTime(5000);
		expect(sound.play).toHaveBeenCalledWith("blink");

		windows.showReminder.mockClear();
		vi.advanceTimersByTime(5000);
		// Replace after escalate: dismiss + new first overlay
		expectBlinkOverlayShown(windows);
		expect(windows.showReminder.mock.calls.length).toBeGreaterThanOrEqual(1);
		expect(showsAfterStart).toBeGreaterThan(0);
		service.ensureStopped();
	});

	it("dismissVisibleBlink hides ambient and clears escalate state", () => {
		const preferences = createPreferences({
			reminderInterval: 1000,
			blinkPromptProfile: "gentle",
			blinkRateCoachingEnabled: false,
		});
		const state = new AppRuntimeState();
		state.isFaceDetected = true;
		state.lastBlinkTime = Date.now() - 5000;
		state.lastReminderShownAt = Date.now() - 5000;
		const windows = createWindows();
		const service = new ReminderService(
			preferences,
			state,
			windows,
			createSidecar(),
			createSound(),
			createStore(),
			createStats({ blinkRateReady: false }),
		);

		service.syncCameraLoopForMgdMode();
		vi.advanceTimersByTime(100);
		expect(windows.showAmbient).toHaveBeenCalled();

		service.dismissVisibleBlink();
		expect(windows.hideAmbient).toHaveBeenCalled();
		expect(windows.closeReminder).toHaveBeenCalled();
		service.ensureStopped();
	});

	it("rotates camera pool via blinkPromptIndex after successful overlay show", () => {
		const preferences = createPreferences({
			reminderInterval: 1000,
			popupMessage: defaultPopupMessage("en"),
			notificationStyle: "overlay",
			blinkPromptProfile: "standard",
		});
		const store = createStore();
		const state = new AppRuntimeState();
		state.isFaceDetected = true;
		state.lastBlinkTime = Date.now() - 5000;
		state.lastReminderShownAt = Date.now() - 5000;
		const windows = createWindows();
		const service = new ReminderService(
			preferences,
			state,
			windows,
			createSidecar(),
			createSound(),
			store,
		);

		service.syncCameraLoopForMgdMode();
		vi.advanceTimersByTime(100);

		expect(windows.showReminder).toHaveBeenCalledWith(
			"blink",
			expect.objectContaining({
				message: t("en", BLINK_CAMERA_MESSAGE_POOL_KEYS[0]),
			}),
		);
		expect(store.get("blinkPromptIndex", 0)).toBe(1);

		service.dismissVisibleBlink();
		windows.showReminder.mockClear();
		state.lastBlinkTime = Date.now() - 5000;
		state.lastReminderShownAt = Date.now() - 5000;
		vi.advanceTimersByTime(100);

		expect(windows.showReminder).toHaveBeenCalledWith(
			"blink",
			expect.objectContaining({
				message: t("en", BLINK_CAMERA_MESSAGE_POOL_KEYS[1]),
			}),
		);
		expect(store.get("blinkPromptIndex", 0)).toBe(2);
		service.ensureStopped();
	});

	it("uses custom popupMessage and does not advance blinkPromptIndex", () => {
		const preferences = createPreferences({
			isTracking: true,
			cameraEnabled: true,
			popupMessage: "Soft blink please",
			notificationStyle: "overlay",
			blinkPromptProfile: "standard",
		});
		const store = createStore();
		store.set("blinkPromptIndex", 3);
		const windows = createWindows();
		const state = new AppRuntimeState();
		state.isFaceDetected = true;
		state.lastBlinkTime = Date.now() - 5000;
		state.lastReminderShownAt = Date.now() - 5000;
		const service = new ReminderService(
			preferences,
			state,
			windows,
			createSidecar(),
			createSound(),
			store,
		);

		service.syncCameraLoopForMgdMode();
		vi.advanceTimersByTime(100);

		expect(windows.showReminder).toHaveBeenCalledWith(
			"blink",
			expect.objectContaining({ message: "Soft blink please" }),
		);
		expect(store.get("blinkPromptIndex", 0)).toBe(3);
		service.ensureStopped();
	});

	it("uses timer pool when camera is off", () => {
		const preferences = createPreferences({
			isTracking: false,
			cameraEnabled: false,
			microBreakInterval: 3000,
			popupMessage: defaultPopupMessage("en"),
			notificationStyle: "both",
		});
		const store = createStore();
		store.set("blinkPromptIndex", 2);
		const windows = createWindows();
		const os = createOs();
		const service = new ReminderService(
			preferences,
			new AppRuntimeState(),
			windows,
			createSidecar({ isRunning: false, isCameraReady: false }),
			createSound(),
			store,
			null,
			undefined,
			null,
			null,
			os,
		);

		service.start(3000);

		const expected = t("en", BLINK_TIMER_MESSAGE_POOL_KEYS[2]);
		expect(windows.showReminder).toHaveBeenCalledWith(
			"blink",
			expect.objectContaining({ message: expected }),
		);
		expect(os.show).toHaveBeenCalledWith(
			"blink",
			expect.objectContaining({ body: expected }),
			expect.any(Object),
		);
		expect(store.get("blinkPromptIndex", 0)).toBe(3);
		service.ensureStopped();
	});

	it("does not advance blinkPromptIndex on ambient-only Gentle step", () => {
		const preferences = createPreferences({
			reminderInterval: 1000,
			blinkPromptProfile: "gentle",
			blinkRateCoachingEnabled: false,
			popupMessage: defaultPopupMessage("en"),
		});
		const store = createStore();
		store.set("blinkPromptIndex", 1);
		const state = new AppRuntimeState();
		state.isFaceDetected = true;
		state.lastBlinkTime = Date.now() - 5000;
		state.lastReminderShownAt = Date.now() - 5000;
		const windows = createWindows();
		const service = new ReminderService(
			preferences,
			state,
			windows,
			createSidecar(),
			createSound(),
			store,
			createStats({ blinkRateReady: false }),
		);

		service.syncCameraLoopForMgdMode();
		vi.advanceTimersByTime(100);
		expect(windows.showAmbient).toHaveBeenCalled();
		expectBlinkOverlayNotShown(windows);
		expect(store.get("blinkPromptIndex", 0)).toBe(1);

		vi.advanceTimersByTime(1100);
		expect(windows.showReminder).toHaveBeenCalledWith(
			"blink",
			expect.objectContaining({
				message: t("en", BLINK_CAMERA_MESSAGE_POOL_KEYS[1]),
			}),
		);
		expect(store.get("blinkPromptIndex", 0)).toBe(2);
		service.ensureStopped();
	});
});

describe("ReminderService FR-7 streak cheer", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	/** Advance fake time while keeping miss-gap timers from firing blink overlays. */
	function advanceHealthyStreak(state: AppRuntimeState, ms: number): void {
		const chunk = 1_000;
		let left = ms;
		while (left > 0) {
			const step = Math.min(chunk, left);
			state.lastBlinkTime = Date.now();
			state.lastReminderShownAt = Date.now();
			vi.advanceTimersByTime(step);
			left -= step;
		}
	}

	function startHealthyFaceAware(options?: {
		gate?: { notificationsAllowed: () => boolean; pauseReason: () => null };
		bpm?: number;
		ready?: boolean;
		mgdMode?: boolean;
		cameraEnabled?: boolean;
	}) {
		const preferences = createPreferences({
			reminderInterval: 3000,
			blinkRateThresholdPerMin: 4,
			blinkRateCoachingEnabled: false,
			mgdMode: options?.mgdMode ?? false,
			cameraEnabled: options?.cameraEnabled ?? true,
		});
		const state = new AppRuntimeState();
		state.isFaceDetected = true;
		state.lastBlinkTime = Date.now();
		state.lastReminderShownAt = Date.now();
		const windows = createWindows();
		const sound = createSound();
		const stats = createStats({
			blinksPerMinute: options?.bpm ?? 8,
			blinkRateReady: options?.ready ?? true,
		});
		const service = new ReminderService(
			preferences,
			state,
			windows,
			createSidecar(),
			sound,
			createStore(),
			stats,
			options?.gate,
		);
		service.syncCameraLoopForMgdMode();
		return { preferences, state, windows, sound, stats, service };
	}

	it("cheers after 10 continuous minutes of healthy ready BPM", () => {
		const { state, windows, sound, service } = startHealthyFaceAware();

		advanceHealthyStreak(state, STREAK_CHEER_HEALTHY_MS - 1_000);
		expect(windows.showCheerToast).not.toHaveBeenCalled();
		expect(sound.play).not.toHaveBeenCalledWith("cheer", { force: true });

		advanceHealthyStreak(state, 2_000);
		expect(windows.showCheerToast).toHaveBeenCalledWith({ kind: "cheer" });
		expect(sound.play).toHaveBeenCalledWith("cheer", { force: true });
		expect(sound.play).not.toHaveBeenCalledWith("blink");
		service.ensureStopped();
	});

	it("does not cheer again inside the 30 minute cooldown", () => {
		const { state, windows, sound, service } = startHealthyFaceAware();

		advanceHealthyStreak(state, STREAK_CHEER_HEALTHY_MS + 500);
		expect(windows.showCheerToast).toHaveBeenCalledTimes(1);

		advanceHealthyStreak(state, STREAK_CHEER_HEALTHY_MS + 500);
		expect(windows.showCheerToast).toHaveBeenCalledTimes(1);

		// Cooldown ends while accumulator already ≥ 10 min → second cheer.
		advanceHealthyStreak(
			state,
			STREAK_CHEER_COOLDOWN_MS - STREAK_CHEER_HEALTHY_MS,
		);
		expect(windows.showCheerToast).toHaveBeenCalledTimes(2);
		expect(sound.play).toHaveBeenCalledWith("cheer", { force: true });
		service.ensureStopped();
	});

	it("resets accumulator when BPM drops below threshold or is not ready", () => {
		const { state, windows, stats, service } = startHealthyFaceAware();

		advanceHealthyStreak(state, STREAK_CHEER_HEALTHY_MS - 2_000);
		stats.getSnapshot!.mockReturnValue({
			blinksPerMinute: 2,
			blinkRateReady: true,
		});
		advanceHealthyStreak(state, 3_000);
		expect(windows.showCheerToast).not.toHaveBeenCalled();

		stats.getSnapshot!.mockReturnValue({
			blinksPerMinute: 8,
			blinkRateReady: true,
		});
		advanceHealthyStreak(state, STREAK_CHEER_HEALTHY_MS - 2_000);
		expect(windows.showCheerToast).not.toHaveBeenCalled();

		advanceHealthyStreak(state, 3_000);
		expect(windows.showCheerToast).toHaveBeenCalledTimes(1);
		service.ensureStopped();
	});

	it("skips cheer while blink overlay is up and fires after clear", () => {
		const { state, windows, sound, service } = startHealthyFaceAware();

		advanceHealthyStreak(state, STREAK_CHEER_HEALTHY_MS - 1_000);
		windows.reminderOpen = true;
		advanceHealthyStreak(state, 5_000);
		expect(windows.showCheerToast).not.toHaveBeenCalled();

		windows.reminderOpen = false;
		advanceHealthyStreak(state, 2_000);
		expect(windows.showCheerToast).toHaveBeenCalledWith({ kind: "cheer" });
		expect(sound.play).toHaveBeenCalledWith("cheer", { force: true });
		service.ensureStopped();
	});

	it("respects NotificationGate and does not cheer in timer-only mode", () => {
		let allowed = false;
		const gate = {
			notificationsAllowed: () => allowed,
			pauseReason: () => null,
		};
		const gated = startHealthyFaceAware({ gate });
		advanceHealthyStreak(gated.state, STREAK_CHEER_HEALTHY_MS + 500);
		expect(gated.windows.showCheerToast).not.toHaveBeenCalled();

		allowed = true;
		advanceHealthyStreak(gated.state, 500);
		expect(gated.windows.showCheerToast).toHaveBeenCalledTimes(1);
		gated.service.ensureStopped();

		const preferences = createPreferences({
			isTracking: false,
			cameraEnabled: false,
			microBreakInterval: 5_000,
		});
		const windows = createWindows();
		const sound = createSound();
		const timerService = new ReminderService(
			preferences,
			new AppRuntimeState(),
			windows,
			createSidecar({ isRunning: false, isCameraReady: false }),
			sound,
			createStore(),
			createStats({ blinksPerMinute: 8, blinkRateReady: true }),
		);
		timerService.start(3_000);
		vi.advanceTimersByTime(STREAK_CHEER_HEALTHY_MS + 5_000);
		expect(windows.showCheerToast).not.toHaveBeenCalled();
		expect(sound.play).not.toHaveBeenCalledWith("cheer", { force: true });
		timerService.ensureStopped();
	});

	it("includes MGD when BPM is ready unless blink overlay is up", () => {
		const { state, windows, sound, service } = startHealthyFaceAware({
			mgdMode: true,
		});
		// MGD still ticks cheer without a face; avoid overlay spam blocking the streak.
		state.isFaceDetected = false;

		// MGD polls at reminderInterval (3s), so allow one extra tick past 10 min.
		advanceHealthyStreak(state, STREAK_CHEER_HEALTHY_MS + 4_000);
		expect(windows.showCheerToast).toHaveBeenCalledWith({ kind: "cheer" });
		expect(sound.play).toHaveBeenCalledWith("cheer", { force: true });

		windows.showCheerToast.mockClear();
		vi.mocked(sound.play).mockClear();
		state.isFaceDetected = true;
		vi.advanceTimersByTime(3_000);
		expectBlinkOverlayShown(windows);
		expect(windows.showCheerToast).not.toHaveBeenCalled();
		service.ensureStopped();
	});
});

describe("ReminderService setOnTrackingChange", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("start tracking notifies true once", () => {
		const preferences = createPreferences({ isTracking: false });
		const service = new ReminderService(
			preferences,
			new AppRuntimeState(),
			createWindows(),
			createSidecar(),
			createSound(),
			createStore(),
		);
		const onTrackingChange = vi.fn();
		service.setOnTrackingChange(onTrackingChange);

		service.start();

		expect(onTrackingChange).toHaveBeenCalledTimes(1);
		expect(onTrackingChange).toHaveBeenCalledWith(true);
		expect(preferences.isTracking).toBe(true);
		service.ensureStopped();
	});

	it("ensureStopped notifies false when tracking", () => {
		const preferences = createPreferences({ isTracking: true });
		const service = new ReminderService(
			preferences,
			new AppRuntimeState(),
			createWindows(),
			createSidecar(),
			createSound(),
			createStore(),
		);
		const onTrackingChange = vi.fn();
		service.setOnTrackingChange(onTrackingChange);

		service.ensureStopped();

		expect(onTrackingChange).toHaveBeenCalledTimes(1);
		expect(onTrackingChange).toHaveBeenCalledWith(false);
		expect(preferences.isTracking).toBe(false);
	});

	it("no-face auto-stop notifies false", () => {
		const preferences = createPreferences({
			autoStopNoFaceEnabled: true,
			autoStopNoFaceMinutes: 2,
		});
		const state = new AppRuntimeState();
		const service = new ReminderService(
			preferences,
			state,
			createWindows(),
			createSidecar(),
			createSound(),
			createStore(),
		);
		const onTrackingChange = vi.fn();
		service.setOnTrackingChange(onTrackingChange);

		service.onFaceDetection(false);
		vi.advanceTimersByTime(NO_FACE_DEBOUNCE_MS);
		expect(onTrackingChange).not.toHaveBeenCalled();

		vi.advanceTimersByTime(2 * 60 * 1000);
		expect(preferences.isTracking).toBe(false);
		expect(onTrackingChange).toHaveBeenCalledTimes(1);
		expect(onTrackingChange).toHaveBeenCalledWith(false);
	});

	it("pauseCameraForFocus soft pause does not notify tracking false", () => {
		const preferences = createPreferences({ isTracking: true });
		const sidecar = createSidecar();
		const service = new ReminderService(
			preferences,
			new AppRuntimeState(),
			createWindows(),
			sidecar,
			createSound(),
			createStore(),
		);
		const onTrackingChange = vi.fn();
		service.setOnTrackingChange(onTrackingChange);

		service.pauseCameraForFocus();

		expect(service.isCameraSoftPaused).toBe(true);
		expect(preferences.isTracking).toBe(true);
		expect(onTrackingChange).not.toHaveBeenCalled();
		expect(sidecar.stopCamera).toHaveBeenCalled();
	});

	it("unchanged setTracking does not notify", () => {
		const preferences = createPreferences({ isTracking: false });
		const service = new ReminderService(
			preferences,
			new AppRuntimeState(),
			createWindows(),
			createSidecar(),
			createSound(),
			createStore(),
		);
		const onTrackingChange = vi.fn();
		service.setOnTrackingChange(onTrackingChange);

		service.ensureStopped();

		expect(preferences.isTracking).toBe(false);
		expect(onTrackingChange).not.toHaveBeenCalled();
	});

	it("ensureStopped releases capture before clearing tracking", () => {
		const callOrder: string[] = [];
		const sidecar = createSidecar();
		vi.mocked(sidecar.stopCamera).mockImplementation(() => {
			callOrder.push("stopCamera");
		});
		const preferences = createPreferences({ isTracking: true });
		const service = new ReminderService(
			preferences,
			new AppRuntimeState(),
			createWindows(),
			sidecar,
			createSound(),
			createStore(),
		);
		service.setOnTrackingChange((isTracking) => {
			callOrder.push(`tracking:${isTracking}`);
		});

		service.ensureStopped();

		expect(callOrder).toEqual(["stopCamera", "tracking:false"]);
		expect(preferences.isTracking).toBe(false);
	});
});
