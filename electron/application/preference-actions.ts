import type { ParsedBackup } from "../../shared/backup";
import {
	backupScopeIncludesPreferences,
	backupScopeIncludesStatistics,
	type BackupScope,
} from "../../shared/backup";
import { sameCameraDevice, type CameraDevicePref } from "../../shared/camera-devices";
import { sanitizeLocale, type Locale } from "../../shared/i18n";
import { IPC_CHANNELS } from "../../shared/ipc-channels";
import type { ClassifierCalibrationPayload } from "../../shared/classifier-calibration";
import type {
	CameraQuality,
	KeyboardShortcuts,
	Point,
} from "../../shared/preferences";
import { appendProcessOnlyPauseAppRule } from "../../shared/preferences";
import type { BlinkStatsService } from "./blink-stats-service";
import type { ExerciseService } from "./exercise-service";
import type { FocusPauseService } from "./focus-pause-service";
import type { LookAwayService } from "./look-away-service";
import type { PreferencesService } from "./preferences-service";
import type { ReminderService } from "./reminder-service";
import type { SettingsProfilesService } from "./settings-profiles-service";

/** Sidecar subset used by preference multi-step flows (avoids infra import). */
export interface PreferenceActionSidecar {
	startEarCalibration(): void;
	cancelEarCalibration(reason?: string): void;
	applyCameraQuality(quality?: CameraQuality): void;
	applyCameraDevice(device?: CameraDevicePref | null): void;
	applyEarCalibration(baseline?: number | null): void;
	applyClassifierCalibration(
		payload?: ClassifierCalibrationPayload | null,
	): void;
	applySessionConfig(): void;
	restartCamera(): boolean;
	readonly isCameraReady: boolean;
}

export interface PreferenceActionWindows {
	sendPreferences(): void;
	sendToMain(channel: string, ...args: unknown[]): void;
	showCamera(onClosed: () => void): void;
	getPopupPositionSeedDisplayId(legacyPoint: Point | null): string;
	sendCameraModeToReminder(enabled: boolean): void;
}

export interface PreferenceActionShortcuts {
	registerAll(shortcuts: KeyboardShortcuts): void;
}

export interface PreferenceActionTray {
	rebuildMenu(locale?: Locale): void;
}

/**
 * Multi-step preference workflows that used to live in IPC handlers.
 * Keeps register-ipc-handlers as thin dispatch.
 */
export class PreferenceActions {
	private settingsProfiles: SettingsProfilesService | null = null;

	constructor(
		private readonly preferences: PreferencesService,
		private readonly reminders: ReminderService,
		private readonly exercises: ExerciseService,
		private readonly lookAway: LookAwayService,
		private readonly focusPause: FocusPauseService,
		private readonly blinkStats: BlinkStatsService,
		private readonly windows: PreferenceActionWindows,
		private readonly sidecar: PreferenceActionSidecar,
		private readonly shortcuts: PreferenceActionShortcuts,
		private readonly applyLaunchAtLogin: (enabled: boolean) => void,
		private readonly tray?: PreferenceActionTray,
	) {}

	attachSettingsProfiles(service: SettingsProfilesService): void {
		this.settingsProfiles = service;
	}

	/** Tray one-click: append last-external process to pauseAppRules. */
	appendPauseAppFromLastExternal(): boolean {
		const result = appendProcessOnlyPauseAppRule(
			this.preferences.current.pauseAppRules,
			this.focusPause.lastExternalForeground(),
		);
		if (!result.ok) return false;
		this.preferences.set("pauseAppRules", result.rules);
		this.focusPause.recompute();
		this.windows.sendPreferences();
		this.tray?.rebuildMenu();
		return true;
	}

	startEarCalibration(): void {
		if (!this.preferences.current.cameraEnabled) {
			this.preferences.set("cameraEnabled", true);
		}
		this.reminders.ensureCameraActive();
		this.sidecar.startEarCalibration();
	}

	updateLocale(value: string): void {
		const locale = sanitizeLocale(value);
		// Same locale is a no-op. Never rewrite popup/exercise content here —
		// React LanguageSettings owns built-in prompt updates; sendPreferences
		// + prompt rewrite used to bounce the settings sync forever.
		if (locale === this.preferences.current.locale) return;
		this.preferences.set("locale", locale);
		this.tray?.rebuildMenu(locale);
		this.blinkStats.invalidateCharts();
		this.windows.sendPreferences();
		if (this.blinkStats.isLivePushEnabled()) {
			this.windows.sendToMain(
				IPC_CHANNELS.loadBlinkStats,
				this.blinkStats.getSnapshot(),
			);
		}
	}

	showCameraWindow(): void {
		const enabledCamera = !this.preferences.current.cameraEnabled;
		if (enabledCamera) {
			this.preferences.set("cameraEnabled", true);
		}
		this.reminders.ensureCameraActive();
		// Only echo when main mutated prefs; unconditional sendPreferences
		// is a bounce vector for the React sync effect.
		if (enabledCamera) {
			this.windows.sendPreferences();
		}
		this.windows.showCamera(() => {
			this.windows.sendToMain(IPC_CHANNELS.cameraWindowClosed);
			this.reminders.stopCameraIfIdle();
		});
	}

	resetPreferences(replayOnboarding?: boolean): void {
		const current = this.preferences.current;
		if (current.isTracking) this.reminders.stop(true);
		this.exercises.stop();
		this.lookAway.stop();
		this.sidecar.cancelEarCalibration("Preferences reset");
		this.preferences.reset(null, {
			replayOnboarding: Boolean(replayOnboarding),
		});
		this.applyLaunchAtLogin(false);
		this.shortcuts.registerAll(this.preferences.current.keyboardShortcuts);
		this.sidecar.applyCameraQuality(this.preferences.current.cameraQuality);
		this.sidecar.applyCameraDevice(this.preferences.current.cameraDevice);
		this.sidecar.applyEarCalibration(null);
		this.sidecar.applyClassifierCalibration(null);
		this.tray?.rebuildMenu(this.preferences.current.locale);
		this.windows.sendPreferences();
		this.focusPause.recompute();
	}

	/**
	 * Apply a validated backup payload. Replace only the requested scope.
	 * Single sendPreferences echo when prefs change (avoid sync bounce).
	 */
	applyBackup(scope: BackupScope, parsed: ParsedBackup): void {
		const applyPrefs =
			backupScopeIncludesPreferences(scope) && parsed.preferences;
		const applyStats =
			backupScopeIncludesStatistics(scope) && parsed.blinkStats;

		if (applyPrefs && parsed.preferences) {
			const current = this.preferences.current;
			if (current.isTracking) this.reminders.stop(true);
			this.exercises.stop();
			this.lookAway.stop();
			this.sidecar.cancelEarCalibration("Preferences imported from backup");
			this.preferences.replaceFromBackup(parsed.preferences);
			this.preferences.seedPopupPositionsFromLegacy(
				this.windows.getPopupPositionSeedDisplayId(
					this.preferences.current.popupPosition,
				),
			);
			this.preferences.seedPopupSizesFromPositionIds();
			const next = this.preferences.current;
			this.applyLaunchAtLogin(next.launchAtLogin);
			this.shortcuts.registerAll(next.keyboardShortcuts);
			this.sidecar.applyCameraQuality(next.cameraQuality);
			this.sidecar.applyCameraDevice(next.cameraDevice);
			this.sidecar.applyEarCalibration(next.earCalibration);
			this.sidecar.applyClassifierCalibration({
				bias: next.classifierBias,
				threshold: next.classifierThreshold,
			});
			this.tray?.rebuildMenu(next.locale);
			this.blinkStats.invalidateCharts();
			this.windows.sendPreferences();
			this.focusPause.recompute();
			if (parsed.settingsProfiles !== undefined) {
				this.settingsProfiles?.replaceFromBackup(parsed.settingsProfiles);
			}
		}

		if (applyStats && parsed.blinkStats) {
			this.blinkStats.replaceState(parsed.blinkStats);
			if (this.blinkStats.isLivePushEnabled()) {
				this.windows.sendToMain(
					IPC_CHANNELS.loadBlinkStats,
					this.blinkStats.getSnapshot(),
				);
			}
		} else if (applyPrefs) {
			this.blinkStats.reconcileAchievements({ celebrate: "summary" });
			if (this.blinkStats.isLivePushEnabled()) {
				this.windows.sendToMain(
					IPC_CHANNELS.loadBlinkStats,
					this.blinkStats.getSnapshot(),
				);
			}
		}
	}

	/**
	 * Hot-apply a settings-profile snapshot. Keeps tracking running; never
	 * clears the prefs store or writes blink stats.
	 */
	applySettingsProfile(snapshot: unknown): void {
		const before = this.preferences.current;
		const previousDevice = before.cameraDevice;
		const cameraWasLive = this.sidecar.isCameraReady;
		const previousCameraEnabled = before.cameraEnabled;
		const previousEar = before.earCalibration;
		const previousBias = before.classifierBias;
		const previousThreshold = before.classifierThreshold;

		this.preferences.applyProfileSnapshot(snapshot);
		const next = this.preferences.current;

		const identityChanged =
			previousEar !== next.earCalibration ||
			previousBias !== next.classifierBias ||
			previousThreshold !== next.classifierThreshold;
		if (identityChanged) {
			this.sidecar.cancelEarCalibration("Settings setup switched");
		}

		this.sidecar.applySessionConfig();

		if (
			cameraWasLive &&
			!sameCameraDevice(previousDevice, next.cameraDevice)
		) {
			this.sidecar.restartCamera();
		}

		if (previousCameraEnabled !== next.cameraEnabled) {
			this.windows.sendCameraModeToReminder(next.cameraEnabled);
			// Interval-only apply clears timers then no-ops when the sidecar is
			// not ready yet — timer→camera would leave reminders dead. Resync
			// starts monitoring (or the timer loop) without clearing tracking.
			this.reminders.resyncLoopsForCameraModeChange();
		} else {
			this.reminders.applyReminderInterval();
			this.reminders.syncCameraLoopForMgdMode();
		}

		const eyeCareActive =
			next.eyeCareIndependentOfTracking || next.isTracking;
		if (eyeCareActive) {
			if (next.eyeExercisesEnabled) {
				this.exercises.stop();
				this.exercises.start();
			} else {
				this.exercises.stop();
			}
			if (next.lookAwayEnabled) {
				this.lookAway.stop();
				this.lookAway.start();
			} else {
				this.lookAway.stop();
			}
		} else {
			this.exercises.stop();
			this.lookAway.stop();
		}

		this.focusPause.recompute();
		this.tray?.rebuildMenu();
		this.windows.sendPreferences();
	}
}
