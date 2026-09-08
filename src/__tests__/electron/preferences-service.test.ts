import { describe, expect, it, vi } from "vitest";
import type { PreferenceStore } from "../../../electron/application/ports/preference-store";
import { PreferencesService } from "../../../electron/application/preferences-service";
import {
	DEFAULT_PREFERENCES,
	type PersistedPreferences,
} from "../../../shared/preferences";

class FakePreferenceStore implements PreferenceStore {
	private readonly data = new Map<string, unknown>();
	readonly setCounts = new Map<string, number>();

	get<T>(key: string, defaultValue?: T): T {
		if (this.data.has(key)) return this.data.get(key) as T;
		return defaultValue as T;
	}

	set<T>(key: string, value: T): void {
		this.data.set(key, value);
		this.setCounts.set(key, (this.setCounts.get(key) ?? 0) + 1);
	}

	has(key: string): boolean {
		return this.data.has(key);
	}

	delete(key: string): void {
		this.data.delete(key);
	}

	clear(): void {
		this.data.clear();
	}
}

describe("PreferencesService", () => {
	it("loads defaults when the store is empty", () => {
		const service = new PreferencesService(new FakePreferenceStore());

		expect(service.current.reminderInterval).toBe(
			DEFAULT_PREFERENCES.reminderInterval,
		);
		expect(service.current.blinkPromptProfile).toBe("standard");
		expect(service.current.microBreakInterval).toBe(30_000);
		expect(service.current.isTracking).toBe(false);
		expect(service.current.launchAtLogin).toBe(false);
		expect(service.current.hasCompletedOnboarding).toBe(false);
		expect(service.current.appearance).toBe(DEFAULT_PREFERENCES.appearance);
		expect(service.current.cameraQuality).toBe(
			DEFAULT_PREFERENCES.cameraQuality,
		);
		expect(service.current.autoStopNoFaceEnabled).toBe(true);
		expect(service.current.autoStopNoFaceMinutes).toBe(2);
	});

	it("migrates upgrades to hasCompletedOnboarding when other prefs exist", () => {
		const store = new FakePreferenceStore();
		store.set("keyboardShortcut", "Ctrl+B");

		const service = new PreferencesService(store);

		expect(service.current.hasCompletedOnboarding).toBe(true);
		expect(store.get("hasCompletedOnboarding")).toBe(true);
	});

	it("migrates legacy keyboardShortcut into keyboardShortcuts.trackingToggle", () => {
		const store = new FakePreferenceStore();
		store.set("keyboardShortcut", "Ctrl+B");
		store.set("hasCompletedOnboarding", true);

		const service = new PreferencesService(store);

		expect(service.current.keyboardShortcuts).toEqual({
			...DEFAULT_PREFERENCES.keyboardShortcuts,
			trackingToggle: "Ctrl+B",
		});
		expect(store.get("keyboardShortcuts")).toEqual({
			...DEFAULT_PREFERENCES.keyboardShortcuts,
			trackingToggle: "Ctrl+B",
		});
	});

	it("keeps first-run onboarding when the store is empty", () => {
		const store = new FakePreferenceStore();
		const service = new PreferencesService(store);

		expect(service.current.hasCompletedOnboarding).toBe(false);
		expect(store.has("hasCompletedOnboarding")).toBe(false);
		expect(store.has("appearance")).toBe(false);
		expect(service.current.appearance).toBe("system");
	});

	it("maps legacy darkMode true/false to Dark/Light and drops the boolean", () => {
		const darkStore = new FakePreferenceStore();
		darkStore.set("darkMode", true);
		darkStore.set("hasCompletedOnboarding", true);
		const darkService = new PreferencesService(darkStore);
		expect(darkService.current.appearance).toBe("dark");
		expect(darkStore.get("appearance")).toBe("dark");
		expect(darkStore.has("darkMode")).toBe(false);

		const lightStore = new FakePreferenceStore();
		lightStore.set("darkMode", false);
		lightStore.set("hasCompletedOnboarding", true);
		const lightService = new PreferencesService(lightStore);
		expect(lightService.current.appearance).toBe("light");
		expect(lightStore.get("appearance")).toBe("light");
		expect(lightStore.has("darkMode")).toBe(false);
	});

	it("does not overwrite a stored appearance with leftover darkMode", () => {
		const store = new FakePreferenceStore();
		store.set("appearance", "system");
		store.set("darkMode", true);
		store.set("hasCompletedOnboarding", true);
		const service = new PreferencesService(store);
		expect(service.current.appearance).toBe("system");
		expect(store.has("darkMode")).toBe(true);
	});

	it("respects an explicit hasCompletedOnboarding false on upgrade-shaped stores", () => {
		const store = new FakePreferenceStore();
		store.set("keyboardShortcut", "Ctrl+B");
		store.set("hasCompletedOnboarding", false);

		const service = new PreferencesService(store);

		expect(service.current.hasCompletedOnboarding).toBe(false);
	});

	it("hydrates persisted values from the store", () => {
		const store = new FakePreferenceStore();
		store.set("reminderInterval", 5000);
		store.set("blinkPromptProfile", "gentle");
		store.set("microBreakInterval", 60_000);
		store.set("appearance", "light");
		store.set("cameraQuality", "high");
		store.set("earCalibration", 0.31);
		store.set("launchAtLogin", true);
		store.set("isTracking", true);

		const service = new PreferencesService(store);

		expect(service.current.reminderInterval).toBe(5000);
		expect(service.current.blinkPromptProfile).toBe("gentle");
		expect(service.current.microBreakInterval).toBe(60_000);
		expect(service.current.appearance).toBe("light");
		expect(service.current.cameraQuality).toBe("high");
		expect(service.current.earCalibration).toBe(0.31);
		expect(service.current.calibrationAt).toBeNull();
		expect(service.current.classifierBias).toBeNull();
		expect(service.current.launchAtLogin).toBe(true);
		expect(service.current.isTracking).toBe(true);
		expect(service.current.popupMessage).toBe(DEFAULT_PREFERENCES.popupMessage);
	});

	it("defaults missing microBreakInterval to 30s without copying reminderInterval", () => {
		const store = new FakePreferenceStore();
		store.set("reminderInterval", 5_000);

		const service = new PreferencesService(store);

		expect(service.current.reminderInterval).toBe(5_000);
		expect(service.current.microBreakInterval).toBe(30_000);
		expect(service.current.blinkPromptProfile).toBe("standard");
	});

	it("sanitizes invalid blinkPromptProfile and clamps microBreakInterval on hydrate", () => {
		const store = new FakePreferenceStore();
		store.set("blinkPromptProfile", "loud");
		store.set("microBreakInterval", 5_000);
		store.set("reminderInterval", 500);

		const service = new PreferencesService(store);

		expect(service.current.blinkPromptProfile).toBe("standard");
		expect(service.current.microBreakInterval).toBe(15_000);
		expect(service.current.reminderInterval).toBe(1_000);
	});

	it("falls back to medium when cameraQuality in the store is invalid", () => {
		const store = new FakePreferenceStore();
		store.set("cameraQuality", "turbo");

		const service = new PreferencesService(store);

		expect(service.current.cameraQuality).toBe("medium");
	});

	it("falls back to overlay when notificationStyle in the store is invalid", () => {
		const store = new FakePreferenceStore();
		store.set("notificationStyle", "toast");

		const service = new PreferencesService(store);

		expect(service.current.notificationStyle).toBe("overlay");
	});

	it("sanitizes invalid notificationStyle on set()", () => {
		const store = new FakePreferenceStore();
		const service = new PreferencesService(store);

		service.set("notificationStyle", "native");
		expect(service.current.notificationStyle).toBe("native");

		service.set("notificationStyle", "toast" as never);

		expect(service.current.notificationStyle).toBe("overlay");
		expect(store.get("notificationStyle")).toBe("overlay");
	});

	it("sanitizes invalid locale to en", () => {
		const store = new FakePreferenceStore();
		store.set("locale", "de");

		const service = new PreferencesService(store);

		expect(service.current.locale).toBe("en");
	});

	it("persists a valid locale", () => {
		const store = new FakePreferenceStore();
		store.set("locale", "uk");

		const service = new PreferencesService(store);

		expect(service.current.locale).toBe("uk");
		service.set("locale", "en");
		expect(service.current.locale).toBe("en");
	});

	it("sanitizes empty or invalid exercisePrompts on load", () => {
		const store = new FakePreferenceStore();
		store.set("exercisePrompts", []);

		const service = new PreferencesService(store);

		expect(service.current.exercisePrompts).toEqual(
			DEFAULT_PREFERENCES.exercisePrompts,
		);
		expect(service.current.exercisePrompts).toHaveLength(4);
	});

	it("sanitizes exercisePrompts on set()", () => {
		const store = new FakePreferenceStore();
		const service = new PreferencesService(store);

		service.set("exercisePrompts", ["  Custom stretch  ", ""]);

		expect(service.current.exercisePrompts).toEqual(["Custom stretch"]);
		expect(store.get("exercisePrompts")).toEqual(["Custom stretch"]);

		service.set("exercisePrompts", []);
		expect(service.current.exercisePrompts).toEqual(
			DEFAULT_PREFERENCES.exercisePrompts,
		);
	});

	it("sanitizes lookAwayTitle and lookAwayHint on set()", () => {
		const store = new FakePreferenceStore();
		const service = new PreferencesService(store);

		service.set("lookAwayTitle", "  Far focus  ");
		service.set("lookAwayHint", "  Soft gaze  ");
		expect(service.current.lookAwayTitle).toBe("Far focus");
		expect(service.current.lookAwayHint).toBe("Soft gaze");

		service.set("lookAwayTitle", "   ");
		service.set("lookAwayHint", "");
		expect(service.current.lookAwayTitle).toBe(
			DEFAULT_PREFERENCES.lookAwayTitle,
		);
		expect(service.current.lookAwayHint).toBe(DEFAULT_PREFERENCES.lookAwayHint);
	});

	it("sanitizes blinkRateThresholdPerMin on load and set()", () => {
		const store = new FakePreferenceStore();
		store.set("blinkRateThresholdPerMin", 100);
		store.set("blinkRateCoachingEnabled", "yes");

		const service = new PreferencesService(store);

		expect(service.current.blinkRateThresholdPerMin).toBe(60);
		expect(service.current.blinkRateCoachingEnabled).toBe(true);

		service.set("blinkRateThresholdPerMin", 0);
		expect(service.current.blinkRateThresholdPerMin).toBe(1);
		expect(store.get("blinkRateThresholdPerMin")).toBe(1);

		service.set("blinkRateCoachingEnabled", false);
		expect(service.current.blinkRateCoachingEnabled).toBe(false);
	});

	it("clears invalid earCalibration from the store", () => {
		const store = new FakePreferenceStore();
		store.set("earCalibration", 9.9);

		const service = new PreferencesService(store);

		expect(service.current.earCalibration).toBeNull();
	});

	it("sanitizes calibration timestamps and persists a valid stamp", () => {
		const store = new FakePreferenceStore();
		store.set("earCalibration", 0.28);
		store.set("calibrationAt", "not-a-date");
		const service = new PreferencesService(store);
		expect(service.current.calibrationAt).toBeNull();

		service.set("calibrationAt", 1_700_000_000_000);
		expect(service.current.calibrationAt).toBe(1_700_000_000_000);
		expect(store.get("calibrationAt")).toBe(1_700_000_000_000);
	});

	it("clears invalid classifier overlay from the store", () => {
		const store = new FakePreferenceStore();
		store.set("classifierBias", 9);
		store.set("classifierThreshold", 0.9);

		const service = new PreferencesService(store);

		expect(service.current.classifierBias).toBeNull();
		expect(service.current.classifierThreshold).toBeNull();
	});

	it("persists set() into both memory and the store", () => {
		const store = new FakePreferenceStore();
		const service = new PreferencesService(store);

		service.set("keyboardShortcuts", {
			...DEFAULT_PREFERENCES.keyboardShortcuts,
			trackingToggle: "Ctrl+B",
		});
		service.set("cameraQuality", "performance");
		service.set("earCalibration", 0.28);
		service.set("classifierBias", 0.4);
		service.set("classifierThreshold", 0.2);
		service.set("launchAtLogin", true);
		service.set("isTracking", true);

		expect(service.current.keyboardShortcuts.trackingToggle).toBe("Ctrl+B");
		expect(store.get("keyboardShortcuts")).toEqual({
			...DEFAULT_PREFERENCES.keyboardShortcuts,
			trackingToggle: "Ctrl+B",
		});
		expect(service.current.cameraQuality).toBe("performance");
		expect(store.get("cameraQuality")).toBe("performance");
		expect(service.current.earCalibration).toBe(0.28);
		expect(store.get("earCalibration")).toBe(0.28);
		expect(service.current.classifierBias).toBe(0.4);
		expect(store.get("classifierBias")).toBe(0.4);
		expect(service.current.classifierThreshold).toBe(0.2);
		expect(store.get("classifierThreshold")).toBe(0.2);
		expect(service.current.launchAtLogin).toBe(true);
		expect(store.get("launchAtLogin")).toBe(true);
		expect(service.current.isTracking).toBe(true);
		expect(store.get("isTracking")).toBe(true);
	});

	it("no-ops set() when the sanitized value is unchanged", () => {
		const store = new FakePreferenceStore();
		const service = new PreferencesService(store);

		service.set("appearance", DEFAULT_PREFERENCES.appearance);
		expect(store.setCounts.get("appearance") ?? 0).toBe(0);

		service.set("appearance", "dark");
		expect(store.setCounts.get("appearance")).toBe(1);
		service.set("appearance", "dark");
		expect(store.setCounts.get("appearance")).toBe(1);

		service.set("exercisePrompts", [...service.current.exercisePrompts]);
		expect(store.setCounts.get("exercisePrompts") ?? 0).toBe(0);

		service.set("autoStopNoFaceMinutes", 2);
		expect(store.setCounts.get("autoStopNoFaceMinutes") ?? 0).toBe(0);
		service.set("autoStopNoFaceMinutes", 99);
		expect(service.current.autoStopNoFaceMinutes).toBe(30);
		expect(store.setCounts.get("autoStopNoFaceMinutes")).toBe(1);

		service.set("snoozeMinutes", 5);
		expect(store.setCounts.get("snoozeMinutes") ?? 0).toBe(0);
		service.set("snoozeMinutes", 99);
		expect(service.current.snoozeMinutes).toBe(30);
		expect(store.setCounts.get("snoozeMinutes")).toBe(1);

		service.set("soundVolume", 100);
		expect(store.setCounts.get("soundVolume") ?? 0).toBe(0);
		service.set("soundVolume", 50);
		expect(service.current.soundVolume).toBe(50);
		expect(store.setCounts.get("soundVolume")).toBe(1);
		service.set("soundVolume", 150);
		expect(service.current.soundVolume).toBe(100);
		expect(store.setCounts.get("soundVolume")).toBe(2);

		service.set("pauseAppRules", []);
		expect(store.setCounts.get("pauseAppRules") ?? 0).toBe(0);

		service.set("cameraDevice", null);
		expect(store.setCounts.get("cameraDevice") ?? 0).toBe(0);
		service.set("cameraDevice", { id: "pnp-1", index: 1, name: "USB" });
		expect(store.setCounts.get("cameraDevice")).toBe(1);
		service.set("cameraDevice", { id: "pnp-1", index: 1, name: "USB" });
		expect(store.setCounts.get("cameraDevice")).toBe(1);

		service.set("popupPositionsByDisplayId", {});
		expect(store.setCounts.get("popupPositionsByDisplayId") ?? 0).toBe(0);
		service.set("popupPositionsByDisplayId", { "1": { x: 10, y: 20 } });
		expect(store.setCounts.get("popupPositionsByDisplayId")).toBe(1);
		service.set("popupPositionsByDisplayId", { "1": { x: 10, y: 20 } });
		expect(store.setCounts.get("popupPositionsByDisplayId")).toBe(1);

		service.set("popupSizesByDisplayId", {});
		expect(store.setCounts.get("popupSizesByDisplayId") ?? 0).toBe(0);
		service.set("popupSizesByDisplayId", { "1": { width: 320, height: 140 } });
		expect(store.setCounts.get("popupSizesByDisplayId")).toBe(1);
		service.set("popupSizesByDisplayId", { "1": { width: 320, height: 140 } });
		expect(store.setCounts.get("popupSizesByDisplayId")).toBe(1);
	});

	it("sanitizes invalid autoStopNoFaceMinutes on hydrate", () => {
		const store = new FakePreferenceStore();
		store.set("autoStopNoFaceMinutes", 0);
		store.set("autoStopNoFaceEnabled", "yes");

		const service = new PreferencesService(store);

		expect(service.current.autoStopNoFaceMinutes).toBe(1);
		expect(service.current.autoStopNoFaceEnabled).toBe(true);
	});

	it("defaults missing snoozeMinutes to 5 on hydrate", () => {
		const store = new FakePreferenceStore();
		const service = new PreferencesService(store);
		expect(service.current.snoozeMinutes).toBe(5);
	});

	it("sanitizes invalid snoozeMinutes on hydrate", () => {
		const store = new FakePreferenceStore();
		store.set("snoozeMinutes", 0);

		const service = new PreferencesService(store);

		expect(service.current.snoozeMinutes).toBe(1);
	});

	it("sanitizes invalid soundVolume on hydrate", () => {
		const store = new FakePreferenceStore();
		store.set("soundVolume", -20);

		const service = new PreferencesService(store);

		expect(service.current.soundVolume).toBe(0);
	});

	it("reset clears the store and restores defaults with a popup position", () => {
		const store = new FakePreferenceStore();
		store.set("reminderInterval", 9000);
		store.set("soundEnabled", true);
		store.set("cameraQuality", "high");
		store.set("earCalibration", 0.33);
		store.set("launchAtLogin", true);
		store.set("isTracking", true);
		const service = new PreferencesService(store);

		const popupPosition: PersistedPreferences["popupPosition"] = {
			x: 40,
			y: 80,
		};
		service.reset(popupPosition);

		expect(store.has("reminderInterval")).toBe(false);
		expect(service.current.reminderInterval).toBe(
			DEFAULT_PREFERENCES.reminderInterval,
		);
		expect(service.current.popupPosition).toEqual(popupPosition);
		expect(service.current.popupPositionsByDisplayId).toEqual({});
		expect(service.current.popupSizesByDisplayId).toEqual({});
		expect(service.current.popupSize).toEqual(DEFAULT_PREFERENCES.popupSize);
		expect(service.current.isTracking).toBe(false);
		expect(service.current.launchAtLogin).toBe(false);
		expect(service.current.hasCompletedOnboarding).toBe(true);
		expect(store.get("hasCompletedOnboarding")).toBe(true);
		expect(service.current.soundEnabled).toBe(DEFAULT_PREFERENCES.soundEnabled);
		expect(service.current.soundVolume).toBe(DEFAULT_PREFERENCES.soundVolume);
		expect(service.current.cameraQuality).toBe(
			DEFAULT_PREFERENCES.cameraQuality,
		);
		expect(service.current.earCalibration).toBeNull();
		expect(service.current.calibrationAt).toBeNull();
		expect(service.current.classifierBias).toBeNull();
		expect(service.current.classifierThreshold).toBeNull();
	});

	it("reset can clear popupPosition so defaults follow the active display", () => {
		const store = new FakePreferenceStore();
		store.set("popupPosition", { x: 40, y: 80 });
		const service = new PreferencesService(store);

		service.reset(null);

		expect(service.current.popupPosition).toBeNull();
		expect(service.current.popupPositionsByDisplayId).toEqual({});
		expect(service.current.popupSizesByDisplayId).toEqual({});
		expect(service.current.popupSize).toEqual(DEFAULT_PREFERENCES.popupSize);
	});

	it("seedPopupPositionsFromLegacy writes the map once from popupPosition", () => {
		const store = new FakePreferenceStore();
		store.set("popupPosition", { x: 40, y: 80 });
		const service = new PreferencesService(store);

		expect(service.seedPopupPositionsFromLegacy("1")).toBe(true);
		expect(service.current.popupPositionsByDisplayId).toEqual({
			"1": { x: 40, y: 80 },
		});
		expect(service.seedPopupPositionsFromLegacy("1")).toBe(false);
		expect(service.seedPopupPositionsFromLegacy("99")).toBe(false);
	});

	it("seedPopupSizesFromPositionIds writes sizes once from popupSize", () => {
		const store = new FakePreferenceStore();
		store.set("popupSize", { width: 320, height: 140 });
		store.set("popupPositionsByDisplayId", { "1": { x: 40, y: 80 } });
		const service = new PreferencesService(store);

		expect(service.seedPopupSizesFromPositionIds()).toBe(true);
		expect(service.current.popupSizesByDisplayId).toEqual({
			"1": { width: 320, height: 140 },
		});
		expect(service.seedPopupSizesFromPositionIds()).toBe(false);
	});

	it("reset with replayOnboarding leaves first-run incomplete", () => {
		const store = new FakePreferenceStore();
		store.set("hasCompletedOnboarding", true);
		const service = new PreferencesService(store);

		service.reset(null, { replayOnboarding: true });

		expect(service.current.hasCompletedOnboarding).toBe(false);
		expect(store.has("hasCompletedOnboarding")).toBe(false);
	});

	it("replaceFromBackup restores key prefs and forces isTracking false", () => {
		const store = new FakePreferenceStore();
		store.set("appearance", "dark");
		store.set("locale", "en");
		const service = new PreferencesService(store);

		service.replaceFromBackup({
			...DEFAULT_PREFERENCES,
			appearance: "light",
			locale: "uk",
			reminderInterval: 7000,
			keyboardShortcuts: {
				...DEFAULT_PREFERENCES.keyboardShortcuts,
				trackingToggle: "Ctrl+B",
			},
			isTracking: true,
			hasCompletedOnboarding: true,
			cameraQuality: "high",
			dailyBlinkGoal: 100,
		});

		expect(service.current.appearance).toBe("light");
		expect(service.current.locale).toBe("uk");
		expect(service.current.reminderInterval).toBe(7000);
		expect(service.current.keyboardShortcuts.trackingToggle).toBe("Ctrl+B");
		expect(service.current.isTracking).toBe(false);
		expect(service.current.hasCompletedOnboarding).toBe(true);
		expect(service.current.cameraQuality).toBe("high");
		expect(service.current.dailyBlinkGoal).toBe(100);
		expect(store.get("isTracking")).toBe(false);
		expect(store.get("locale")).toBe("uk");
	});

	it("replaceFromBackup clamps invalid fields instead of rejecting", () => {
		const store = new FakePreferenceStore();
		const service = new PreferencesService(store);

		service.replaceFromBackup({
			...DEFAULT_PREFERENCES,
			autoStopNoFaceMinutes: 99,
			snoozeMinutes: 99,
			soundVolume: -5,
			cameraQuality: "turbo" as never,
		});

		expect(service.current.autoStopNoFaceMinutes).toBe(30);
		expect(service.current.snoozeMinutes).toBe(30);
		expect(service.current.soundVolume).toBe(0);
		expect(service.current.cameraQuality).toBe(
			DEFAULT_PREFERENCES.cameraQuality,
		);
	});

	it("sanitizes pauseAppRules on set() and hydrates missing to []", () => {
		const store = new FakePreferenceStore();
		const service = new PreferencesService(store);
		expect(service.current.pauseAppRules).toEqual([]);

		service.set("pauseAppRules", [
			{ processName: "  zoom  ", windowTitle: "" },
			{ processName: "", windowTitle: "  " },
		] as never);
		expect(service.current.pauseAppRules).toEqual([
			{ processName: "zoom", windowTitle: "" },
		]);
		expect(store.get("pauseAppRules")).toEqual([
			{ processName: "zoom", windowTitle: "" },
		]);

		service.set("pauseAppRules", [{ processName: "zoom", windowTitle: "" }]);
		expect(store.setCounts.get("pauseAppRules")).toBe(1);

		service.set("pauseAppRules", [{ processName: "", windowTitle: "" }]);
		expect(service.current.pauseAppRules).toEqual([]);
	});

	it("sanitizes quietHoursByWeekday on set() and hydrates missing to {}", () => {
		const store = new FakePreferenceStore();
		const service = new PreferencesService(store);
		expect(service.current.quietHoursByWeekday).toEqual({});

		service.set("quietHoursByWeekday", {
			sat: { mode: "off" },
			fri: { mode: "custom", start: "24:00", end: "08:00" },
			mon: { mode: "default" },
			__proto__: { mode: "off" },
		} as never);
		expect(service.current.quietHoursByWeekday).toEqual({
			sat: { mode: "off" },
		});
		expect(store.get("quietHoursByWeekday")).toEqual({
			sat: { mode: "off" },
		});

		service.set("quietHoursByWeekday", { sat: { mode: "off" } });
		expect(store.setCounts.get("quietHoursByWeekday")).toBe(1);

		service.set("quietHoursByWeekday", "garbage" as never);
		expect(service.current.quietHoursByWeekday).toEqual({});
	});

	it("applyProfileSnapshot writes only SNAPSHOT_KEYS and never clears the store", () => {
		const store = new FakePreferenceStore();
		store.clear = vi.fn(store.clear.bind(store));
		const service = new PreferencesService(store);
		service.set("locale", "uk");
		service.set("appearance", "light");
		service.set("isTracking", true);
		service.set("launchAtLogin", true);
		service.set("hasCompletedOnboarding", true);
		service.set("goalsEnabled", true);
		service.set("dailyBlinkGoal", 80);
		service.set("popupMessage", "Keep blinking");
		service.set("popupColors", {
			...DEFAULT_PREFERENCES.popupColors,
			transparency: 0.4,
		});
		service.set("eyeCareIndependentOfTracking", false);
		service.set("autoStopNoFaceEnabled", false);
		service.set("autoStopNoFaceMinutes", 5);
		service.set("reminderInterval", 2000);

		const clearSpy = store.clear as ReturnType<typeof vi.fn>;
		clearSpy.mockClear();

		service.applyProfileSnapshot({
			reminderInterval: 7000,
			blinkPromptProfile: "strong",
			cameraEnabled: true,
			earCalibration: 0.3,
			calibrationAt: 1_700_000_000_000,
			locale: "en",
			isTracking: false,
			hasCompletedOnboarding: false,
			goalsEnabled: false,
			dailyBlinkGoal: 1,
			popupMessage: "Hacked",
			unknownKey: true,
		});

		expect(clearSpy).not.toHaveBeenCalled();
		expect(service.current.reminderInterval).toBe(7000);
		expect(service.current.blinkPromptProfile).toBe("strong");
		expect(service.current.cameraEnabled).toBe(true);
		expect(service.current.earCalibration).toBe(0.3);
		expect(service.current.locale).toBe("uk");
		expect(service.current.appearance).toBe("light");
		expect(service.current.isTracking).toBe(true);
		expect(service.current.launchAtLogin).toBe(true);
		expect(service.current.hasCompletedOnboarding).toBe(true);
		expect(service.current.goalsEnabled).toBe(true);
		expect(service.current.dailyBlinkGoal).toBe(80);
		expect(service.current.popupMessage).toBe("Keep blinking");
		expect(service.current.popupColors.transparency).toBe(0.4);
		expect(service.current.eyeCareIndependentOfTracking).toBe(false);
		expect(service.current.autoStopNoFaceEnabled).toBe(false);
		expect(service.current.autoStopNoFaceMinutes).toBe(5);
		expect(Object.hasOwn(service.current, "unknownKey")).toBe(false);
	});
});
