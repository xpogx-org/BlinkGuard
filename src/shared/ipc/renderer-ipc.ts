import type { AutoUpdateStatus } from "../../../shared/auto-update";
import type {
	BackupScope,
	ExportBackupResult,
	ImportBackupResult,
} from "../../../shared/backup";
import type { BlinkStatsSnapshot } from "../../../shared/blink-stats";
import {
	type CalibrationNudgePayload,
	sanitizeCalibrationNudgePayload,
} from "../../../shared/calibration-freshness";
import {
	type CameraCaptureStatusPayload,
	sanitizeCameraCaptureStatusPayload,
} from "../../../shared/camera-capture-status";
import {
	type CameraDeviceNotice,
	type CameraDevicePref,
	type CameraDevicesPayload,
	emptyCameraDevicesPayload,
	sanitizeCameraDeviceNotice,
	sanitizeCameraDevicesPayload,
} from "../../../shared/camera-devices";
import type {
	DebugOverlayKind,
	DebugSoundKind,
} from "../../../shared/debug-preview";
import type { ExportDiagnosticsResult } from "../../../shared/diagnostics";
import { IPC_CHANNELS } from "../../../shared/ipc-channels";
import type { NotificationStyle } from "../../../shared/notification-style";
import {
	type BlinkPromptProfile,
	type CameraQuality,
	emptyPauseAppPicker,
	type KeyboardShortcuts,
	type PauseAppPickerPayload,
	type PauseAppRule,
	type PopupColors,
	type QuietHoursByWeekday,
	type RendererPreferences,
	type ShortcutErrorPayload,
	sanitizePauseAppPickerPayload,
} from "../../../shared/preferences";
import type { ExportProfileImageResult } from "../../../shared/profile-export";
import type { GetReleaseNotesResult } from "../../../shared/release-notes";
import {
	type FocusPauseStatePayload,
	sanitizeFocusPauseStatePayload,
} from "../../../shared/session-pause-status";
import type { SettingsProfilesResult } from "../../../shared/settings-profiles";
import type { TraceRecordingResult } from "../../../shared/trace-recording";

type Listener = (...args: unknown[]) => void;

interface RendererBridge {
	on(channel: string, listener: Listener): void;
	off(channel: string, listener: Listener): void;
	send(channel: string, ...args: unknown[]): void;
	invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}

const bridge = (): RendererBridge | undefined =>
	window.ipcRenderer as unknown as RendererBridge | undefined;

const send = (channel: string, ...args: unknown[]) => {
	bridge()?.send(channel, ...args);
};

const subscribe = <T>(
	channel: string,
	listener: (payload: T) => void,
): (() => void) => {
	const wrapped: Listener = (payload) => listener(payload as T);
	bridge()?.on(channel, wrapped);
	return () => bridge()?.off(channel, wrapped);
};

export const rendererIpc = {
	onPreferences: (listener: (preferences: RendererPreferences) => void) =>
		subscribe(IPC_CHANNELS.loadPreferences, listener),
	onCameraError: (listener: (error: string) => void) =>
		subscribe(IPC_CHANNELS.cameraError, listener),
	onCameraReady: (listener: () => void) =>
		subscribe(IPC_CHANNELS.cameraReady, listener),
	onCameraCaptureStatus: (
		listener: (payload: CameraCaptureStatusPayload) => void,
	) =>
		subscribe(IPC_CHANNELS.cameraCaptureStatus, (payload) => {
			listener(sanitizeCameraCaptureStatusPayload(payload));
		}),
	requestCameraCaptureStatus: () =>
		send(IPC_CHANNELS.requestCameraCaptureStatus),
	onCameraDevices: (listener: (payload: CameraDevicesPayload) => void) =>
		subscribe(IPC_CHANNELS.cameraDevices, (payload) => {
			listener(sanitizeCameraDevicesPayload(payload));
		}),
	onCameraDeviceNotice: (listener: (notice: CameraDeviceNotice) => void) =>
		subscribe(IPC_CHANNELS.cameraDeviceNotice, (payload) => {
			const notice = sanitizeCameraDeviceNotice(payload);
			if (notice) listener(notice);
		}),
	onShortcutError: (listener: (payload: ShortcutErrorPayload) => void) =>
		subscribe(IPC_CHANNELS.shortcutError, listener),
	onCameraWindowClosed: (listener: () => void) =>
		subscribe(IPC_CHANNELS.cameraWindowClosed, listener),

	startReminders: (intervalSeconds: number) =>
		send(IPC_CHANNELS.startBlinkReminders, intervalSeconds * 1000),
	stopReminders: () => send(IPC_CHANNELS.stopBlinkReminders),
	/** Settings shell hydrated + boot splash dismissed — main may restore tracking. */
	notifyShellReady: () => send(IPC_CHANNELS.shellReady),
	updateReminderInterval: (intervalSeconds: number) =>
		send(IPC_CHANNELS.updateInterval, intervalSeconds * 1000),
	updateMicroBreakInterval: (intervalSeconds: number) =>
		send(IPC_CHANNELS.updateMicroBreakInterval, intervalSeconds * 1000),
	updateBlinkPromptProfile: (profile: BlinkPromptProfile) =>
		send(IPC_CHANNELS.updateBlinkPromptProfile, profile),
	updateDarkMode: (enabled: boolean) =>
		send(IPC_CHANNELS.updateDarkMode, enabled),
	updateCameraEnabled: (enabled: boolean) =>
		send(IPC_CHANNELS.updateCameraEnabled, enabled),
	updateCameraQuality: (quality: CameraQuality) =>
		send(IPC_CHANNELS.updateCameraQuality, quality),
	updateCameraDevice: (device: CameraDevicePref | null) =>
		send(IPC_CHANNELS.updateCameraDevice, device),
	listCameraDevices: async (): Promise<CameraDevicesPayload> => {
		try {
			const result = await bridge()?.invoke(IPC_CHANNELS.listCameraDevices);
			return sanitizeCameraDevicesPayload(result);
		} catch {
			return emptyCameraDevicesPayload();
		}
	},
	updateAutoStopNoFaceEnabled: (enabled: boolean) =>
		send(IPC_CHANNELS.updateAutoStopNoFaceEnabled, enabled),
	updateAutoStopNoFaceMinutes: (minutes: number) =>
		send(IPC_CHANNELS.updateAutoStopNoFaceMinutes, minutes),
	updateSnoozeMinutes: (minutes: number) =>
		send(IPC_CHANNELS.updateSnoozeMinutes, minutes),
	updateEarCalibration: (baseline: number | null) =>
		send(IPC_CHANNELS.updateEarCalibration, baseline),
	updateClassifierCalibration: (payload: {
		bias: number | null;
		threshold: number | null;
	}) => send(IPC_CHANNELS.updateClassifierCalibration, payload),
	startEarCalibration: () => send(IPC_CHANNELS.startEarCalibration),
	cancelEarCalibration: () => send(IPC_CHANNELS.cancelEarCalibration),
	onEarCalibrationProgress: (
		listener: (payload: {
			elapsedMs: number;
			sampleCount: number;
			durationMs: number;
			faceDetected: boolean;
			phase?: "open_eye" | "blinks";
			blinkCount?: number;
		}) => void,
	) => subscribe(IPC_CHANNELS.earCalibrationProgress, listener),
	onEarCalibrationComplete: (
		listener: (payload: {
			baseline: number | null;
			classifierBias?: number | null;
			classifierThreshold?: number | null;
			error?: string;
		}) => void,
	) => subscribe(IPC_CHANNELS.earCalibrationComplete, listener),
	updateEyeExercisesEnabled: (enabled: boolean) =>
		send(IPC_CHANNELS.updateEyeExercisesEnabled, enabled),
	updateExerciseInterval: (minutes: number) =>
		send(IPC_CHANNELS.updateExerciseInterval, minutes),
	updateExercisePrompts: (prompts: string[]) =>
		send(IPC_CHANNELS.updateExercisePrompts, prompts),
	updateEyeCareIndependentOfTracking: (enabled: boolean) =>
		send(IPC_CHANNELS.updateEyeCareIndependentOfTracking, enabled),
	updateLookAwayEnabled: (enabled: boolean) =>
		send(IPC_CHANNELS.updateLookAwayEnabled, enabled),
	updateLookAwayInterval: (minutes: number) =>
		send(IPC_CHANNELS.updateLookAwayInterval, minutes),
	updateLookAwayDuration: (seconds: number) =>
		send(IPC_CHANNELS.updateLookAwayDuration, seconds),
	updateLookAwayTitle: (title: string) =>
		send(IPC_CHANNELS.updateLookAwayTitle, title),
	updateLookAwayHint: (hint: string) =>
		send(IPC_CHANNELS.updateLookAwayHint, hint),
	updatePopupColors: (colors: PopupColors) =>
		send(IPC_CHANNELS.updatePopupColors, colors),
	updatePopupTransparency: (transparency: number) =>
		send(IPC_CHANNELS.updatePopupTransparency, transparency),
	updatePopupMessage: (message: string) =>
		send(IPC_CHANNELS.updatePopupMessage, message),
	updateBlinkPopupClickThrough: (enabled: boolean) =>
		send(IPC_CHANNELS.updateBlinkPopupClickThrough, enabled),
	updateKeyboardShortcuts: (shortcuts: KeyboardShortcuts) =>
		send(IPC_CHANNELS.updateKeyboardShortcuts, shortcuts),
	setShortcutCaptureMode: (capturing: boolean) =>
		send(IPC_CHANNELS.setShortcutCaptureMode, capturing),
	snoozeAll: () => send(IPC_CHANNELS.snoozeAll),
	endPromptHush: () => send(IPC_CHANNELS.endPromptHush),
	updateSoundEnabled: (enabled: boolean) =>
		send(IPC_CHANNELS.updateSoundEnabled, enabled),
	updateSoundVolume: (volume: number) =>
		send(IPC_CHANNELS.updateSoundVolume, volume),
	updateNotificationStyle: (style: NotificationStyle) =>
		send(IPC_CHANNELS.updateNotificationStyle, style),
	updateSessionRecapEnabled: (enabled: boolean) =>
		send(IPC_CHANNELS.updateSessionRecapEnabled, enabled),
	updateLaunchAtLogin: (enabled: boolean) =>
		send(IPC_CHANNELS.updateLaunchAtLogin, enabled),
	updateHasCompletedOnboarding: (completed: boolean) =>
		send(IPC_CHANNELS.updateHasCompletedOnboarding, completed),
	updateQuietHoursEnabled: (enabled: boolean) =>
		send(IPC_CHANNELS.updateQuietHoursEnabled, enabled),
	updateQuietHoursStart: (value: string) =>
		send(IPC_CHANNELS.updateQuietHoursStart, value),
	updateQuietHoursEnd: (value: string) =>
		send(IPC_CHANNELS.updateQuietHoursEnd, value),
	updateQuietHoursByWeekday: (map: QuietHoursByWeekday) =>
		send(IPC_CHANNELS.updateQuietHoursByWeekday, map),
	updatePauseOnFullscreen: (enabled: boolean) =>
		send(IPC_CHANNELS.updatePauseOnFullscreen, enabled),
	updatePauseAppRules: (rules: PauseAppRule[]) =>
		send(IPC_CHANNELS.updatePauseAppRules, rules),
	listPauseAppCandidates: async (): Promise<PauseAppPickerPayload> => {
		try {
			const result = await bridge()?.invoke(
				IPC_CHANNELS.listPauseAppCandidates,
			);
			return sanitizePauseAppPickerPayload(result);
		} catch {
			return emptyPauseAppPicker();
		}
	},
	updateBlinkRateCoachingEnabled: (enabled: boolean) =>
		send(IPC_CHANNELS.updateBlinkRateCoachingEnabled, enabled),
	updateBlinkRateThreshold: (threshold: number) =>
		send(IPC_CHANNELS.updateBlinkRateThreshold, threshold),
	updateCalibrationNudgeEnabled: (enabled: boolean) =>
		send(IPC_CHANNELS.updateCalibrationNudgeEnabled, enabled),
	dismissCalibrationNudge: () => send(IPC_CHANNELS.dismissCalibrationNudge),
	onCalibrationNudge: (listener: (payload: CalibrationNudgePayload) => void) =>
		subscribe(IPC_CHANNELS.calibrationNudge, (payload) => {
			listener(sanitizeCalibrationNudgePayload(payload));
		}),
	updateLocale: (locale: string) => send(IPC_CHANNELS.updateLocale, locale),
	onFocusPauseState: (listener: (payload: FocusPauseStatePayload) => void) =>
		subscribe(IPC_CHANNELS.focusPauseState, (payload) => {
			listener(sanitizeFocusPauseStatePayload(payload));
		}),
	updateMgdMode: (enabled: boolean) =>
		send(IPC_CHANNELS.updateMgdMode, enabled),
	startCameraTracking: () => send(IPC_CHANNELS.startCameraTracking),
	stopCameraTracking: () => send(IPC_CHANNELS.stopCameraTracking),
	showCameraWindow: () => send(IPC_CHANNELS.showCameraWindow),
	closeCameraWindow: () => send(IPC_CHANNELS.closeCameraWindow),
	showPopupEditor: () => send(IPC_CHANNELS.showPopupEditor),
	resetPreferences: (replayOnboarding = false) =>
		send(IPC_CHANNELS.resetPreferences, replayOnboarding),
	onBlinkStats: (listener: (snapshot: BlinkStatsSnapshot) => void) =>
		subscribe(IPC_CHANNELS.loadBlinkStats, listener),
	requestBlinkStats: () => send(IPC_CHANNELS.requestBlinkStats),
	subscribeBlinkStats: () => send(IPC_CHANNELS.subscribeBlinkStats),
	unsubscribeBlinkStats: () => send(IPC_CHANNELS.unsubscribeBlinkStats),
	resetBlinkStats: () => send(IPC_CHANNELS.resetBlinkStats),
	spendBlinkReward: (rewardId: string) =>
		send(IPC_CHANNELS.spendBlinkReward, rewardId),
	equipCheerTheme: (theme: string) =>
		send(IPC_CHANNELS.equipCheerTheme, theme),
	equipPopupPreset: (presetId: string) =>
		send(IPC_CHANNELS.equipPopupPreset, presetId),
	updateGoalsConfig: (config: {
		goalsEnabled: boolean;
		dailyBlinkGoal: number;
		dailyTrackingMinutesGoal: number;
		weeklyBlinkGoal: number;
		weeklyTrackingMinutesGoal: number;
	}) => send(IPC_CHANNELS.updateGoalsConfig, config),
	debugPreviewOverlay: (kind: DebugOverlayKind) =>
		send(IPC_CHANNELS.debugPreviewOverlay, kind),
	debugCleanPreview: () => send(IPC_CHANNELS.debugCleanPreview),
	debugPreviewSound: (kind: DebugSoundKind, volume?: number) =>
		send(IPC_CHANNELS.debugPreviewSound, kind, volume),
	debugPreviewCheer: () => send(IPC_CHANNELS.debugPreviewCheer),
	debugPreviewLevelUp: (level?: number) =>
		send(IPC_CHANNELS.debugPreviewLevelUp, level),
	debugPreviewAchievement: (id?: string) =>
		send(IPC_CHANNELS.debugPreviewAchievement, id),
	debugPreviewAchievementSummary: (count?: number) =>
		send(IPC_CHANNELS.debugPreviewAchievementSummary, count),
	debugSetProfileLevel: (level: number, celebrate = false) =>
		send(IPC_CHANNELS.debugSetProfileLevel, level, celebrate),
	debugSetShopReward: (
		rewardId: "statsFlair" | "streakShield",
		enabled: boolean,
	) => send(IPC_CHANNELS.debugSetShopReward, rewardId, enabled),
	debugSetShopDiscountLevel: (level: number) =>
		send(IPC_CHANNELS.debugSetShopDiscountLevel, level),
	openGithubRepo: () => send(IPC_CHANNELS.openGithubRepo),
	openGithubReleases: () => send(IPC_CHANNELS.openGithubReleases),
	openGithubReportIssue: () => send(IPC_CHANNELS.openGithubReportIssue),
	openExternalUrl: (url: string) => send(IPC_CHANNELS.openExternalUrl, url),
	checkForUpdates: () => send(IPC_CHANNELS.checkForUpdates),
	installUpdate: () => send(IPC_CHANNELS.installUpdate),
	onAutoUpdateStatus: (listener: (status: AutoUpdateStatus) => void) =>
		subscribe(IPC_CHANNELS.autoUpdateStatus, listener),
	getReleaseNotes: async (): Promise<GetReleaseNotesResult> => {
		const result = await bridge()?.invoke(IPC_CHANNELS.getReleaseNotes);
		if (
			result &&
			typeof result === "object" &&
			"status" in result &&
			((result as GetReleaseNotesResult).status === "ok" ||
				(result as GetReleaseNotesResult).status === "error")
		) {
			return result as GetReleaseNotesResult;
		}
		return {
			status: "error",
			message: "Release notes are unavailable in this environment",
		};
	},
	exportDiagnostics: async (): Promise<ExportDiagnosticsResult> => {
		const result = await bridge()?.invoke(IPC_CHANNELS.exportDiagnostics);
		if (
			result &&
			typeof result === "object" &&
			"status" in result &&
			(result as ExportDiagnosticsResult).status
		) {
			return result as ExportDiagnosticsResult;
		}
		return {
			status: "error",
			message: "Diagnostics export is unavailable in this environment",
		};
	},
	exportProfileImage: async (
		pngBytes: Uint8Array,
	): Promise<ExportProfileImageResult> => {
		const result = await bridge()?.invoke(
			IPC_CHANNELS.exportProfileImage,
			pngBytes,
		);
		if (
			result &&
			typeof result === "object" &&
			"status" in result &&
			(result as ExportProfileImageResult).status
		) {
			return result as ExportProfileImageResult;
		}
		return {
			status: "error",
			message: "Profile image export is unavailable in this environment",
		};
	},
	exportBackup: async (scope: BackupScope): Promise<ExportBackupResult> => {
		const result = await bridge()?.invoke(IPC_CHANNELS.exportBackup, scope);
		if (
			result &&
			typeof result === "object" &&
			"status" in result &&
			(result as ExportBackupResult).status
		) {
			return result as ExportBackupResult;
		}
		return {
			status: "error",
			message: "Backup export is unavailable in this environment",
		};
	},
	importBackup: async (scope: BackupScope): Promise<ImportBackupResult> => {
		const result = await bridge()?.invoke(IPC_CHANNELS.importBackup, scope);
		if (
			result &&
			typeof result === "object" &&
			"status" in result &&
			(result as ImportBackupResult).status
		) {
			return result as ImportBackupResult;
		}
		return {
			status: "error",
			message: "Backup import is unavailable in this environment",
		};
	},
	listSettingsProfiles: async (): Promise<SettingsProfilesResult> => {
		const result = await bridge()?.invoke(IPC_CHANNELS.listSettingsProfiles);
		if (result && typeof result === "object" && "ok" in result) {
			return result as SettingsProfilesResult;
		}
		return { ok: false, code: "error" };
	},
	saveSettingsProfile: async (payload: {
		name: string;
		replaceId?: string;
	}): Promise<SettingsProfilesResult> => {
		const result = await bridge()?.invoke(
			IPC_CHANNELS.saveSettingsProfile,
			payload,
		);
		if (result && typeof result === "object" && "ok" in result) {
			return result as SettingsProfilesResult;
		}
		return { ok: false, code: "error" };
	},
	renameSettingsProfile: async (payload: {
		id: string;
		name: string;
	}): Promise<SettingsProfilesResult> => {
		const result = await bridge()?.invoke(
			IPC_CHANNELS.renameSettingsProfile,
			payload,
		);
		if (result && typeof result === "object" && "ok" in result) {
			return result as SettingsProfilesResult;
		}
		return { ok: false, code: "error" };
	},
	deleteSettingsProfile: async (payload: {
		id: string;
	}): Promise<SettingsProfilesResult> => {
		const result = await bridge()?.invoke(
			IPC_CHANNELS.deleteSettingsProfile,
			payload,
		);
		if (result && typeof result === "object" && "ok" in result) {
			return result as SettingsProfilesResult;
		}
		return { ok: false, code: "error" };
	},
	switchSettingsProfile: async (payload: {
		id: string;
		confirmDirty?: boolean;
	}): Promise<SettingsProfilesResult> => {
		const result = await bridge()?.invoke(
			IPC_CHANNELS.switchSettingsProfile,
			payload,
		);
		if (result && typeof result === "object" && "ok" in result) {
			return result as SettingsProfilesResult;
		}
		return { ok: false, code: "error" };
	},
	startTraceRecording: async (): Promise<TraceRecordingResult> => {
		const result = await bridge()?.invoke(IPC_CHANNELS.startTraceRecording);
		if (
			result &&
			typeof result === "object" &&
			"status" in result &&
			(result as TraceRecordingResult).status
		) {
			return result as TraceRecordingResult;
		}
		return {
			status: "error",
			message: "Trace recording is unavailable in this environment",
		};
	},
	stopTraceRecording: async (): Promise<TraceRecordingResult> => {
		const result = await bridge()?.invoke(IPC_CHANNELS.stopTraceRecording);
		if (
			result &&
			typeof result === "object" &&
			"status" in result &&
			(result as TraceRecordingResult).status
		) {
			return result as TraceRecordingResult;
		}
		return {
			status: "error",
			message: "Trace recording is unavailable in this environment",
		};
	},
};
