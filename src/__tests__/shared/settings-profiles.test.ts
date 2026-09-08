import { describe, expect, it } from "vitest";
import {
	DEFAULT_PREFERENCES,
	type PersistedPreferences,
} from "../../../shared/preferences";
import {
	captureSettingsProfilePrefs,
	overlaySettingsProfilePrefs,
	SETTINGS_PROFILE_CAP,
	SNAPSHOT_KEYS,
	sameSettingsProfilePrefs,
	sanitizeSettingsProfileName,
	sanitizeSettingsProfilesState,
} from "../../../shared/settings-profiles";

const EXCLUDED_KEYS = [
	"keyboardShortcuts",
	"locale",
	"darkMode",
	"launchAtLogin",
	"hasCompletedOnboarding",
	"isTracking",
	"popupPosition",
	"popupPositionsByDisplayId",
	"popupSize",
	"popupSizesByDisplayId",
	"exercisePrompts",
	"popupMessage",
	"lookAwayTitle",
	"lookAwayHint",
	"popupColors",
	"eyeCareIndependentOfTracking",
	"autoStopNoFaceEnabled",
	"autoStopNoFaceMinutes",
	"goalsEnabled",
	"dailyBlinkGoal",
	"dailyTrackingMinutesGoal",
	"weeklyBlinkGoal",
	"weeklyTrackingMinutesGoal",
] as const satisfies readonly (keyof PersistedPreferences)[];

describe("settings-profiles shared helpers", () => {
	it("SNAPSHOT_KEYS includes EAR/classifier + blinkPromptProfile and excludes identity/geometry/goals", () => {
		expect(SNAPSHOT_KEYS).toContain("earCalibration");
		expect(SNAPSHOT_KEYS).toContain("classifierBias");
		expect(SNAPSHOT_KEYS).toContain("classifierThreshold");
		expect(SNAPSHOT_KEYS).toContain("calibrationAt");
		expect(SNAPSHOT_KEYS).toContain("blinkPromptProfile");
		for (const key of EXCLUDED_KEYS) {
			expect(SNAPSHOT_KEYS).not.toContain(key);
		}
	});

	it("capture includes every SNAPSHOT_KEYS member and omits excluded keys", () => {
		const live: PersistedPreferences = {
			...DEFAULT_PREFERENCES,
			reminderInterval: 4000,
			blinkPromptProfile: "strong",
			earCalibration: 0.28,
			calibrationAt: 1_700_000_000_000,
			locale: "uk",
			isTracking: true,
			darkMode: false,
			goalsEnabled: true,
			dailyBlinkGoal: 999,
		};
		const captured = captureSettingsProfilePrefs(live);
		for (const key of SNAPSHOT_KEYS) {
			expect(captured).toHaveProperty(key);
		}
		expect(captured.reminderInterval).toBe(4000);
		expect(captured.blinkPromptProfile).toBe("strong");
		expect(captured.earCalibration).toBe(0.28);
		for (const key of EXCLUDED_KEYS) {
			expect(Object.hasOwn(captured, key)).toBe(false);
		}
	});

	it("capture → overlay → sameSettingsProfilePrefs round-trips snapshot keys", () => {
		const live: PersistedPreferences = {
			...DEFAULT_PREFERENCES,
			cameraEnabled: true,
			reminderInterval: 3500,
			microBreakInterval: 45_000,
			blinkPromptProfile: "gentle",
			quietHoursEnabled: true,
			snoozeMinutes: 10,
			locale: "uk",
			isTracking: true,
			darkMode: false,
		};
		const captured = captureSettingsProfilePrefs(live);
		const overlaid = overlaySettingsProfilePrefs(DEFAULT_PREFERENCES, captured);
		const again = captureSettingsProfilePrefs(overlaid);
		expect(sameSettingsProfilePrefs(captured, again)).toBe(true);
		expect(overlaid.locale).toBe(DEFAULT_PREFERENCES.locale);
		expect(overlaid.isTracking).toBe(DEFAULT_PREFERENCES.isTracking);
		expect(overlaid.darkMode).toBe(DEFAULT_PREFERENCES.darkMode);
	});

	it("overlay keeps excluded live keys and drops unknown snapshot keys", () => {
		const live: PersistedPreferences = {
			...DEFAULT_PREFERENCES,
			locale: "uk",
			isTracking: true,
			darkMode: false,
			hasCompletedOnboarding: true,
			goalsEnabled: true,
			dailyBlinkGoal: 50,
			popupMessage: "Custom",
		};
		const next = overlaySettingsProfilePrefs(live, {
			reminderInterval: 2000,
			hasCompletedOnboarding: false,
			isTracking: false,
			locale: "en",
			goalsEnabled: false,
			dailyBlinkGoal: 1,
			unknownKey: "drop-me",
		});
		expect(next.reminderInterval).toBe(2000);
		expect(next.locale).toBe("uk");
		expect(next.isTracking).toBe(true);
		expect(next.hasCompletedOnboarding).toBe(true);
		expect(next.goalsEnabled).toBe(true);
		expect(next.dailyBlinkGoal).toBe(50);
		expect(next.popupMessage).toBe("Custom");
		expect(Object.hasOwn(next, "unknownKey")).toBe(false);
	});

	it("sanitizeSettingsProfilesState drops unknown envelope keys and caps at 5", () => {
		const profiles = Array.from({ length: 7 }, (_, i) => ({
			id: `id-${i}`,
			name: `Setup ${i}`,
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			prefs: { reminderInterval: 1000 + i },
			extra: "drop",
		}));
		const state = sanitizeSettingsProfilesState({
			version: 99,
			activeProfileId: "id-0",
			profiles,
			hacked: true,
		});
		expect(state.version).toBe(1);
		expect(state.profiles).toHaveLength(SETTINGS_PROFILE_CAP);
		expect(state.activeProfileId).toBe("id-0");
		expect(Object.hasOwn(state, "hacked")).toBe(false);
		expect(state.profiles[0]?.prefs.reminderInterval).toBe(1000);
	});

	it("sanitizeSettingsProfilesState does not throw on corrupt envelopes", () => {
		expect(() => sanitizeSettingsProfilesState(null)).not.toThrow();
		expect(() => sanitizeSettingsProfilesState("nope")).not.toThrow();
		expect(() => sanitizeSettingsProfilesState([])).not.toThrow();
		expect(() =>
			sanitizeSettingsProfilesState({
				profiles: [null, 42, { id: "" }, { id: "ok", name: "  " }],
			}),
		).not.toThrow();
		expect(sanitizeSettingsProfilesState(null)).toEqual({
			version: 1,
			activeProfileId: null,
			profiles: [],
		});
		expect(
			sanitizeSettingsProfilesState({
				activeProfileId: "missing",
				profiles: [{ id: "a", name: "Desk", prefs: {} }],
			}).activeProfileId,
		).toBeNull();
	});

	it("sanitizeSettingsProfileName trims, collapses whitespace, clamps length", () => {
		expect(sanitizeSettingsProfileName("  Desk   Mode  ")).toBe("Desk Mode");
		expect(sanitizeSettingsProfileName("")).toBeNull();
		expect(sanitizeSettingsProfileName("   ")).toBeNull();
		expect(sanitizeSettingsProfileName("a".repeat(50))).toBe("a".repeat(40));
		expect(sanitizeSettingsProfileName("Hi\u0000there")).toBe("Hithere");
	});
});
