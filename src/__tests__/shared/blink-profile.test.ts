import { describe, expect, it } from "vitest";
import {
	costToAdvanceFrom,
	levelFromTotalBlinks,
	PROFILE_TITLE_MAX_LEVEL,
	profileDescKey,
	profileTierKey,
	profileTitleKey,
	progressToNextLevel,
	thresholdForLevel,
	tierForLevel,
	titleLevel,
	upcomingTitleMilestones,
} from "../../../shared/blink-profile";

describe("blink-profile", () => {
	it("has zero threshold for level 1", () => {
		expect(thresholdForLevel(1)).toBe(0);
		expect(levelFromTotalBlinks(0)).toBe(1);
	});

	it("uses exponential per-level costs", () => {
		expect(costToAdvanceFrom(1)).toBe(500);
		expect(costToAdvanceFrom(2)).toBe(Math.round(500 * 1.07));
		expect(thresholdForLevel(2)).toBe(costToAdvanceFrom(1));
		expect(thresholdForLevel(3)).toBe(
			costToAdvanceFrom(1) + costToAdvanceFrom(2),
		);
	});

	it("maps totals to levels consistently with thresholds", () => {
		const t10 = thresholdForLevel(10);
		expect(levelFromTotalBlinks(t10)).toBe(10);
		expect(levelFromTotalBlinks(t10 - 1)).toBe(9);

		const t50 = thresholdForLevel(50);
		expect(levelFromTotalBlinks(t50)).toBe(50);
		expect(levelFromTotalBlinks(t50 - 1)).toBe(49);
	});

	it("calibrates early/mid/endgame against daily-goal and shop scale", () => {
		// First step ≈ Cheer cost; L10 ≈ a bit over one default daily goal (4500).
		expect(costToAdvanceFrom(1)).toBe(500);
		const t10 = thresholdForLevel(10);
		expect(t10).toBeGreaterThan(5_000);
		expect(t10).toBeLessThan(8_000);

		const t50 = thresholdForLevel(50);
		expect(t50).toBeGreaterThan(150_000);
		expect(t50).toBeLessThan(250_000);

		// L100 ≈ multi-year daily-goal grind (~5–7M), not a short season.
		const t100 = thresholdForLevel(100);
		expect(t100).toBeGreaterThan(5_000_000);
		expect(t100).toBeLessThan(7_000_000);
		expect(levelFromTotalBlinks(t100)).toBe(100);
		expect(levelFromTotalBlinks(t100 - 1)).toBe(99);
	});

	it("continues leveling past 100 while capping title level", () => {
		const t101 = thresholdForLevel(101);
		expect(levelFromTotalBlinks(t101)).toBe(101);
		expect(titleLevel(101)).toBe(PROFILE_TITLE_MAX_LEVEL);
		expect(titleLevel(250)).toBe(100);
		expect(profileTitleKey(250)).toBe("profile.level.100.title");
		expect(profileDescKey(250)).toBe("profile.level.100.desc");
	});

	it("computes in-level progress", () => {
		const t5 = thresholdForLevel(5);
		const cost = costToAdvanceFrom(5);
		const mid = t5 + Math.floor(cost / 2);
		const progress = progressToNextLevel(mid);
		expect(progress.level).toBe(5);
		expect(progress.needed).toBe(cost);
		expect(progress.current).toBe(Math.floor(cost / 2));
		expect(progress.ratio).toBeCloseTo(0.5, 1);
	});

	it("maps tiers in bands of 10 and caps at 10", () => {
		expect(tierForLevel(1)).toBe(1);
		expect(tierForLevel(10)).toBe(1);
		expect(tierForLevel(11)).toBe(2);
		expect(tierForLevel(100)).toBe(10);
		expect(tierForLevel(150)).toBe(10);
		expect(profileTierKey(11)).toBe("profile.tier.2");
	});

	it("lists upcoming titled milestones", () => {
		expect(upcomingTitleMilestones(98, 3)).toEqual([99, 100]);
		expect(upcomingTitleMilestones(100, 3)).toEqual([]);
		expect(upcomingTitleMilestones(1, 3)).toEqual([2, 3, 4]);
	});
});
