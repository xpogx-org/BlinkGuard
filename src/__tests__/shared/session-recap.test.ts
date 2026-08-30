import { describe, expect, it } from "vitest";
import type { TodayBlinkSummary } from "../../../shared/blink-stats";
import {
	buildNativePayload,
	buildOverlayPayload,
	computeSessionDelta,
	truncateNativeBody,
	SESSION_RECAP_NATIVE_BODY_MAX,
	type SessionRecapBaseline,
} from "../../../shared/session-recap";

const todayBase: TodayBlinkSummary = {
	date: "2026-08-30",
	blinks: 100,
	trackingMs: 600_000,
	sessions: 1,
	lookAwayCompleted: 2,
	lookAwaySkipped: 0,
	lookAwaySnoozed: 0,
	exerciseCompleted: 1,
	exerciseSkipped: 0,
	exerciseSnoozed: 0,
};

const baseline: SessionRecapBaseline = {
	date: "2026-08-30",
	blinks: 40,
	trackingMs: 300_000,
	lookAwayCompleted: 1,
	exerciseCompleted: 0,
	armedAt: 1,
};

describe("session-recap shared builders", () => {
	it("computes non-negative session deltas from baseline", () => {
		expect(computeSessionDelta(baseline, todayBase)).toEqual({
			blinks: 60,
			trackingMs: 300_000,
			lookAwayCompleted: 1,
			exerciseCompleted: 1,
			eyeCareCompleted: 2,
		});
	});

	it("treats prior-day baseline fields as zero when the calendar day changes", () => {
		const crossMidnight = computeSessionDelta(
			{ ...baseline, date: "2026-08-29" },
			todayBase,
		);
		expect(crossMidnight.blinks).toBe(100);
		expect(crossMidnight.trackingMs).toBe(600_000);
	});

	it("builds overlay payload with streak line when streak >= 2", () => {
		const payload = buildOverlayPayload(
			{
				blinks: 12,
				trackingMs: 360_000,
				lookAwayCompleted: 1,
				exerciseCompleted: 0,
				eyeCareCompleted: 1,
			},
			todayBase,
			{ current: 3, shieldCharges: 0 },
			"en",
		);
		expect(payload.streakLine).toBe("3-day streak");
		expect(payload.sessionLines.length).toBe(2);
	});

	it("builds quit and lock native payloads", () => {
		const quit = buildNativePayload("quit", { today: todayBase }, "en");
		expect(quit.kind).toBe("quit");
		expect(quit.body).toContain("blinks");

		const lock = buildNativePayload(
			"lock",
			{
				delta: {
					blinks: 4,
					trackingMs: 360_000,
					lookAwayCompleted: 0,
					exerciseCompleted: 2,
					eyeCareCompleted: 2,
				},
			},
			"en",
		);
		expect(lock.kind).toBe("lock");
		expect(lock.body).toContain("eye-care");
	});

	it("truncates native bodies at the shared max length", () => {
		const long = "x".repeat(SESSION_RECAP_NATIVE_BODY_MAX + 10);
		expect(truncateNativeBody(long).length).toBe(SESSION_RECAP_NATIVE_BODY_MAX);
	});
});
