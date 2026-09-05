import { describe, expect, it } from "vitest";
import {
	ACHIEVEMENT_CATEGORIES,
	ACHIEVEMENT_COUNT,
	ACHIEVEMENT_IDS,
	ACHIEVEMENT_IDS_BY_CATEGORY,
	type AchievementEvalContext,
	achievementIdsByCategory,
	achievementProgress,
	evaluateAchievements,
	isAchievementId,
	mergeUnlockedAchievementIds,
	newlyUnlockedAchievements,
} from "../../../shared/achievements";
import {
	type BlinkStatsState,
	DEFAULT_BLINK_STATS,
	emptyDayStats,
} from "../../../shared/blink-stats";
import { DEFAULT_GOALS_CONFIG } from "../../../shared/preferences";

function ctx(
	overrides: Partial<AchievementEvalContext> & {
		stats?: BlinkStatsState;
	} = {},
): AchievementEvalContext {
	return {
		stats: overrides.stats ?? DEFAULT_BLINK_STATS,
		streak: overrides.streak ?? 0,
		goals: overrides.goals ?? DEFAULT_GOALS_CONFIG,
		cameraEnabled: overrides.cameraEnabled ?? true,
		hasCompletedOnboarding: overrides.hasCompletedOnboarding ?? false,
		hasEarCalibration: overrides.hasEarCalibration ?? false,
	};
}

describe("achievements catalog", () => {
	it("has 18 unique ids", () => {
		expect(ACHIEVEMENT_IDS).toHaveLength(18);
		expect(ACHIEVEMENT_COUNT).toBe(18);
		expect(new Set(ACHIEVEMENT_IDS).size).toBe(18);
		expect(isAchievementId("firstBlink")).toBe(true);
		expect(isAchievementId("bargainHunter")).toBe(false);
	});

	it("unlocks nothing on empty stats", () => {
		expect(evaluateAchievements(ctx())).toEqual([]);
	});

	it("grants start and exploration flags independently of blinks", () => {
		expect(evaluateAchievements(ctx({ hasCompletedOnboarding: true }))).toEqual(
			["gettingStarted"],
		);
		expect(evaluateAchievements(ctx({ hasEarCalibration: true }))).toEqual([
			"calibrated",
		]);
	});

	it("grants first blink and first session from stats", () => {
		expect(
			evaluateAchievements(
				ctx({
					stats: { ...DEFAULT_BLINK_STATS, totalBlinks: 1 },
				}),
			),
		).toEqual(["firstBlink"]);
		expect(
			evaluateAchievements(
				ctx({
					stats: {
						...DEFAULT_BLINK_STATS,
						days: [{ ...emptyDayStats("2026-08-07"), sessions: 1 }],
					},
				}),
			),
		).toEqual(["firstSession"]);
	});

	it("grants retro progression from high totals", () => {
		const earned = evaluateAchievements(
			ctx({
				stats: { ...DEFAULT_BLINK_STATS, totalBlinks: 50_000 },
				hasCompletedOnboarding: true,
			}),
		);
		expect(earned).toContain("firstBlink");
		expect(earned).toContain("gettingStarted");
		expect(earned).toContain("blinks1k");
		expect(earned).toContain("blinks10k");
		expect(earned).toContain("blinks50k");
		expect(earned).not.toContain("blinks250k");
		expect(earned).toContain("level10");
		expect(earned).toContain("level25");
	});

	it("grants habit unlocks from streak, goals, tracking, and active days", () => {
		const days = Array.from({ length: 7 }, (_, index) => ({
			...emptyDayStats(`2026-08-0${index + 1}`),
			blinks: 100,
			trackingMs: 2 * 60 * 60 * 1000,
		}));
		const earned = evaluateAchievements(
			ctx({
				stats: {
					...DEFAULT_BLINK_STATS,
					days,
					totalBlinks: 700,
				},
				streak: 7,
				goals: {
					goalsEnabled: true,
					dailyBlinkGoal: 50,
					dailyTrackingMinutesGoal: 0,
					weeklyBlinkGoal: 0,
					weeklyTrackingMinutesGoal: 0,
				},
			}),
		);
		expect(earned).toContain("streak3");
		expect(earned).toContain("streak7");
		expect(earned).not.toContain("streak30");
		expect(earned).toContain("goalDay");
		expect(earned).toContain("tracking10h");
		expect(earned).toContain("activeDays7");
	});

	it("grants goalDay from tracking minutes when camera is off", () => {
		const earned = evaluateAchievements(
			ctx({
				stats: {
					...DEFAULT_BLINK_STATS,
					days: [
						{
							...emptyDayStats("2026-08-07"),
							blinks: 0,
							trackingMs: 300 * 60_000,
						},
					],
				},
				goals: {
					goalsEnabled: true,
					dailyBlinkGoal: 4500,
					dailyTrackingMinutesGoal: 300,
					weeklyBlinkGoal: 0,
					weeklyTrackingMinutesGoal: 0,
				},
				cameraEnabled: false,
			}),
		);
		expect(earned).toContain("goalDay");
		expect(earned).not.toContain("firstBlink");
	});

	it("grants firstCheer from purchase counts", () => {
		expect(
			evaluateAchievements(
				ctx({
					stats: {
						...DEFAULT_BLINK_STATS,
						rewardPurchaseCounts: { cheer: 1 },
					},
				}),
			),
		).toEqual(["firstCheer"]);
	});

	it("diffs newly unlocked without repeating", () => {
		const earned = evaluateAchievements(
			ctx({
				stats: { ...DEFAULT_BLINK_STATS, totalBlinks: 1 },
				hasCompletedOnboarding: true,
			}),
		);
		expect(newlyUnlockedAchievements(["firstBlink"], earned)).toEqual([
			"gettingStarted",
		]);
		expect(mergeUnlockedAchievementIds(["firstBlink"], earned)).toEqual([
			"firstBlink",
			"gettingStarted",
		]);
	});

	it("reports numeric progress toward blink and streak targets", () => {
		const progress = achievementProgress(
			"blinks1k",
			ctx({ stats: { ...DEFAULT_BLINK_STATS, totalBlinks: 250 } }),
		);
		expect(progress).toEqual({ current: 250, target: 1_000 });
		expect(achievementProgress("firstBlink", ctx())).toBeNull();
		expect(achievementProgress("streak7", ctx({ streak: 2 }))).toEqual({
			current: 2,
			target: 7,
		});
	});

	it("groups catalog ids by category", () => {
		expect(achievementIdsByCategory("start")).toEqual([
			"firstBlink",
			"firstSession",
			"gettingStarted",
		]);
		expect(achievementIdsByCategory("explore")).toEqual([
			"firstCheer",
			"calibrated",
		]);
		const grouped = ACHIEVEMENT_CATEGORIES.flatMap((category) =>
			achievementIdsByCategory(category),
		);
		expect(grouped).toEqual([...ACHIEVEMENT_IDS]);
		expect(ACHIEVEMENT_IDS_BY_CATEGORY.start).toEqual(
			achievementIdsByCategory("start"),
		);
	});
});
