import { describe, expect, it, vi } from "vitest";
import { buildAlgorithmPrefs, buildMeta } from "../../../electron/infrastructure/logging/diagnostics-export";
import { DEFAULT_PREFERENCES } from "../../../shared/preferences";

vi.mock("electron", () => ({
	app: {
		getVersion: () => "2.4.0",
		getAppPath: () => "/app",
		isPackaged: false,
	},
}));

vi.mock(
	"../../../electron/infrastructure/sidecar/blink-detector-path",
	() => ({
		isBlinkDetectorBinaryPresent: () => false,
	}),
);

describe("buildAlgorithmPrefs", () => {
	it("includes sanitized quietHoursByWeekday beside legacy quiet-hours fields", () => {
		const prefs = {
			...DEFAULT_PREFERENCES,
			quietHoursByWeekday: {
				sat: { mode: "off" as const },
				fri: { mode: "custom" as const, start: "22:00", end: "08:00" },
			},
		};
		const dump = buildAlgorithmPrefs(prefs);
		expect(dump.quietHoursEnabled).toBe(true);
		expect(dump.quietHoursStart).toBe("22:00");
		expect(dump.quietHoursEnd).toBe("08:00");
		expect(dump.quietHoursByWeekday).toEqual({
			sat: { mode: "off" },
			fri: { mode: "custom", start: "22:00", end: "08:00" },
		});
	});

	it("collapses hostile quietHoursByWeekday in the dump", () => {
		const prefs = {
			...DEFAULT_PREFERENCES,
			quietHoursByWeekday: {
				__proto__: { polluted: true },
				sat: { mode: "custom", start: "24:00", end: "08:00" },
				mon: { mode: "off" },
			} as never,
		};
		const dump = buildAlgorithmPrefs(prefs);
		expect(dump.quietHoursByWeekday).toEqual({ mon: { mode: "off" } });
	});
});

describe("buildMeta", () => {
	it("includes operational flags for triage", () => {
		const prefs = {
			...DEFAULT_PREFERENCES,
			cameraEnabled: true,
			isTracking: true,
			hasCompletedOnboarding: true,
		};
		const meta = buildMeta(prefs);
		expect(meta.cameraEnabled).toBe(true);
		expect(meta.isTracking).toBe(true);
		expect(meta.hasCompletedOnboarding).toBe(true);
		expect(meta.sidecarBinaryPresent).toBe(false);
		expect(meta.packaged).toBe(false);
		expect(meta.appVersion).toBe("2.4.0");
	});

	it("includes settingsProfilesCount when provided", () => {
		const meta = buildMeta(DEFAULT_PREFERENCES, 3);
		expect(meta.settingsProfilesCount).toBe(3);
	});
});
