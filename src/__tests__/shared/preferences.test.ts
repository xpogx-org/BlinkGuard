import { describe, expect, it } from "vitest";
import {
	CAMERA_QUALITY_PRESETS,
	isCameraQuality,
	toSidecarCameraQualityMessage,
} from "../../../shared/camera-quality";
import {
	isValidEarCalibration,
	medianEarCalibration,
} from "../../../shared/ear-calibration";
import {
	type AppPreferences,
	DEFAULT_EXERCISE_PROMPTS,
	DEFAULT_KEYBOARD_SHORTCUTS,
	DEFAULT_PREFERENCES,
	findDuplicateShortcutActions,
	capPopupPositionsByDisplayId,
	capPopupSizesByDisplayId,
	prunePopupPositionsByDisplayId,
	prunePopupSizesByDisplayId,
	samePopupPositionsByDisplayId,
	samePopupSizesByDisplayId,
	sameQuietHoursByWeekday,
	sanitizeAutoStopNoFaceMinutes,
	sanitizeBlinkRateThresholdPerMin,
	sanitizeEpochMs,
	sanitizeExercisePrompts,
	sanitizeKeyboardShortcuts,
	sanitizeLookAwayHint,
	sanitizeLookAwayTitle,
	sanitizePauseAppCandidates,
	sanitizePauseAppPickerPayload,
	sanitizePauseAppRules,
	appendProcessOnlyPauseAppRule,
	pauseAppProcessBasename,
	processOnlyPauseAppRule,
	sanitizePersistedPreferences,
	sanitizePopupPositionsByDisplayId,
	sanitizePopupSizesByDisplayId,
	sanitizeQuietHoursByWeekday,
	sanitizeBlinkPromptProfile,
	sanitizeMicroBreakIntervalMs,
	sanitizeReminderIntervalMs,
	sanitizeSnoozeMinutes,
	sanitizeSoundVolume,
	seedPopupPositionsFromLegacy,
	seedPopupSizesFromPositionIds,
	toRendererPreferences,
} from "../../../shared/preferences";

describe("toRendererPreferences", () => {
	it("converts reminderInterval from ms to seconds for the settings UI", () => {
		const preferences: AppPreferences = {
			...DEFAULT_PREFERENCES,
			reminderInterval: 4500,
			isTracking: true,
		};

		const renderer = toRendererPreferences(preferences);

		expect(renderer.reminderInterval).toBe(4.5);
		expect(renderer.isTracking).toBe(true);
		expect(renderer.popupMessage).toBe(DEFAULT_PREFERENCES.popupMessage);
		expect(renderer.cameraQuality).toBe("medium");
		expect(renderer.earCalibration).toBeNull();
		expect(renderer.calibrationAt).toBeNull();
		expect(renderer.calibrationNudgeEnabled).toBe(true);
		expect(renderer.classifierBias).toBeNull();
		expect(renderer.classifierThreshold).toBeNull();
	});

	it("converts microBreakInterval from ms to seconds for the settings UI", () => {
		const preferences: AppPreferences = {
			...DEFAULT_PREFERENCES,
			microBreakInterval: 45_000,
		};

		const renderer = toRendererPreferences(preferences);

		expect(renderer.microBreakInterval).toBe(45);
		expect(renderer.reminderInterval).toBe(3);
		expect(renderer.blinkPromptProfile).toBe("standard");
	});
});

describe("blink prompt profile / micro-break preference defaults", () => {
	it("defaults profile to standard and micro-break to 30s", () => {
		expect(DEFAULT_PREFERENCES.blinkPromptProfile).toBe("standard");
		expect(DEFAULT_PREFERENCES.microBreakInterval).toBe(30_000);
		expect(DEFAULT_PREFERENCES.reminderInterval).toBe(3_000);
	});

	it("sanitizes blinkPromptProfile; unknown → standard", () => {
		expect(sanitizeBlinkPromptProfile("gentle")).toBe("gentle");
		expect(sanitizeBlinkPromptProfile("standard")).toBe("standard");
		expect(sanitizeBlinkPromptProfile("strong")).toBe("strong");
		expect(sanitizeBlinkPromptProfile("loud")).toBe("standard");
		expect(sanitizeBlinkPromptProfile(null)).toBe("standard");
		expect(
			sanitizePersistedPreferences({ blinkPromptProfile: "harsh" })
				.blinkPromptProfile,
		).toBe("standard");
	});

	it("sanitizes microBreakInterval to 15_000…120_000; missing → 30s", () => {
		expect(sanitizeMicroBreakIntervalMs(null)).toBe(30_000);
		expect(sanitizeMicroBreakIntervalMs(undefined)).toBe(30_000);
		expect(sanitizeMicroBreakIntervalMs(0)).toBe(30_000);
		expect(sanitizeMicroBreakIntervalMs(10_000)).toBe(15_000);
		expect(sanitizeMicroBreakIntervalMs(200_000)).toBe(120_000);
		expect(sanitizeMicroBreakIntervalMs(45_500.6)).toBe(45_501);
	});

	it("never copies reminderInterval into a missing microBreakInterval", () => {
		const prefs = sanitizePersistedPreferences({
			reminderInterval: 5_000,
		});
		expect(prefs.reminderInterval).toBe(5_000);
		expect(prefs.microBreakInterval).toBe(30_000);
	});

	it("clamps reminderInterval to 1_000…10_000 ms", () => {
		expect(sanitizeReminderIntervalMs(null)).toBe(3_000);
		expect(sanitizeReminderIntervalMs(500)).toBe(1_000);
		expect(sanitizeReminderIntervalMs(15_000)).toBe(10_000);
		expect(sanitizeReminderIntervalMs(4_500.4)).toBe(4_500);
	});
});

describe("camera quality presets", () => {
	it("maps performance / medium / high / ultra to the quality table", () => {
		expect(CAMERA_QUALITY_PRESETS.performance).toEqual({
			targetFps: 10,
			processingResolution: [320, 240],
			faceDetectInterval: 2,
			poseStrictness: "loose",
		});
		expect(CAMERA_QUALITY_PRESETS.medium).toEqual({
			targetFps: 15,
			processingResolution: [480, 360],
			faceDetectInterval: 1,
			poseStrictness: "normal",
		});
		expect(CAMERA_QUALITY_PRESETS.high).toEqual({
			targetFps: 20,
			processingResolution: [640, 480],
			faceDetectInterval: 2,
			poseStrictness: "normal",
		});
		expect(CAMERA_QUALITY_PRESETS.ultra).toEqual({
			targetFps: 30,
			processingResolution: [640, 480],
			faceDetectInterval: 2,
			poseStrictness: "normal",
		});
	});

	it("defaults cameraQuality to medium in DEFAULT_PREFERENCES", () => {
		expect(DEFAULT_PREFERENCES.cameraQuality).toBe("medium");
	});

	it("serializes presets to sidecar NDJSON field names", () => {
		expect(toSidecarCameraQualityMessage("high")).toEqual({
			target_fps: 20,
			processing_resolution: [640, 480],
			face_detect_interval: 2,
			pose_strictness: "normal",
		});
		expect(toSidecarCameraQualityMessage("ultra")).toEqual({
			target_fps: 30,
			processing_resolution: [640, 480],
			face_detect_interval: 2,
			pose_strictness: "normal",
		});
	});

	it("validates camera quality values", () => {
		expect(isCameraQuality("medium")).toBe(true);
		expect(isCameraQuality("ultra")).toBe(true);
		expect(isCameraQuality("max")).toBe(false);
	});
});

describe("ear calibration helpers", () => {
	it("validates plausible open-eye EAR values", () => {
		expect(isValidEarCalibration(0.28)).toBe(true);
		expect(isValidEarCalibration(null)).toBe(false);
		expect(isValidEarCalibration(0.05)).toBe(false);
		expect(isValidEarCalibration(0.9)).toBe(false);
	});

	it("computes median from enough samples", () => {
		const samples = Array.from({ length: 15 }, () => 0.27);
		samples[7] = 0.29;
		expect(medianEarCalibration(samples)).toBeCloseTo(0.27, 5);
	});

	it("returns null when too few samples", () => {
		expect(medianEarCalibration([0.28, 0.29])).toBeNull();
	});
});

describe("phase 4 preference defaults", () => {
	it("defaults earCalibration to null", () => {
		expect(DEFAULT_PREFERENCES.earCalibration).toBeNull();
	});

	it("defaults classifier calibration to null", () => {
		expect(DEFAULT_PREFERENCES.classifierBias).toBeNull();
		expect(DEFAULT_PREFERENCES.classifierThreshold).toBeNull();
	});

	it("sanitizes invalid classifier overlay fields to null", () => {
		const prefs = sanitizePersistedPreferences({
			classifierBias: 9,
			classifierThreshold: 0.9,
		});
		expect(prefs.classifierBias).toBeNull();
		expect(prefs.classifierThreshold).toBeNull();
	});

	it("keeps a valid classifier overlay", () => {
		const prefs = sanitizePersistedPreferences({
			classifierBias: 0.4,
			classifierThreshold: 0.2,
		});
		expect(prefs.classifierBias).toBe(0.4);
		expect(prefs.classifierThreshold).toBe(0.2);
	});
});

describe("tray / autostart preference defaults", () => {
	it("defaults launchAtLogin and isTracking to false", () => {
		expect(DEFAULT_PREFERENCES.launchAtLogin).toBe(false);
		expect(DEFAULT_PREFERENCES.isTracking).toBe(false);
	});
});

describe("look-away / 20-20-20 preference defaults", () => {
	it("defaults to classic 20-20-20 values and enabled", () => {
		expect(DEFAULT_PREFERENCES.lookAwayEnabled).toBe(true);
		expect(DEFAULT_PREFERENCES.lookAwayInterval).toBe(20);
		expect(DEFAULT_PREFERENCES.exerciseInterval).toBe(40);
		expect(DEFAULT_PREFERENCES.blinkPopupClickThrough).toBe(true);
		expect(DEFAULT_PREFERENCES.notificationStyle).toBe("overlay");
		expect(DEFAULT_PREFERENCES.lookAwayDuration).toBe(20);
		expect(DEFAULT_PREFERENCES.lookAwayTitle).toBe("Look away");
		expect(DEFAULT_PREFERENCES.lookAwayHint).toContain("20 feet");
	});
});

describe("quiet hours / focus preference defaults", () => {
	it("defaults quiet hours overnight and fullscreen pause on", () => {
		expect(DEFAULT_PREFERENCES.quietHoursEnabled).toBe(true);
		expect(DEFAULT_PREFERENCES.quietHoursStart).toBe("22:00");
		expect(DEFAULT_PREFERENCES.quietHoursEnd).toBe("08:00");
		expect(DEFAULT_PREFERENCES.quietHoursByWeekday).toEqual({});
		expect(DEFAULT_PREFERENCES.pauseOnFullscreen).toBe(true);
		expect(DEFAULT_PREFERENCES.pauseAppRules).toEqual([]);
	});
});

describe("sanitizeQuietHoursByWeekday", () => {
	it("returns inherit-all for missing, null, and non-objects", () => {
		expect(sanitizeQuietHoursByWeekday(undefined)).toEqual({});
		expect(sanitizeQuietHoursByWeekday(null)).toEqual({});
		expect(sanitizeQuietHoursByWeekday("fri")).toEqual({});
		expect(sanitizeQuietHoursByWeekday([])).toEqual({});
	});

	it("keeps off and custom; drops default, unknown keys, and invalid times", () => {
		expect(
			sanitizeQuietHoursByWeekday({
				mon: { mode: "off", start: "09:00", end: "17:00" },
				tue: { mode: "custom", start: "21:00", end: "07:00" },
				wed: { mode: "default" },
				thu: { mode: "custom", start: "24:00", end: "08:00" },
				fri: { mode: "custom", start: "22:00", end: "12:60" },
				__proto__: { mode: "off" },
				constructor: { mode: "off" },
				0: { mode: "off" },
				sat: "nope",
			}),
		).toEqual({
			mon: { mode: "off" },
			tue: { mode: "custom", start: "21:00", end: "07:00" },
		});
	});

	it("normalizes custom times and ignores key order for equality", () => {
		expect(
			sanitizeQuietHoursByWeekday({
				fri: { mode: "custom", start: "8:05", end: "9:00:00" },
			}),
		).toEqual({
			fri: { mode: "custom", start: "08:05", end: "09:00" },
		});
		expect(
			sameQuietHoursByWeekday(
				{ sat: { mode: "off" }, fri: { mode: "custom", start: "22:00", end: "08:00" } },
				{ fri: { mode: "custom", start: "22:00", end: "08:00" }, sat: { mode: "off" } },
			),
		).toBe(true);
	});

	it("hydrates three-field-only prefs with overnight defaults and empty map", () => {
		const prefs = sanitizePersistedPreferences({
			quietHoursEnabled: true,
			quietHoursStart: "22:00",
			quietHoursEnd: "08:00",
		});
		expect(prefs.quietHoursEnabled).toBe(true);
		expect(prefs.quietHoursStart).toBe("22:00");
		expect(prefs.quietHoursEnd).toBe("08:00");
		expect(prefs.quietHoursByWeekday).toEqual({});
	});
});

describe("onboarding preference defaults", () => {
	it("defaults hasCompletedOnboarding to false for first-run", () => {
		expect(DEFAULT_PREFERENCES.hasCompletedOnboarding).toBe(false);
	});
});

describe("blink-rate coaching preference defaults", () => {
	it("defaults coaching on with Low-band threshold", () => {
		expect(DEFAULT_PREFERENCES.blinkRateCoachingEnabled).toBe(true);
		expect(DEFAULT_PREFERENCES.blinkRateThresholdPerMin).toBe(4);
	});

	it("sanitizes blinkRateThresholdPerMin to 1…60", () => {
		expect(sanitizeBlinkRateThresholdPerMin(null)).toBe(4);
		expect(sanitizeBlinkRateThresholdPerMin(0)).toBe(1);
		expect(sanitizeBlinkRateThresholdPerMin(99)).toBe(60);
		expect(sanitizeBlinkRateThresholdPerMin(7.6)).toBe(8);
	});
});

describe("calibration freshness preference defaults", () => {
	it("defaults timestamps to null and the toast opt-in on", () => {
		expect(DEFAULT_PREFERENCES.calibrationAt).toBeNull();
		expect(DEFAULT_PREFERENCES.calibrationNudgeEnabled).toBe(true);
		expect(DEFAULT_PREFERENCES.calibrationNudgeDismissedAt).toBeNull();
		expect(DEFAULT_PREFERENCES.lastBaselineDriftAt).toBeNull();
	});

	it("parses epoch ms and ISO strings, drops invalid stamps", () => {
		expect(sanitizeEpochMs(1_700_000_000_000)).toBe(1_700_000_000_000);
		expect(sanitizeEpochMs("2024-01-15T12:00:00.000Z")).toBe(
			Date.parse("2024-01-15T12:00:00.000Z"),
		);
		expect(sanitizeEpochMs("nope")).toBeNull();
		expect(sanitizeEpochMs(-1)).toBeNull();
	});

	it("clears calibrationAt when earCalibration is missing", () => {
		const prefs = sanitizePersistedPreferences({
			earCalibration: null,
			calibrationAt: 1_700_000_000_000,
		});
		expect(prefs.calibrationAt).toBeNull();
	});

	it("keeps a valid calibrationAt with a saved EAR", () => {
		const prefs = sanitizePersistedPreferences({
			earCalibration: 0.28,
			calibrationAt: 1_700_000_000_000,
		});
		expect(prefs.calibrationAt).toBe(1_700_000_000_000);
	});
});

describe("notificationStyle preference", () => {
	it("defaults to overlay and keeps native / both", () => {
		expect(DEFAULT_PREFERENCES.notificationStyle).toBe("overlay");
		expect(sanitizePersistedPreferences({}).notificationStyle).toBe("overlay");
		expect(
			sanitizePersistedPreferences({ notificationStyle: "both" })
				.notificationStyle,
		).toBe("both");
		expect(
			sanitizePersistedPreferences({ notificationStyle: "native" })
				.notificationStyle,
		).toBe("native");
	});

	it("falls back to overlay when the stored value is invalid", () => {
		expect(
			sanitizePersistedPreferences({ notificationStyle: "toast" })
				.notificationStyle,
		).toBe("overlay");
	});
});

describe("cameraDevice preference", () => {
	it("defaults cameraDevice to null (Automatic)", () => {
		expect(DEFAULT_PREFERENCES.cameraDevice).toBeNull();
	});

	it("keeps a valid cameraDevice object", () => {
		const prefs = sanitizePersistedPreferences({
			cameraDevice: { id: "USB\\VID_046D", index: 1, name: "Logitech C170" },
		});
		expect(prefs.cameraDevice).toEqual({
			id: "USB\\VID_046D",
			index: 1,
			name: "Logitech C170",
		});
	});

	it("falls back to null when cameraDevice is invalid", () => {
		expect(
			sanitizePersistedPreferences({ cameraDevice: "usb" }).cameraDevice,
		).toBeNull();
		expect(
			sanitizePersistedPreferences({ cameraDevice: { index: 9, name: "X" } })
				.cameraDevice,
		).toBeNull();
		expect(
			sanitizePersistedPreferences({ cameraDevice: { index: 0 } }).cameraDevice,
		).toBeNull();
	});
});

describe("auto-stop on no-face preference defaults", () => {
	it("defaults enabled with 2 minutes", () => {
		expect(DEFAULT_PREFERENCES.autoStopNoFaceEnabled).toBe(true);
		expect(DEFAULT_PREFERENCES.autoStopNoFaceMinutes).toBe(2);
	});

	it("sanitizes autoStopNoFaceMinutes to 1…30", () => {
		expect(sanitizeAutoStopNoFaceMinutes(null)).toBe(2);
		expect(sanitizeAutoStopNoFaceMinutes(0)).toBe(1);
		expect(sanitizeAutoStopNoFaceMinutes(99)).toBe(30);
		expect(sanitizeAutoStopNoFaceMinutes(7.6)).toBe(8);
	});
});

describe("keyboardShortcuts sanitize", () => {
	it("defaults trackingToggle to Ctrl+I and snoozeAll to Ctrl+Shift+S", () => {
		expect(sanitizeKeyboardShortcuts(undefined)).toEqual({
			...DEFAULT_KEYBOARD_SHORTCUTS,
		});
	});

	it("allows empty trackingToggle (unbound)", () => {
		expect(
			sanitizeKeyboardShortcuts({
				trackingToggle: "",
				snoozeAll: "Ctrl+Shift+S",
			}),
		).toEqual({
			trackingToggle: "",
			snoozeAll: "Ctrl+Shift+S",
			snoozeWithToken: "",
			openSettings: "",
			openCameraPreview: "",
		});
	});

	it("migrates legacy keyboardShortcut when map is absent", () => {
		const prefs = sanitizePersistedPreferences({
			keyboardShortcut: "Ctrl+B",
		});
		expect(prefs.keyboardShortcuts.trackingToggle).toBe("Ctrl+B");
		expect(prefs.keyboardShortcuts.snoozeAll).toBe("Ctrl+Shift+S");
	});

	it("finds duplicate accelerators across actions", () => {
		expect(
			findDuplicateShortcutActions({
				trackingToggle: "Ctrl+I",
				snoozeAll: "Ctrl+I",
				snoozeWithToken: "",
				openSettings: "",
				openCameraPreview: "",
			}).sort(),
		).toEqual(["snoozeAll", "trackingToggle"]);
		expect(
			findDuplicateShortcutActions({ ...DEFAULT_KEYBOARD_SHORTCUTS }),
		).toEqual([]);
	});
});

describe("snooze duration preference defaults", () => {
	it("defaults to 5 minutes", () => {
		expect(DEFAULT_PREFERENCES.snoozeMinutes).toBe(5);
	});

	it("sanitizes snoozeMinutes to 1…30", () => {
		expect(sanitizeSnoozeMinutes(null)).toBe(5);
		expect(sanitizeSnoozeMinutes(0)).toBe(1);
		expect(sanitizeSnoozeMinutes(99)).toBe(30);
		expect(sanitizeSnoozeMinutes(7.6)).toBe(8);
	});
});

describe("sound volume preference", () => {
	it("defaults to 100", () => {
		expect(DEFAULT_PREFERENCES.soundVolume).toBe(100);
	});

	it("sanitizes soundVolume to 0…100", () => {
		expect(sanitizeSoundVolume(null)).toBe(100);
		expect(sanitizeSoundVolume(-5)).toBe(0);
		expect(sanitizeSoundVolume(150)).toBe(100);
		expect(sanitizeSoundVolume(42.6)).toBe(43);
	});
});

describe("sanitizeExercisePrompts", () => {
	it("defaults to the built-in four prompts", () => {
		expect(DEFAULT_PREFERENCES.exercisePrompts).toEqual([
			...DEFAULT_EXERCISE_PROMPTS,
		]);
		expect(DEFAULT_PREFERENCES.exercisePrompts).toHaveLength(4);
	});

	it("returns defaults for non-arrays, empty arrays, and whitespace-only", () => {
		expect(sanitizeExercisePrompts(null)).toEqual([
			...DEFAULT_EXERCISE_PROMPTS,
		]);
		expect(sanitizeExercisePrompts([])).toEqual([...DEFAULT_EXERCISE_PROMPTS]);
		expect(sanitizeExercisePrompts(["  ", ""])).toEqual([
			...DEFAULT_EXERCISE_PROMPTS,
		]);
	});

	it("trims and keeps valid lines", () => {
		expect(
			sanitizeExercisePrompts(["  Blink slowly  ", "", 42, "Look far"]),
		).toEqual(["Blink slowly", "Look far"]);
	});
});

describe("sanitizeLookAwayTitle / Hint", () => {
	it("falls back to defaults for empty input", () => {
		expect(sanitizeLookAwayTitle("")).toBe(DEFAULT_PREFERENCES.lookAwayTitle);
		expect(sanitizeLookAwayHint("  ")).toBe(DEFAULT_PREFERENCES.lookAwayHint);
		expect(sanitizeLookAwayTitle(null, "uk")).not.toBe(
			DEFAULT_PREFERENCES.lookAwayTitle,
		);
	});

	it("trims non-empty values", () => {
		expect(sanitizeLookAwayTitle("  Hello  ")).toBe("Hello");
		expect(sanitizeLookAwayHint("  Far away  ")).toBe("Far away");
	});
});

describe("sanitizePauseAppRules", () => {
	it("returns empty for non-arrays and empty drafts", () => {
		expect(sanitizePauseAppRules(null)).toEqual([]);
		expect(sanitizePauseAppRules("zoom")).toEqual([]);
		expect(
			sanitizePauseAppRules([{ processName: "  ", windowTitle: "" }]),
		).toEqual([]);
	});

	it("trims fields, drops invalid items, and clamps length", () => {
		expect(
			sanitizePauseAppRules([
				{ processName: "  Zoom.exe  ", windowTitle: "" },
				{ processName: "", windowTitle: "  Meeting  " },
				{ notARule: true },
				"nope",
				{
					processName: "x".repeat(200),
					windowTitle: "y".repeat(200),
				},
			]),
		).toEqual([
			{ processName: "Zoom.exe", windowTitle: "" },
			{ processName: "", windowTitle: "Meeting" },
			{ processName: "x".repeat(128), windowTitle: "y".repeat(128) },
		]);
	});

	it("caps the list at 32 rules", () => {
		const input = Array.from({ length: 40 }, (_, i) => ({
			processName: `app${i}`,
			windowTitle: "",
		}));
		expect(sanitizePauseAppRules(input)).toHaveLength(32);
		expect(sanitizePauseAppRules(input)[31]).toEqual({
			processName: "app31",
			windowTitle: "",
		});
	});

	it("hydrates missing pauseAppRules to []", () => {
		expect(sanitizePersistedPreferences({}).pauseAppRules).toEqual([]);
	});
});

describe("pauseAppProcessBasename", () => {
	it("returns the last path segment and preserves casing", () => {
		expect(pauseAppProcessBasename("C:\\Program Files\\Zoom\\Zoom.exe")).toBe(
			"Zoom.exe",
		);
		expect(pauseAppProcessBasename("/usr/bin/firefox")).toBe("firefox");
		expect(pauseAppProcessBasename("  Teams.exe  ")).toBe("Teams.exe");
	});

	it("returns empty for blank input", () => {
		expect(pauseAppProcessBasename("")).toBe("");
		expect(pauseAppProcessBasename("   ")).toBe("");
	});
});

describe("processOnlyPauseAppRule", () => {
	it("strips window title and keeps process basename", () => {
		expect(
			processOnlyPauseAppRule({
				processName: "C:\\Apps\\Zoom.exe",
				windowTitle: "Zoom Meeting — Host",
			}),
		).toEqual({ processName: "Zoom.exe", windowTitle: "" });
	});

	it("returns null for title-only candidates", () => {
		expect(
			processOnlyPauseAppRule({ processName: "", windowTitle: "Meeting" }),
		).toBeNull();
		expect(processOnlyPauseAppRule(null)).toBeNull();
	});
});

describe("appendProcessOnlyPauseAppRule", () => {
	it("appends a process-only rule", () => {
		const result = appendProcessOnlyPauseAppRule(
			[],
			{ processName: "Zoom.exe", windowTitle: "Host" },
		);
		expect(result).toEqual({
			ok: true,
			rules: [{ processName: "Zoom.exe", windowTitle: "" }],
		});
	});

	it("dedupes case-insensitively on process with empty title", () => {
		const listed = appendProcessOnlyPauseAppRule(
			[{ processName: "Zoom.exe", windowTitle: "" }],
			{ processName: "zoom.exe", windowTitle: "" },
		);
		expect(listed).toEqual({ ok: false, reason: "already-listed" });
	});

	it("allows process-only add when a title-specific rule exists", () => {
		const result = appendProcessOnlyPauseAppRule(
			[{ processName: "Zoom.exe", windowTitle: "Standup" }],
			{ processName: "Zoom.exe", windowTitle: "Other" },
		);
		expect(result).toEqual({
			ok: true,
			rules: [
				{ processName: "Zoom.exe", windowTitle: "Standup" },
				{ processName: "Zoom.exe", windowTitle: "" },
			],
		});
	});

	it("refuses at cap", () => {
		const full = Array.from({ length: 32 }, (_, i) => ({
			processName: `app${i}.exe`,
			windowTitle: "",
		}));
		const result = appendProcessOnlyPauseAppRule(full, {
			processName: "New.exe",
			windowTitle: "",
		});
		expect(result).toEqual({ ok: false, reason: "at-cap" });
	});

	it("refuses empty process", () => {
		expect(
			appendProcessOnlyPauseAppRule([], {
				processName: "",
				windowTitle: "Only title",
			}),
		).toEqual({ ok: false, reason: "empty-process" });
	});
});

describe("sanitizePauseAppCandidates", () => {
	it("accepts host {p,t} rows and drops empties", () => {
		expect(
			sanitizePauseAppCandidates([
				{ p: " Zoom.exe ", t: "Meeting" },
				{ processName: "chrome.exe", windowTitle: "" },
				{ p: "", t: "" },
				"nope",
			]),
		).toEqual([
			{ processName: "Zoom.exe", windowTitle: "Meeting" },
			{ processName: "chrome.exe", windowTitle: "" },
		]);
	});

	it("dedupes and caps picker rows at 64", () => {
		const input = Array.from({ length: 80 }, (_, i) => ({
			p: `app${i}.exe`,
			t: "",
		}));
		input.push({ p: "app0.exe", t: "" });
		expect(sanitizePauseAppCandidates(input)).toHaveLength(64);
		expect(sanitizePauseAppCandidates(input)[0]).toEqual({
			processName: "app0.exe",
			windowTitle: "",
		});
	});
});

describe("sanitizePauseAppPickerPayload", () => {
	it("returns an empty picker for garbage", () => {
		expect(sanitizePauseAppPickerPayload(null)).toEqual({
			lastFocused: null,
			running: [],
		});
		expect(sanitizePauseAppPickerPayload({ status: "error" })).toEqual({
			lastFocused: null,
			running: [],
		});
	});

	it("keeps lastFocused and running", () => {
		expect(
			sanitizePauseAppPickerPayload({
				lastFocused: { p: "Zoom.exe", t: "ignored-for-parse" },
				running: [{ processName: "chrome.exe", windowTitle: "Docs" }],
			}),
		).toEqual({
			lastFocused: {
				processName: "Zoom.exe",
				windowTitle: "ignored-for-parse",
			},
			running: [{ processName: "chrome.exe", windowTitle: "Docs" }],
		});
	});
});

describe("popupPositionsByDisplayId", () => {
	it("sanitizes junk keys and non-finite points", () => {
		expect(sanitizePopupPositionsByDisplayId(null)).toEqual({});
		expect(sanitizePopupPositionsByDisplayId("nope")).toEqual({});
		expect(sanitizePopupPositionsByDisplayId([])).toEqual({});
		expect(
			sanitizePopupPositionsByDisplayId({
				" 12 ": { x: 10.6, y: 20.2 },
				"": { x: 1, y: 2 },
				bad: { x: "n", y: 2 },
				nested: 4,
			}),
		).toEqual({
			"12": { x: 11, y: 20 },
		});
	});

	it("hydrates a missing map to {}", () => {
		expect(sanitizePersistedPreferences({}).popupPositionsByDisplayId).toEqual(
			{},
		);
	});

	it("seeds from legacy popupPosition only when the map is empty", () => {
		const legacy = { x: 40, y: 80 };
		expect(seedPopupPositionsFromLegacy({}, legacy, "1")).toEqual({
			"1": legacy,
		});
		expect(
			seedPopupPositionsFromLegacy({ "2": { x: 1, y: 2 } }, legacy, "1"),
		).toEqual({ "2": { x: 1, y: 2 } });
		expect(seedPopupPositionsFromLegacy({}, null, "1")).toEqual({});
		expect(seedPopupPositionsFromLegacy({}, legacy, "  ")).toEqual({});
	});

	it("prunes ids that are not live and compares maps", () => {
		const map = {
			"1": { x: 10, y: 20 },
			"2": { x: 30, y: 40 },
		};
		expect(prunePopupPositionsByDisplayId(map, ["1"])).toEqual({
			"1": { x: 10, y: 20 },
		});
		expect(samePopupPositionsByDisplayId(map, { ...map })).toBe(true);
		expect(samePopupPositionsByDisplayId(map, { "1": { x: 10, y: 20 } })).toBe(
			false,
		);
	});

	it("keeps disconnected display layouts until over the cap", () => {
		const map = {
			"1": { x: 10, y: 20 },
			"2": { x: 30, y: 40 },
		};
		expect(capPopupPositionsByDisplayId(map, ["1"])).toEqual(map);
		const overflow: Record<string, { x: number; y: number }> = {
			live: { x: 1, y: 1 },
		};
		for (let i = 0; i < 16; i += 1) {
			overflow[`old-${i}`] = { x: i, y: i };
		}
		const capped = capPopupPositionsByDisplayId(overflow, ["live"], 16);
		expect(capped.live).toEqual({ x: 1, y: 1 });
		expect(Object.keys(capped)).toHaveLength(16);
		expect(capped["old-15"]).toBeUndefined();
	});
});

describe("popupSizesByDisplayId", () => {
	it("sanitizes junk keys and invalid sizes", () => {
		expect(sanitizePopupSizesByDisplayId(null)).toEqual({});
		expect(sanitizePopupSizesByDisplayId([])).toEqual({});
		expect(
			sanitizePopupSizesByDisplayId({
				" 3 ": { width: 320.6, height: 140.2 },
				"": { width: 10, height: 10 },
				bad: { width: 0, height: 80 },
				nested: true,
			}),
		).toEqual({
			"3": { width: 321, height: 140 },
		});
	});

	it("hydrates a missing map to {}", () => {
		expect(sanitizePersistedPreferences({}).popupSizesByDisplayId).toEqual({});
	});

	it("seeds from the size mirror onto position-map ids when empty", () => {
		const mirror = { width: 300, height: 120 };
		expect(seedPopupSizesFromPositionIds({}, ["1", "2"], mirror)).toEqual({
			"1": mirror,
			"2": mirror,
		});
		expect(
			seedPopupSizesFromPositionIds(
				{ "9": { width: 200, height: 80 } },
				["1"],
				mirror,
			),
		).toEqual({ "9": { width: 200, height: 80 } });
		expect(seedPopupSizesFromPositionIds({}, [], mirror)).toEqual({});
	});

	it("prunes ids that are not live", () => {
		const map = {
			"1": { width: 300, height: 120 },
			"2": { width: 400, height: 180 },
		};
		expect(prunePopupSizesByDisplayId(map, ["2"])).toEqual({
			"2": { width: 400, height: 180 },
		});
		expect(samePopupSizesByDisplayId(map, { ...map })).toBe(true);
		expect(
			samePopupSizesByDisplayId(map, { "1": { width: 300, height: 120 } }),
		).toBe(false);
	});

	it("keeps disconnected sizes until over the cap", () => {
		const map = {
			"1": { width: 300, height: 120 },
			"2": { width: 400, height: 180 },
		};
		expect(capPopupSizesByDisplayId(map, ["1"])).toEqual(map);
	});
});
