import { describe, expect, it } from "vitest";
import {
	IDLE_POLL_INTERVAL_MS,
	LOCK_SHORT_RETURN_MS,
	NATIVE_LOCK_COOLDOWN_MS,
	OVERLAY_COOLDOWN_MS,
	RECAP_OVERLAY_DISMISS_MS,
	SESSION_RECAP_IDLE_MS,
	SESSION_RECAP_MIN_TRACKING_MS,
	nativeLockCooldownAllows,
	overlayCooldownAllows,
	qualifiesQuitToday,
	qualifiesSession,
	shouldSuppressRecap,
	streakLineEligible,
} from "../../../electron/domain/session-recap-policy";

describe("session-recap-policy", () => {
	it("exports timing constants", () => {
		expect(SESSION_RECAP_MIN_TRACKING_MS).toBe(5 * 60_000);
		expect(SESSION_RECAP_IDLE_MS).toBe(25 * 60_000);
		expect(OVERLAY_COOLDOWN_MS).toBe(30 * 60_000);
		expect(NATIVE_LOCK_COOLDOWN_MS).toBe(2 * 60 * 60_000);
		expect(LOCK_SHORT_RETURN_MS).toBe(3 * 60_000);
		expect(RECAP_OVERLAY_DISMISS_MS).toBe(5_000);
		expect(IDLE_POLL_INTERVAL_MS).toBe(60_000);
	});

	it("qualifies session by tracking time or eye-care completion", () => {
		expect(
			qualifiesSession({
				blinks: 0,
				trackingMs: SESSION_RECAP_MIN_TRACKING_MS,
				lookAwayCompleted: 0,
				exerciseCompleted: 0,
				eyeCareCompleted: 0,
			}),
		).toBe(true);
		expect(
			qualifiesSession({
				blinks: 10,
				trackingMs: 0,
				lookAwayCompleted: 1,
				exerciseCompleted: 0,
				eyeCareCompleted: 1,
			}),
		).toBe(true);
		expect(
			qualifiesSession({
				blinks: 0,
				trackingMs: 60_000,
				lookAwayCompleted: 0,
				exerciseCompleted: 0,
				eyeCareCompleted: 0,
			}),
		).toBe(false);
	});

	it("qualifies quit recap from last session or meaningful day", () => {
		const today = {
			date: "2026-08-30",
			blinks: 100,
			trackingMs: SESSION_RECAP_MIN_TRACKING_MS,
			sessions: 1,
			lookAwayCompleted: 0,
			lookAwaySkipped: 0,
			lookAwaySnoozed: 0,
			exerciseCompleted: 0,
			exerciseSkipped: 0,
			exerciseSnoozed: 0,
		};
		expect(qualifiesQuitToday(today, false)).toBe(true);
		expect(qualifiesQuitToday({ ...today, trackingMs: 0 }, true)).toBe(true);
		expect(qualifiesQuitToday({ ...today, trackingMs: 0 }, false)).toBe(false);
	});

	it("suppresses recap for hush and focus pause only", () => {
		expect(shouldSuppressRecap(null)).toBe(false);
		expect(shouldSuppressRecap("session-idle")).toBe(false);
		expect(shouldSuppressRecap("manual-hush")).toBe(true);
		expect(shouldSuppressRecap("quiet-hours")).toBe(true);
		expect(shouldSuppressRecap("fullscreen")).toBe(true);
		expect(shouldSuppressRecap("app-rule")).toBe(true);
	});

	it("enforces overlay and native lock cooldowns", () => {
		const now = 1_000_000;
		expect(overlayCooldownAllows(now, null)).toBe(true);
		expect(overlayCooldownAllows(now, now - OVERLAY_COOLDOWN_MS + 1)).toBe(
			false,
		);
		expect(overlayCooldownAllows(now, now - OVERLAY_COOLDOWN_MS)).toBe(true);

		expect(
			nativeLockCooldownAllows(now, now - NATIVE_LOCK_COOLDOWN_MS, null),
		).toBe(true);
		expect(
			nativeLockCooldownAllows(
				now,
				now - NATIVE_LOCK_COOLDOWN_MS + 1,
				null,
			),
		).toBe(false);
		expect(
			nativeLockCooldownAllows(
				now,
				now - 1_000,
				now - LOCK_SHORT_RETURN_MS + 1,
			),
		).toBe(false);
	});

	it("requires streak of at least two days for streak line", () => {
		expect(streakLineEligible(1)).toBe(false);
		expect(streakLineEligible(2)).toBe(true);
	});
});
