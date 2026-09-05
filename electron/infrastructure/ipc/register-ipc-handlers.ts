import { ipcMain, shell, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { sanitizeClassifierCalibrationPayload } from "../../../shared/classifier-calibration";
import { isValidEarCalibration } from "../../../shared/ear-calibration";
import { isCameraQuality } from "../../../shared/camera-quality";
import {
	emptyCameraDevicesPayload,
	sameCameraDevice,
	sanitizeCameraDevice,
} from "../../../shared/camera-devices";
import { isBlinkRewardId } from "../../../shared/blink-rewards";
import { isCheerThemeId } from "../../../shared/cheer-themes";
import { isDebugOverlayKind, isDebugSoundKind } from "../../../shared/debug-preview";
import { IPC_CHANNELS, sanitizeSnoozeAllOptions, type SanitizedSnoozeAllOptions } from "../../../shared/ipc-channels";
import { POPUP_PRESETS, isPopupPresetId } from "../../../shared/popup-presets";
import { sanitizeNotificationStyle } from "../../../shared/notification-style";
import type { PauseAppRule, Point, PopupColors, Size } from "../../../shared/preferences";
import {
	sameKeyboardShortcuts,
	findDuplicateShortcutActions,
	sanitizeBlinkPromptProfile,
	sanitizeGoalsConfig,
	sanitizeKeyboardShortcuts,
	sanitizeMicroBreakIntervalMs,
	sanitizePauseAppPickerPayload,
	sanitizeQuietHoursByWeekday,
	sanitizeSessionRecapEnabled,
	emptyPauseAppPicker,
} from "../../../shared/preferences";
import type { ReminderService } from "../../application/reminder-service";
import type { BlinkStatsService } from "../../application/blink-stats-service";
import type { CalibrationNudgeService } from "../../application/calibration-nudge-service";
import type { ExerciseService } from "../../application/exercise-service";
import type { FocusPauseService } from "../../application/focus-pause-service";
import type { FocusEnvironmentPort } from "../../application/ports/focus-environment-port";
import type { LookAwayService } from "../../application/look-away-service";
import type { PreferenceActions } from "../../application/preference-actions";
import type { PreferencesService } from "../../application/preferences-service";
import type { SettingsProfilesService } from "../../application/settings-profiles-service";
import {
	startTrackingSession,
	stopTrackingSession,
} from "../../application/tracking-session";
import type { NotificationSoundPort } from "../../application/ports/runtime-ports";
import { normalizeQuietHoursTime } from "../../domain/focus-policy";
import { isBackupScope } from "../../../shared/backup";
import {
	exportBackupBundle,
	importBackupBundle,
} from "../backup/backup-io";
import { exportDiagnosticsBundle } from "../logging/diagnostics-export";
import { exportProfileImageFile } from "../profile/export-profile-image";
import type { InteractionLogger } from "../logging/interaction-logger";
import { applyLaunchAtLogin } from "../lifecycle/login-item";
import { fetchGithubReleases } from "../github/fetch-github-releases";
import type { BlinkDetectorSidecar } from "../sidecar/blink-detector-sidecar";
import {
	startTraceRecordingDialog,
	stopTraceRecordingSession,
} from "../sidecar/trace-recording";
import type { ShortcutController } from "../shortcuts/shortcut-controller";
import type { WindowManager } from "../windows/window-manager";
import {
	GITHUB_REPO_PAGE_URL,
	GITHUB_RELEASES_PAGE_URL,
	isAllowedExternalUrl,
} from "../../../shared/release-notes";
import {
	GITHUB_NEW_ISSUE_BUG_URL,
	isAllowedSupportUrl,
} from "../../../shared/support";

interface IpcDependencies {
	preferences: PreferencesService;
	preferenceActions: PreferenceActions;
	reminders: ReminderService;
	exercises: ExerciseService;
	lookAway: LookAwayService;
	sidecar: BlinkDetectorSidecar;
	shortcuts: ShortcutController;
	windows: WindowManager;
	blinkStats: BlinkStatsService;
	focusPause: FocusPauseService;
	focusEnvironment: FocusEnvironmentPort;
	sound: NotificationSoundPort;
	calibrationNudge: CalibrationNudgeService;
	checkForUpdates: () => void;
	installUpdate: () => void;
	interactions: InteractionLogger;
	/** Cold-start gate: settings shell hydrated + boot splash dismissed. */
	onShellReady?: () => void;
	/** Forced capture-status snapshot for late Settings subscribers. */
	pushCameraCaptureStatus?: () => void;
	/** Tray label refresh when snooze duration changes (no prefs echo). */
	onSnoozeMinutesChanged?: () => void;
	/** Tray accelerator refresh after Settings remaps global shortcuts. */
	onKeyboardShortcutsChanged?: () => void;
	/** Tray pause-app row refresh when blocklist changes from Settings. */
	onPauseAppRulesChanged?: () => void;
	hushAllPrompts: (options: SanitizedSnoozeAllOptions) => void;
	endPromptHush: () => void;
	settingsProfiles: SettingsProfilesService;
}

export function registerIpcHandlers(deps: IpcDependencies): void {
	const {
		preferences,
		preferenceActions,
		reminders,
		exercises,
		lookAway,
		sidecar,
		shortcuts,
		windows,
		blinkStats,
		focusPause,
		focusEnvironment,
		sound,
		calibrationNudge,
		checkForUpdates,
		installUpdate,
		interactions,
		onShellReady,
		pushCameraCaptureStatus,
		onSnoozeMinutesChanged,
		onKeyboardShortcutsChanged,
		onPauseAppRulesChanged,
		hushAllPrompts,
		endPromptHush,
		settingsProfiles,
	} = deps;
	const current = preferences.current;

	const on = (
		channel: string,
		listener: (event: IpcMainEvent, ...args: unknown[]) => void,
	): void => {
		ipcMain.on(channel, (event, ...args: unknown[]) => {
			interactions.logIpc(channel, args);
			listener(event, ...args);
		});
	};

	on(IPC_CHANNELS.startBlinkReminders, (_event, interval: unknown) => {
		startTrackingSession(
			{ reminders, exercises, lookAway, preferences: current },
			interval as number,
		);
	});
	on(IPC_CHANNELS.stopBlinkReminders, () =>
		stopTrackingSession(
			{ reminders, exercises, lookAway, preferences: current },
			true,
		),
	);
	on(IPC_CHANNELS.shellReady, () => {
		onShellReady?.();
	});
	on(IPC_CHANNELS.requestCameraCaptureStatus, () => {
		pushCameraCaptureStatus?.();
	});
	on(IPC_CHANNELS.updateInterval, (_event, interval: unknown) => {
		preferences.set("reminderInterval", interval as number);
		reminders.applyReminderInterval();
	});
	on(IPC_CHANNELS.updateMicroBreakInterval, (_event, interval: unknown) => {
		preferences.set(
			"microBreakInterval",
			sanitizeMicroBreakIntervalMs(interval),
		);
		reminders.applyReminderInterval();
	});
	on(IPC_CHANNELS.updateBlinkPromptProfile, (_event, profile: unknown) => {
		preferences.set(
			"blinkPromptProfile",
			sanitizeBlinkPromptProfile(profile),
		);
	});
	on(IPC_CHANNELS.updatePopupColors, (_event, colors: unknown) => {
		preferences.set("popupColors", colors as PopupColors);
		preferences.set("popupGlowPreset", null);
		windows.applyPopupAppearance();
	});
	on(IPC_CHANNELS.updatePopupTransparency, (_event, transparency: unknown) => {
		current.popupColors.transparency = transparency as number;
		preferences.set("popupColors", current.popupColors);
		windows.applyPopupAppearance();
	});
	on(IPC_CHANNELS.updatePopupMessage, (_event, message: unknown) => {
		preferences.set("popupMessage", message as string);
	});
	on(IPC_CHANNELS.updateBlinkPopupClickThrough, (_event, enabled: unknown) => {
		preferences.set("blinkPopupClickThrough", Boolean(enabled));
	});
	on(IPC_CHANNELS.updateDarkMode, (_event, enabled: unknown) => {
		preferences.set("darkMode", enabled as boolean);
	});
	on(IPC_CHANNELS.updateCameraEnabled, (_event, enabled: unknown) => {
		const wasEnabled = current.cameraEnabled;
		preferences.set("cameraEnabled", enabled as boolean);
		if (windows.reminder && !windows.reminder.isDestroyed()) {
			windows.reminder.webContents.send(
				IPC_CHANNELS.cameraMode,
				enabled as boolean,
			);
		}
		if (wasEnabled !== enabled && current.isTracking) {
			reminders.resyncLoopsForCameraModeChange();
		}
		blinkStats.refreshTrayGlance();
		if (blinkStats.isLivePushEnabled()) {
			windows.sendToMain(IPC_CHANNELS.loadBlinkStats, blinkStats.getSnapshot());
		}
	});
	on(IPC_CHANNELS.updateCameraQuality, (_event, quality: unknown) => {
		if (!isCameraQuality(quality)) return;
		preferences.set("cameraQuality", quality);
		sidecar.applyCameraQuality(quality);
	});
	on(IPC_CHANNELS.updateCameraDevice, (_event, raw: unknown) => {
		const next = sanitizeCameraDevice(raw);
		if (sameCameraDevice(preferences.current.cameraDevice, next)) return;
		preferences.set("cameraDevice", next);
		sidecar.applyCameraDevice(next);
		if (sidecar.isCameraReady) {
			sidecar.restartCamera();
		}
	});
	on(IPC_CHANNELS.updateAutoStopNoFaceEnabled, (_event, enabled: unknown) => {
		preferences.set("autoStopNoFaceEnabled", enabled as boolean);
	});
	on(IPC_CHANNELS.updateAutoStopNoFaceMinutes, (_event, minutes: unknown) => {
		preferences.set("autoStopNoFaceMinutes", minutes as number);
	});
	on(IPC_CHANNELS.updateSnoozeMinutes, (_event, minutes: unknown) => {
		const before = preferences.current.snoozeMinutes;
		preferences.set("snoozeMinutes", minutes as number);
		if (preferences.current.snoozeMinutes !== before) {
			onSnoozeMinutesChanged?.();
		}
	});
	on(IPC_CHANNELS.updateEarCalibration, (_event, baseline: unknown) => {
		if (baseline === null) {
			preferences.set("earCalibration", null);
			preferences.set("calibrationAt", null);
			sidecar.applyEarCalibration(null);
			calibrationNudge.onCalibrationUpdated();
			return;
		}
		if (!isValidEarCalibration(baseline)) return;
		preferences.set("earCalibration", baseline);
		sidecar.applyEarCalibration(baseline);
		blinkStats.reconcileAchievements({ celebrate: "live" });
	});
	on(IPC_CHANNELS.updateClassifierCalibration, (_event, payload: unknown) => {
		const parsed = sanitizeClassifierCalibrationPayload(payload);
		if (!parsed) return;
		const current = preferences.current;
		if (
			current.classifierBias === parsed.bias &&
			current.classifierThreshold === parsed.threshold
		) {
			return;
		}
		preferences.set("classifierBias", parsed.bias);
		preferences.set("classifierThreshold", parsed.threshold);
		sidecar.applyClassifierCalibration(parsed);
	});
	on(IPC_CHANNELS.startEarCalibration, () => {
		preferenceActions.startEarCalibration();
	});
	on(IPC_CHANNELS.cancelEarCalibration, () => {
		sidecar.cancelEarCalibration();
	});
	on(IPC_CHANNELS.updateEyeExercisesEnabled, (_event, enabled: unknown) => {
		preferences.set("eyeExercisesEnabled", enabled as boolean);
		if (!enabled) {
			exercises.stop();
			return;
		}
		if (
			current.eyeCareIndependentOfTracking ||
			current.isTracking
		) {
			exercises.start();
		}
	});
	on(IPC_CHANNELS.updateExerciseInterval, (_event, interval: unknown) => {
		preferences.set("exerciseInterval", interval as number);
		if (
			current.eyeExercisesEnabled &&
			(current.eyeCareIndependentOfTracking || current.isTracking)
		) {
			exercises.stop();
			exercises.start();
		}
	});
	on(IPC_CHANNELS.updateExercisePrompts, (_event, prompts: unknown) => {
		preferences.set("exercisePrompts", prompts as string[]);
	});
	on(
		IPC_CHANNELS.updateEyeCareIndependentOfTracking,
		(_event, enabled: unknown) => {
			const independent = Boolean(enabled);
			preferences.set("eyeCareIndependentOfTracking", independent);
			if (independent) {
				if (current.eyeExercisesEnabled) exercises.start();
				if (current.lookAwayEnabled) lookAway.start();
				return;
			}
			if (!current.isTracking) {
				exercises.stop();
				lookAway.stop();
			}
		},
	);
	on(IPC_CHANNELS.updateLookAwayEnabled, (_event, enabled: unknown) => {
		preferences.set("lookAwayEnabled", enabled as boolean);
		if (!enabled) {
			lookAway.stop();
			return;
		}
		if (
			current.eyeCareIndependentOfTracking ||
			current.isTracking
		) {
			lookAway.start();
		}
	});
	on(IPC_CHANNELS.updateLookAwayInterval, (_event, interval: unknown) => {
		preferences.set("lookAwayInterval", interval as number);
		if (
			current.lookAwayEnabled &&
			(current.eyeCareIndependentOfTracking || current.isTracking)
		) {
			lookAway.stop();
			lookAway.start();
		}
	});
	on(IPC_CHANNELS.updateLookAwayDuration, (_event, duration: unknown) => {
		preferences.set("lookAwayDuration", duration as number);
	});
	on(IPC_CHANNELS.updateLookAwayTitle, (_event, title: unknown) => {
		preferences.set("lookAwayTitle", title as string);
	});
	on(IPC_CHANNELS.updateLookAwayHint, (_event, hint: unknown) => {
		preferences.set("lookAwayHint", hint as string);
	});
	on(IPC_CHANNELS.updateKeyboardShortcuts, (_event, raw: unknown) => {
		const next = sanitizeKeyboardShortcuts(raw);
		const before = preferences.current.keyboardShortcuts;
		if (sameKeyboardShortcuts(before, next)) return;
		const conflicts = findDuplicateShortcutActions(next);
		if (conflicts.length > 0) {
			const errors: Record<string, string> = {};
			for (const action of conflicts) {
				errors[action] = next[action];
			}
			windows.sendToMain(IPC_CHANNELS.shortcutError, { errors, conflicts });
			return;
		}
		preferences.set("keyboardShortcuts", next);
		shortcuts.registerAll(preferences.current.keyboardShortcuts);
		onKeyboardShortcutsChanged?.();
	});
	on(IPC_CHANNELS.setShortcutCaptureMode, (_event, capturing: unknown) => {
		shortcuts.setCaptureMode(Boolean(capturing));
	});
	on(IPC_CHANNELS.startCameraTracking, () => {
		const wasEnabled = current.cameraEnabled;
		preferences.set("cameraEnabled", true);
		if (windows.reminder && !windows.reminder.isDestroyed()) {
			windows.reminder.webContents.send(IPC_CHANNELS.cameraMode, true);
		}
		if (!wasEnabled && current.isTracking) {
			reminders.resyncLoopsForCameraModeChange();
		}
	});
	on(IPC_CHANNELS.stopCameraTracking, () => {
		const wasEnabled = current.cameraEnabled;
		preferences.set("cameraEnabled", false);
		if (windows.reminder && !windows.reminder.isDestroyed()) {
			windows.reminder.webContents.send(IPC_CHANNELS.cameraMode, false);
		}
		if (wasEnabled && current.isTracking) {
			reminders.resyncLoopsForCameraModeChange();
		}
	});
	on(IPC_CHANNELS.skipExercise, () => exercises.skip());
	on(IPC_CHANNELS.snoozeExercise, () => exercises.snooze());
	on(IPC_CHANNELS.skipLookAway, () => lookAway.skip());
	on(IPC_CHANNELS.snoozeLookAway, () => lookAway.snooze());
	on(IPC_CHANNELS.snoozeBlink, () => reminders.snooze());
	on(IPC_CHANNELS.snoozeAll, (_event, raw) =>
		hushAllPrompts(sanitizeSnoozeAllOptions(raw)),
	);
	on(IPC_CHANNELS.endPromptHush, () => endPromptHush());
	on(IPC_CHANNELS.updateMgdMode, (_event, enabled: unknown) => {
		preferences.set("mgdMode", enabled as boolean);
		reminders.syncCameraLoopForMgdMode();
	});
	on(IPC_CHANNELS.updateSoundEnabled, (_event, enabled: unknown) => {
		preferences.set("soundEnabled", enabled as boolean);
	});
	on(IPC_CHANNELS.updateSoundVolume, (_event, volume: unknown) => {
		preferences.set("soundVolume", volume as number);
	});
	on(IPC_CHANNELS.updateNotificationStyle, (_event, style: unknown) => {
		preferences.set("notificationStyle", sanitizeNotificationStyle(style));
	});
	on(IPC_CHANNELS.updateSessionRecapEnabled, (_event, enabled: unknown) => {
		if (typeof enabled !== "boolean") return;
		preferences.set("sessionRecapEnabled", sanitizeSessionRecapEnabled(enabled));
	});
	on(IPC_CHANNELS.updateLaunchAtLogin, (_event, enabled: unknown) => {
		preferences.set("launchAtLogin", enabled as boolean);
		applyLaunchAtLogin(enabled as boolean);
	});
	on(IPC_CHANNELS.updateHasCompletedOnboarding, (_event, completed: unknown) => {
		preferences.set("hasCompletedOnboarding", Boolean(completed));
		if (completed) {
			blinkStats.reconcileAchievements({ celebrate: "live" });
		}
	});
	on(IPC_CHANNELS.updateQuietHoursEnabled, (_event, enabled: unknown) => {
		preferences.set("quietHoursEnabled", Boolean(enabled));
		focusPause.recompute();
	});
	on(IPC_CHANNELS.updateQuietHoursStart, (_event, value: unknown) => {
		const normalized = normalizeQuietHoursTime(value as string);
		if (!normalized) return;
		preferences.set("quietHoursStart", normalized);
		focusPause.recompute();
	});
	on(IPC_CHANNELS.updateQuietHoursEnd, (_event, value: unknown) => {
		const normalized = normalizeQuietHoursTime(value as string);
		if (!normalized) return;
		preferences.set("quietHoursEnd", normalized);
		focusPause.recompute();
	});
	on(IPC_CHANNELS.updateQuietHoursByWeekday, (_event, map: unknown) => {
		preferences.set(
			"quietHoursByWeekday",
			sanitizeQuietHoursByWeekday(map),
		);
		focusPause.recompute();
	});
	on(IPC_CHANNELS.updatePauseOnFullscreen, (_event, enabled: unknown) => {
		preferences.set("pauseOnFullscreen", Boolean(enabled));
		focusPause.recompute();
	});
	on(IPC_CHANNELS.updatePauseAppRules, (_event, rules: unknown) => {
		preferences.set("pauseAppRules", rules as PauseAppRule[]);
		focusPause.recompute();
		onPauseAppRulesChanged?.();
	});
	on(
		IPC_CHANNELS.updateBlinkRateCoachingEnabled,
		(_event, enabled: unknown) => {
			preferences.set("blinkRateCoachingEnabled", Boolean(enabled));
		},
	);
	on(
		IPC_CHANNELS.updateCalibrationNudgeEnabled,
		(_event, enabled: unknown) => {
			preferences.set("calibrationNudgeEnabled", Boolean(enabled));
		},
	);
	on(IPC_CHANNELS.dismissCalibrationNudge, () => {
		calibrationNudge.dismiss();
	});
	on(IPC_CHANNELS.updateBlinkRateThreshold, (_event, threshold: unknown) => {
		preferences.set("blinkRateThresholdPerMin", threshold as number);
	});
	on(IPC_CHANNELS.updateLocale, (_event, value: unknown) => {
		preferenceActions.updateLocale(value as string);
	});
	on(IPC_CHANNELS.showCameraWindow, () => {
		preferenceActions.showCameraWindow();
	});
	on(IPC_CHANNELS.closeCameraWindow, () => windows.closeCamera());
	on(IPC_CHANNELS.requestVideoStream, () => sidecar.requestVideo());
	on(IPC_CHANNELS.showPopupEditor, () => windows.showEditor());
	on(IPC_CHANNELS.debugPreviewOverlay, (_event, kind: unknown) => {
		if (!isDebugOverlayKind(kind)) return;
		windows.previewDebugOverlay(kind);
	});
	on(IPC_CHANNELS.debugCleanPreview, () => {
		reminders.dismissVisibleBlink();
		windows.hideNoFace();
		windows.closeExercise();
		windows.closeLookAway();
		windows.hideCheerToast();
		windows.hideSessionRecap();
		sound.stop();
	});
	on(IPC_CHANNELS.debugPreviewSound, (_event, kind: unknown, volume?: unknown) => {
		if (!isDebugSoundKind(kind)) return;
		const options: { force: true; volume?: number; cheerTheme?: string } = {
			force: true,
		};
		if (typeof volume === "number") {
			options.volume = volume;
		}
		if (kind === "cheer") {
			options.cheerTheme = "__cycle__";
		}
		sound.play(kind, options);
	});
	on(IPC_CHANNELS.debugPreviewCheer, () => {
		blinkStats.previewCheer();
	});
	on(IPC_CHANNELS.debugPreviewLevelUp, (_event, level: unknown) => {
		const resolved =
			typeof level === "number" && Number.isFinite(level) ? level : undefined;
		blinkStats.previewLevelUp(resolved);
	});
	on(IPC_CHANNELS.debugPreviewAchievement, (_event, id: unknown) => {
		blinkStats.previewAchievement(id);
	});
	on(IPC_CHANNELS.debugPreviewAchievementSummary, (_event, count: unknown) => {
		blinkStats.previewAchievementSummary(count);
	});
	on(
		IPC_CHANNELS.debugSetProfileLevel,
		(_event, level: unknown, celebrate: unknown) => {
			if (typeof level !== "number" || !Number.isFinite(level)) return;
			blinkStats.setDebugProfileLevel(level, celebrate === true);
			windows.sendToMain(IPC_CHANNELS.loadBlinkStats, blinkStats.getSnapshot());
		},
	);
	on(
		IPC_CHANNELS.debugSetShopReward,
		(_event, rewardId: unknown, enabled: unknown) => {
			if (rewardId !== "statsFlair" && rewardId !== "streakShield") return;
			blinkStats.setDebugRewardGrant(rewardId, enabled === true);
			windows.sendToMain(IPC_CHANNELS.loadBlinkStats, blinkStats.getSnapshot());
		},
	);
	on(IPC_CHANNELS.debugSetShopDiscountLevel, (_event, level: unknown) => {
		if (typeof level !== "number" || !Number.isFinite(level)) return;
		blinkStats.setDebugShopDiscountLevel(level);
		windows.sendToMain(IPC_CHANNELS.loadBlinkStats, blinkStats.getSnapshot());
	});
	on(IPC_CHANNELS.openGithubRepo, () => {
		void shell.openExternal(GITHUB_REPO_PAGE_URL);
	});
	on(IPC_CHANNELS.openGithubReleases, () => {
		void shell.openExternal(GITHUB_RELEASES_PAGE_URL);
	});
	on(IPC_CHANNELS.openGithubReportIssue, () => {
		if (!isAllowedSupportUrl(GITHUB_NEW_ISSUE_BUG_URL)) {
			console.warn("Blocked unsupported GitHub report issue URL");
			return;
		}
		void shell.openExternal(GITHUB_NEW_ISSUE_BUG_URL);
	});
	on(IPC_CHANNELS.openExternalUrl, (_event, urlRaw: unknown) => {
		if (typeof urlRaw !== "string" || !isAllowedExternalUrl(urlRaw)) return;
		void shell.openExternal(urlRaw);
	});
	on(IPC_CHANNELS.checkForUpdates, () => {
		checkForUpdates();
	});
	on(IPC_CHANNELS.installUpdate, () => {
		installUpdate();
	});
	on(IPC_CHANNELS.popupEditorSaved, (_event, value: unknown) => {
		if (!value || typeof value !== "object") return;
		const payload = value as {
			size?: Size;
			position?: Point;
			scope?: unknown;
		};
		if (payload.scope === "next") {
			windows.moveEditorToNextUnsaved();
			return;
		}
		if (!payload.size || !payload.position) return;
		if (payload.scope === "all") {
			windows.saveEditorGeometryAll(payload.size, payload.position);
			windows.sendPreferences();
			windows.closeEditor();
			return;
		}
		const displayId = windows.saveEditorGeometry(
			payload.size,
			payload.position,
		);
		windows.sendPreferences();
		if (windows.hasNextUnsavedDisplay(displayId)) {
			windows.sendEditorSetupNextState(true);
			return;
		}
		windows.closeEditor();
	});
	on(IPC_CHANNELS.resetPreferences, (_event, replayOnboarding?: unknown) => {
		preferenceActions.resetPreferences(replayOnboarding as boolean | undefined);
	});
	on(IPC_CHANNELS.requestBlinkStats, () => {
		windows.sendToMain(IPC_CHANNELS.loadBlinkStats, blinkStats.getSnapshot());
	});
	on(IPC_CHANNELS.subscribeBlinkStats, () => {
		blinkStats.setLivePushEnabled(true);
	});
	on(IPC_CHANNELS.unsubscribeBlinkStats, () => {
		blinkStats.setLivePushEnabled(false);
	});
	on(IPC_CHANNELS.resetBlinkStats, () => {
		blinkStats.reset();
		windows.sendToMain(IPC_CHANNELS.loadBlinkStats, blinkStats.getSnapshot());
	});
	on(IPC_CHANNELS.spendBlinkReward, (_event, rewardId: unknown) => {
		if (!isBlinkRewardId(rewardId)) return;
		blinkStats.purchaseReward(rewardId);
		windows.sendToMain(IPC_CHANNELS.loadBlinkStats, blinkStats.getSnapshot());
	});
	on(IPC_CHANNELS.equipCheerTheme, (_event, theme: unknown) => {
		if (theme === "random") {
			blinkStats.equipCheerTheme("random");
		} else if (isCheerThemeId(theme)) {
			blinkStats.equipCheerTheme(theme);
		} else {
			return;
		}
		windows.sendToMain(IPC_CHANNELS.loadBlinkStats, blinkStats.getSnapshot());
	});
	on(IPC_CHANNELS.equipPopupPreset, (_event, presetId: unknown) => {
		if (presetId === "custom") {
			blinkStats.clearEquippedPopupPreset();
			preferences.set("popupGlowPreset", null);
			windows.applyPopupAppearance();
			windows.sendToMain(IPC_CHANNELS.loadBlinkStats, blinkStats.getSnapshot());
			return;
		}
		if (!isPopupPresetId(presetId)) return;
		const equipped = blinkStats.equipPopupPreset(presetId);
		if (!equipped) return;
		const preset = POPUP_PRESETS[equipped];
		preferences.set("popupColors", { ...preset.colors });
		preferences.set("popupGlowPreset", equipped);
		windows.applyPopupAppearance();
		windows.sendPreferences();
		windows.sendToMain(IPC_CHANNELS.loadBlinkStats, blinkStats.getSnapshot());
	});
	on(IPC_CHANNELS.updateGoalsConfig, (_event, raw: unknown) => {
		const goals = sanitizeGoalsConfig(raw);
		preferences.set("goalsEnabled", goals.goalsEnabled);
		preferences.set("dailyBlinkGoal", goals.dailyBlinkGoal);
		preferences.set("dailyTrackingMinutesGoal", goals.dailyTrackingMinutesGoal);
		preferences.set("weeklyBlinkGoal", goals.weeklyBlinkGoal);
		preferences.set(
			"weeklyTrackingMinutesGoal",
			goals.weeklyTrackingMinutesGoal,
		);
		if (blinkStats.isLivePushEnabled()) {
			windows.sendToMain(IPC_CHANNELS.loadBlinkStats, blinkStats.getSnapshot());
		}
		blinkStats.refreshTrayGlance();
	});

	ipcMain.handle(
		IPC_CHANNELS.getReleaseNotes,
		async (_event: IpcMainInvokeEvent) => {
			interactions.logIpc(IPC_CHANNELS.getReleaseNotes, []);
			return fetchGithubReleases();
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.exportDiagnostics,
		async (_event: IpcMainInvokeEvent) => {
			interactions.logIpc(IPC_CHANNELS.exportDiagnostics, []);
			return exportDiagnosticsBundle({
				preferences: current,
				settingsProfilesCount:
					settingsProfiles.getPersistedState().profiles.length,
				parentWindow: windows.main && !windows.main.isDestroyed()
					? windows.main
					: null,
			});
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.exportProfileImage,
		async (_event: IpcMainInvokeEvent, pngRaw: unknown) => {
			interactions.logIpc(IPC_CHANNELS.exportProfileImage, []);
			let bytes: Uint8Array | null = null;
			if (pngRaw instanceof Uint8Array) {
				bytes = pngRaw;
			} else if (Buffer.isBuffer(pngRaw)) {
				bytes = new Uint8Array(pngRaw);
			} else if (
				pngRaw &&
				typeof pngRaw === "object" &&
				"type" in pngRaw &&
				(pngRaw as { type?: string }).type === "Buffer" &&
				"data" in pngRaw &&
				Array.isArray((pngRaw as { data?: unknown }).data)
			) {
				bytes = Uint8Array.from((pngRaw as { data: number[] }).data);
			}
			if (!bytes || bytes.byteLength === 0) {
				return { status: "error", message: "Missing profile image bytes" };
			}
			return exportProfileImageFile({
				pngBytes: bytes,
				parentWindow: windows.main && !windows.main.isDestroyed()
					? windows.main
					: null,
			});
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.exportBackup,
		async (_event: IpcMainInvokeEvent, scopeRaw: unknown) => {
			interactions.logIpc(IPC_CHANNELS.exportBackup, [scopeRaw]);
			const scope = isBackupScope(scopeRaw) ? scopeRaw : null;
			if (!scope) {
				return { status: "error", message: "Invalid backup scope" };
			}
			return exportBackupBundle({
				scope,
				preferences: preferences.current,
				blinkStats: blinkStats.getPersistedState(),
				settingsProfiles: settingsProfiles.getPersistedState(),
				parentWindow: windows.main && !windows.main.isDestroyed()
					? windows.main
					: null,
			});
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.importBackup,
		async (_event: IpcMainInvokeEvent, scopeRaw: unknown, optionsRaw?: unknown) => {
			interactions.logIpc(IPC_CHANNELS.importBackup, [scopeRaw, optionsRaw]);
			const scope = isBackupScope(scopeRaw) ? scopeRaw : null;
			if (!scope) {
				return { status: "error", message: "Invalid backup scope" };
			}
			const options =
				optionsRaw && typeof optionsRaw === "object"
					? (optionsRaw as Record<string, unknown>)
					: {};
			const profilesOverwriteConfirmed =
				options.profilesOverwriteConfirmed === true;
			const filePath =
				typeof options.filePath === "string" && options.filePath.trim()
					? options.filePath.trim()
					: undefined;
			return importBackupBundle({
				scope,
				filePath,
				profilesOverwriteConfirmed,
				getLocalProfiles: () => settingsProfiles.getPersistedState(),
				parentWindow: windows.main && !windows.main.isDestroyed()
					? windows.main
					: null,
				apply: (parsed) => {
					preferenceActions.applyBackup(scope, parsed);
				},
			});
		},
	);

	ipcMain.handle(IPC_CHANNELS.listSettingsProfiles, async () => {
		interactions.logIpc(IPC_CHANNELS.listSettingsProfiles, []);
		return settingsProfiles.list();
	});

	ipcMain.handle(
		IPC_CHANNELS.saveSettingsProfile,
		async (_event: IpcMainInvokeEvent, raw: unknown) => {
			interactions.logIpc(IPC_CHANNELS.saveSettingsProfile, [raw]);
			return settingsProfiles.save(raw);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.renameSettingsProfile,
		async (_event: IpcMainInvokeEvent, raw: unknown) => {
			interactions.logIpc(IPC_CHANNELS.renameSettingsProfile, [raw]);
			return settingsProfiles.rename(raw);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.deleteSettingsProfile,
		async (_event: IpcMainInvokeEvent, raw: unknown) => {
			interactions.logIpc(IPC_CHANNELS.deleteSettingsProfile, [raw]);
			return settingsProfiles.delete(raw);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.switchSettingsProfile,
		async (_event: IpcMainInvokeEvent, raw: unknown) => {
			interactions.logIpc(IPC_CHANNELS.switchSettingsProfile, [raw]);
			return settingsProfiles.switch(raw);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.startTraceRecording,
		async (_event: IpcMainInvokeEvent) => {
			interactions.logIpc(IPC_CHANNELS.startTraceRecording, []);
			return startTraceRecordingDialog({
				sidecar,
				parentWindow: windows.main && !windows.main.isDestroyed()
					? windows.main
					: null,
			});
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.stopTraceRecording,
		async (_event: IpcMainInvokeEvent) => {
			interactions.logIpc(IPC_CHANNELS.stopTraceRecording, []);
			return stopTraceRecordingSession(sidecar);
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.listPauseAppCandidates,
		async (_event: IpcMainInvokeEvent) => {
			interactions.logIpc(IPC_CHANNELS.listPauseAppCandidates, []);
			try {
				const running = await focusEnvironment.listRunningApps();
				return sanitizePauseAppPickerPayload({
					lastFocused: focusPause.lastExternalForeground(),
					running,
				});
			} catch {
				return emptyPauseAppPicker();
			}
		},
	);

	ipcMain.handle(
		IPC_CHANNELS.listCameraDevices,
		async (_event: IpcMainInvokeEvent) => {
			interactions.logIpc(IPC_CHANNELS.listCameraDevices, []);
			try {
				return await sidecar.listDevices();
			} catch {
				return { ...emptyCameraDevicesPayload(), unavailable: true };
			}
		},
	);
}
