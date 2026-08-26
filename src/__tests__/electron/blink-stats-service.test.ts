import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BlinkStatsService } from "../../../electron/application/blink-stats-service";
import type { PreferenceStore } from "../../../electron/application/ports/preference-store";
import { BLINK_REWARDS } from "../../../shared/blink-rewards";
import {
	BLINK_STATS_STORE_KEY,
	DEFAULT_BLINK_STATS,
	emptyDayStats,
	localDateKey,
} from "../../../shared/blink-stats";

function createStore(): PreferenceStore & { data: Map<string, unknown> } {
	const data = new Map<string, unknown>();
	return {
		data,
		get<T>(key: string, defaultValue?: T): T {
			if (data.has(key)) return data.get(key) as T;
			return defaultValue as T;
		},
		set<T>(key: string, value: T): void {
			data.set(key, value);
		},
		has(key: string): boolean {
			return data.has(key);
		},
		clear(): void {
			data.clear();
		},
	};
}

describe("BlinkStatsService", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 7, 7, 15, 0, 0));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("persists credited blinks and pushes snapshots when live UI is open", () => {
		const store = createStore();
		const service = new BlinkStatsService(store);
		const push = vi.fn();
		service.setPushHandler(push);
		service.setLivePushEnabled(true);
		push.mockClear();

		service.recordBlink();
		vi.advanceTimersByTime(1000);

		expect(service.getSnapshot().today.blinks).toBe(1);
		expect(service.getSnapshot().totals).toEqual({
			total: 1,
			spent: 0,
			available: 1,
		});
		expect(push).toHaveBeenCalled();
		const persisted = store.get(BLINK_STATS_STORE_KEY) as {
			days: Array<{ date: string; blinks: number }>;
			totalBlinks: number;
		};
		expect(persisted.days[0]?.date).toBe(localDateKey());
		expect(persisted.days[0]?.blinks).toBe(1);
		expect(persisted.totalBlinks).toBe(1);
		service.dispose();
	});

	it("does not push while Statistics is closed", () => {
		const store = createStore();
		const service = new BlinkStatsService(store);
		const push = vi.fn();
		service.setPushHandler(push);

		service.onTrackingStart();
		service.recordBlink();
		vi.advanceTimersByTime(20_000);
		expect(push).not.toHaveBeenCalled();
		expect(service.getSnapshot().today.blinks).toBe(1);

		service.setLivePushEnabled(true);
		expect(push).toHaveBeenCalledTimes(1);

		push.mockClear();
		service.setLivePushEnabled(false);
		service.recordBlink();
		vi.advanceTimersByTime(5_000);
		expect(push).not.toHaveBeenCalled();
		service.dispose();
	});

	it("spend stub deducts available balance", () => {
		const store = createStore();
		const service = new BlinkStatsService(store);
		service.recordBlink();
		service.recordBlink();
		expect(service.spend(1)).toBe(true);
		expect(service.getSnapshot().totals).toEqual({
			total: 2,
			spent: 1,
			available: 1,
		});
		expect(service.spend(5)).toBe(false);
		service.dispose();
	});

	it("purchaseReward persists spent unlocks and clears them on reset", () => {
		const store = createStore();
		const onCheer = vi.fn();
		const service = new BlinkStatsService(
			store,
			() => "en",
			() => ({
				goalsEnabled: true,
				dailyBlinkGoal: 10,
				dailyTrackingMinutesGoal: 0,
				weeklyBlinkGoal: 0,
				weeklyTrackingMinutesGoal: 0,
			}),
		);
		service.setCheerEffects({ onCheer });
		const need = BLINK_REWARDS.statsFlair.cost + BLINK_REWARDS.cheer.cost;
		for (let i = 0; i < need; i += 1) service.recordBlink();
		onCheer.mockClear();

		expect(service.purchaseReward("statsFlair")).toBe(true);
		expect(service.getSnapshot().hasStatsFlair).toBe(true);
		expect(service.getSnapshot().totals.spent).toBe(
			BLINK_REWARDS.statsFlair.cost,
		);
		expect(service.purchaseReward("cheer")).toBe(true);
		expect(onCheer).toHaveBeenCalledTimes(1);

		const persisted = store.get(BLINK_STATS_STORE_KEY) as {
			spentBlinks: number;
			unlockedRewardIds: string[];
		};
		expect(persisted.spentBlinks).toBe(need);
		expect(persisted.unlockedRewardIds).toContain("statsFlair");

		service.reset();
		expect(service.getSnapshot().hasStatsFlair).toBe(false);
		expect(service.getSnapshot().totals.spent).toBe(0);
		expect(service.getSnapshot().streak.current).toBe(0);
		service.dispose();
	});

	it("debug reward grants and previewCheer skip spend", () => {
		const store = createStore();
		const onCheer = vi.fn();
		const service = new BlinkStatsService(
			store,
			() => "en",
			() => ({
				goalsEnabled: false,
				dailyBlinkGoal: 0,
				dailyTrackingMinutesGoal: 0,
				weeklyBlinkGoal: 0,
				weeklyTrackingMinutesGoal: 0,
			}),
		);
		service.setCheerEffects({ onCheer });

		expect(service.getSnapshot().hasStatsFlair).toBe(false);
		service.setDebugRewardGrant("statsFlair", true);
		expect(service.getSnapshot().hasStatsFlair).toBe(true);
		expect(service.getSnapshot().totals.spent).toBe(0);

		service.setDebugRewardGrant("streakShield", true);
		expect(service.getSnapshot().streak.shieldCharges).toBe(1);

		service.setDebugRewardGrant("statsFlair", false);
		service.setDebugRewardGrant("streakShield", false);
		expect(service.getSnapshot().hasStatsFlair).toBe(false);
		expect(service.getSnapshot().streak.shieldCharges).toBe(0);

		service.previewCheer();
		expect(onCheer).toHaveBeenCalledTimes(1);
		expect(service.getSnapshot().totals.spent).toBe(0);
		service.dispose();
	});

	it("debug shop discount level applies without spending", () => {
		const store = createStore();
		const service = new BlinkStatsService(
			store,
			() => "en",
			() => ({
				goalsEnabled: false,
				dailyBlinkGoal: 0,
				dailyTrackingMinutesGoal: 0,
				weeklyBlinkGoal: 0,
				weeklyTrackingMinutesGoal: 0,
			}),
		);

		service.setDebugShopDiscountLevel(3);
		const offers = service.getSnapshot().rewards;
		const discount = offers.find((offer) => offer.id === "shopDiscount");
		const cheer = offers.find((offer) => offer.id === "cheer");
		expect(discount?.purchaseCount).toBe(3);
		expect(discount?.discountPercent).toBe(15);
		expect(cheer?.cost).toBe(
			Math.max(1, Math.floor(BLINK_REWARDS.cheer.cost * 0.85)),
		);
		expect(service.getSnapshot().totals.spent).toBe(0);

		service.setDebugShopDiscountLevel(0);
		const cleared = service
			.getSnapshot()
			.rewards.find((offer) => offer.id === "shopDiscount");
		expect(cleared?.purchaseCount).toBe(0);
		expect(cleared?.discountPercent).toBe(0);
		service.dispose();
	});

	it("exposes goal progress from injected prefs", () => {
		const store = createStore();
		const service = new BlinkStatsService(
			store,
			() => "en",
			() => ({
				goalsEnabled: true,
				dailyBlinkGoal: 5,
				dailyTrackingMinutesGoal: 0,
				weeklyBlinkGoal: 0,
				weeklyTrackingMinutesGoal: 0,
			}),
		);
		for (let i = 0; i < 5; i += 1) service.recordBlink();
		const snapshot = service.getSnapshot();
		expect(snapshot.goals.dailyBlinks.met).toBe(true);
		expect(snapshot.goals.dailyMet).toBe(true);
		expect(snapshot.streak.current).toBe(1);
		service.dispose();
	});

	it("tracks sessions and accumulates tracking time on flush", () => {
		const store = createStore();
		const service = new BlinkStatsService(store);

		service.onTrackingStart();
		expect(service.getSnapshot().today.sessions).toBe(1);

		vi.advanceTimersByTime(15_000);
		expect(service.getSnapshot().today.trackingMs).toBeGreaterThanOrEqual(
			15_000,
		);

		service.onTrackingStop();
		const trackingMs = service.getSnapshot().today.trackingMs;
		expect(trackingMs).toBeGreaterThanOrEqual(15_000);

		vi.advanceTimersByTime(30_000);
		expect(service.getSnapshot().today.trackingMs).toBe(trackingMs);
		service.dispose();
	});

	it("reset clears totals and history and restarts an active session", () => {
		const store = createStore();
		const service = new BlinkStatsService(store);
		service.onTrackingStart();
		service.recordBlink();
		service.spend(1);
		service.reset();

		expect(service.getSnapshot().today.blinks).toBe(0);
		expect(service.getSnapshot().today.sessions).toBe(1);
		expect(service.getSnapshot().totals).toEqual({
			total: 0,
			spent: 0,
			available: 0,
		});
		expect(service.getSnapshot().blinksPerMinute).toBe(0);
		service.dispose();
	});

	it("exposes live blinksPerMinute only after a one-minute warmup", () => {
		const store = createStore();
		const service = new BlinkStatsService(store);
		const push = vi.fn();
		service.setPushHandler(push);
		service.setLivePushEnabled(true);
		push.mockClear();

		service.onTrackingStart();
		expect(service.getSnapshot().blinkRateReady).toBe(false);
		expect(service.getSnapshot().blinksPerMinute).toBe(0);

		vi.advanceTimersByTime(50_000);
		service.recordBlink();
		service.recordBlink();
		service.recordBlink();
		expect(service.getSnapshot().blinkRateReady).toBe(false);
		expect(service.getSnapshot().blinksPerMinute).toBe(0);
		expect(service.getSnapshot().blinkRateWarmupMs).toBe(50_000);

		vi.advanceTimersByTime(10_000);
		expect(service.getSnapshot().blinkRateReady).toBe(true);
		expect(service.getSnapshot().blinksPerMinute).toBe(3);

		// Let any pending throttle from the ready transition settle.
		vi.advanceTimersByTime(1_000);
		push.mockClear();
		// Stable BPM must not spam full snapshot IPC every tick.
		vi.advanceTimersByTime(5_000);
		expect(push).not.toHaveBeenCalled();
		expect(service.getSnapshot().blinksPerMinute).toBe(3);

		// Rolling window ages out the blinks recorded at t=50s once now >= 110s.
		vi.advanceTimersByTime(55_000);
		expect(service.getSnapshot().blinksPerMinute).toBe(0);

		service.onTrackingStop();
		expect(service.getSnapshot().blinkRateReady).toBe(false);
		expect(service.getSnapshot().blinksPerMinute).toBe(0);
		service.dispose();
	});

	it("face-coverage mode: ready after ~24s face-visible, BPM uses face time", () => {
		const store = createStore();
		const service = new BlinkStatsService(store);
		service.setFaceCoverageMode(true);
		service.onTrackingStart();
		service.onFaceVisibility(true);

		vi.advanceTimersByTime(20_000);
		for (let i = 0; i < 5; i++) service.recordBlink();
		expect(service.getSnapshot().blinkRateReady).toBe(false);
		expect(service.getSnapshot().blinksPerMinute).toBe(0);
		expect(service.getSnapshot().blinkRateWarmupTargetMs).toBe(24_000);

		vi.advanceTimersByTime(4_000);
		expect(service.getSnapshot().blinkRateReady).toBe(true);
		// 5 blinks / 24s face → 12.5 /min
		expect(service.getSnapshot().blinksPerMinute).toBeCloseTo(12.5, 5);

		vi.advanceTimersByTime(6_000); // 30s face total
		expect(service.getSnapshot().blinksPerMinute).toBe(10);

		// Look away 30s — wall clock would halve BPM; face denominator stays ~30s.
		service.onFaceVisibility(false);
		vi.advanceTimersByTime(30_000);
		expect(service.getSnapshot().blinkRateReady).toBe(true);
		expect(service.getSnapshot().blinksPerMinute).toBe(10);

		service.dispose();
	});

	it("face-coverage mode: trackingMs only accumulates while face is visible", () => {
		const store = createStore();
		const service = new BlinkStatsService(store);
		service.setFaceCoverageMode(true);
		service.onTrackingStart();
		service.onFaceVisibility(true);

		vi.advanceTimersByTime(10_000);
		service.onFaceVisibility(false);
		vi.advanceTimersByTime(20_000);
		// Force flush interval
		vi.advanceTimersByTime(15_000);

		const trackingMs = service.getSnapshot().today.trackingMs;
		expect(trackingMs).toBeGreaterThanOrEqual(10_000);
		expect(trackingMs).toBeLessThan(20_000);
		service.dispose();
	});

	it("replaceState restores persisted stats and reset still clears them", () => {
		const store = createStore();
		const service = new BlinkStatsService(store);
		service.recordBlink();
		expect(service.getSnapshot().totals.total).toBe(1);

		service.replaceState({
			days: [
				{
					...emptyDayStats("2026-08-01"),
					blinks: 40,
					trackingMs: 120_000,
					sessions: 2,
				},
			],
			totalBlinks: 40,
			spentBlinks: 5,
			unlockedRewardIds: ["statsFlair"],
			unlockedAchievementIds: [],
			streakShieldCharges: 1,
			streakShieldUsedDates: [],
			rewardPurchaseCounts: { statsFlair: 1 },
			shopDiscountLevel: 0,
			unlockedCheerThemeIds: [],
			equippedCheerTheme: "random",
			unlockedPopupPresetIds: [],
			equippedPopupPresetId: null,
			snoozeTokenCharges: 0,
		});

		expect(service.getPersistedState().totalBlinks).toBe(40);
		expect(service.getPersistedState().spentBlinks).toBe(5);
		expect(service.getPersistedState().days[0]?.blinks).toBe(40);
		expect(service.getSnapshot().totals.available).toBe(35);
		expect(service.getSnapshot().hasStatsFlair).toBe(true);

		service.reset();
		expect(service.getPersistedState().totalBlinks).toBe(0);
		expect(service.getPersistedState().days).toEqual([]);
		service.dispose();
	});

	it("grants retro achievements once with a summary toast", () => {
		const store = createStore();
		store.set(BLINK_STATS_STORE_KEY, {
			...DEFAULT_BLINK_STATS,
			days: [
				{
					...emptyDayStats("2026-08-01"),
					blinks: 1200,
					sessions: 2,
					trackingMs: 60_000,
				},
			],
			totalBlinks: 1200,
		});
		const onCheer = vi.fn();
		const service = new BlinkStatsService(
			store,
			() => "en",
			() => ({
				goalsEnabled: false,
				dailyBlinkGoal: 0,
				dailyTrackingMinutesGoal: 0,
				weeklyBlinkGoal: 0,
				weeklyTrackingMinutesGoal: 0,
			}),
			() => true,
			() => true,
		);
		service.setCheerEffects({ onCheer });

		const first = service.reconcileAchievements({ celebrate: "summary" });
		expect(first).toEqual(
			expect.arrayContaining([
				"firstBlink",
				"firstSession",
				"gettingStarted",
				"blinks1k",
				"calibrated",
			]),
		);
		expect(onCheer).toHaveBeenCalledTimes(1);
		expect(onCheer.mock.calls[0]?.[0]).toMatchObject({
			kind: "achievementSummary",
			count: first.length,
		});

		onCheer.mockClear();
		expect(service.reconcileAchievements({ celebrate: "summary" })).toEqual([]);
		expect(onCheer).not.toHaveBeenCalled();
		expect(service.getSnapshot().achievementsUnlocked).toBe(first.length);
		service.dispose();
	});

	it("grants missing achievements on import with a summary toast", () => {
		const store = createStore();
		const onCheer = vi.fn();
		const service = new BlinkStatsService(store);
		service.setCheerEffects({ onCheer });

		service.replaceState({
			...DEFAULT_BLINK_STATS,
			days: [
				{
					...emptyDayStats("2026-08-01"),
					blinks: 1200,
					sessions: 1,
				},
			],
			totalBlinks: 1200,
			unlockedAchievementIds: [],
		});

		expect(onCheer).toHaveBeenCalledTimes(1);
		expect(onCheer.mock.calls[0]?.[0]).toMatchObject({
			kind: "achievementSummary",
		});
		expect(service.getSnapshot().unlockedAchievementIds).toEqual(
			expect.arrayContaining(["firstBlink", "firstSession", "blinks1k"]),
		);
		service.dispose();
	});

	it("celebrates a live first blink once then stays quiet", () => {
		const store = createStore();
		const onCheer = vi.fn();
		const service = new BlinkStatsService(store);
		service.setCheerEffects({ onCheer });

		service.recordBlink();
		expect(onCheer).toHaveBeenCalledWith({
			kind: "achievement",
			id: "firstBlink",
		});
		onCheer.mockClear();
		service.recordBlink();
		expect(onCheer).not.toHaveBeenCalled();
		service.dispose();
	});

	it("keeps the cheer toast when unlocking firstCheer", () => {
		const store = createStore();
		const onCheer = vi.fn();
		const service = new BlinkStatsService(store);
		service.setCheerEffects({ onCheer });
		for (let i = 0; i < BLINK_REWARDS.cheer.cost; i += 1) {
			service.recordBlink();
		}
		onCheer.mockClear();

		expect(service.purchaseReward("cheer")).toBe(true);
		expect(onCheer).toHaveBeenCalledTimes(1);
		expect(onCheer).toHaveBeenCalledWith({ kind: "cheer" });
		expect(service.getSnapshot().unlockedAchievementIds).toContain(
			"firstCheer",
		);
		service.dispose();
	});

	it("records eye-care outcomes, restore keeps them, and reset clears them", () => {
		const store = createStore();
		const service = new BlinkStatsService(store);
		service.recordEyeCare("lookAway", "completed");
		service.recordEyeCare("exercise", "skipped");
		expect(service.getSnapshot().today.lookAwayCompleted).toBe(1);
		expect(service.getSnapshot().today.exerciseSkipped).toBe(1);
		expect(service.getSnapshot().weekEyeCare.lookAwayCompleted).toBe(1);

		const persisted = service.getPersistedState();
		expect(persisted.days[0]?.lookAwayCompleted).toBe(1);

		service.reset();
		expect(service.getSnapshot().today.lookAwayCompleted).toBe(0);
		expect(service.getSnapshot().today.exerciseSkipped).toBe(0);

		service.replaceState(persisted);
		expect(service.getSnapshot().today.lookAwayCompleted).toBe(1);
		expect(service.getSnapshot().today.exerciseSkipped).toBe(1);
		service.dispose();
	});
});
