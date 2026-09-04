import type { CheerCelebration } from "../../../shared/achievements";

export interface ReminderWindowPort {
	showReminder(
		kind: "starting" | "blink" | "stopped",
		options?: { force?: boolean; message?: string },
	): unknown | null;
	closeReminder(): void;
	closeReminderIfCurrent(token: unknown): boolean;
	hasReminder(): boolean;
	/** Gentle peripheral glow (Task 3.1 implements the window). */
	showAmbient(): void;
	hideAmbient(): void;
	hasAmbient(): boolean;
	showNoFace(): void;
	hideNoFace(): void;
	hasNoFace(): boolean;
	showCalibrationNudge(reason: "stale" | "drift"): void;
	hideCalibrationNudge(): void;
	hasCalibrationNudge(): boolean;
	/** Same API as blinkStats.setCheerEffects → windows.showCheerToast. */
	showCheerToast(celebration?: CheerCelebration): void;
	closeCamera(): void;
	sendToMain(channel: string, ...args: unknown[]): void;
	sendPreferences(): void;
}

export interface CalibrationNudgeWindowPort {
	showCalibrationNudge(reason: "stale" | "drift"): void;
	hideCalibrationNudge(): void;
	hasCalibrationNudge(): boolean;
	hasAmbient(): boolean;
	hasReminder(): boolean;
	hasNoFace(): boolean;
	sendToMain(channel: string, ...args: unknown[]): void;
}

export interface BlinkDetectorPort {
	readonly isRunning: boolean;
	readonly isCameraReady: boolean;
	start(): void;
	startCamera(): boolean;
	stopCamera(): void;
	requestVideo(): void;
	stopVideo(): void;
	markCameraUnavailable(): void;
}

export interface ExerciseWindowPort {
	showExercise(prompt: string, onClosed: () => void): unknown | null;
	closeExercise(): void;
	closeExerciseIfCurrent(token: unknown): boolean;
}

export interface LookAwayWindowPort {
	showLookAway(onClosed: () => void): unknown | null;
	closeLookAway(): void;
	closeLookAwayIfCurrent(token: unknown): boolean;
}

export interface NotificationSoundPort {
	play(
		kind: "blink" | "exercise" | "lookAway" | "starting" | "stopped" | "cheer",
		options?: { force?: boolean; volume?: number; cheerTheme?: string },
	): void;
	stop(): void;
}

export type OsToastKind = "blink" | "exercise" | "lookAway" | "sessionRecap";

export type OsToastShowResult = { shown: boolean };

export type OsToastPayload = {
	title: string;
	body: string;
	snoozeLabel: string;
	/** Second action: extended global hush using a snooze token. */
	tokenSnoozeLabel?: string;
};

export interface OsNotificationPort {
	isSupported(): boolean;
	show(
		kind: OsToastKind,
		payload: OsToastPayload,
		hooks?: { onFailed?: () => void },
	): OsToastShowResult;
	showSessionRecap?(payload: { title: string; body: string }): OsToastShowResult;
	dismiss(kind: OsToastKind): void;
	dismissAll(): void;
	setActivationHandlers(handlers: {
		onClick: (kind: OsToastKind) => void;
		onSnooze: (kind: OsToastKind) => void;
		onSnoozeWithToken?: () => void;
	}): void;
}

/** Default when tests / callers omit the port — native is treated as unsupported (overlay fallback). */
export const NO_OP_OS_NOTIFICATIONS: OsNotificationPort = {
	isSupported: () => false,
	show: () => ({ shown: false }),
	showSessionRecap: () => ({ shown: false }),
	dismiss: () => {},
	dismissAll: () => {},
	setActivationHandlers: () => {},
};
