import { describe, expect, it } from "vitest";
import {
	BACKUP_SCHEMA,
	BACKUP_VERSION,
	buildBackupDocument,
	parseBackupDocument,
} from "../../../shared/backup";
import { DEFAULT_BLINK_STATS } from "../../../shared/blink-stats";
import {
	DEFAULT_PREFERENCES,
	type PersistedPreferences,
} from "../../../shared/preferences";
import {
	captureSettingsProfilePrefs,
	type SettingsProfilesState,
} from "../../../shared/settings-profiles";

function sampleProfilesState(): SettingsProfilesState {
	const prefs = captureSettingsProfilePrefs({
		...DEFAULT_PREFERENCES,
		reminderInterval: 4000,
		cameraEnabled: true,
	});
	return {
		version: 1,
		activeProfileId: "profile-desk",
		profiles: [
			{
				id: "profile-desk",
				name: "Desk",
				createdAt: "2026-08-01T00:00:00.000Z",
				updatedAt: "2026-08-01T00:00:00.000Z",
				prefs,
			},
			{
				id: "profile-sofa",
				name: "Sofa",
				createdAt: "2026-08-02T00:00:00.000Z",
				updatedAt: "2026-08-02T00:00:00.000Z",
				prefs: captureSettingsProfilePrefs({
					...DEFAULT_PREFERENCES,
					reminderInterval: 5000,
				}),
			},
		],
	};
}

describe("backup document", () => {
	it("round-trips preferences and statistics through build + parse", () => {
		const preferences: PersistedPreferences = {
			...DEFAULT_PREFERENCES,
			darkMode: false,
			locale: "uk",
			reminderInterval: 5000,
			isTracking: true,
			hasCompletedOnboarding: true,
		};
		const blinkStats = {
			...DEFAULT_BLINK_STATS,
			days: [
				{
					date: "2026-08-01",
					blinks: 12,
					trackingMs: 60_000,
					sessions: 1,
					hourlyBlinks: Array.from({ length: 24 }, () => 0),
					lookAwayCompleted: 3,
					lookAwaySkipped: 1,
					lookAwaySnoozed: 0,
					exerciseCompleted: 2,
					exerciseSkipped: 1,
					exerciseSnoozed: 0,
				},
			],
			totalBlinks: 12,
			spentBlinks: 2,
			unlockedRewardIds: ["statsFlair" as const],
			unlockedAchievementIds: ["firstBlink" as const],
			streakShieldCharges: 1,
			streakShieldUsedDates: ["2026-07-30"],
		};

		const document = buildBackupDocument({
			scope: "both",
			appVersion: "1.2.3",
			exportedAt: new Date("2026-08-09T00:00:00.000Z"),
			preferences,
			blinkStats,
		});

		expect(document.schema).toBe(BACKUP_SCHEMA);
		expect(document.version).toBe(BACKUP_VERSION);
		expect(document.scope).toBe("both");

		const parsed = parseBackupDocument(document, "both");
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;

		expect(parsed.value.preferences?.darkMode).toBe(false);
		expect(parsed.value.preferences?.locale).toBe("uk");
		expect(parsed.value.preferences?.reminderInterval).toBe(5000);
		expect(parsed.value.preferences?.isTracking).toBe(false);
		expect(parsed.value.blinkStats?.totalBlinks).toBe(12);
		expect(parsed.value.blinkStats?.days[0]?.blinks).toBe(12);
		expect(parsed.value.blinkStats?.days[0]?.lookAwayCompleted).toBe(3);
		expect(parsed.value.blinkStats?.days[0]?.exerciseCompleted).toBe(2);
		expect(parsed.value.blinkStats?.unlockedRewardIds).toContain("statsFlair");
		expect(parsed.value.blinkStats?.unlockedAchievementIds).toContain(
			"firstBlink",
		);
	});

	it("round-trips settingsProfiles when setups exist", () => {
		const settingsProfiles = sampleProfilesState();
		const document = buildBackupDocument({
			scope: "preferences",
			appVersion: "2.17.0",
			preferences: { ...DEFAULT_PREFERENCES },
			settingsProfiles,
		});
		expect(document.settingsProfiles?.profiles).toHaveLength(2);
		expect(document.settingsProfiles?.activeProfileId).toBe("profile-desk");

		const parsed = parseBackupDocument(document, "preferences");
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.value.settingsProfiles?.profiles).toHaveLength(2);
		expect(parsed.value.settingsProfiles?.profiles[0]?.name).toBe("Desk");
	});

	it("omits settingsProfiles from export when empty", () => {
		const document = buildBackupDocument({
			scope: "both",
			appVersion: "2.17.0",
			preferences: { ...DEFAULT_PREFERENCES },
			blinkStats: { ...DEFAULT_BLINK_STATS, days: [] },
			settingsProfiles: {
				version: 1,
				activeProfileId: null,
				profiles: [],
			},
		});
		expect(document.settingsProfiles).toBeUndefined();
	});

	it("imports v1 backup without settingsProfiles field", () => {
		const document = buildBackupDocument({
			scope: "preferences",
			appVersion: "1.0.0",
			preferences: { ...DEFAULT_PREFERENCES, darkMode: false },
		});
		const parsed = parseBackupDocument(document, "preferences");
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.value.settingsProfiles).toBeUndefined();
		expect(parsed.value.preferences?.darkMode).toBe(false);
	});

	it("extracts settingsProfiles when importing preferences from a both-scoped file", () => {
		const settingsProfiles = sampleProfilesState();
		const document = buildBackupDocument({
			scope: "both",
			appVersion: "2.17.0",
			preferences: { ...DEFAULT_PREFERENCES },
			blinkStats: { ...DEFAULT_BLINK_STATS, days: [] },
			settingsProfiles,
		});
		const parsed = parseBackupDocument(document, "preferences");
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.value.settingsProfiles?.profiles).toHaveLength(2);
		expect(parsed.value.blinkStats).toBeUndefined();
	});

	it("truncates more than five profiles on import sanitize", () => {
		const prefs = captureSettingsProfilePrefs(DEFAULT_PREFERENCES);
		const profiles = Array.from({ length: 6 }, (_, index) => ({
			id: `profile-${index}`,
			name: `Setup ${index}`,
			createdAt: "2026-08-01T00:00:00.000Z",
			updatedAt: "2026-08-01T00:00:00.000Z",
			prefs,
		}));
		const document = buildBackupDocument({
			scope: "preferences",
			appVersion: "2.17.0",
			preferences: { ...DEFAULT_PREFERENCES },
			settingsProfiles: {
				version: 1,
				activeProfileId: "profile-5",
				profiles,
			},
		});
		const parsed = parseBackupDocument(document, "preferences");
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.value.settingsProfiles?.profiles).toHaveLength(5);
		expect(parsed.value.settingsProfiles?.activeProfileId).toBeNull();
	});

	it("rejects wrong schema or version without applying soft defaults", () => {
		expect(
			parseBackupDocument({ schema: "other", version: 1 }, "both").ok,
		).toBe(false);
		expect(
			parseBackupDocument(
				{
					schema: BACKUP_SCHEMA,
					version: 99,
					preferences: {},
					blinkStats: { days: [] },
				},
				"both",
			).ok,
		).toBe(false);
	});

	it("rejects statistics without a days array", () => {
		const result = parseBackupDocument(
			{
				schema: BACKUP_SCHEMA,
				version: BACKUP_VERSION,
				blinkStats: { totalBlinks: 9 },
			},
			"statistics",
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.message).toMatch(/days array/i);
	});

	it("rejects prefs-only file when scope is both", () => {
		const document = buildBackupDocument({
			scope: "preferences",
			appVersion: "1.0.0",
			preferences: { ...DEFAULT_PREFERENCES },
		});
		const result = parseBackupDocument(document, "both");
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.message).toMatch(/statistics/i);
	});

	it("allows importing preferences-only from a both-scoped file", () => {
		const document = buildBackupDocument({
			scope: "both",
			appVersion: "1.0.0",
			preferences: {
				...DEFAULT_PREFERENCES,
				keyboardShortcuts: {
					...DEFAULT_PREFERENCES.keyboardShortcuts,
					trackingToggle: "Ctrl+B",
				},
			},
			blinkStats: { ...DEFAULT_BLINK_STATS, days: [] },
		});
		const result = parseBackupDocument(document, "preferences");
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.preferences?.keyboardShortcuts.trackingToggle).toBe(
			"Ctrl+B",
		);
		expect(result.value.blinkStats).toBeUndefined();
	});

	it("rejects non-object payloads", () => {
		expect(parseBackupDocument(null, "preferences").ok).toBe(false);
		expect(parseBackupDocument("{}", "preferences").ok).toBe(false);
	});

	it("imports prefs without quietHoursByWeekday as inherit-all", () => {
		const legacyPrefs = { ...DEFAULT_PREFERENCES };
		delete (legacyPrefs as { quietHoursByWeekday?: unknown })
			.quietHoursByWeekday;
		const document = buildBackupDocument({
			scope: "preferences",
			appVersion: "1.0.0",
			preferences: legacyPrefs,
		});
		// Simulate an older backup blob that never had the map key.
		if (document.preferences) {
			delete (document.preferences as { quietHoursByWeekday?: unknown })
				.quietHoursByWeekday;
		}
		const result = parseBackupDocument(document, "preferences");
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.preferences?.quietHoursByWeekday).toEqual({});
		expect(result.value.preferences?.quietHoursStart).toBe("22:00");
		expect(result.value.preferences?.quietHoursEnd).toBe("08:00");
	});

	it("imports hostile quietHoursByWeekday as a sanitized sparse map", () => {
		const document = buildBackupDocument({
			scope: "preferences",
			appVersion: "1.0.0",
			preferences: DEFAULT_PREFERENCES,
		});
		if (document.preferences) {
			(
				document.preferences as {
					quietHoursByWeekday: unknown;
				}
			).quietHoursByWeekday = {
				__proto__: { polluted: true },
				constructor: { mode: "off" },
				sat: { mode: "custom", start: "24:00", end: "08:00" },
				fri: { mode: "off" },
			};
		}
		const result = parseBackupDocument(document, "preferences");
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.preferences?.quietHoursByWeekday).toEqual({
			fri: { mode: "off" },
		});
	});
});
