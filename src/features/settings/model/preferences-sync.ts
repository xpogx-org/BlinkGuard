import { rendererIpc } from "@/shared/ipc/renderer-ipc";
import { sameCameraDevice } from "../../../../shared/camera-devices";
import {
	type Point,
	type Size,
	sameKeyboardShortcuts,
	samePauseAppRules,
	samePopupPositionsByDisplayId,
	samePopupSizesByDisplayId,
	sameQuietHoursByWeekday,
} from "../../../../shared/preferences";
import type { SettingsPreferences } from "./preferences";

export function sameStringArray(a: string[], b: string[]): boolean {
	return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function samePopupColors(
	a: SettingsPreferences["popupColors"],
	b: SettingsPreferences["popupColors"],
): boolean {
	return (
		a.background === b.background &&
		a.text === b.text &&
		a.transparency === b.transparency
	);
}

export function samePoint(a: Point | null, b: Point | null): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	return a.x === b.x && a.y === b.y;
}

export function sameSize(a: Size, b: Size): boolean {
	return a.width === b.width && a.height === b.height;
}

/**
 * Compare persisted renderer fields only (ignore UI-only flags like showMgdInfo).
 * Used to block main↔renderer preference echo loops.
 */
export function sameRendererPrefs(
	a: SettingsPreferences,
	b: SettingsPreferences,
): boolean {
	return (
		a.darkMode === b.darkMode &&
		a.reminderInterval === b.reminderInterval &&
		a.microBreakInterval === b.microBreakInterval &&
		a.blinkPromptProfile === b.blinkPromptProfile &&
		a.cameraEnabled === b.cameraEnabled &&
		a.cameraQuality === b.cameraQuality &&
		sameCameraDevice(a.cameraDevice, b.cameraDevice) &&
		a.autoStopNoFaceEnabled === b.autoStopNoFaceEnabled &&
		a.autoStopNoFaceMinutes === b.autoStopNoFaceMinutes &&
		a.snoozeMinutes === b.snoozeMinutes &&
		a.blinkRateCoachingEnabled === b.blinkRateCoachingEnabled &&
		a.blinkRateThresholdPerMin === b.blinkRateThresholdPerMin &&
		a.earCalibration === b.earCalibration &&
		a.calibrationAt === b.calibrationAt &&
		a.calibrationNudgeEnabled === b.calibrationNudgeEnabled &&
		a.calibrationNudgeDismissedAt === b.calibrationNudgeDismissedAt &&
		a.lastBaselineDriftAt === b.lastBaselineDriftAt &&
		a.classifierBias === b.classifierBias &&
		a.classifierThreshold === b.classifierThreshold &&
		a.eyeExercisesEnabled === b.eyeExercisesEnabled &&
		a.exerciseInterval === b.exerciseInterval &&
		sameStringArray(a.exercisePrompts, b.exercisePrompts) &&
		a.eyeCareIndependentOfTracking === b.eyeCareIndependentOfTracking &&
		a.lookAwayEnabled === b.lookAwayEnabled &&
		a.lookAwayInterval === b.lookAwayInterval &&
		a.lookAwayDuration === b.lookAwayDuration &&
		a.lookAwayTitle === b.lookAwayTitle &&
		a.lookAwayHint === b.lookAwayHint &&
		a.popupMessage === b.popupMessage &&
		a.blinkPopupClickThrough === b.blinkPopupClickThrough &&
		a.notificationStyle === b.notificationStyle &&
		a.sessionRecapEnabled === b.sessionRecapEnabled &&
		samePopupColors(a.popupColors, b.popupColors) &&
		samePoint(a.popupPosition, b.popupPosition) &&
		samePopupPositionsByDisplayId(
			a.popupPositionsByDisplayId,
			b.popupPositionsByDisplayId,
		) &&
		sameSize(a.popupSize, b.popupSize) &&
		samePopupSizesByDisplayId(
			a.popupSizesByDisplayId,
			b.popupSizesByDisplayId,
		) &&
		sameKeyboardShortcuts(a.keyboardShortcuts, b.keyboardShortcuts) &&
		a.mgdMode === b.mgdMode &&
		a.soundEnabled === b.soundEnabled &&
		a.soundVolume === b.soundVolume &&
		a.launchAtLogin === b.launchAtLogin &&
		a.isTracking === b.isTracking &&
		a.quietHoursEnabled === b.quietHoursEnabled &&
		a.quietHoursStart === b.quietHoursStart &&
		a.quietHoursEnd === b.quietHoursEnd &&
		sameQuietHoursByWeekday(a.quietHoursByWeekday, b.quietHoursByWeekday) &&
		a.pauseOnFullscreen === b.pauseOnFullscreen &&
		samePauseAppRules(a.pauseAppRules, b.pauseAppRules) &&
		a.hasCompletedOnboarding === b.hasCompletedOnboarding &&
		a.locale === b.locale &&
		a.goalsEnabled === b.goalsEnabled &&
		a.dailyBlinkGoal === b.dailyBlinkGoal &&
		a.dailyTrackingMinutesGoal === b.dailyTrackingMinutesGoal &&
		a.weeklyBlinkGoal === b.weeklyBlinkGoal &&
		a.weeklyTrackingMinutesGoal === b.weeklyTrackingMinutesGoal
	);
}

/** Push only fields that changed. Never call update* for unchanged values. */
export function pushPreferenceDiff(
	previous: SettingsPreferences | null,
	next: SettingsPreferences,
): void {
	if (!previous || previous.darkMode !== next.darkMode) {
		rendererIpc.updateDarkMode(next.darkMode);
	}
	if (!previous || previous.microBreakInterval !== next.microBreakInterval) {
		rendererIpc.updateMicroBreakInterval(next.microBreakInterval);
	}
	if (!previous || previous.blinkPromptProfile !== next.blinkPromptProfile) {
		rendererIpc.updateBlinkPromptProfile(next.blinkPromptProfile);
	}
	if (!previous || previous.cameraEnabled !== next.cameraEnabled) {
		rendererIpc.updateCameraEnabled(next.cameraEnabled);
	}
	if (!previous || previous.cameraQuality !== next.cameraQuality) {
		rendererIpc.updateCameraQuality(next.cameraQuality);
	}
	if (
		!previous ||
		!sameCameraDevice(previous.cameraDevice, next.cameraDevice)
	) {
		rendererIpc.updateCameraDevice(next.cameraDevice);
	}
	if (
		!previous ||
		previous.autoStopNoFaceEnabled !== next.autoStopNoFaceEnabled
	) {
		rendererIpc.updateAutoStopNoFaceEnabled(next.autoStopNoFaceEnabled);
	}
	if (
		!previous ||
		previous.autoStopNoFaceMinutes !== next.autoStopNoFaceMinutes
	) {
		rendererIpc.updateAutoStopNoFaceMinutes(next.autoStopNoFaceMinutes);
	}
	if (!previous || previous.snoozeMinutes !== next.snoozeMinutes) {
		rendererIpc.updateSnoozeMinutes(next.snoozeMinutes);
	}
	if (!previous || previous.earCalibration !== next.earCalibration) {
		rendererIpc.updateEarCalibration(next.earCalibration);
	}
	if (
		!previous ||
		previous.classifierBias !== next.classifierBias ||
		previous.classifierThreshold !== next.classifierThreshold
	) {
		rendererIpc.updateClassifierCalibration({
			bias: next.classifierBias,
			threshold: next.classifierThreshold,
		});
	}
	if (!previous || previous.eyeExercisesEnabled !== next.eyeExercisesEnabled) {
		rendererIpc.updateEyeExercisesEnabled(next.eyeExercisesEnabled);
	}
	if (!previous || previous.exerciseInterval !== next.exerciseInterval) {
		rendererIpc.updateExerciseInterval(next.exerciseInterval);
	}
	if (
		!previous ||
		!sameStringArray(previous.exercisePrompts, next.exercisePrompts)
	) {
		rendererIpc.updateExercisePrompts(next.exercisePrompts);
	}
	if (
		!previous ||
		previous.eyeCareIndependentOfTracking !== next.eyeCareIndependentOfTracking
	) {
		rendererIpc.updateEyeCareIndependentOfTracking(
			next.eyeCareIndependentOfTracking,
		);
	}
	if (!previous || previous.lookAwayEnabled !== next.lookAwayEnabled) {
		rendererIpc.updateLookAwayEnabled(next.lookAwayEnabled);
	}
	if (!previous || previous.lookAwayInterval !== next.lookAwayInterval) {
		rendererIpc.updateLookAwayInterval(next.lookAwayInterval);
	}
	if (!previous || previous.lookAwayDuration !== next.lookAwayDuration) {
		rendererIpc.updateLookAwayDuration(next.lookAwayDuration);
	}
	if (!previous || previous.lookAwayTitle !== next.lookAwayTitle) {
		rendererIpc.updateLookAwayTitle(next.lookAwayTitle);
	}
	if (!previous || previous.lookAwayHint !== next.lookAwayHint) {
		rendererIpc.updateLookAwayHint(next.lookAwayHint);
	}
	if (!previous || !samePopupColors(previous.popupColors, next.popupColors)) {
		rendererIpc.updatePopupColors(next.popupColors);
		rendererIpc.updatePopupTransparency(next.popupColors.transparency);
	}
	if (!previous || previous.popupMessage !== next.popupMessage) {
		rendererIpc.updatePopupMessage(next.popupMessage);
	}
	if (
		!previous ||
		previous.blinkPopupClickThrough !== next.blinkPopupClickThrough
	) {
		rendererIpc.updateBlinkPopupClickThrough(next.blinkPopupClickThrough);
	}
	if (!previous || previous.notificationStyle !== next.notificationStyle) {
		rendererIpc.updateNotificationStyle(next.notificationStyle);
	}
	if (!previous || previous.sessionRecapEnabled !== next.sessionRecapEnabled) {
		rendererIpc.updateSessionRecapEnabled(next.sessionRecapEnabled);
	}
	if (
		!previous ||
		!sameKeyboardShortcuts(previous.keyboardShortcuts, next.keyboardShortcuts)
	) {
		rendererIpc.updateKeyboardShortcuts(next.keyboardShortcuts);
	}
	if (!previous || previous.mgdMode !== next.mgdMode) {
		rendererIpc.updateMgdMode(next.mgdMode);
	}
	if (!previous || previous.soundEnabled !== next.soundEnabled) {
		rendererIpc.updateSoundEnabled(next.soundEnabled);
	}
	if (!previous || previous.soundVolume !== next.soundVolume) {
		rendererIpc.updateSoundVolume(next.soundVolume);
	}
	if (!previous || previous.launchAtLogin !== next.launchAtLogin) {
		rendererIpc.updateLaunchAtLogin(next.launchAtLogin);
	}
	if (!previous || previous.quietHoursEnabled !== next.quietHoursEnabled) {
		rendererIpc.updateQuietHoursEnabled(next.quietHoursEnabled);
	}
	if (!previous || previous.quietHoursStart !== next.quietHoursStart) {
		rendererIpc.updateQuietHoursStart(next.quietHoursStart);
	}
	if (!previous || previous.quietHoursEnd !== next.quietHoursEnd) {
		rendererIpc.updateQuietHoursEnd(next.quietHoursEnd);
	}
	if (
		!previous ||
		!sameQuietHoursByWeekday(
			previous.quietHoursByWeekday,
			next.quietHoursByWeekday,
		)
	) {
		rendererIpc.updateQuietHoursByWeekday(next.quietHoursByWeekday);
	}
	if (!previous || previous.pauseOnFullscreen !== next.pauseOnFullscreen) {
		rendererIpc.updatePauseOnFullscreen(next.pauseOnFullscreen);
	}
	if (
		!previous ||
		!samePauseAppRules(previous.pauseAppRules, next.pauseAppRules)
	) {
		rendererIpc.updatePauseAppRules(next.pauseAppRules);
	}
	if (
		!previous ||
		previous.blinkRateCoachingEnabled !== next.blinkRateCoachingEnabled
	) {
		rendererIpc.updateBlinkRateCoachingEnabled(next.blinkRateCoachingEnabled);
	}
	if (
		!previous ||
		previous.calibrationNudgeEnabled !== next.calibrationNudgeEnabled
	) {
		rendererIpc.updateCalibrationNudgeEnabled(next.calibrationNudgeEnabled);
	}
	if (
		!previous ||
		previous.blinkRateThresholdPerMin !== next.blinkRateThresholdPerMin
	) {
		rendererIpc.updateBlinkRateThreshold(next.blinkRateThresholdPerMin);
	}
	if (!previous || previous.locale !== next.locale) {
		rendererIpc.updateLocale(next.locale);
	}
	if (
		!previous ||
		previous.hasCompletedOnboarding !== next.hasCompletedOnboarding
	) {
		rendererIpc.updateHasCompletedOnboarding(next.hasCompletedOnboarding);
	}
	if (
		!previous ||
		previous.goalsEnabled !== next.goalsEnabled ||
		previous.dailyBlinkGoal !== next.dailyBlinkGoal ||
		previous.dailyTrackingMinutesGoal !== next.dailyTrackingMinutesGoal ||
		previous.weeklyBlinkGoal !== next.weeklyBlinkGoal ||
		previous.weeklyTrackingMinutesGoal !== next.weeklyTrackingMinutesGoal
	) {
		rendererIpc.updateGoalsConfig({
			goalsEnabled: next.goalsEnabled,
			dailyBlinkGoal: next.dailyBlinkGoal,
			dailyTrackingMinutesGoal: next.dailyTrackingMinutesGoal,
			weeklyBlinkGoal: next.weeklyBlinkGoal,
			weeklyTrackingMinutesGoal: next.weeklyTrackingMinutesGoal,
		});
	}
}
