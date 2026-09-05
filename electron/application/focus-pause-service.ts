import type { AppPreferences, PauseAppRule } from "../../shared/preferences";
import type {
	FocusPauseStatePayload,
	SessionIdleCause,
	SessionPauseMode,
} from "../../shared/session-pause-status";
import { overlayManualHush } from "../../shared/session-pause-status";
import {
	foregroundMatchesAppRules,
	isInQuietHoursForSchedule,
	resolveFocusPauseReason,
	type FocusPauseReason,
} from "../domain/focus-policy";
import type {
	NotificationGate,
	NotificationPauseReason,
} from "./ports/notification-gate";
import type { FocusForegroundSnapshot } from "./ports/focus-environment-port";
import { EMPTY_FOREGROUND_SNAPSHOT } from "./ports/focus-environment-port";
import type { ReminderService } from "./reminder-service";
import {
	NO_OP_OS_NOTIFICATIONS,
	type OsNotificationPort,
} from "./ports/runtime-ports";

export type { FocusPauseStatePayload };

export interface FocusPauseWindowsPort {
	closeReminder(): void;
	closeExercise(): void;
	closeLookAway(): void;
	hideNoFace(): void;
	hideAmbient(): void;
	hideCalibrationNudge(): void;
	sendToMain(channel: string, ...args: unknown[]): void;
}

export class FocusPauseService implements NotificationGate {
	private reason: FocusPauseReason = null;
	private sessionPauseMode: SessionPauseMode = "active";
	private sessionIdleCause: SessionIdleCause | null = null;
	private cameraPausedForFocus = false;
	private foreground: FocusForegroundSnapshot = EMPTY_FOREGROUND_SNAPSHOT;
	private lastExternal: PauseAppRule | null = null;
	private quietHoursTimer: ReturnType<typeof setInterval> | null = null;
	private onState: ((payload: FocusPauseStatePayload) => void) | null = null;
	private getPromptHushState: () => {
		promptSuppressUntil: number;
		promptHushUntilResume: boolean;
	} = () => ({ promptSuppressUntil: 0, promptHushUntilResume: false });

	private promptDismissers: {
		blink: () => void;
		exercise: () => void;
		lookAway: () => void;
	} | null = null;

	constructor(
		private readonly preferences: AppPreferences,
		private readonly windows: FocusPauseWindowsPort,
		private readonly reminders: ReminderService,
		private readonly focusPauseChannel: string,
		private readonly fullscreenDetectionSupported: boolean,
		private readonly osNotifications: OsNotificationPort = NO_OP_OS_NOTIFICATIONS,
	) {}

	setOnState(listener: (payload: FocusPauseStatePayload) => void): void {
		this.onState = listener;
	}

	setPromptHushState(
		getter: () => {
			promptSuppressUntil: number;
			promptHushUntilResume: boolean;
		},
	): void {
		this.getPromptHushState = getter;
	}

	/**
	 * Late-bind prompt teardown so pause can clear native-only showing flags.
	 * Exercise / look-away are constructed after this service in main.
	 */
	bindPromptDismissers(dismissers: {
		blink: () => void;
		exercise: () => void;
		lookAway: () => void;
	}): void {
		this.promptDismissers = dismissers;
	}

	notificationsAllowed(): boolean {
		return this.sessionPauseMode !== "inactive" && this.reason === null;
	}

	pauseReason(): NotificationPauseReason {
		if (this.sessionPauseMode === "inactive") return "session-idle";
		return this.reason;
	}

	/**
	 * Session overlay for Settings/tray. Only `inactive` trips the notification
	 * gate (`session-idle`); `camera-only` is UI-only (clamshell).
	 */
	setSessionOverlay(overlay: {
		mode: SessionPauseMode;
		cause: SessionIdleCause | null;
	}): void {
		const wasInactive = this.sessionPauseMode === "inactive";
		if (
			overlay.mode === this.sessionPauseMode &&
			overlay.cause === this.sessionIdleCause
		) {
			return;
		}
		if (overlay.mode === "inactive" && !wasInactive) {
			this.closeInterruptiveUi();
		}
		this.sessionPauseMode = overlay.mode;
		this.sessionIdleCause = overlay.cause;
		this.pushState();
	}

	setForeground(snapshot: FocusForegroundSnapshot): void {
		this.foreground = snapshot;
		const processName = snapshot.processName?.trim() ?? "";
		if (processName) {
			this.lastExternal = { processName, windowTitle: "" };
		} else {
			const windowTitle = snapshot.windowTitle?.trim() ?? "";
			if (windowTitle) {
				this.lastExternal = { processName: "", windowTitle };
			}
		}
		this.recompute();
	}

	/** Last non-empty foreground identity; survives BlinkGuard-focused empty probes. */
	lastExternalForeground(): PauseAppRule | null {
		return this.lastExternal ? { ...this.lastExternal } : null;
	}

	setFullscreen(isFullscreen: boolean): void {
		this.setForeground({ ...this.foreground, isFullscreen });
	}

	/** Re-evaluate quiet hours / fullscreen / app rules and apply side effects. */
	recompute(): void {
		const appRuleMatched = foregroundMatchesAppRules(
			this.preferences.pauseAppRules,
			{
				processName: this.foreground.processName ?? "",
				windowTitle: this.foreground.windowTitle ?? "",
			},
		);
		const next = resolveFocusPauseReason({
			quietHoursEnabled: this.preferences.quietHoursEnabled,
			inQuietHours: isInQuietHoursForSchedule(
				new Date(),
				this.preferences.quietHoursEnabled,
				this.preferences.quietHoursStart,
				this.preferences.quietHoursEnd,
				this.preferences.quietHoursByWeekday,
			),
			pauseOnFullscreen: this.preferences.pauseOnFullscreen,
			isFullscreen: this.foreground.isFullscreen,
			appRuleMatched,
		});

		if (next !== null && this.reason === null) {
			this.closeInterruptiveUi();
		}

		const cameraShouldPause =
			(this.preferences.pauseOnFullscreen && this.foreground.isFullscreen) ||
			appRuleMatched;
		if (cameraShouldPause && !this.cameraPausedForFocus) {
			this.pauseCameraForFocus();
		} else if (!cameraShouldPause && this.cameraPausedForFocus) {
			this.resumeCameraAfterFocus();
		}

		const changed = next !== this.reason;
		this.reason = next;
		if (changed) {
			this.pushState();
		}
	}

	startQuietHoursWatch(intervalMs = 30_000): void {
		if (this.quietHoursTimer) return;
		this.recompute();
		this.pushState();
		this.quietHoursTimer = setInterval(() => this.recompute(), intervalMs);
	}

	stopQuietHoursWatch(): void {
		if (this.quietHoursTimer) clearInterval(this.quietHoursTimer);
		this.quietHoursTimer = null;
	}

	pushState(): void {
		const hush = this.getPromptHushState();
		const payload = overlayManualHush(
			{
				reason: this.pauseReason(),
				fullscreenDetectionSupported: this.fullscreenDetectionSupported,
				sessionPauseMode: this.sessionPauseMode,
				sessionIdleCause: this.sessionIdleCause,
			},
			hush.promptSuppressUntil,
			hush.promptHushUntilResume,
		);
		this.windows.sendToMain(this.focusPauseChannel, payload);
		this.onState?.(payload);
	}

	closeInterruptiveUi(): void {
		this.windows.closeReminder();
		this.windows.closeExercise();
		this.windows.closeLookAway();
		this.windows.hideNoFace();
		this.windows.hideAmbient();
		this.windows.hideCalibrationNudge();
		this.promptDismissers?.blink();
		this.promptDismissers?.exercise();
		this.promptDismissers?.lookAway();
		this.osNotifications.dismissAll();
	}

	private pauseCameraForFocus(): void {
		if (!this.preferences.isTracking || !this.preferences.cameraEnabled) {
			return;
		}
		this.reminders.pauseCameraForFocus();
		this.cameraPausedForFocus = true;
	}

	private resumeCameraAfterFocus(): void {
		this.cameraPausedForFocus = false;
		this.reminders.resumeCameraIfNeeded();
	}
}
