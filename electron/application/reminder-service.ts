import { IPC_CHANNELS } from "../../shared/ipc-channels";
import { defaultPopupMessage, t } from "../../shared/i18n";
import {
	resolvePromptSurfaces,
	withNativeFallback,
} from "../../shared/notification-style";
import type { AppPreferences } from "../../shared/preferences";
import {
	BLINK_CREDIT_DEBOUNCE_MS,
	CAMERA_POLL_INTERVAL_MS,
	FACE_RETURN_DEBOUNCE_MS,
	NO_FACE_DEBOUNCE_MS,
	REMINDER_POPUP_VISIBLE_MS,
	STREAK_CHEER_COOLDOWN_MS,
	STREAK_CHEER_HEALTHY_MS,
	autoStopNoFaceDelayMs,
	type BlinkCreditSource,
	nextTimerReminderDelay,
	promptSnoozeMs,
	shouldArmAutoStopOnNoFace,
	shouldShowCameraReminder,
} from "../domain/reminder-policy";
import {
	BLINK_CAMERA_MESSAGE_POOL_KEYS,
	BLINK_TIMER_MESSAGE_POOL_KEYS,
	type BlinkBackoffState,
	type BlinkPromptStep,
	createBackoffState,
	nextBackoffIntervalMs,
	nextBlinkPromptStep,
	pickBlinkOverlayMessage,
	resetBackoff,
} from "../domain/reminder-prompt-policy";
import type { AppRuntimeState } from "./app-runtime-state";
import { tokenSnoozeToastLabel } from "./snooze-token-prompt";
import type {
	BlinkRateCoachingPort,
	BlinkStatsPort,
	CalibrationNudgePort,
} from "./ports/blink-stats-port";
import type { PreferenceStore } from "./ports/preference-store";
import type { NotificationGate } from "./ports/notification-gate";
import {
	NO_OP_OS_NOTIFICATIONS,
	type BlinkDetectorPort,
	type NotificationSoundPort,
	type OsNotificationPort,
	type ReminderWindowPort,
} from "./ports/runtime-ports";

const ALLOW_ALL_GATE: NotificationGate = {
	notificationsAllowed: () => true,
	pauseReason: () => null,
};

export type CameraPauseReason = "focus" | "session";

type BlinkPromptSession = {
	overlay: unknown | null;
	ambient: boolean;
	escalateChimePlayed: boolean;
	/** Overlay / native body for this visible session (fallback toast). */
	message: string | null;
};

export class ReminderService {
	private lastDetectedBlinkAt = 0;
	private readonly cameraPauseReasons = new Set<CameraPauseReason>();
	private trackingSessionStop: ((showStatus: boolean) => void) | null = null;
	private sessionRecap: { handleStop(options: { showStatus: boolean }): boolean } | null =
		null;
	private onTrackingChange: ((isTracking: boolean) => void) | null = null;
	private blinkSession: BlinkPromptSession | null = null;
	private backoff: BlinkBackoffState;
	/** Continuous healthy ready-BPM ms (FR-7); resets when unhealthy / not tracking. */
	private streakHealthyAccumulatedMs = 0;
	private streakLastTickAt: number | null = null;
	/** Last streak cheer wall time; 0 = never. In-memory only. */
	private streakLastCheerAt = 0;

	constructor(
		private readonly preferences: AppPreferences,
		private readonly state: AppRuntimeState,
		private readonly windows: ReminderWindowPort,
		private readonly sidecar: BlinkDetectorPort,
		private readonly sound: NotificationSoundPort,
		private readonly store: PreferenceStore,
		private readonly stats: BlinkStatsPort | null = null,
		private readonly notificationGate: NotificationGate = ALLOW_ALL_GATE,
		private readonly coaching: BlinkRateCoachingPort | null = null,
		private readonly calibrationNudge: CalibrationNudgePort | null = null,
		private readonly osNotifications: OsNotificationPort = NO_OP_OS_NOTIFICATIONS,
		/** Injectable clock for streak cheer tests (defaults to wall clock). */
		private readonly now: () => number = () => Date.now(),
	) {
		this.backoff = createBackoffState(this.preferences.reminderInterval);
	}

	/**
	 * Late-bind session teardown so no-face auto-stop can pause eye-care
	 * when coupled (`eyeCareIndependentOfTracking === false`).
	 * Exercises / look-away are constructed after this service in main.
	 */
	bindTrackingSessionStop(handler: (showStatus: boolean) => void): void {
		this.trackingSessionStop = handler;
	}

	bindSessionRecap(
		recap: { handleStop(options: { showStatus: boolean }): boolean } | null,
	): void {
		this.sessionRecap = recap;
	}

	/**
	 * Late-bind capture-status / tray listeners when persisted tracking flips.
	 * Soft pause does not clear isTracking and must not fire this.
	 */
	setOnTrackingChange(
		listener: ((isTracking: boolean) => void) | null,
	): void {
		this.onTrackingChange = listener;
	}

	start(interval = this.preferences.reminderInterval): void {
		this.ensureStopped();
		this.setTracking(true);
		this.preferences.reminderInterval = interval;
		this.backoff = createBackoffState(interval);
		if (this.preferences.cameraEnabled) {
			this.startCameraMonitoring();
		} else {
			this.startTimerLoop();
		}
	}

	stop(showStatus = true): void {
		this.ensureStopped();
		this.windows.closeCamera();
		if (showStatus) {
			this.sound.play("stopped");
			const recapShown =
				this.sessionRecap?.handleStop({ showStatus: true }) ?? false;
			if (!recapShown) {
				this.windows.showReminder("stopped");
			}
		}
	}

	ensureStopped(): void {
		this.state.clearReminderTimers();
		this.state.isAutoResuming = false;
		this.cameraPauseReasons.clear();
		this.coaching?.stop();
		this.calibrationNudge?.stop();
		// Release capture before clearing isTracking so capture-status never
		// briefly derives "preview" (capturing + !tracking) during Stop.
		this.sidecar.stopCamera();
		this.setTracking(false);
		this.resetFaceTracking();
		this.dismissVisibleBlink();
	}

	private setTracking(value: boolean): void {
		const wasTracking = this.preferences.isTracking;
		this.preferences.isTracking = value;
		this.store.set("isTracking", value);
		if (value && !wasTracking) this.stats?.onTrackingStart();
		if (!value && wasTracking) {
			this.stats?.setFaceCoverageMode(false);
			this.stats?.onTrackingStop();
			this.resetStreakCheerAccumulator();
		}
		if (value !== wasTracking) {
			this.onTrackingChange?.(value);
		}
	}

	/** Sidecar-detected blink only. Debounced; closes any open reminder. */
	onBlink(): boolean {
		if (!this.preferences.isTracking) return false;
		if (!this.creditBlink("detected")) return false;
		this.stats?.recordBlink();
		this.dismissVisibleBlink();
		return true;
	}

	/**
	 * Credits a blink (or grace reset). Returns false when a detected blink is
	 * dropped by the main-side debounce.
	 */
	creditBlink(source: BlinkCreditSource): boolean {
		if (source === "detected") {
			const now = Date.now();
			if (now - this.lastDetectedBlinkAt < BLINK_CREDIT_DEBOUNCE_MS) {
				return false;
			}
			this.lastDetectedBlinkAt = now;
		}
		this.state.lastBlinkTime = Date.now();
		return true;
	}

	/** Close overlay + ambient + native blink toast without snoozing or stopping tracking. */
	dismissVisibleBlink(): void {
		this.windows.hideAmbient();
		this.windows.closeReminder();
		this.osNotifications.dismiss("blink");
		this.blinkSession = null;
	}

	/** Auto-dismiss / show cooldown — does not forge blink credit. */
	markReminderShown(): void {
		this.state.lastReminderShownAt = Date.now();
	}

	/**
	 * Suppress blink popups for {@link promptSnoozeMs}(`snoozeMinutes`).
	 * Does not forge blink credit. Loops keep running; shows resume naturally
	 * after the snooze window.
	 */
	snooze(): void {
		const ms = promptSnoozeMs(this.preferences.snoozeMinutes);
		this.dismissVisibleBlink();
		if (this.state.blinkSnoozeTimeout) {
			clearTimeout(this.state.blinkSnoozeTimeout);
		}
		this.state.blinkSnoozeUntil = Date.now() + ms;
		this.markReminderShown();
		this.state.blinkSnoozeTimeout = setTimeout(() => {
			this.state.blinkSnoozeUntil = 0;
			this.state.blinkSnoozeTimeout = null;
		}, ms);
	}

	onFaceDetection(faceDetected: boolean): void {
		if (!this.preferences.isTracking || !this.preferences.cameraEnabled) return;
		if (faceDetected) {
			this.cancelNoFaceDebounce();
			if (this.state.isFaceDetected && !this.windows.hasNoFace()) {
				this.cancelFaceReturnDebounce();
				return;
			}
			if (this.state.faceReturnDebounceTimer) return;
			this.state.faceReturnDebounceTimer = setTimeout(() => {
				this.state.faceReturnDebounceTimer = null;
				if (!this.preferences.isTracking || !this.preferences.cameraEnabled) {
					return;
				}
				const wasDetected = this.state.isFaceDetected;
				this.state.isFaceDetected = true;
				this.cancelNoFaceAutoStop();
				if (this.windows.hasNoFace()) this.windows.hideNoFace();
				if (!wasDetected) this.creditBlink("face-return");
			}, FACE_RETURN_DEBOUNCE_MS);
			return;
		}
		this.cancelFaceReturnDebounce();
		if (
			this.state.noFaceDebounceTimer ||
			this.windows.hasNoFace()
		) {
			return;
		}
		this.state.noFaceDebounceTimer = setTimeout(() => {
			this.state.noFaceDebounceTimer = null;
			if (!this.preferences.isTracking || !this.preferences.cameraEnabled) {
				return;
			}
			this.state.isFaceDetected = false;
			this.dismissVisibleBlink();
			this.windows.hideCalibrationNudge();
			this.armNoFaceAutoStop();
			if (!this.notificationGate.notificationsAllowed()) return;
			this.windows.showNoFace();
		}, NO_FACE_DEBOUNCE_MS);
	}

	/**
	 * Pause reminder loops and camera without clearing persisted isTracking.
	 * Stats stop so lid-closed time does not count as tracking minutes.
	 */
	pauseForSession(): void {
		this.state.clearReminderTimers();
		this.freezeStreakCheerClock();
		this.pauseCameraForFocus("session");
		if (this.preferences.isTracking) this.stats?.onTrackingStop();
	}

	/**
	 * Soft-pause the camera while the lid is closed but an external display
	 * is still on. Timer blink reminders keep running.
	 */
	pauseCameraForClamshell(): void {
		this.pauseCameraForFocus("session");
		if (!this.preferences.isTracking) return;
		this.state.clearReminderTimers();
		this.freezeStreakCheerClock();
		this.startTimerLoop(false);
	}

	/**
	 * Restore loops after sleep / lid-open. Does not persist isTracking.
	 * `releaseCamera` drops the session camera hold; `restoreStats` restarts
	 * tracking-minute accrual after {@link pauseForSession}.
	 */
	resumeAfterSleep(
		options: { releaseCamera?: boolean; restoreStats?: boolean } = {},
	): void {
		const releaseCamera = options.releaseCamera ?? true;
		const restoreStats = options.restoreStats ?? true;
		if (releaseCamera) this.cameraPauseReasons.delete("session");
		this.state.isAutoResuming = true;
		this.creditBlink("sleep");
		if (restoreStats && this.preferences.isTracking) {
			this.stats?.onTrackingStart();
		}
		this.state.clearReminderTimers();
		if (this.preferences.isTracking) {
			if (
				this.preferences.cameraEnabled &&
				this.cameraPauseReasons.size === 0
			) {
				this.startCameraMonitoring(false);
			} else if (!this.preferences.cameraEnabled || !releaseCamera) {
				this.startTimerLoop(false);
			}
		}
		this.windows.sendPreferences();
		setTimeout(() => {
			this.state.isAutoResuming = false;
		}, 3000);
	}

	/**
	 * Mid-session MGD toggle: swap face-aware ↔ MGD loop without full stop.
	 * Pref `mgdMode` must already be updated by the caller.
	 */
	syncCameraLoopForMgdMode(): void {
		if (
			!this.preferences.isTracking ||
			!this.preferences.cameraEnabled ||
			!this.sidecar.isRunning ||
			!this.sidecar.isCameraReady
		) {
			return;
		}
		this.state.clearReminderTimers();
		this.dismissVisibleBlink();
		this.backoff = createBackoffState(this.preferences.reminderInterval);
		if (this.preferences.mgdMode) {
			this.startMgdLoop();
		} else {
			this.startFaceAwareLoop();
		}
	}

	/**
	 * Mid-session reminder-interval / micro-break change: reschedule loops
	 * without stopping the camera sidecar. Prefs must already be updated.
	 */
	applyReminderInterval(): void {
		if (!this.preferences.isTracking) return;

		this.state.clearReminderTimers();
		this.dismissVisibleBlink();
		this.backoff = createBackoffState(this.preferences.reminderInterval);

		if (!this.preferences.cameraEnabled) {
			// Re-arm timer cadence without an immediate popup (slider tweak).
			this.stats?.setFaceCoverageMode(false);
			this.coaching?.stop();
			this.calibrationNudge?.stop();
			this.state.blinkReminderActive = true;
			this.state.blinkInterval = setInterval(() => {
				if (this.state.blinkReminderActive && this.preferences.isTracking) {
					this.onTimerTick();
				} else {
					this.state.clearReminderTimers();
				}
			}, nextTimerReminderDelay(this.preferences.microBreakInterval));
			return;
		}

		// Still waiting for camera — wait-for-camera path will arm with new pref.
		if (!this.sidecar.isRunning || !this.sidecar.isCameraReady) {
			return;
		}

		if (this.preferences.mgdMode) {
			this.startMgdLoop();
		} else {
			this.startFaceAwareLoop();
		}
	}

	/**
	 * After a settings-setup switch flips `cameraEnabled` while tracking.
	 * Arms camera monitoring or the timer loop without clearing `isTracking`.
	 * Prefer this over {@link applyReminderInterval} when the mode itself changed
	 * — interval-only apply clears timers then no-ops if the sidecar is not ready.
	 */
	resyncLoopsForCameraModeChange(): void {
		if (!this.preferences.isTracking) return;

		this.state.clearReminderTimers();
		this.dismissVisibleBlink();
		this.backoff = createBackoffState(this.preferences.reminderInterval);

		if (this.preferences.cameraEnabled) {
			this.startCameraMonitoring(false);
			return;
		}

		this.coaching?.stop();
		this.calibrationNudge?.stop();
		this.sidecar.stopCamera();
		this.resetFaceTracking();
		this.stats?.onFaceVisibility(false);
		this.startTimerLoop(false);
	}

	/** Ensure camera sidecar is running so preview / face tracking can work. */
	ensureCameraActive(): void {
		if (!this.preferences.cameraEnabled) return;
		if (!this.sidecar.isRunning) this.sidecar.start();
		if (this.sidecar.isCameraReady) {
			// Preview-only: do not stop/start an already-live capture.
			this.sidecar.requestVideo();
			return;
		}
		this.sidecar.startCamera();
	}

	/** Release capture when preview closes and tracking is not using the camera.
	 * While tracking, only stop JPEG preview encode. */
	stopCameraIfIdle(): void {
		if (this.preferences.isTracking) {
			this.sidecar.stopVideo();
			return;
		}
		this.sidecar.stopCamera();
	}

	/** Soft-pause camera during fullscreen / session without clearing isTracking. */
	pauseCameraForFocus(reason: CameraPauseReason = "focus"): void {
		const alreadyPaused = this.cameraPauseReasons.size > 0;
		this.cameraPauseReasons.add(reason);
		if (alreadyPaused) return;
		this.coaching?.stop();
		this.calibrationNudge?.stop();
		this.sidecar.stopCamera();
		this.resetFaceTracking();
		this.stats?.onFaceVisibility(false);
		this.dismissVisibleBlink();
		this.freezeStreakCheerClock();
	}

	/** Resume camera after fullscreen / session if tracking still wants capture. */
	resumeCameraIfNeeded(reason: CameraPauseReason = "focus"): void {
		this.cameraPauseReasons.delete(reason);
		if (this.cameraPauseReasons.size > 0) return;
		if (!this.preferences.isTracking || !this.preferences.cameraEnabled) {
			return;
		}
		if (this.sidecar.isCameraReady) {
			this.coaching?.start();
			this.calibrationNudge?.start();
			return;
		}
		this.startCameraMonitoring(false);
	}

	get isCameraSoftPaused(): boolean {
		return this.cameraPauseReasons.size > 0;
	}

	private startTimerLoop(showImmediately = true): void {
		this.stats?.setFaceCoverageMode(false);
		this.coaching?.stop();
		this.calibrationNudge?.stop();
		this.resetStreakCheerAccumulator();
		this.state.blinkReminderActive = true;
		if (showImmediately) this.onTimerTick();
		this.state.blinkInterval = setInterval(() => {
			if (this.state.blinkReminderActive && this.preferences.isTracking) {
				this.onTimerTick();
			} else {
				this.state.clearReminderTimers();
			}
		}, nextTimerReminderDelay(this.preferences.microBreakInterval));
	}

	/**
	 * Timer micro-break tick: advance ladder / escalate if cue still up;
	 * replace with a fresh first step after escalate; otherwise show first step.
	 */
	private onTimerTick(): void {
		if (this.blinkSession?.escalateChimePlayed) {
			this.dismissVisibleBlink();
			this.showBlinkReminder();
			return;
		}
		this.showBlinkReminder();
	}

	private startCameraMonitoring(showStarting = true): void {
		if (this.state.cameraMonitoringInterval) {
			clearInterval(this.state.cameraMonitoringInterval);
		}

		this.backoff = createBackoffState(this.preferences.reminderInterval);

		// Already capturing — arm reminder loops without DSHOW reopen thrash.
		if (this.sidecar.isRunning && this.sidecar.isCameraReady) {
			this.resetFaceTracking();
			if (showStarting) {
				this.sound.play("starting");
				const popup = this.windows.showReminder("starting");
				setTimeout(() => {
					this.windows.closeReminderIfCurrent(popup);
				}, REMINDER_POPUP_VISIBLE_MS);
			}
			this.coaching?.start();
			this.calibrationNudge?.start();
			this.sidecar.requestVideo();
			this.creditBlink("camera-ready");
			this.windows.sendToMain(IPC_CHANNELS.cameraReady);
			if (this.preferences.mgdMode) {
				this.startMgdLoop();
			} else {
				this.startFaceAwareLoop();
			}
			return;
		}

		this.sidecar.markCameraUnavailable();
		this.resetFaceTracking();
		if (showStarting) {
			this.sound.play("starting");
			const popup = this.windows.showReminder("starting");
			setTimeout(() => {
				this.windows.closeReminderIfCurrent(popup);
			}, REMINDER_POPUP_VISIBLE_MS);
		}
		if (!this.sidecar.isRunning) this.sidecar.start();
		if (!this.sidecar.startCamera()) return;
		this.coaching?.start();
		this.calibrationNudge?.start();

		const waitForCamera = setInterval(() => {
			if (!this.preferences.isTracking) {
				clearInterval(waitForCamera);
				return;
			}
			if (!this.sidecar.isRunning || !this.sidecar.isCameraReady) return;
			clearInterval(waitForCamera);
			this.creditBlink("camera-ready");
			this.windows.sendToMain(IPC_CHANNELS.cameraReady);
			if (this.preferences.mgdMode) {
				this.startMgdLoop();
			} else {
				this.startFaceAwareLoop();
			}
		}, CAMERA_POLL_INTERVAL_MS);
	}

	private startMgdLoop(): void {
		this.stats?.setFaceCoverageMode(false);
		this.backoff = resetBackoff(
			createBackoffState(this.preferences.reminderInterval),
		);
		this.state.mgdReminderLoopActive = true;
		if (this.state.blinkInterval) clearInterval(this.state.blinkInterval);
		this.state.blinkInterval = setInterval(() => {
			if (
				this.state.mgdReminderLoopActive &&
				this.preferences.isTracking &&
				this.preferences.mgdMode &&
				this.sidecar.isRunning
			) {
				this.tickStreakCheer();
				if (this.state.isFaceDetected) {
					this.showBlinkReminder();
				}
			} else {
				this.state.clearReminderTimers();
			}
		}, nextTimerReminderDelay(this.preferences.reminderInterval));
	}

	private startFaceAwareLoop(): void {
		this.stats?.setFaceCoverageMode(true);
		this.state.cameraMonitoringInterval = setInterval(() => {
			if (!this.preferences.isTracking || !this.sidecar.isRunning) {
				this.state.clearReminderTimers();
				return;
			}
			this.tickFaceAwarePrompt();
		}, CAMERA_POLL_INTERVAL_MS);
	}

	private tickFaceAwarePrompt(): void {
		this.tickStreakCheer();
		const now = this.now();
		const hasSurface = this.hasBlinkPromptSurface();
		const i0 = this.preferences.reminderInterval;
		const timeSinceLastReminderMs = now - this.state.lastReminderShownAt;

		if (hasSurface) {
			// Advance ambient → overlay → escalate after one more miss gap.
			if (timeSinceLastReminderMs >= i0) {
				this.showBlinkReminder();
			}
			return;
		}

		const rate = this.readLiveBlinkRate();
		if (
			rate.ready &&
			Number.isFinite(rate.bpm) &&
			rate.bpm < this.preferences.blinkRateThresholdPerMin
		) {
			this.backoff = resetBackoff(this.backoff);
		}

		const spacingMs = this.preferences.mgdMode
			? i0
			: this.backoff.intervalMs;

		if (
			!shouldShowCameraReminder({
				isTracking: this.preferences.isTracking,
				isDetectorRunning: this.sidecar.isRunning,
				isFaceDetected: this.state.isFaceDetected,
				hasPopup: false,
				timeSinceLastBlinkMs: now - this.state.lastBlinkTime,
				timeSinceLastReminderMs,
				reminderIntervalMs: i0,
			})
		) {
			return;
		}
		if (timeSinceLastReminderMs < spacingMs) return;

		this.showBlinkReminder();
	}

	/**
	 * FR-7: after 10 continuous minutes of camera + tracking + ready BPM ≥ T,
	 * show built-in cheer toast + force cheer sound (30 min in-memory cooldown).
	 * Pauses while blink overlay / ambient / no-face are up; timer-only never cheers.
	 */
	private tickStreakCheer(): void {
		const now = this.now();

		if (!this.preferences.cameraEnabled || !this.preferences.isTracking) {
			this.resetStreakCheerAccumulator();
			return;
		}

		const rate = this.readLiveBlinkRate();
		const healthy =
			rate.ready &&
			Number.isFinite(rate.bpm) &&
			rate.bpm >= this.preferences.blinkRateThresholdPerMin;

		if (!healthy) {
			this.resetStreakCheerAccumulator();
			return;
		}

		const surfacesBlocking =
			this.hasBlinkPromptSurface() || this.windows.hasNoFace();

		if (this.streakLastTickAt !== null && !surfacesBlocking) {
			this.streakHealthyAccumulatedMs += Math.max(
				0,
				now - this.streakLastTickAt,
			);
		}
		this.streakLastTickAt = now;

		if (surfacesBlocking) return;
		if (!this.notificationGate.notificationsAllowed()) return;
		if (
			this.streakLastCheerAt > 0 &&
			now - this.streakLastCheerAt < STREAK_CHEER_COOLDOWN_MS
		) {
			return;
		}
		if (this.streakHealthyAccumulatedMs < STREAK_CHEER_HEALTHY_MS) return;

		this.fireStreakCheer(now);
	}

	private fireStreakCheer(now: number): void {
		this.streakHealthyAccumulatedMs = 0;
		this.streakLastTickAt = now;
		this.streakLastCheerAt = now;
		this.sound.play("cheer", { force: true });
		this.windows.showCheerToast({ kind: "cheer" });
	}

	private resetStreakCheerAccumulator(): void {
		this.streakHealthyAccumulatedMs = 0;
		this.streakLastTickAt = null;
	}

	/** Keep accumulated healthy ms but do not credit a pause/sleep gap. */
	private freezeStreakCheerClock(): void {
		this.streakLastTickAt = null;
	}

	private hasBlinkPromptSurface(): boolean {
		return (
			this.blinkSession !== null ||
			this.windows.hasReminder() ||
			this.windows.hasAmbient()
		);
	}

	private readLiveBlinkRate(): { bpm: number; ready: boolean } {
		const snapshot = this.stats?.getSnapshot?.();
		if (!snapshot) return { bpm: 0, ready: false };
		return {
			bpm: snapshot.blinksPerMinute,
			ready: snapshot.blinkRateReady,
		};
	}

	/**
	 * Soft-suppress blink popups while eye-care / quiet hours / fullscreen / snooze.
	 * Camera: stays until blink/snooze/no-face (no 2.5s auto-dismiss).
	 */
	private showBlinkReminder(): BlinkPromptSession | null {
		if (this.state.isLookAwayShowing) return null;
		if (this.state.isExerciseShowing) return null;
		if (Date.now() < this.state.blinkSnoozeUntil) return null;
		if (!this.notificationGate.notificationsAllowed()) return null;

		this.windows.hideCalibrationNudge();

		const rate = this.readLiveBlinkRate();
		const session = this.blinkSession;
		const step = nextBlinkPromptStep({
			profile: this.preferences.blinkPromptProfile,
			mgdMode: this.preferences.mgdMode && this.preferences.cameraEnabled,
			soundEnabled: this.preferences.soundEnabled,
			overlayShowing: !!(session && !session.ambient),
			ambientShowing: !!(session?.ambient || this.windows.hasAmbient()),
			escalateChimePlayed: session?.escalateChimePlayed ?? false,
			cameraEnabled: this.preferences.cameraEnabled,
			isTracking: this.preferences.isTracking,
			blinkRateCoachingEnabled: this.preferences.blinkRateCoachingEnabled,
			blinkRateReady: rate.ready,
			blinksPerMinute: rate.bpm,
			thresholdPerMin: this.preferences.blinkRateThresholdPerMin,
		});

		if (!step) return session;

		this.presentBlinkPrompt(step);
		return this.blinkSession;
	}

	private presentBlinkPrompt(step: BlinkPromptStep): void {
		const locale = this.preferences.locale === "uk" ? "uk" : "en";

		if (step === "ambient") {
			this.windows.hideAmbient();
			this.windows.closeReminder();
			this.osNotifications.dismiss("blink");
			this.windows.showAmbient();
			this.blinkSession = {
				overlay: null,
				ambient: true,
				escalateChimePlayed: false,
				message: null,
			};
			this.markReminderShown();
			this.updateBackoffAfterShow();
			return;
		}

		const { body, shouldAdvancePool, index } =
			this.resolveBlinkOverlayBody(locale);

		if (step === "full") {
			// Strong: soft glow + overlay (+ chime) together; glow stays until dismiss.
			if (!this.windows.hasAmbient()) {
				this.windows.showAmbient();
			}
			this.showOverlaySurfaces(locale, body, {
				shouldAdvancePool,
				index,
			});
			if (this.blinkSession && !this.blinkSession.escalateChimePlayed) {
				if (this.preferences.soundEnabled) {
					this.sound.play("blink");
				}
				this.blinkSession.escalateChimePlayed = true;
			}
			return;
		}

		if (step === "overlay") {
			// Keep Gentle soft glow under the blink popup (dismiss only on blink/snooze/stop).
			this.showOverlaySurfaces(locale, body, {
				shouldAdvancePool,
				index,
			});
			return;
		}

		// escalate — ensure overlay/native up, chime once (glow stays if already on)
		const alreadyShowingOverlayStep =
			!!this.blinkSession && !this.blinkSession.ambient;
		if (!alreadyShowingOverlayStep) {
			this.showOverlaySurfaces(locale, body, {
				shouldAdvancePool,
				index,
			});
		}

		if (this.blinkSession && !this.blinkSession.escalateChimePlayed) {
			this.sound.play("blink");
			this.blinkSession.escalateChimePlayed = true;
			this.markReminderShown();
		}
	}

	/**
	 * Resolve blink overlay/native copy. Custom non-default `popupMessage`
	 * wins and does not advance `blinkPromptIndex`.
	 */
	private resolveBlinkOverlayBody(locale: "en" | "uk"): {
		body: string;
		shouldAdvancePool: boolean;
		index: number;
	} {
		const defaultMessage = defaultPopupMessage(locale);
		const custom = this.preferences.popupMessage;
		const trimmed = custom.trim();
		const shouldAdvancePool = !trimmed || trimmed === defaultMessage;
		const index = this.readBlinkPromptIndex();
		const body = pickBlinkOverlayMessage({
			locale,
			customPopupMessage: custom,
			cameraEnabled: this.preferences.cameraEnabled,
			index,
			defaultPopupMessage: defaultMessage,
		});
		return { body, shouldAdvancePool, index };
	}

	private readBlinkPromptIndex(): number {
		const rawIndex = this.store.get("blinkPromptIndex", 0);
		return typeof rawIndex === "number" && Number.isFinite(rawIndex)
			? Math.floor(rawIndex)
			: 0;
	}

	private advanceBlinkPromptIndex(index: number): void {
		const poolLen = this.preferences.cameraEnabled
			? BLINK_CAMERA_MESSAGE_POOL_KEYS.length
			: BLINK_TIMER_MESSAGE_POOL_KEYS.length;
		this.store.set("blinkPromptIndex", (index + 1) % poolLen);
	}

	private showOverlaySurfaces(
		locale: "en" | "uk",
		body: string,
		rotation: { shouldAdvancePool: boolean; index: number },
	): void {
		const surfaces = resolvePromptSurfaces(
			this.preferences.notificationStyle,
			this.osNotifications.isSupported(),
		);
		let nativeShown = false;
		if (surfaces.native) {
			const tokenLabel = tokenSnoozeToastLabel(
				locale,
				this.preferences.snoozeMinutes,
				this.stats?.getSnoozeTokenCharges?.() ?? 0,
			);
			nativeShown = this.osNotifications.show(
				"blink",
				{
					title: t(locale, "popup.blink.title"),
					body,
					snoozeLabel: t(locale, "osToast.snooze"),
					...(tokenLabel ? { tokenSnoozeLabel: tokenLabel } : {}),
				},
				{ onFailed: () => this.fallbackBlinkOverlay() },
			).shown;
		}
		const planned = withNativeFallback(surfaces, nativeShown);
		let overlay: unknown | null = null;
		if (planned.overlay) {
			overlay = this.windows.showReminder("blink", { message: body });
		}
		if (planned.overlay && !overlay && !planned.nativeShown) {
			this.blinkSession = null;
			return;
		}

		this.blinkSession = {
			overlay,
			ambient: false,
			escalateChimePlayed: false,
			message: body,
		};
		this.markReminderShown();
		this.updateBackoffAfterShow();
		if (rotation.shouldAdvancePool) {
			this.advanceBlinkPromptIndex(rotation.index);
		}
	}

	private updateBackoffAfterShow(): void {
		const rate = this.readLiveBlinkRate();
		this.backoff = nextBackoffIntervalMs(this.backoff, {
			bpmReady: rate.ready,
			bpm: rate.bpm,
			threshold: this.preferences.blinkRateThresholdPerMin,
			mgdMode: this.preferences.mgdMode,
			cameraEnabled: this.preferences.cameraEnabled,
		});
	}

	private fallbackBlinkOverlay(): void {
		if (this.blinkSession?.overlay) return;
		if (this.state.isLookAwayShowing || this.state.isExerciseShowing) return;
		const message = this.blinkSession?.message ?? undefined;
		const overlay = this.windows.showReminder(
			"blink",
			message ? { message } : undefined,
		);
		if (this.blinkSession) this.blinkSession.overlay = overlay;
	}

	private resetFaceTracking(): void {
		this.state.isFaceDetected = false;
		this.cancelNoFaceDebounce();
		this.cancelNoFaceAutoStop();
		this.cancelFaceReturnDebounce();
		this.windows.hideNoFace();
		this.windows.hideCalibrationNudge();
		this.windows.hideAmbient();
	}

	private cancelNoFaceDebounce(): void {
		if (this.state.noFaceDebounceTimer) {
			clearTimeout(this.state.noFaceDebounceTimer);
			this.state.noFaceDebounceTimer = null;
		}
	}

	private cancelFaceReturnDebounce(): void {
		if (this.state.faceReturnDebounceTimer) {
			clearTimeout(this.state.faceReturnDebounceTimer);
			this.state.faceReturnDebounceTimer = null;
		}
	}

	private cancelNoFaceAutoStop(): void {
		if (this.state.noFaceAutoStopTimer) {
			clearTimeout(this.state.noFaceAutoStopTimer);
			this.state.noFaceAutoStopTimer = null;
		}
	}

	private armNoFaceAutoStop(): void {
		if (
			!shouldArmAutoStopOnNoFace({
				isTracking: this.preferences.isTracking,
				cameraEnabled: this.preferences.cameraEnabled,
				autoStopNoFaceEnabled: this.preferences.autoStopNoFaceEnabled,
				cameraSoftPaused: this.isCameraSoftPaused,
			})
		) {
			return;
		}
		if (this.state.noFaceAutoStopTimer) return;
		const delayMs = autoStopNoFaceDelayMs(
			this.preferences.autoStopNoFaceMinutes,
		);
		this.state.noFaceAutoStopTimer = setTimeout(() => {
			this.state.noFaceAutoStopTimer = null;
			if (
				!shouldArmAutoStopOnNoFace({
					isTracking: this.preferences.isTracking,
					cameraEnabled: this.preferences.cameraEnabled,
					autoStopNoFaceEnabled: this.preferences.autoStopNoFaceEnabled,
					cameraSoftPaused: this.isCameraSoftPaused,
				})
			) {
				return;
			}
			if (this.trackingSessionStop) {
				this.trackingSessionStop(true);
			} else {
				this.stop(true);
			}
			this.windows.sendPreferences();
		}, delayMs);
	}
}
