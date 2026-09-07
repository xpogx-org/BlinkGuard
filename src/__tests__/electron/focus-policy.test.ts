import { describe, expect, it } from "vitest";
import {
	foregroundMatchesAppRules,
	isInQuietHours,
	isInQuietHoursForSchedule,
	isValidQuietHoursTime,
	matchesPauseAppRule,
	normalizeQuietHoursTime,
	parseQuietHoursMinutes,
	resolveFocusPauseReason,
	shouldFreezeTrackingForFocusPause,
	shouldSuppressNotifications,
	weekdayKeyFromDate,
} from "../../../electron/domain/focus-policy";

describe("quiet hours parsing", () => {
	it("parses valid HH:mm into minutes since midnight", () => {
		expect(parseQuietHoursMinutes("22:00")).toBe(22 * 60);
		expect(parseQuietHoursMinutes("08:30")).toBe(8 * 60 + 30);
		expect(parseQuietHoursMinutes("0:05")).toBe(5);
	});

	it("rejects invalid times", () => {
		expect(isValidQuietHoursTime("24:00")).toBe(false);
		expect(isValidQuietHoursTime("12:60")).toBe(false);
		expect(isValidQuietHoursTime("noon")).toBe(false);
		expect(parseQuietHoursMinutes("")).toBeNull();
	});

	it("accepts optional seconds and normalizes to HH:mm", () => {
		expect(parseQuietHoursMinutes("22:00:00")).toBe(22 * 60);
		expect(normalizeQuietHoursTime("8:05")).toBe("08:05");
	});
});

describe("isInQuietHours", () => {
	it("handles same-day windows", () => {
		const noon = new Date(2026, 7, 7, 12, 0, 0);
		expect(isInQuietHours(noon, "09:00", "17:00")).toBe(true);
		expect(isInQuietHours(noon, "13:00", "17:00")).toBe(false);
	});

	it("handles overnight windows wrapping midnight", () => {
		const late = new Date(2026, 7, 7, 23, 0, 0);
		const early = new Date(2026, 7, 7, 7, 0, 0);
		const midday = new Date(2026, 7, 7, 12, 0, 0);
		expect(isInQuietHours(late, "22:00", "08:00")).toBe(true);
		expect(isInQuietHours(early, "22:00", "08:00")).toBe(true);
		expect(isInQuietHours(midday, "22:00", "08:00")).toBe(false);
	});

	it("treats equal start/end as an empty window", () => {
		const now = new Date(2026, 7, 7, 22, 0, 0);
		expect(isInQuietHours(now, "22:00", "22:00")).toBe(false);
	});

	it("uses half-open end bound", () => {
		const atEnd = new Date(2026, 7, 7, 8, 0, 0);
		expect(isInQuietHours(atEnd, "22:00", "08:00")).toBe(false);
	});
});

describe("isInQuietHoursForSchedule", () => {
	// 2026-08-07 is Friday; 2026-08-08 is Saturday (fixed constructors).
	const fridayLate = new Date(2026, 7, 7, 23, 0, 0);
	const saturdayEarly = new Date(2026, 7, 8, 1, 0, 0);
	const saturdayMorning = new Date(2026, 7, 8, 10, 30, 0);

	it("maps Date.getDay() to named weekday keys (locale-independent)", () => {
		expect(weekdayKeyFromDate(fridayLate)).toBe("fri");
		expect(weekdayKeyFromDate(saturdayEarly)).toBe("sat");
		expect(weekdayKeyFromDate(new Date(2026, 7, 9, 12, 0, 0))).toBe("sun");
		expect(weekdayKeyFromDate(new Date(2026, 7, 10, 12, 0, 0))).toBe("mon");
	});

	it("treats missing map as legacy overnight wrap", () => {
		expect(
			isInQuietHoursForSchedule(saturdayEarly, true, "22:00", "08:00"),
		).toBe(true);
		expect(
			isInQuietHoursForSchedule(saturdayMorning, true, "22:00", "08:00", {}),
		).toBe(false);
	});

	it("keeps Friday wrap on Saturday morning when Saturday is off", () => {
		expect(
			isInQuietHoursForSchedule(saturdayEarly, true, "22:00", "08:00", {
				sat: { mode: "off" },
			}),
		).toBe(true);
	});

	it("ORs Friday overnight tail with Saturday custom daytime", () => {
		const overrides = {
			sat: { mode: "custom" as const, start: "10:00", end: "12:00" },
		};
		expect(
			isInQuietHoursForSchedule(
				saturdayEarly,
				true,
				"22:00",
				"08:00",
				overrides,
			),
		).toBe(true);
		expect(
			isInQuietHoursForSchedule(
				saturdayMorning,
				true,
				"22:00",
				"08:00",
				overrides,
			),
		).toBe(true);
	});

	it("applies Saturday custom morning even when Friday is off", () => {
		expect(
			isInQuietHoursForSchedule(saturdayEarly, true, "22:00", "08:00", {
				fri: { mode: "off" },
				sat: { mode: "custom", start: "00:00", end: "06:00" },
			}),
		).toBe(true);
	});

	it("uses Saturday wrap when Friday is off and Saturday inherits", () => {
		expect(
			isInQuietHoursForSchedule(saturdayEarly, true, "22:00", "08:00", {
				fri: { mode: "off" },
			}),
		).toBe(true);
		expect(
			isInQuietHoursForSchedule(fridayLate, true, "22:00", "08:00", {
				fri: { mode: "off" },
			}),
		).toBe(false);
	});

	it("treats custom equal start/end as an empty day window", () => {
		expect(
			isInQuietHoursForSchedule(saturdayMorning, true, "22:00", "08:00", {
				sat: { mode: "custom", start: "10:00", end: "10:00" },
			}),
		).toBe(false);
	});

	it("returns false when master switch is off", () => {
		expect(
			isInQuietHoursForSchedule(saturdayEarly, false, "22:00", "08:00", {
				sat: { mode: "custom", start: "00:00", end: "06:00" },
			}),
		).toBe(false);
	});
});

describe("resolveFocusPauseReason", () => {
	it("prefers quiet hours over fullscreen", () => {
		expect(
			resolveFocusPauseReason({
				quietHoursEnabled: true,
				inQuietHours: true,
				pauseOnFullscreen: true,
				isFullscreen: true,
				appRuleMatched: true,
			}),
		).toBe("quiet-hours");
	});

	it("returns fullscreen when only that gate trips", () => {
		expect(
			resolveFocusPauseReason({
				quietHoursEnabled: true,
				inQuietHours: false,
				pauseOnFullscreen: true,
				isFullscreen: true,
				appRuleMatched: false,
			}),
		).toBe("fullscreen");
	});

	it("returns app-rule after quiet hours and fullscreen", () => {
		expect(
			resolveFocusPauseReason({
				quietHoursEnabled: true,
				inQuietHours: false,
				pauseOnFullscreen: true,
				isFullscreen: false,
				appRuleMatched: true,
			}),
		).toBe("app-rule");
		expect(
			resolveFocusPauseReason({
				quietHoursEnabled: false,
				inQuietHours: false,
				pauseOnFullscreen: true,
				isFullscreen: true,
				appRuleMatched: true,
			}),
		).toBe("fullscreen");
	});

	it("respects disabled toggles", () => {
		expect(
			shouldSuppressNotifications({
				quietHoursEnabled: false,
				inQuietHours: true,
				pauseOnFullscreen: false,
				isFullscreen: true,
				appRuleMatched: false,
			}),
		).toBe(false);
	});
});

describe("shouldFreezeTrackingForFocusPause", () => {
	it("freezes only for quiet hours", () => {
		expect(shouldFreezeTrackingForFocusPause("quiet-hours")).toBe(true);
		expect(shouldFreezeTrackingForFocusPause("fullscreen")).toBe(false);
		expect(shouldFreezeTrackingForFocusPause("app-rule")).toBe(false);
		expect(shouldFreezeTrackingForFocusPause(null)).toBe(false);
	});
});

describe("pause app-rule matching", () => {
	const zoom = { processName: "Zoom.exe", windowTitle: "Zoom Meeting" };

	it("matches process-only substring and ignores .exe", () => {
		expect(
			matchesPauseAppRule({ processName: "zoom", windowTitle: "" }, zoom),
		).toBe(true);
		expect(
			matchesPauseAppRule(
				{ processName: "ZOOM.EXE", windowTitle: "" },
				{
					processName: "zoom",
					windowTitle: "",
				},
			),
		).toBe(true);
	});

	it("matches title-only substring case-insensitively", () => {
		expect(
			matchesPauseAppRule({ processName: "", windowTitle: "meeting" }, zoom),
		).toBe(true);
		expect(
			matchesPauseAppRule({ processName: "", windowTitle: "Teams" }, zoom),
		).toBe(false);
	});

	it("requires both fields when both are set", () => {
		expect(
			matchesPauseAppRule(
				{ processName: "zoom", windowTitle: "Meeting" },
				zoom,
			),
		).toBe(true);
		expect(
			matchesPauseAppRule({ processName: "zoom", windowTitle: "Teams" }, zoom),
		).toBe(false);
		expect(
			matchesPauseAppRule(
				{ processName: "chrome", windowTitle: "Meeting" },
				zoom,
			),
		).toBe(false);
	});

	it("compares process basename and misses empty rules", () => {
		expect(
			matchesPauseAppRule(
				{ processName: "Zoom.exe", windowTitle: "" },
				{
					processName: "C:/Program Files/Zoom/Zoom.exe",
					windowTitle: "",
				},
			),
		).toBe(true);
		expect(
			matchesPauseAppRule(
				{ processName: "zoom", windowTitle: "" },
				{
					processName: "",
					windowTitle: "Zoom Meeting",
				},
			),
		).toBe(false);
		expect(
			matchesPauseAppRule({ processName: "", windowTitle: "" }, zoom),
		).toBe(false);
		expect(foregroundMatchesAppRules([], zoom)).toBe(false);
		expect(
			foregroundMatchesAppRules(
				[{ processName: "discord", windowTitle: "" }],
				zoom,
			),
		).toBe(false);
	});
});
