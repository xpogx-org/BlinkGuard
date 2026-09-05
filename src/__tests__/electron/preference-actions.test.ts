import { describe, expect, it, vi } from "vitest";
import type { PreferenceStore } from "../../../electron/application/ports/preference-store";
import { PreferenceActions } from "../../../electron/application/preference-actions";
import { PreferencesService } from "../../../electron/application/preferences-service";
import { IPC_CHANNELS } from "../../../shared/ipc-channels";
import { captureSettingsProfilePrefs } from "../../../shared/settings-profiles";

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

function createActions(
	preferences: PreferencesService,
	overrides: {
		reminders?: object;
		exercises?: object;
		lookAway?: object;
		focusPause?: object;
		blinkStats?: object;
		windows?: object;
		sidecar?: object;
		shortcuts?: object;
		applyLaunchAtLogin?: (enabled: boolean) => void;
		tray?: object;
	} = {},
) {
	return new PreferenceActions(
		preferences,
		(overrides.reminders ?? {}) as never,
		(overrides.exercises ?? { stop: vi.fn(), start: vi.fn() }) as never,
		(overrides.lookAway ?? { stop: vi.fn(), start: vi.fn() }) as never,
		(overrides.focusPause ?? { recompute: vi.fn() }) as never,
		(overrides.blinkStats ?? {
			invalidateCharts: vi.fn(),
			isLivePushEnabled: () => false,
			getSnapshot: vi.fn(),
			reconcileAchievements: vi.fn(),
			replaceState: vi.fn(),
		}) as never,
		(overrides.windows ?? {
			sendPreferences: vi.fn(),
			sendToMain: vi.fn(),
			showCamera: vi.fn(),
			getPopupPositionSeedDisplayId: () => "1",
			sendCameraModeToReminder: vi.fn(),
		}) as never,
		(overrides.sidecar ?? {
			startEarCalibration: vi.fn(),
			cancelEarCalibration: vi.fn(),
			applyCameraQuality: vi.fn(),
			applyCameraDevice: vi.fn(),
			applyEarCalibration: vi.fn(),
			applyClassifierCalibration: vi.fn(),
			applySessionConfig: vi.fn(),
			restartCamera: vi.fn(),
			isCameraReady: false,
		}) as never,
		(overrides.shortcuts ?? { registerAll: vi.fn() }) as never,
		overrides.applyLaunchAtLogin ?? vi.fn(),
		overrides.tray as never,
	);
}

function defaultSidecar(overrides: Record<string, unknown> = {}) {
	return {
		startEarCalibration: vi.fn(),
		cancelEarCalibration: vi.fn(),
		applyCameraQuality: vi.fn(),
		applyCameraDevice: vi.fn(),
		applyEarCalibration: vi.fn(),
		applyClassifierCalibration: vi.fn(),
		applySessionConfig: vi.fn(),
		restartCamera: vi.fn(() => true),
		isCameraReady: false,
		...overrides,
	};
}

describe("PreferenceActions", () => {
	it("startEarCalibration enables camera and starts sidecar calibration", () => {
		const preferences = new PreferencesService(createStore());
		preferences.set("cameraEnabled", false);
		const reminders = { ensureCameraActive: vi.fn() };
		const sidecar = {
			startEarCalibration: vi.fn(),
			cancelEarCalibration: vi.fn(),
			applyCameraQuality: vi.fn(),
			applyCameraDevice: vi.fn(),
			applyEarCalibration: vi.fn(),
			applyClassifierCalibration: vi.fn(),
		};
		const actions = createActions(preferences, { reminders, sidecar });

		actions.startEarCalibration();

		expect(preferences.current.cameraEnabled).toBe(true);
		expect(reminders.ensureCameraActive).toHaveBeenCalledOnce();
		expect(sidecar.startEarCalibration).toHaveBeenCalledOnce();
	});

	it("updateLocale is a no-op for the same locale", () => {
		const preferences = new PreferencesService(createStore());
		const tray = { rebuildMenu: vi.fn() };
		const windows = {
			sendPreferences: vi.fn(),
			sendToMain: vi.fn(),
			showCamera: vi.fn(),
		};
		const actions = createActions(preferences, { tray, windows });

		actions.updateLocale("en");

		expect(tray.rebuildMenu).not.toHaveBeenCalled();
		expect(windows.sendPreferences).not.toHaveBeenCalled();
	});

	it("updateLocale rebuilds tray and echoes preferences", () => {
		const preferences = new PreferencesService(createStore());
		const tray = { rebuildMenu: vi.fn() };
		const snapshot = { totalBlinks: 0 };
		const blinkStats = {
			invalidateCharts: vi.fn(),
			isLivePushEnabled: () => true,
			getSnapshot: vi.fn(() => snapshot),
		};
		const windows = {
			sendPreferences: vi.fn(),
			sendToMain: vi.fn(),
			showCamera: vi.fn(),
		};
		const actions = createActions(preferences, {
			tray,
			blinkStats,
			windows,
		});

		actions.updateLocale("uk");

		expect(preferences.current.locale).toBe("uk");
		expect(tray.rebuildMenu).toHaveBeenCalledWith("uk");
		expect(blinkStats.invalidateCharts).toHaveBeenCalledOnce();
		expect(windows.sendPreferences).toHaveBeenCalledOnce();
		expect(windows.sendToMain).toHaveBeenCalledWith(
			IPC_CHANNELS.loadBlinkStats,
			snapshot,
		);
	});

	it("showCameraWindow enables camera only when it was off", () => {
		const preferences = new PreferencesService(createStore());
		preferences.set("cameraEnabled", false);
		const reminders = {
			ensureCameraActive: vi.fn(),
			stopCameraIfIdle: vi.fn(),
		};
		const windows = {
			sendPreferences: vi.fn(),
			sendToMain: vi.fn(),
			showCamera: vi.fn((onClosed: () => void) => {
				onClosed();
			}),
		};
		const actions = createActions(preferences, { reminders, windows });

		actions.showCameraWindow();

		expect(preferences.current.cameraEnabled).toBe(true);
		expect(preferences.current.isTracking).toBe(false);
		expect(reminders.ensureCameraActive).toHaveBeenCalledOnce();
		expect(windows.sendPreferences).toHaveBeenCalledOnce();
		expect(windows.showCamera).toHaveBeenCalledOnce();
		expect(windows.sendToMain).toHaveBeenCalledWith(
			IPC_CHANNELS.cameraWindowClosed,
		);
		expect(reminders.stopCameraIfIdle).toHaveBeenCalledOnce();
	});

	it("showCameraWindow still releases idle camera when it was already enabled", () => {
		const preferences = new PreferencesService(createStore());
		preferences.set("cameraEnabled", true);
		preferences.set("isTracking", false);
		const reminders = {
			ensureCameraActive: vi.fn(),
			stopCameraIfIdle: vi.fn(),
		};
		const windows = {
			sendPreferences: vi.fn(),
			sendToMain: vi.fn(),
			showCamera: vi.fn((onClosed: () => void) => {
				onClosed();
			}),
		};
		const actions = createActions(preferences, { reminders, windows });

		actions.showCameraWindow();

		expect(reminders.ensureCameraActive).toHaveBeenCalledOnce();
		expect(windows.sendPreferences).not.toHaveBeenCalled();
		expect(reminders.stopCameraIfIdle).toHaveBeenCalledOnce();
	});

	it("applyBackup replaces prefs with side effects and optional stats", () => {
		const preferences = new PreferencesService(createStore());
		preferences.set("isTracking", true);
		const reminders = { stop: vi.fn() };
		const exercises = { stop: vi.fn() };
		const lookAway = { stop: vi.fn() };
		const focusPause = { recompute: vi.fn() };
		const snapshot = { totals: { total: 40 } };
		const blinkStats = {
			invalidateCharts: vi.fn(),
			isLivePushEnabled: () => true,
			getSnapshot: vi.fn(() => snapshot),
			replaceState: vi.fn(),
			reconcileAchievements: vi.fn(),
		};
		const windows = {
			sendPreferences: vi.fn(),
			sendToMain: vi.fn(),
			showCamera: vi.fn(),
			getPopupPositionSeedDisplayId: () => "1",
		};
		const sidecar = {
			startEarCalibration: vi.fn(),
			cancelEarCalibration: vi.fn(),
			applyCameraQuality: vi.fn(),
			applyCameraDevice: vi.fn(),
			applyEarCalibration: vi.fn(),
			applyClassifierCalibration: vi.fn(),
		};
		const shortcuts = { registerAll: vi.fn() };
		const applyLaunchAtLogin = vi.fn();
		const tray = { rebuildMenu: vi.fn() };
		const actions = createActions(preferences, {
			reminders,
			exercises,
			lookAway,
			focusPause,
			blinkStats,
			windows,
			sidecar,
			shortcuts,
			applyLaunchAtLogin,
			tray,
		});

		actions.applyBackup("both", {
			preferences: {
				...preferences.current,
				locale: "uk",
				darkMode: false,
				launchAtLogin: true,
				keyboardShortcuts: {
					...preferences.current.keyboardShortcuts,
					trackingToggle: "Ctrl+B",
				},
				cameraQuality: "high",
				earCalibration: 0.25,
				classifierBias: 0.4,
				classifierThreshold: 0.2,
				isTracking: true,
			},
			blinkStats: {
				days: [],
				totalBlinks: 40,
				spentBlinks: 0,
				unlockedRewardIds: [],
				unlockedAchievementIds: [],
				streakShieldCharges: 0,
				streakShieldUsedDates: [],
				rewardPurchaseCounts: {},
				shopDiscountLevel: 0,
				unlockedCheerThemeIds: [],
				equippedCheerTheme: "random",
				unlockedPopupPresetIds: [],
				equippedPopupPresetId: null,
				snoozeTokenCharges: 0,
			},
		});

		expect(reminders.stop).toHaveBeenCalledWith(true);
		expect(exercises.stop).toHaveBeenCalledOnce();
		expect(lookAway.stop).toHaveBeenCalledOnce();
		expect(sidecar.cancelEarCalibration).toHaveBeenCalledOnce();
		expect(preferences.current.locale).toBe("uk");
		expect(preferences.current.darkMode).toBe(false);
		expect(preferences.current.isTracking).toBe(false);
		expect(applyLaunchAtLogin).toHaveBeenCalledWith(true);
		expect(shortcuts.registerAll).toHaveBeenCalledWith({
			...preferences.current.keyboardShortcuts,
			trackingToggle: "Ctrl+B",
		});
		expect(sidecar.applyCameraQuality).toHaveBeenCalledWith("high");
		expect(sidecar.applyCameraDevice).toHaveBeenCalled();
		expect(sidecar.applyEarCalibration).toHaveBeenCalledWith(0.25);
		expect(sidecar.applyClassifierCalibration).toHaveBeenCalledWith({
			bias: 0.4,
			threshold: 0.2,
		});
		expect(tray.rebuildMenu).toHaveBeenCalledWith("uk");
		expect(blinkStats.invalidateCharts).toHaveBeenCalledOnce();
		expect(windows.sendPreferences).toHaveBeenCalledOnce();
		expect(focusPause.recompute).toHaveBeenCalledOnce();
		expect(blinkStats.replaceState).toHaveBeenCalledOnce();
		expect(windows.sendToMain).toHaveBeenCalledWith(
			IPC_CHANNELS.loadBlinkStats,
			snapshot,
		);
		expect(blinkStats.reconcileAchievements).not.toHaveBeenCalled();
	});

	it("applyBackup prefs-only reconciles achievements after prefs replace", () => {
		const preferences = new PreferencesService(createStore());
		const blinkStats = {
			invalidateCharts: vi.fn(),
			isLivePushEnabled: () => false,
			getSnapshot: vi.fn(),
			replaceState: vi.fn(),
			reconcileAchievements: vi.fn(),
		};
		const sidecar = {
			startEarCalibration: vi.fn(),
			cancelEarCalibration: vi.fn(),
			applyCameraQuality: vi.fn(),
			applyCameraDevice: vi.fn(),
			applyEarCalibration: vi.fn(),
			applyClassifierCalibration: vi.fn(),
		};
		const actions = createActions(preferences, { blinkStats, sidecar });

		actions.applyBackup("preferences", {
			preferences: {
				...preferences.current,
				hasCompletedOnboarding: true,
				earCalibration: 0.25,
			},
		});

		expect(blinkStats.replaceState).not.toHaveBeenCalled();
		expect(blinkStats.reconcileAchievements).toHaveBeenCalledWith({
			celebrate: "summary",
		});
	});

	it("applyBackup seeds per-display positions from a legacy popupPosition", () => {
		const preferences = new PreferencesService(createStore());
		const windows = {
			sendPreferences: vi.fn(),
			sendToMain: vi.fn(),
			showCamera: vi.fn(),
			getPopupPositionSeedDisplayId: () => "2528",
		};
		const actions = createActions(preferences, { windows });

		actions.applyBackup("preferences", {
			preferences: {
				...preferences.current,
				popupPosition: { x: 40, y: 80 },
				popupPositionsByDisplayId: {},
				hasCompletedOnboarding: true,
			},
		});

		expect(preferences.current.popupPositionsByDisplayId).toEqual({
			"2528": { x: 40, y: 80 },
		});
		expect(preferences.current.popupPosition).toEqual({ x: 40, y: 80 });
		expect(preferences.current.popupSizesByDisplayId).toEqual({
			"2528": preferences.current.popupSize,
		});
	});

	it("applyBackup keeps an existing per-display map instead of reseeding", () => {
		const preferences = new PreferencesService(createStore());
		const windows = {
			sendPreferences: vi.fn(),
			sendToMain: vi.fn(),
			showCamera: vi.fn(),
			getPopupPositionSeedDisplayId: () => "2528",
		};
		const actions = createActions(preferences, { windows });
		const existing = { "9": { x: 1, y: 2 } };
		const existingSizes = { "9": { width: 400, height: 180 } };

		actions.applyBackup("preferences", {
			preferences: {
				...preferences.current,
				popupPosition: { x: 40, y: 80 },
				popupPositionsByDisplayId: existing,
				popupSizesByDisplayId: existingSizes,
				hasCompletedOnboarding: true,
			},
		});

		expect(preferences.current.popupPositionsByDisplayId).toEqual(existing);
		expect(preferences.current.popupSizesByDisplayId).toEqual(existingSizes);
	});

	it("applyBackup restores settingsProfiles when present without auto-switching live prefs", () => {
		const preferences = new PreferencesService(createStore());
		preferences.set("reminderInterval", 3000);
		preferences.set("goalsEnabled", true);
		preferences.set("dailyBlinkGoal", 999);
		const replaceFromBackup = vi.fn();
		const actions = createActions(preferences, {
			reminders: { stop: vi.fn() },
			exercises: { stop: vi.fn() },
			lookAway: { stop: vi.fn() },
			focusPause: { recompute: vi.fn() },
			blinkStats: {
				invalidateCharts: vi.fn(),
				isLivePushEnabled: () => false,
				getSnapshot: vi.fn(),
				reconcileAchievements: vi.fn(),
				replaceState: vi.fn(),
			},
			windows: {
				sendPreferences: vi.fn(),
				sendToMain: vi.fn(),
				showCamera: vi.fn(),
				getPopupPositionSeedDisplayId: () => "1",
			},
			sidecar: {
				cancelEarCalibration: vi.fn(),
				applyCameraQuality: vi.fn(),
				applyCameraDevice: vi.fn(),
				applyEarCalibration: vi.fn(),
				applyClassifierCalibration: vi.fn(),
			},
			shortcuts: { registerAll: vi.fn() },
			applyLaunchAtLogin: vi.fn(),
		});
		actions.attachSettingsProfiles({ replaceFromBackup } as never);

		const profilePrefs = captureSettingsProfilePrefs({
			...preferences.current,
			reminderInterval: 7000,
			cameraEnabled: true,
		});
		const settingsProfiles = {
			version: 1 as const,
			activeProfileId: "profile-desk",
			profiles: [
				{
					id: "profile-desk",
					name: "Desk",
					createdAt: "2026-08-01T00:00:00.000Z",
					updatedAt: "2026-08-01T00:00:00.000Z",
					prefs: profilePrefs,
				},
			],
		};

		actions.applyBackup("preferences", {
			preferences: {
				...preferences.current,
				reminderInterval: 5000,
				hasCompletedOnboarding: true,
			},
			settingsProfiles,
		});

		expect(preferences.current.reminderInterval).toBe(5000);
		expect(preferences.current.dailyBlinkGoal).toBe(999);
		expect(replaceFromBackup).toHaveBeenCalledWith(settingsProfiles);
	});

	it("applyBackup skips settingsProfiles when field is absent", () => {
		const preferences = new PreferencesService(createStore());
		const replaceFromBackup = vi.fn();
		const actions = createActions(preferences, {
			reminders: { stop: vi.fn() },
			exercises: { stop: vi.fn() },
			lookAway: { stop: vi.fn() },
			focusPause: { recompute: vi.fn() },
			blinkStats: {
				invalidateCharts: vi.fn(),
				isLivePushEnabled: () => false,
				getSnapshot: vi.fn(),
				reconcileAchievements: vi.fn(),
			},
			windows: {
				sendPreferences: vi.fn(),
				sendToMain: vi.fn(),
				showCamera: vi.fn(),
				getPopupPositionSeedDisplayId: () => "1",
			},
			sidecar: {
				cancelEarCalibration: vi.fn(),
				applyCameraQuality: vi.fn(),
				applyCameraDevice: vi.fn(),
				applyEarCalibration: vi.fn(),
				applyClassifierCalibration: vi.fn(),
			},
			shortcuts: { registerAll: vi.fn() },
			applyLaunchAtLogin: vi.fn(),
		});
		actions.attachSettingsProfiles({ replaceFromBackup } as never);

		actions.applyBackup("preferences", {
			preferences: {
				...preferences.current,
				hasCompletedOnboarding: true,
			},
		});

		expect(replaceFromBackup).not.toHaveBeenCalled();
	});

	it("resetPreferences stops tracking and restores defaults without replaying onboarding", () => {
		const preferences = new PreferencesService(createStore());
		preferences.set("isTracking", true);
		preferences.set("locale", "uk");
		preferences.set("cameraQuality", "high");
		preferences.set("earCalibration", 0.25);
		preferences.set("classifierBias", 0.4);
		preferences.set("hasCompletedOnboarding", true);
		preferences.set("launchAtLogin", true);
		preferences.set("popupPosition", { x: 40, y: 80 });
		preferences.set("popupPositionsByDisplayId", { "1": { x: 40, y: 80 } });
		preferences.set("popupSizesByDisplayId", {
			"1": { width: 400, height: 180 },
		});
		preferences.set("popupSize", { width: 400, height: 180 });
		const reminders = { stop: vi.fn() };
		const exercises = { stop: vi.fn() };
		const lookAway = { stop: vi.fn() };
		const focusPause = { recompute: vi.fn() };
		const windows = {
			sendPreferences: vi.fn(),
			sendToMain: vi.fn(),
			showCamera: vi.fn(),
		};
		const sidecar = {
			startEarCalibration: vi.fn(),
			cancelEarCalibration: vi.fn(),
			applyCameraQuality: vi.fn(),
			applyCameraDevice: vi.fn(),
			applyEarCalibration: vi.fn(),
			applyClassifierCalibration: vi.fn(),
		};
		const shortcuts = { registerAll: vi.fn() };
		const applyLaunchAtLogin = vi.fn();
		const tray = { rebuildMenu: vi.fn() };
		const actions = createActions(preferences, {
			reminders,
			exercises,
			lookAway,
			focusPause,
			windows,
			sidecar,
			shortcuts,
			applyLaunchAtLogin,
			tray,
		});

		actions.resetPreferences();

		expect(reminders.stop).toHaveBeenCalledWith(true);
		expect(exercises.stop).toHaveBeenCalledOnce();
		expect(lookAway.stop).toHaveBeenCalledOnce();
		expect(sidecar.cancelEarCalibration).toHaveBeenCalledWith(
			"Preferences reset",
		);
		expect(preferences.current.locale).toBe("en");
		expect(preferences.current.cameraQuality).toBe("medium");
		expect(preferences.current.cameraDevice).toBeNull();
		expect(preferences.current.earCalibration).toBeNull();
		expect(preferences.current.classifierBias).toBeNull();
		expect(preferences.current.isTracking).toBe(false);
		expect(preferences.current.hasCompletedOnboarding).toBe(true);
		expect(preferences.current.popupPosition).toBeNull();
		expect(preferences.current.popupPositionsByDisplayId).toEqual({});
		expect(preferences.current.popupSizesByDisplayId).toEqual({});
		expect(preferences.current.popupSize).toEqual({ width: 300, height: 120 });
		expect(applyLaunchAtLogin).toHaveBeenCalledWith(false);
		expect(shortcuts.registerAll).toHaveBeenCalledWith(
			preferences.current.keyboardShortcuts,
		);
		expect(sidecar.applyCameraQuality).toHaveBeenCalledWith("medium");
		expect(sidecar.applyCameraDevice).toHaveBeenCalledWith(null);
		expect(sidecar.applyEarCalibration).toHaveBeenCalledWith(null);
		expect(sidecar.applyClassifierCalibration).toHaveBeenCalledWith(null);
		expect(tray.rebuildMenu).toHaveBeenCalledWith("en");
		expect(windows.sendPreferences).toHaveBeenCalledOnce();
		expect(focusPause.recompute).toHaveBeenCalledOnce();
	});

	it("resetPreferences(true) skips stop when tracking is off and replays onboarding", () => {
		const preferences = new PreferencesService(createStore());
		preferences.set("isTracking", false);
		preferences.set("hasCompletedOnboarding", true);
		const reminders = { stop: vi.fn() };
		const exercises = { stop: vi.fn() };
		const lookAway = { stop: vi.fn() };
		const focusPause = { recompute: vi.fn() };
		const sidecar = {
			startEarCalibration: vi.fn(),
			cancelEarCalibration: vi.fn(),
			applyCameraQuality: vi.fn(),
			applyCameraDevice: vi.fn(),
			applyEarCalibration: vi.fn(),
			applyClassifierCalibration: vi.fn(),
		};
		const actions = createActions(preferences, {
			reminders,
			exercises,
			lookAway,
			focusPause,
			sidecar,
		});

		actions.resetPreferences(true);

		expect(reminders.stop).not.toHaveBeenCalled();
		expect(exercises.stop).toHaveBeenCalledOnce();
		expect(lookAway.stop).toHaveBeenCalledOnce();
		expect(sidecar.cancelEarCalibration).toHaveBeenCalledWith(
			"Preferences reset",
		);
		expect(preferences.current.hasCompletedOnboarding).toBe(false);
		expect(focusPause.recompute).toHaveBeenCalledOnce();
	});

	it("applySettingsProfile keeps tracking running and never writes stats", () => {
		const store = createStore();
		const clearSpy = vi.fn();
		const originalClear = store.clear.bind(store);
		store.clear = () => {
			clearSpy();
			originalClear();
		};
		const preferences = new PreferencesService(store);
		preferences.set("isTracking", true);
		preferences.set("locale", "uk");
		preferences.set("reminderInterval", 2000);
		preferences.set("cameraEnabled", false);
		preferences.set("snoozeMinutes", 5);
		preferences.set("eyeExercisesEnabled", true);
		preferences.set("eyeCareIndependentOfTracking", true);

		const reminders = {
			stop: vi.fn(),
			applyReminderInterval: vi.fn(),
			syncCameraLoopForMgdMode: vi.fn(),
			resyncLoopsForCameraModeChange: vi.fn(),
		};
		const exercises = { stop: vi.fn(), start: vi.fn() };
		const lookAway = { stop: vi.fn(), start: vi.fn() };
		const focusPause = { recompute: vi.fn() };
		const replaceState = vi.fn();
		const blinkStats = {
			invalidateCharts: vi.fn(),
			isLivePushEnabled: () => false,
			getSnapshot: vi.fn(),
			reconcileAchievements: vi.fn(),
			replaceState,
		};
		const windows = {
			sendPreferences: vi.fn(),
			sendToMain: vi.fn(),
			showCamera: vi.fn(),
			getPopupPositionSeedDisplayId: () => "1",
			sendCameraModeToReminder: vi.fn(),
		};
		const sidecar = defaultSidecar({ isCameraReady: true });
		const shortcuts = { registerAll: vi.fn() };
		const applyLaunchAtLogin = vi.fn();
		const tray = { rebuildMenu: vi.fn() };
		const actions = createActions(preferences, {
			reminders,
			exercises,
			lookAway,
			focusPause,
			blinkStats,
			windows,
			sidecar,
			shortcuts,
			applyLaunchAtLogin,
			tray,
		});

		actions.applySettingsProfile({
			reminderInterval: 8000,
			blinkPromptProfile: "strong",
			cameraEnabled: true,
			snoozeMinutes: 15,
			cameraQuality: "high",
			earCalibration: 0.29,
			calibrationAt: 1_700_000_000_000,
		});

		expect(reminders.stop).not.toHaveBeenCalled();
		expect(replaceState).not.toHaveBeenCalled();
		expect(clearSpy).not.toHaveBeenCalled();
		expect(shortcuts.registerAll).not.toHaveBeenCalled();
		expect(applyLaunchAtLogin).not.toHaveBeenCalled();
		expect(preferences.current.isTracking).toBe(true);
		expect(preferences.current.locale).toBe("uk");
		expect(preferences.current.reminderInterval).toBe(8000);
		expect(preferences.current.cameraEnabled).toBe(true);
		expect(sidecar.applySessionConfig).toHaveBeenCalledOnce();
		expect(sidecar.restartCamera).not.toHaveBeenCalled();
		expect(sidecar.cancelEarCalibration).toHaveBeenCalledWith(
			"Settings setup switched",
		);
		expect(reminders.resyncLoopsForCameraModeChange).toHaveBeenCalledOnce();
		expect(reminders.applyReminderInterval).not.toHaveBeenCalled();
		expect(reminders.syncCameraLoopForMgdMode).not.toHaveBeenCalled();
		expect(windows.sendCameraModeToReminder).toHaveBeenCalledWith(true);
		expect(tray.rebuildMenu).toHaveBeenCalledOnce();
		expect(exercises.stop).toHaveBeenCalled();
		expect(exercises.start).toHaveBeenCalled();
		expect(windows.sendPreferences).toHaveBeenCalledOnce();
		expect(focusPause.recompute).toHaveBeenCalledOnce();
	});

	it("applySettingsProfile uses interval apply when cameraEnabled is unchanged", () => {
		const preferences = new PreferencesService(createStore());
		preferences.set("isTracking", true);
		preferences.set("cameraEnabled", true);
		preferences.set("reminderInterval", 2000);
		const reminders = {
			stop: vi.fn(),
			applyReminderInterval: vi.fn(),
			syncCameraLoopForMgdMode: vi.fn(),
			resyncLoopsForCameraModeChange: vi.fn(),
		};
		const actions = createActions(preferences, { reminders });

		actions.applySettingsProfile({
			reminderInterval: 8000,
			cameraEnabled: true,
		});

		expect(reminders.applyReminderInterval).toHaveBeenCalledOnce();
		expect(reminders.syncCameraLoopForMgdMode).toHaveBeenCalledOnce();
		expect(reminders.resyncLoopsForCameraModeChange).not.toHaveBeenCalled();
		expect(reminders.stop).not.toHaveBeenCalled();
	});

	it("applySettingsProfile restarts camera only when device changes and camera is live", () => {
		const preferences = new PreferencesService(createStore());
		preferences.set("cameraDevice", {
			id: "cam-a",
			index: 0,
			name: "Desk",
		});
		const sidecar = defaultSidecar({ isCameraReady: true });
		const reminders = {
			applyReminderInterval: vi.fn(),
			syncCameraLoopForMgdMode: vi.fn(),
			stop: vi.fn(),
		};
		const actions = createActions(preferences, { sidecar, reminders });

		actions.applySettingsProfile({
			cameraDevice: { id: "cam-b", index: 1, name: "Sofa" },
		});

		expect(sidecar.restartCamera).toHaveBeenCalledOnce();
		expect(reminders.stop).not.toHaveBeenCalled();
	});

	it("applySettingsProfile skips camera restart when device unchanged or camera idle", () => {
		const preferences = new PreferencesService(createStore());
		preferences.set("cameraDevice", {
			id: "cam-a",
			index: 0,
			name: "Desk",
		});
		const sidecarLiveSame = defaultSidecar({ isCameraReady: true });
		const reminders = {
			applyReminderInterval: vi.fn(),
			syncCameraLoopForMgdMode: vi.fn(),
		};
		createActions(preferences, {
			sidecar: sidecarLiveSame,
			reminders,
		}).applySettingsProfile({
			cameraDevice: { id: "cam-a", index: 0, name: "Desk" },
			cameraQuality: "ultra",
		});
		expect(sidecarLiveSame.restartCamera).not.toHaveBeenCalled();
		expect(sidecarLiveSame.cancelEarCalibration).not.toHaveBeenCalled();

		const sidecarIdle = defaultSidecar({ isCameraReady: false });
		createActions(preferences, {
			sidecar: sidecarIdle,
			reminders,
		}).applySettingsProfile({
			cameraDevice: { id: "cam-b", index: 1, name: "Sofa" },
		});
		expect(sidecarIdle.restartCamera).not.toHaveBeenCalled();
	});

	it("applySettingsProfile skips EAR cancel when identity fields are unchanged", () => {
		const preferences = new PreferencesService(createStore());
		preferences.set("earCalibration", 0.3);
		preferences.set("calibrationAt", 1_700_000_000_000);
		preferences.set("classifierBias", 0.1);
		preferences.set("classifierThreshold", 0.25);
		const sidecar = defaultSidecar();
		const reminders = {
			applyReminderInterval: vi.fn(),
			syncCameraLoopForMgdMode: vi.fn(),
		};
		const actions = createActions(preferences, { sidecar, reminders });

		actions.applySettingsProfile({
			cameraQuality: "high",
			earCalibration: 0.3,
			calibrationAt: 1_700_000_000_000,
			classifierBias: 0.1,
			classifierThreshold: 0.25,
		});

		expect(sidecar.cancelEarCalibration).not.toHaveBeenCalled();
		expect(sidecar.applySessionConfig).toHaveBeenCalledOnce();
	});
});

describe("PreferenceActions.appendPauseAppFromLastExternal", () => {
	it("persists, echoes prefs, recomputes, and rebuilds the tray on success", () => {
		const preferences = new PreferencesService(createStore());
		const focusPause = {
			lastExternalForeground: vi.fn(() => ({
				processName: "Zoom.exe",
				windowTitle: "Meeting",
			})),
			recompute: vi.fn(),
		};
		const windows = { sendPreferences: vi.fn() };
		const tray = { rebuildMenu: vi.fn() };
		const actions = createActions(preferences, {
			focusPause,
			windows,
			tray,
		});

		expect(actions.appendPauseAppFromLastExternal()).toBe(true);
		expect(preferences.current.pauseAppRules).toEqual([
			{ processName: "Zoom.exe", windowTitle: "" },
		]);
		expect(focusPause.recompute).toHaveBeenCalledOnce();
		expect(windows.sendPreferences).toHaveBeenCalledOnce();
		expect(tray.rebuildMenu).toHaveBeenCalledOnce();
		expect(preferences.current.isTracking).toBe(false);
	});

	it("no-ops when last external has no process", () => {
		const preferences = new PreferencesService(createStore());
		const focusPause = {
			lastExternalForeground: vi.fn(() => ({
				processName: "",
				windowTitle: "Only title",
			})),
			recompute: vi.fn(),
		};
		const windows = { sendPreferences: vi.fn() };
		const tray = { rebuildMenu: vi.fn() };
		const actions = createActions(preferences, {
			focusPause,
			windows,
			tray,
		});

		expect(actions.appendPauseAppFromLastExternal()).toBe(false);
		expect(preferences.current.pauseAppRules).toEqual([]);
		expect(windows.sendPreferences).not.toHaveBeenCalled();
		expect(focusPause.recompute).not.toHaveBeenCalled();
		expect(tray.rebuildMenu).not.toHaveBeenCalled();
	});
});
