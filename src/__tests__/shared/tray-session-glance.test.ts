import { describe, expect, it } from "vitest";
import {
	formatCompactCount,
	formatTraySessionGlance,
	type TraySessionGlanceInput,
} from "../../../shared/tray-session-glance";

const baseGoals = {
	enabled: true,
	dailyBlinks: {
		current: 1200,
		target: 4500,
		enabled: true,
		met: false,
	},
	dailyTrackingMinutes: {
		current: 0,
		target: 0,
		enabled: false,
		met: false,
	},
};

function glance(
	overrides: Partial<TraySessionGlanceInput> = {},
): TraySessionGlanceInput {
	return {
		isTracking: true,
		showLiveBpm: true,
		blinksPerMinute: 0,
		blinkRateReady: false,
		todayBlinks: 0,
		todayTrackingMs: 0,
		goals: baseGoals,
		...overrides,
	};
}

describe("formatCompactCount", () => {
	it("formats thousands with one decimal", () => {
		expect(formatCompactCount(1234, "en")).toBe("1.2k");
		expect(formatCompactCount(4500, "en")).toBe("4.5k");
		expect(formatCompactCount(1000, "en")).toBe("1k");
	});

	it("uses uk decimal separator", () => {
		expect(formatCompactCount(1234, "uk")).toBe("1,2k");
	});
});

describe("formatTraySessionGlance", () => {
	it("shows warming copy before blink rate is ready", () => {
		const text = formatTraySessionGlance("en", glance({ todayBlinks: 5 }));
		expect(text).toContain("Warming up");
		expect(text).not.toMatch(/\d+\/min/);
	});

	it("shows live bpm and band when ready", () => {
		const text = formatTraySessionGlance(
			"en",
			glance({
				blinkRateReady: true,
				blinksPerMinute: 12,
				todayBlinks: 40,
			}),
		);
		expect(text).toContain("12/min");
		expect(text).toContain("OK");
		expect(text).toContain("Today 40 blinks");
	});

	it("omits bpm for timer-only tracking but keeps today stats", () => {
		const text = formatTraySessionGlance(
			"en",
			glance({
				showLiveBpm: false,
				isTracking: true,
				todayBlinks: 18,
				todayTrackingMs: 12 * 60_000,
				goals: { ...baseGoals, enabled: false },
			}),
		);
		expect(text).not.toContain("/min");
		expect(text).toContain("Today 18 blinks");
		expect(text).toContain("12m");
	});

	it("hides goal when goals are disabled", () => {
		const text = formatTraySessionGlance(
			"en",
			glance({
				blinkRateReady: true,
				blinksPerMinute: 10,
				todayBlinks: 100,
				goals: { ...baseGoals, enabled: false },
			}),
		);
		expect(text).not.toContain("/ 4.5k");
	});

	it("shows goal progress with compact counts", () => {
		const text = formatTraySessionGlance(
			"en",
			glance({
				blinkRateReady: true,
				blinksPerMinute: 10,
				todayBlinks: 1200,
			}),
		);
		expect(text).toContain("1.2k / 4.5k");
	});

	it("marks met daily goal", () => {
		const text = formatTraySessionGlance(
			"en",
			glance({
				blinkRateReady: true,
				blinksPerMinute: 16,
				todayBlinks: 4500,
				goals: {
					...baseGoals,
					dailyBlinks: {
						current: 4500,
						target: 4500,
						enabled: true,
						met: true,
					},
				},
			}),
		);
		expect(text).toContain("Met");
	});

	it("renders uk strings", () => {
		const text = formatTraySessionGlance(
			"uk",
			glance({
				showLiveBpm: false,
				todayBlinks: 5,
				todayTrackingMs: 0,
				goals: { ...baseGoals, enabled: false },
			}),
		);
		expect(text).toContain("Сьогодні");
	});

	it("shows tracking goal for timer-only mode instead of blink goal", () => {
		const text = formatTraySessionGlance(
			"en",
			glance({
				showLiveBpm: false,
				isTracking: true,
				todayBlinks: 0,
				todayTrackingMs: 45 * 60_000,
				goals: {
					enabled: true,
					dailyBlinks: {
						current: 0,
						target: 4500,
						enabled: false,
						met: false,
					},
					dailyTrackingMinutes: {
						current: 45,
						target: 300,
						enabled: true,
						met: false,
					},
				},
			}),
		);
		expect(text).not.toContain("4.5k");
		expect(text).toContain("45 / 300");
	});

	it("marks met tracking goal in timer-only mode", () => {
		const text = formatTraySessionGlance(
			"en",
			glance({
				showLiveBpm: false,
				todayTrackingMs: 300 * 60_000,
				goals: {
					enabled: true,
					dailyBlinks: {
						current: 0,
						target: 4500,
						enabled: false,
						met: false,
					},
					dailyTrackingMinutes: {
						current: 300,
						target: 300,
						enabled: true,
						met: true,
					},
				},
			}),
		);
		expect(text).toContain("300 / 300");
		expect(text).toContain("Met");
	});
});
