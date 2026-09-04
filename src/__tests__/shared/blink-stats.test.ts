import { describe, expect, it } from "vitest";
import {
	BLINK_REWARDS,
	discountedRewardCost,
	shopDiscountPercent,
	shopDiscountUpgradeCost,
} from "../../../shared/blink-rewards";
import {
	addTrackingMs,
	applyRewardPurchase,
	availableBlinks,
	computeStreak,
	consumeSnoozeToken,
	equipCheerTheme,
	equipPopupPreset,
	DEFAULT_BLINK_STATS,
	EMPTY_EYE_CARE_COUNTS,
	emptyDayStats,
	formatTrackingDuration,
	goalProgress,
	localDateKey,
	localHour,
	normalizeBlinkStatsState,
	pruneDays,
	recordBlink,
	recordEyeCareOutcome,
	recordSessionStart,
	rewardOffers,
	shiftDateKey,
	spendBlinks,
	tokenSnoozeMinutes,
	toBlinkStatsSnapshot,
	toDayChart,
	todaySummary,
	toMonthChart,
	totalsSummary,
	toWeekChart,
	toYearChart,
	weekEyeCareTotals,
} from "../../../shared/blink-stats";

function withDays(
	days: ReturnType<typeof emptyDayStats>[],
	totals: { totalBlinks?: number; spentBlinks?: number } = {},
) {
	return {
		...DEFAULT_BLINK_STATS,
		days,
		totalBlinks:
			totals.totalBlinks ?? days.reduce((sum, day) => sum + day.blinks, 0),
		spentBlinks: totals.spentBlinks ?? 0,
	};
}

describe("blink-stats helpers", () => {
	it("formats local date keys and hours", () => {
		const noon = new Date(2026, 7, 7, 12, 30, 0);
		expect(localDateKey(noon)).toBe("2026-08-07");
		expect(localHour(noon)).toBe(12);
		expect(shiftDateKey("2026-08-07", -1)).toBe("2026-08-06");
	});

	it("records blinks into the correct hourly bucket and lifetime total", () => {
		const now = new Date(2026, 7, 7, 14, 0, 0);
		const state = recordBlink(DEFAULT_BLINK_STATS, now);
		expect(todaySummary(state, "2026-08-07")).toEqual({
			date: "2026-08-07",
			blinks: 1,
			trackingMs: 0,
			sessions: 0,
			...EMPTY_EYE_CARE_COUNTS,
		});
		expect(toDayChart(state, "2026-08-07")[14]?.value).toBe(1);
		expect(totalsSummary(state)).toEqual({
			total: 1,
			spent: 0,
			available: 1,
		});
	});

	it("keeps lifetime total when pruned days drop off", () => {
		const today = "2026-08-07";
		let state = recordBlink(
			DEFAULT_BLINK_STATS,
			new Date(2026, 7, 7, 10, 0, 0),
		);
		state = {
			...state,
			days: [
				{ ...emptyDayStats(shiftDateKey(today, -400)), blinks: 0 },
				...state.days,
			],
			totalBlinks: 42,
		};
		const pruned = pruneDays(state, 366, today);
		expect(pruned.days.map((day) => day.date)).toEqual([today]);
		expect(pruned.totalBlinks).toBe(42);
		expect(availableBlinks(pruned)).toBe(42);
	});

	it("spendBlinks deducts from available and rejects overspend", () => {
		const state = withDays([{ ...emptyDayStats("2026-08-07"), blinks: 10 }], {
			totalBlinks: 10,
		});
		const spent = spendBlinks(state, 3);
		expect(spent).toEqual({
			...state,
			spentBlinks: 3,
		});
		expect(totalsSummary(spent ?? DEFAULT_BLINK_STATS)).toEqual({
			total: 10,
			spent: 3,
			available: 7,
		});
		expect(spendBlinks(spent ?? DEFAULT_BLINK_STATS, 8)).toBeNull();
		expect(spendBlinks(state, 0)).toBeNull();
	});

	it("accumulates tracking time and sessions", () => {
		const now = new Date(2026, 7, 7, 9, 0, 0);
		let state = recordSessionStart(DEFAULT_BLINK_STATS, now);
		state = addTrackingMs(state, 90_000, now);
		expect(todaySummary(state, "2026-08-07")).toMatchObject({
			blinks: 0,
			trackingMs: 90_000,
			sessions: 1,
		});
		expect(formatTrackingDuration(90_000)).toBe("1m");
		expect(formatTrackingDuration(3_660_000)).toBe("1h 1m");
		expect(formatTrackingDuration(90_000, "uk")).toBe("1хв");
		expect(formatTrackingDuration(3_660_000, "uk")).toBe("1год 1хв");
	});

	it("builds a Mon–Sun week chart with gaps filled as zero", () => {
		const today = "2026-08-07";
		let state = recordBlink(
			DEFAULT_BLINK_STATS,
			new Date(2026, 7, 7, 10, 0, 0),
		);
		state = recordBlink(state, new Date(2026, 7, 5, 10, 0, 0));
		const week = toWeekChart(state, today);
		expect(week.map((bucket) => bucket.label)).toEqual([
			"Mon",
			"Tue",
			"Wed",
			"Thu",
			"Fri",
			"Sat",
			"Sun",
		]);
		expect(week.map((bucket) => bucket.value)).toEqual([0, 0, 1, 0, 1, 0, 0]);

		const weekUk = toWeekChart(state, today, "uk");
		expect(weekUk.map((bucket) => bucket.label)).toEqual([
			"Пн",
			"Вт",
			"Ср",
			"Чт",
			"Пт",
			"Сб",
			"Нд",
		]);
	});

	it("builds a year chart with monthly blink totals", () => {
		const today = "2026-08-07";
		const state = withDays([
			{ ...emptyDayStats("2026-01-15"), blinks: 2 },
			{ ...emptyDayStats("2026-01-20"), blinks: 3 },
			{ ...emptyDayStats("2026-08-07"), blinks: 4 },
			{ ...emptyDayStats("2025-12-31"), blinks: 99 },
		]);
		const year = toYearChart(state, today);
		expect(year.map((bucket) => bucket.label)).toEqual([
			"Jan",
			"Feb",
			"Mar",
			"Apr",
			"May",
			"Jun",
			"Jul",
			"Aug",
			"Sep",
			"Oct",
			"Nov",
			"Dec",
		]);
		expect(year[0]?.value).toBe(5);
		expect(year[7]?.value).toBe(4);
		expect(year.map((bucket) => bucket.value)).toEqual([
			5, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0,
		]);

		const yearUk = toYearChart(state, today, "uk");
		expect(yearUk.map((bucket) => bucket.label)[0]).toBe("Січ");
		expect(yearUk.map((bucket) => bucket.label)[7]).toBe("Сер");
	});

	it("builds a month chart with one bar per calendar day", () => {
		const august = toMonthChart(
			withDays([
				{ ...emptyDayStats("2026-08-01"), blinks: 2 },
				{ ...emptyDayStats("2026-08-31"), blinks: 5 },
				{ ...emptyDayStats("2026-07-31"), blinks: 9 },
			]),
			"2026-08-07",
		);
		expect(august).toHaveLength(31);
		expect(august[0]).toEqual({ label: "1", value: 2 });
		expect(august[30]).toEqual({ label: "31", value: 5 });
		expect(august[6]?.value).toBe(0);

		const february = toMonthChart(DEFAULT_BLINK_STATS, "2026-02-10");
		expect(february).toHaveLength(28);
		expect(february[0]?.label).toBe("1");
		expect(february[27]?.label).toBe("28");
	});

	it("records eye-care outcomes and keeps them through sanitize and prune", () => {
		const now = new Date(2026, 7, 7, 10, 0, 0);
		let state = recordEyeCareOutcome(
			DEFAULT_BLINK_STATS,
			"lookAway",
			"completed",
			now,
		);
		state = recordEyeCareOutcome(state, "lookAway", "skipped", now);
		state = recordEyeCareOutcome(state, "lookAway", "snoozed", now);
		state = recordEyeCareOutcome(state, "exercise", "completed", now);
		expect(todaySummary(state, "2026-08-07")).toMatchObject({
			lookAwayCompleted: 1,
			lookAwaySkipped: 1,
			lookAwaySnoozed: 1,
			exerciseCompleted: 1,
			exerciseSkipped: 0,
			blinks: 0,
		});
		expect(weekEyeCareTotals(state, "2026-08-07").lookAwayCompleted).toBe(1);
		expect(state.totalBlinks).toBe(0);

		const normalized = normalizeBlinkStatsState({
			days: [
				{
					date: "2026-08-07",
					blinks: 3,
					lookAwayCompleted: 2,
				},
			],
		});
		expect(normalized.days[0]).toMatchObject({
			lookAwayCompleted: 2,
			lookAwaySkipped: 0,
			exerciseCompleted: 0,
			hourlyBlinks: expect.any(Array),
		});

		const pruned = pruneDays(
			{
				...DEFAULT_BLINK_STATS,
				days: [
					{ ...emptyDayStats("2025-01-01"), lookAwayCompleted: 9 },
					{ ...emptyDayStats("2026-08-07"), lookAwayCompleted: 4 },
				],
			},
			366,
			"2026-08-07",
		);
		expect(pruned.days.map((day) => day.date)).toEqual(["2026-08-07"]);
		expect(pruned.days[0]?.lookAwayCompleted).toBe(4);
	});

	it("prunes days outside retention", () => {
		const today = "2026-08-07";
		const state = withDays(
			[emptyDayStats(shiftDateKey(today, -400)), emptyDayStats(today)],
			{ totalBlinks: 5 },
		);
		const pruned = pruneDays(state, 366, today);
		expect(pruned.days.map((day) => day.date)).toEqual([today]);
		expect(pruned.totalBlinks).toBe(5);
	});

	it("normalizes corrupt persisted payloads and seeds total from days", () => {
		expect(normalizeBlinkStatsState(null)).toEqual(DEFAULT_BLINK_STATS);
		const normalized = normalizeBlinkStatsState({
			days: [
				{ date: "bad", blinks: 3 },
				{
					date: "2026-08-07",
					blinks: 2.7,
					trackingMs: -5,
					sessions: 1,
					hourlyBlinks: [1, "x"],
				},
			],
		});
		expect(normalized.days).toHaveLength(1);
		expect(normalized.days[0]).toMatchObject({
			date: "2026-08-07",
			blinks: 2,
			trackingMs: 0,
			sessions: 1,
		});
		expect(normalized.days[0]?.hourlyBlinks).toHaveLength(24);
		expect(normalized.days[0]?.hourlyBlinks[0]).toBe(1);
		expect(normalized.days[0]?.hourlyBlinks[1]).toBe(0);
		expect(normalized.totalBlinks).toBe(2);
		expect(normalized.spentBlinks).toBe(0);
		expect(normalized.unlockedRewardIds).toEqual([]);
		expect(normalized.unlockedAchievementIds).toEqual([]);
		expect(normalized.streakShieldCharges).toBe(0);
		expect(normalized.rewardPurchaseCounts).toEqual({});
		expect(normalized.shopDiscountLevel).toBe(0);
		expect(normalized.unlockedCheerThemeIds).toEqual([]);
		expect(normalized.equippedCheerTheme).toBe("random");
		expect(normalized.unlockedPopupPresetIds).toEqual([]);
		expect(normalized.equippedPopupPresetId).toBeNull();
		expect(normalized.snoozeTokenCharges).toBe(0);
	});

	it("keeps valid achievement ids on normalize and snapshot", () => {
		const normalized = normalizeBlinkStatsState({
			days: [],
			unlockedAchievementIds: ["firstBlink", "nope", "firstBlink"],
			totalBlinks: 1,
		});
		expect(normalized.unlockedAchievementIds).toEqual(["firstBlink"]);
		const snapshot = toBlinkStatsSnapshot(normalized);
		expect(snapshot.unlockedAchievementIds).toEqual(["firstBlink"]);
		expect(snapshot.achievementsUnlocked).toBe(1);
		expect(snapshot.achievementsTotal).toBe(18);
		expect(snapshot.achievementProgress.blinks1k).toEqual({
			current: 1,
			target: 1_000,
		});
	});

	it("computes daily and weekly goal progress", () => {
		const today = new Date(2026, 7, 7, 12, 0, 0); // Fri
		const state = withDays([
			{
				...emptyDayStats("2026-08-07"),
				blinks: 100,
				trackingMs: 30 * 60_000,
			},
			{ ...emptyDayStats("2026-08-03"), blinks: 50, trackingMs: 10 * 60_000 },
		]);
		const goals = {
			goalsEnabled: true,
			dailyBlinkGoal: 240,
			dailyTrackingMinutesGoal: 60,
			weeklyBlinkGoal: 140,
			weeklyTrackingMinutesGoal: 30,
		};
		const progress = goalProgress(state, goals, today);
		expect(progress.dailyBlinks).toMatchObject({
			current: 100,
			target: 240,
			enabled: true,
			met: false,
		});
		expect(progress.dailyTrackingMinutes).toMatchObject({
			current: 30,
			target: 60,
			met: false,
		});
		expect(progress.weeklyBlinks.current).toBe(150);
		expect(progress.weeklyBlinks.met).toBe(true);
		expect(progress.weeklyTrackingMinutes.met).toBe(true);
		expect(progress.dailyMet).toBe(false);
	});

	it("computes streak across midnight and consumes a shield once", () => {
		const goals = {
			goalsEnabled: true,
			dailyBlinkGoal: 10,
			dailyTrackingMinutesGoal: 0,
			weeklyBlinkGoal: 0,
			weeklyTrackingMinutesGoal: 0,
		};
		const state = withDays(
			[
				{ ...emptyDayStats("2026-08-05"), blinks: 10 },
				{ ...emptyDayStats("2026-08-06"), blinks: 2 },
				{ ...emptyDayStats("2026-08-07"), blinks: 10 },
			],
			{ totalBlinks: 22 },
		);
		state.streakShieldCharges = 1;

		const friday = new Date(2026, 7, 7, 10, 0, 0);
		const result = computeStreak(state, goals, friday);
		expect(result.streak.current).toBe(3);
		expect(result.streak.shieldCharges).toBe(0);
		expect(result.state.streakShieldUsedDates).toContain("2026-08-06");

		const again = computeStreak(result.state, goals, friday);
		expect(again.streak.current).toBe(3);
		expect(again.streak.shieldCharges).toBe(0);
		expect(again.state.streakShieldUsedDates).toEqual(
			result.state.streakShieldUsedDates,
		);

		const saturday = new Date(2026, 7, 8, 1, 0, 0);
		const afterMidnight = computeStreak(result.state, goals, saturday);
		// Saturday incomplete; streak from Fri+Thu(shield)+Wed
		expect(afterMidnight.streak.current).toBe(3);
	});

	it("applies reward purchases and rejects invalid buys", () => {
		const flairCost = BLINK_REWARDS.statsFlair.cost;
		const shieldCost = BLINK_REWARDS.streakShield.cost;
		const cheerCost = BLINK_REWARDS.cheer.cost;
		const total = flairCost + shieldCost + cheerCost;
		const state = withDays(
			[{ ...emptyDayStats("2026-08-07"), blinks: total }],
			{ totalBlinks: total },
		);
		const flair = applyRewardPurchase(state, "statsFlair");
		expect(flair?.spentBlinks).toBe(flairCost);
		expect(flair?.unlockedRewardIds).toContain("statsFlair");
		expect(flair?.rewardPurchaseCounts.statsFlair).toBe(1);
		expect(applyRewardPurchase(flair ?? state, "statsFlair")).toBeNull();

		const shield = applyRewardPurchase(flair ?? state, "streakShield");
		expect(shield?.streakShieldCharges).toBe(1);
		expect(shield?.rewardPurchaseCounts.streakShield).toBe(1);
		expect(applyRewardPurchase(shield ?? state, "streakShield")).toBeNull();

		const cheer = applyRewardPurchase(shield ?? state, "cheer");
		expect(cheer?.spentBlinks).toBe(total);
		expect(cheer?.rewardPurchaseCounts.cheer).toBe(1);
		expect(availableBlinks(cheer ?? state)).toBe(0);
	});

	it("escalates shop discount upgrades and discounts other buys", () => {
		const firstUpgrade = shopDiscountUpgradeCost(0);
		expect(firstUpgrade).toBe(1500);
		expect(shopDiscountUpgradeCost(1)).toBe(3000);
		expect(shopDiscountUpgradeCost(9)).toBe(15000);
		expect(shopDiscountUpgradeCost(10)).toBeNull();

		const budget = 1500 + 3000 + BLINK_REWARDS.cheer.cost;
		const state = withDays(
			[{ ...emptyDayStats("2026-08-07"), blinks: budget }],
			{ totalBlinks: budget },
		);

		const level1 = applyRewardPurchase(state, "shopDiscount");
		expect(level1?.shopDiscountLevel).toBe(1);
		expect(level1?.spentBlinks).toBe(1500);
		expect(level1?.rewardPurchaseCounts.shopDiscount).toBe(1);
		expect(shopDiscountPercent(level1?.shopDiscountLevel ?? 0)).toBe(5);

		// Discount does not reduce the next discount upgrade cost.
		const level2 = applyRewardPurchase(level1 ?? state, "shopDiscount");
		expect(level2?.shopDiscountLevel).toBe(2);
		expect(level2?.spentBlinks).toBe(1500 + 3000);
		expect(shopDiscountPercent(2)).toBe(10);

		const cheerCost = discountedRewardCost(BLINK_REWARDS.cheer.cost, 10);
		expect(cheerCost).toBe(450);
		const cheer = applyRewardPurchase(level2 ?? state, "cheer");
		expect(cheer?.spentBlinks).toBe(1500 + 3000 + cheerCost);
		expect(cheer?.rewardPurchaseCounts.cheer).toBe(1);

		const offers = rewardOffers(cheer ?? state);
		const cheerOffer = offers.find((offer) => offer.id === "cheer");
		expect(cheerOffer?.cost).toBe(cheerCost);
		expect(cheerOffer?.discountPercent).toBe(10);

		const discountOffer = offers.find((offer) => offer.id === "shopDiscount");
		expect(discountOffer?.cost).toBe(4500);
		expect(discountOffer?.purchaseCount).toBe(2);
		expect(discountOffer?.maxPurchases).toBe(10);
		expect(discountOffer?.atMax).toBe(false);
	});

	it("caps shop discount at 50% / 10 levels", () => {
		const state = {
			...DEFAULT_BLINK_STATS,
			totalBlinks: 1_000_000,
			shopDiscountLevel: 9,
			rewardPurchaseCounts: { shopDiscount: 9 },
		};
		const last = applyRewardPurchase(state, "shopDiscount");
		expect(last?.shopDiscountLevel).toBe(10);
		expect(last?.spentBlinks).toBe(15000);
		expect(applyRewardPurchase(last ?? state, "shopDiscount")).toBeNull();

		const offers = rewardOffers(last ?? state);
		const discountOffer = offers.find((offer) => offer.id === "shopDiscount");
		expect(discountOffer?.atMax).toBe(true);
		expect(discountOffer?.discountPercent).toBe(50);
		expect(discountOffer?.purchaseCount).toBe(10);

		const cheerOffer = offers.find((offer) => offer.id === "cheer");
		expect(cheerOffer?.cost).toBe(
			discountedRewardCost(BLINK_REWARDS.cheer.cost, 50),
		);
	});

	it("unlocks cheer themes, popup presets, and snooze tokens", () => {
		const budget =
			BLINK_REWARDS.cheerThemeBounce.cost +
			BLINK_REWARDS.popupPresetAurora.cost +
			BLINK_REWARDS.snoozeToken.cost * 2;
		const state = withDays([], { totalBlinks: budget });

		const bounce = applyRewardPurchase(state, "cheerThemeBounce");
		expect(bounce?.unlockedCheerThemeIds).toContain("bounce");
		expect(bounce?.unlockedRewardIds).toContain("cheerThemeBounce");

		const aurora = applyRewardPurchase(bounce ?? state, "popupPresetAurora");
		expect(aurora?.unlockedPopupPresetIds).toContain("aurora");

		const token1 = applyRewardPurchase(aurora ?? state, "snoozeToken");
		expect(token1?.snoozeTokenCharges).toBe(1);
		const token2 = applyRewardPurchase(token1 ?? state, "snoozeToken");
		expect(token2?.snoozeTokenCharges).toBe(2);
		expect(applyRewardPurchase(token2 ?? state, "snoozeToken")).toBeNull();

		const equipped = equipCheerTheme(token2 ?? state, "bounce");
		expect(equipped?.equippedCheerTheme).toBe("bounce");
		const preset = equipPopupPreset(equipped ?? state, "aurora");
		expect(preset?.equippedPopupPresetId).toBe("aurora");

		const offers = rewardOffers(preset ?? state);
		const bounceOffer = offers.find((o) => o.id === "cheerThemeBounce");
		expect(bounceOffer?.isEquipped).toBe(true);
		expect(bounceOffer?.canEquip).toBe(false);
	});

	it("consumes snooze tokens and exposes canUse on reward offers", () => {
		expect(tokenSnoozeMinutes(5)).toBe(10);
		expect(tokenSnoozeMinutes(0)).toBe(2);

		const budget = BLINK_REWARDS.snoozeToken.cost;
		const purchased = applyRewardPurchase(
			withDays([], { totalBlinks: budget }),
			"snoozeToken",
		);
		expect(purchased?.snoozeTokenCharges).toBe(1);
		expect(
			rewardOffers(purchased ?? DEFAULT_BLINK_STATS).find(
				(o) => o.id === "snoozeToken",
			)?.canUse,
		).toBe(true);

		const spent = consumeSnoozeToken(purchased ?? DEFAULT_BLINK_STATS);
		expect(spent?.snoozeTokenCharges).toBe(0);
		expect(consumeSnoozeToken(spent ?? DEFAULT_BLINK_STATS)).toBeNull();
		expect(
			rewardOffers(spent ?? DEFAULT_BLINK_STATS).find(
				(o) => o.id === "snoozeToken",
			)?.canUse,
		).toBe(false);
	});
});
