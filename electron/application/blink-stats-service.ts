import {
	levelFromTotalBlinks,
	thresholdForLevel,
} from "../../shared/blink-profile";
import {
	BLINK_RATE_WINDOW_MS,
	blinkRateCoverageReadyMs,
	computeBlinksPerMinute,
	computeFaceVisibleMsInWindow,
	type FaceVisibleSegment,
	isBlinkRateCoverageReady,
	pruneBlinkTimestamps,
	pruneFaceVisibleSegments,
} from "../../shared/blink-rate";
import type { BlinkRewardId } from "../../shared/blink-rewards";
import {
	BLINK_REWARDS,
	SHOP_DISCOUNT_MAX_LEVEL,
} from "../../shared/blink-rewards";
import {
	CHEER_THEME_IDS,
	resolveCheerTheme,
	type CheerThemeId,
} from "../../shared/cheer-themes";
import type { PopupPresetId } from "../../shared/popup-presets";
import {
	BLINK_STATS_STORE_KEY,
	DEFAULT_BLINK_STATS,
	type BlinkStatsSnapshot,
	type BlinkStatsState,
	type GoalsConfig,
	addTrackingMs,
	applyRewardPurchase,
	clearEquippedPopupPreset,
	computeStreak,
	consumeSnoozeToken,
	equipCheerTheme,
	equipCheerThemeRandom,
	equipPopupPreset,
	localDateKey,
	normalizeBlinkStatsState,
	recordBlink,
	recordEyeCareOutcome,
	recordSessionStart,
	type EyeCarePromptKind,
	type EyeCarePromptOutcome,
	spendBlinks,
	todaySummary,
	toBlinkStatsSnapshot,
	totalsSummary,
	goalProgress,
	rewardOffers,
	weekEyeCareTotals,
} from "../../shared/blink-stats";
import {
	achievementSnapshotFields,
	evaluateAchievements,
	isAchievementId,
	mergeUnlockedAchievementIds,
	newlyUnlockedAchievements,
	type AchievementId,
	type CheerCelebration,
} from "../../shared/achievements";
import type { Locale } from "../../shared/i18n";
import {
	DEFAULT_GOALS_CONFIG,
} from "../../shared/preferences";
import type { PreferenceStore } from "./ports/preference-store";

export type { CheerCelebration };

export type AchievementCelebrateMode = "none" | "live" | "summary";

const TRACKING_FLUSH_MS = 15_000;
const PUSH_THROTTLE_MS = 1_000;
const RATE_TICK_MS = 1_000;

export type CheerRewardEffects = {
	onCheer?: (celebration?: CheerCelebration) => void;
};

export class BlinkStatsService {
	private state: BlinkStatsState;
	private trackingStartedAt: number | null = null;
	/** Wall-clock start of the current tracking session (not reset by flush). */
	private rateSessionStartedAt: number | null = null;
	private flushTimer: ReturnType<typeof setInterval> | null = null;
	private rateTickTimer: ReturnType<typeof setInterval> | null = null;
	private pushTimer: ReturnType<typeof setTimeout> | null = null;
	private onPush: ((snapshot: BlinkStatsSnapshot) => void) | null = null;
	/** Ephemeral credited-blink timestamps for live BPM (not persisted). */
	private blinkTimestamps: number[] = [];
	/** Last BPM included in a pushed snapshot — skip redundant rate ticks. */
	private lastPushedBpm: number | null = null;
	/** Last warmup second pushed while collecting coverage / first minute. */
	private lastPushedWarmupSec: number | null = null;
	/** True while the Statistics settings panel is mounted. */
	private livePushEnabled = false;
	/** Cached charts; rebuilt only when blink/session totals change. */
	private chartsDirty = true;
	private cachedCharts: Pick<
		BlinkStatsSnapshot,
		"dayChart" | "weekChart" | "monthChart" | "yearChart"
	> | null = null;
	private cachedLocale: Locale | null = null;
	private cheerEffects: CheerRewardEffects = {};
	private debugCheerThemeCycle = 0;
	/** One-shot override while previewCheer runs (sync onCheer). */
	private cheerThemeOverride: string | null = null;
	private onSnoozeTokenChargesChanged: (() => void) | null = null;

	/**
	 * When true (camera face-aware): BPM denominator + trackingMs use face-visible
	 * time. When false (MGD / timer): wall-clock behavior.
	 */
	private faceCoverageMode = false;
	private faceVisible = false;
	private faceVisibleSinceMs: number | null = null;
	private faceSegments: FaceVisibleSegment[] = [];
	/** Face-visible ms not yet flushed into daily trackingMs. */
	private pendingFaceTrackingMs = 0;

	constructor(
		private readonly store: PreferenceStore,
		private readonly getLocale: () => Locale = () => "en",
		private readonly getGoals: () => GoalsConfig = () => ({
			...DEFAULT_GOALS_CONFIG,
		}),
		private readonly getHasCompletedOnboarding: () => boolean = () => false,
		private readonly getHasEarCalibration: () => boolean = () => false,
	) {
		this.state = normalizeBlinkStatsState(
			this.store.get(BLINK_STATS_STORE_KEY, DEFAULT_BLINK_STATS),
		);
		this.persist();
	}

	setCheerEffects(effects: CheerRewardEffects): void {
		this.cheerEffects = effects;
	}

	setOnSnoozeTokenChargesChanged(callback: (() => void) | null): void {
		this.onSnoozeTokenChargesChanged = callback;
	}

	getSnoozeTokenCharges(): number {
		return this.state.snoozeTokenCharges;
	}

	/**
	 * Camera face-aware tracking → true. MGD / timer-only → false.
	 * Resets face clock when disabled so stale segments do not affect BPM.
	 */
	setFaceCoverageMode(enabled: boolean, nowMs: number = Date.now()): void {
		if (this.faceCoverageMode === enabled) return;
		if (this.faceCoverageMode && !enabled) {
			this.closeFaceSegment(nowMs);
			this.faceSegments = [];
			this.pendingFaceTrackingMs = 0;
			this.faceVisible = false;
		}
		this.faceCoverageMode = enabled;
		if (!enabled) {
			this.faceVisibleSinceMs = null;
		}
	}

	isFaceCoverageMode(): boolean {
		return this.faceCoverageMode;
	}

	/**
	 * Raw sidecar face presence (no toast debounce). Drives coverage BPM +
	 * face-only trackingMs while {@link faceCoverageMode} is on.
	 */
	onFaceVisibility(visible: boolean, nowMs: number = Date.now()): void {
		if (!this.faceCoverageMode) {
			this.faceVisible = visible;
			return;
		}
		if (visible === this.faceVisible) return;
		if (visible) {
			this.faceVisible = true;
			this.faceVisibleSinceMs = nowMs;
			return;
		}
		this.closeFaceSegment(nowMs);
		this.faceVisible = false;
	}

	/** Dev Debug: play Cheer FX without spending blinks; cycles pattern families. */
	previewCheer(): void {
		const theme =
			CHEER_THEME_IDS[this.debugCheerThemeCycle % CHEER_THEME_IDS.length];
		this.debugCheerThemeCycle += 1;
		this.cheerThemeOverride = theme;
		this.cheerEffects.onCheer?.({ kind: "cheer" });
		this.cheerThemeOverride = null;
	}

	resolveCheerThemeForPlay(): CheerThemeId {
		return resolveCheerTheme(
			{
				unlockedCheerThemeIds: this.state.unlockedCheerThemeIds,
				equippedCheerTheme: this.state.equippedCheerTheme,
			},
			this.cheerThemeOverride,
		);
	}

	equipCheerTheme(theme: CheerThemeId | "random"): boolean {
		const next =
			theme === "random"
				? equipCheerThemeRandom(this.state)
				: equipCheerTheme(this.state, theme);
		if (!next || next === this.state) return false;
		this.state = next;
		this.persist();
		this.schedulePush(true);
		return true;
	}

	equipPopupPreset(presetId: PopupPresetId): PopupPresetId | null {
		const next = equipPopupPreset(this.state, presetId);
		if (!next) return null;
		this.state = next;
		this.persist();
		this.schedulePush(true);
		return presetId;
	}

	clearEquippedPopupPreset(): void {
		const next = clearEquippedPopupPreset(this.state);
		if (next === this.state) return;
		this.state = next;
		this.persist();
		this.schedulePush(true);
	}

	getEquippedPopupPresetId(): PopupPresetId | null {
		return this.state.equippedPopupPresetId;
	}

	/** Dev Debug: play level-up celebration without changing stats. */
	previewLevelUp(level?: number): void {
		const resolved =
			typeof level === "number" && Number.isFinite(level)
				? Math.max(1, Math.floor(level))
				: levelFromTotalBlinks(this.state.totalBlinks) + 1;
		this.cheerEffects.onCheer?.({ kind: "levelUp", level: resolved });
	}

	/** Dev Debug: play an achievement toast without changing stats. */
	previewAchievement(id?: unknown): void {
		const resolved = isAchievementId(id) ? id : "firstBlink";
		this.cheerEffects.onCheer?.({ kind: "achievement", id: resolved });
	}

	/** Dev Debug: play the bulk-unlock summary toast without changing stats. */
	previewAchievementSummary(count?: unknown): void {
		const resolved =
			typeof count === "number" && Number.isFinite(count)
				? Math.max(1, Math.floor(count))
				: 3;
		this.cheerEffects.onCheer?.({
			kind: "achievementSummary",
			count: resolved,
		});
	}

	/**
	 * Dev Debug: set lifetime blinks to the threshold for `level`.
	 * When `celebrate` is true, fires level-up FX for that level.
	 */
	setDebugProfileLevel(level: number, celebrate = false): void {
		if (!Number.isFinite(level)) return;
		const nextLevel = Math.max(1, Math.floor(level));
		const totalBlinks = thresholdForLevel(nextLevel);
		this.state = {
			...this.state,
			totalBlinks,
			spentBlinks: Math.min(this.state.spentBlinks, totalBlinks),
			days: this.state.days,
			unlockedRewardIds: [...this.state.unlockedRewardIds],
			unlockedAchievementIds: [...this.state.unlockedAchievementIds],
			streakShieldUsedDates: [...this.state.streakShieldUsedDates],
			rewardPurchaseCounts: { ...this.state.rewardPurchaseCounts },
		};
		this.markChartsDirty();
		this.persist();
		this.applyNewAchievements();
		this.schedulePush(true);
		if (celebrate) {
			this.cheerEffects.onCheer?.({ kind: "levelUp", level: nextLevel });
		}
	}

	/**
	 * Dev Debug: grant/revoke persistent shop unlocks without spending.
	 * Only `statsFlair` and `streakShield` (Cheer has no unlock state).
	 */
	setDebugRewardGrant(
		rewardId: "statsFlair" | "streakShield",
		enabled: boolean,
	): void {
		const next = {
			...this.state,
			unlockedRewardIds: [...this.state.unlockedRewardIds],
			unlockedAchievementIds: [...this.state.unlockedAchievementIds],
			streakShieldUsedDates: [...this.state.streakShieldUsedDates],
			rewardPurchaseCounts: { ...this.state.rewardPurchaseCounts },
			days: this.state.days,
		};
		if (rewardId === "statsFlair") {
			const has = next.unlockedRewardIds.includes("statsFlair");
			if (enabled && !has) {
				next.unlockedRewardIds = [...next.unlockedRewardIds, "statsFlair"];
			} else if (!enabled && has) {
				next.unlockedRewardIds = next.unlockedRewardIds.filter(
					(id) => id !== "statsFlair",
				);
			} else {
				return;
			}
		} else {
			const max =
				BLINK_REWARDS.streakShield.maxCharges ?? 1;
			const target = enabled ? max : 0;
			if (next.streakShieldCharges === target) return;
			next.streakShieldCharges = target;
		}
		this.state = next;
		this.markChartsDirty();
		this.persist();
		this.schedulePush(true);
	}

	/**
	 * Dev Debug: set shop discount level (0…10) without spending blinks.
	 * Keeps `rewardPurchaseCounts.shopDiscount` aligned with the level.
	 */
	setDebugShopDiscountLevel(level: number): void {
		if (!Number.isFinite(level)) return;
		const nextLevel = Math.max(
			0,
			Math.min(SHOP_DISCOUNT_MAX_LEVEL, Math.floor(level)),
		);
		if (nextLevel === this.state.shopDiscountLevel) return;
		const next = {
			...this.state,
			unlockedRewardIds: [...this.state.unlockedRewardIds],
			unlockedAchievementIds: [...this.state.unlockedAchievementIds],
			streakShieldUsedDates: [...this.state.streakShieldUsedDates],
			rewardPurchaseCounts: { ...this.state.rewardPurchaseCounts },
			days: this.state.days,
			shopDiscountLevel: nextLevel,
		};
		if (nextLevel > 0) {
			next.rewardPurchaseCounts.shopDiscount = nextLevel;
		} else {
			delete next.rewardPurchaseCounts.shopDiscount;
		}
		this.state = next;
		this.markChartsDirty();
		this.persist();
		this.schedulePush(true);
	}

	invalidateCharts(): void {
		this.chartsDirty = true;
		this.cachedCharts = null;
		this.cachedLocale = null;
	}

	setPushHandler(handler: (snapshot: BlinkStatsSnapshot) => void): void {
		this.onPush = handler;
	}

	/** Enable/disable IPC pushes + rate tick (Statistics panel visibility). */
	setLivePushEnabled(enabled: boolean): void {
		if (this.livePushEnabled === enabled) {
			if (enabled) this.pushSnapshot();
			return;
		}
		this.livePushEnabled = enabled;
		if (enabled) {
			if (this.rateSessionStartedAt !== null) this.startRateTick();
			this.pushSnapshot();
			return;
		}
		this.stopRateTick();
		if (this.pushTimer) {
			clearTimeout(this.pushTimer);
			this.pushTimer = null;
		}
	}

	isLivePushEnabled(): boolean {
		return this.livePushEnabled;
	}

	/** Persisted stats state for backup export (not the derived UI snapshot). */
	getPersistedState(): BlinkStatsState {
		return {
			...this.state,
			days: this.state.days.map((day) => ({
				...day,
				hourlyBlinks: [...day.hourlyBlinks],
			})),
			unlockedRewardIds: [...this.state.unlockedRewardIds],
			unlockedAchievementIds: [...this.state.unlockedAchievementIds],
			streakShieldUsedDates: [...this.state.streakShieldUsedDates],
		};
	}

	/**
	 * Replace persisted stats from a normalized backup payload.
	 * Restarts an in-progress tracking session the same way reset() does.
	 */
	replaceState(state: BlinkStatsState): void {
		this.flushTracking();
		this.stopFlushTimer();
		this.stopRateTick();
		this.blinkTimestamps = [];
		this.resetFaceClock();
		this.lastPushedBpm = null;
		this.lastPushedWarmupSec = null;
		this.markChartsDirty();
		const wasTracking = this.trackingStartedAt !== null;
		this.trackingStartedAt = null;
		this.rateSessionStartedAt = null;
		this.state = normalizeBlinkStatsState(state);
		this.persist();
		this.reconcileAchievements({ celebrate: "summary" });
		if (wasTracking) {
			this.onTrackingStart();
		} else {
			this.schedulePush(true);
		}
	}

	getSnapshot(now: Date = new Date()): BlinkStatsSnapshot {
		this.reconcileStreak(now);
		const nowMs = now.getTime();
		this.blinkTimestamps = pruneBlinkTimestamps(this.blinkTimestamps, nowMs);
		this.pruneFaceSegments(nowMs);
		const { ready, warmupMs } = this.rateWarmup(nowMs);
		const warmupTargetMs = this.faceCoverageMode
			? blinkRateCoverageReadyMs()
			: BLINK_RATE_WINDOW_MS;
		const blinksPerMinute = ready
			? this.computeLiveBpm(nowMs)
			: 0;
		const today = localDateKey(now);
		const locale = this.getLocale();
		const goals = this.getGoals();
		const streakResult = computeStreak(this.state, goals, now);
		const achievementFields = achievementSnapshotFields({
			stats: this.state,
			streak: streakResult.streak.current,
			goals,
			hasCompletedOnboarding: this.getHasCompletedOnboarding(),
			hasEarCalibration: this.getHasEarCalibration(),
		});

		if (
			this.chartsDirty ||
			!this.cachedCharts ||
			this.cachedLocale !== locale
		) {
			const full = toBlinkStatsSnapshot(
				this.state,
				now,
				blinksPerMinute,
				ready,
				warmupMs,
				locale,
				goals,
				streakResult.streak,
				warmupTargetMs,
			);
			this.cachedCharts = {
				dayChart: full.dayChart,
				weekChart: full.weekChart,
				monthChart: full.monthChart,
				yearChart: full.yearChart,
			};
			this.chartsDirty = false;
			this.cachedLocale = locale;
			return { ...full, ...achievementFields };
		}

		return {
			today: todaySummary(this.state, today),
			totals: totalsSummary(this.state),
			weekEyeCare: weekEyeCareTotals(this.state, today),
			...this.cachedCharts,
			blinksPerMinute,
			blinkRateReady: ready,
			blinkRateWarmupMs: warmupMs,
			blinkRateWarmupTargetMs: warmupTargetMs,
			goals: goalProgress(this.state, goals, now),
			streak: streakResult.streak,
			rewards: rewardOffers(this.state),
			hasStatsFlair: this.state.unlockedRewardIds.includes("statsFlair"),
			equippedCheerTheme: this.state.equippedCheerTheme,
			equippedPopupPresetId: this.state.equippedPopupPresetId,
			unlockedCheerThemeIds: [...this.state.unlockedCheerThemeIds],
			unlockedPopupPresetIds: [...this.state.unlockedPopupPresetIds],
			...achievementFields,
		};
	}

	recordEyeCare(
		kind: EyeCarePromptKind,
		outcome: EyeCarePromptOutcome,
		now: Date = new Date(),
	): void {
		this.state = recordEyeCareOutcome(this.state, kind, outcome, now);
		this.persist();
		this.schedulePush();
	}

	recordBlink(now: Date = new Date()): void {
		const prevLevel = levelFromTotalBlinks(this.state.totalBlinks);
		const nowMs = now.getTime();
		this.state = recordBlink(this.state, now);
		const nextLevel = levelFromTotalBlinks(this.state.totalBlinks);
		this.blinkTimestamps = pruneBlinkTimestamps(
			[...this.blinkTimestamps, nowMs],
			nowMs,
		);
		this.markChartsDirty();
		this.persist();
		const newly = this.applyNewAchievements(now);
		if (newly.length > 0) {
			this.celebrateAchievements(newly, "live");
		} else if (nextLevel > prevLevel) {
			this.cheerEffects.onCheer?.({ kind: "levelUp", level: nextLevel });
		}
		this.schedulePush();
	}

	/** Deduct from the spendable blink balance (low-level). */
	spend(amount: number): boolean {
		const next = spendBlinks(this.state, amount);
		if (!next) return false;
		this.state = next;
		this.markChartsDirty();
		this.persist();
		this.schedulePush(true);
		return true;
	}

	/**
	 * Purchase a catalog reward; persists spent balance + unlock/shield.
	 * Cheer triggers optional sound/toast side effects.
	 */
	purchaseReward(rewardId: BlinkRewardId): boolean {
		const next = applyRewardPurchase(this.state, rewardId);
		if (!next) return false;
		this.state = next;
		this.markChartsDirty();
		this.persist();
		const newly = this.applyNewAchievements();
		if (rewardId === "cheer" || BLINK_REWARDS[rewardId].cheerThemeId) {
			this.cheerEffects.onCheer?.({ kind: "cheer" });
		} else {
			this.celebrateAchievements(newly, "live");
		}
		if (rewardId === "snoozeToken") {
			this.onSnoozeTokenChargesChanged?.();
		}
		this.schedulePush(true);
		return true;
	}

	/** Spend one banked snooze token; persists and pushes snapshot. */
	consumeSnoozeToken(): boolean {
		const next = consumeSnoozeToken(this.state);
		if (!next) return false;
		this.state = next;
		this.persist();
		this.schedulePush(true);
		this.onSnoozeTokenChargesChanged?.();
		return true;
	}

	onTrackingStart(now: Date = new Date()): void {
		if (this.trackingStartedAt !== null) return;
		this.state = recordSessionStart(this.state, now);
		this.trackingStartedAt = now.getTime();
		this.rateSessionStartedAt = now.getTime();
		this.resetFaceClock();
		this.lastPushedWarmupSec = null;
		this.markChartsDirty();
		this.persist();
		this.startFlushTimer();
		if (this.livePushEnabled) this.startRateTick();
		this.reconcileAchievements({ celebrate: "live" }, now);
		this.schedulePush();
	}

	onTrackingStop(now: Date = new Date()): void {
		this.flushTracking(now);
		this.stopFlushTimer();
		this.stopRateTick();
		this.trackingStartedAt = null;
		this.rateSessionStartedAt = null;
		this.lastPushedWarmupSec = null;
		this.blinkTimestamps = [];
		this.resetFaceClock();
		this.lastPushedBpm = null;
		this.schedulePush(true);
	}

	reset(): void {
		this.stopFlushTimer();
		this.stopRateTick();
		this.blinkTimestamps = [];
		this.resetFaceClock();
		this.lastPushedBpm = null;
		this.lastPushedWarmupSec = null;
		this.markChartsDirty();
		const wasTracking = this.trackingStartedAt !== null;
		this.trackingStartedAt = null;
		this.rateSessionStartedAt = null;
		this.state = {
			...DEFAULT_BLINK_STATS,
			days: [],
			unlockedRewardIds: [],
			unlockedAchievementIds: [],
			streakShieldUsedDates: [],
		};
		this.persist();
		this.reconcileAchievements({ celebrate: "none" });
		if (wasTracking) {
			this.onTrackingStart();
		} else {
			this.schedulePush(true);
		}
	}

	/** Flush pending tracking time (e.g. before quit). */
	dispose(): void {
		this.flushTracking();
		this.stopFlushTimer();
		this.stopRateTick();
		this.livePushEnabled = false;
		if (this.pushTimer) {
			clearTimeout(this.pushTimer);
			this.pushTimer = null;
		}
	}

	/**
	 * Re-evaluate achievements from current stats + prefs getters.
	 * Persists newly earned ids and optionally celebrates.
	 */
	reconcileAchievements(
		options: { celebrate?: AchievementCelebrateMode } = {},
		now: Date = new Date(),
	): AchievementId[] {
		const newly = this.applyNewAchievements(now);
		this.celebrateAchievements(newly, options.celebrate ?? "live");
		if (newly.length > 0) this.schedulePush(true);
		return newly;
	}

	private applyNewAchievements(now: Date = new Date()): AchievementId[] {
		this.reconcileStreak(now);
		const goals = this.getGoals();
		const streak = computeStreak(this.state, goals, now).streak.current;
		const earned = evaluateAchievements({
			stats: this.state,
			streak,
			goals,
			hasCompletedOnboarding: this.getHasCompletedOnboarding(),
			hasEarCalibration: this.getHasEarCalibration(),
		});
		const newly = newlyUnlockedAchievements(
			this.state.unlockedAchievementIds,
			earned,
		);
		if (newly.length === 0) return [];
		this.state = {
			...this.state,
			unlockedAchievementIds: mergeUnlockedAchievementIds(
				this.state.unlockedAchievementIds,
				earned,
			),
		};
		this.persist();
		return newly;
	}

	private celebrateAchievements(
		newly: AchievementId[],
		mode: AchievementCelebrateMode,
	): void {
		if (mode === "none" || newly.length === 0) return;
		if (mode === "summary" || newly.length > 1) {
			this.cheerEffects.onCheer?.({
				kind: "achievementSummary",
				count: newly.length,
			});
			return;
		}
		const id = newly[0];
		if (!id) return;
		this.cheerEffects.onCheer?.({ kind: "achievement", id });
	}

	/** Apply shield consumption for past misses and persist if changed. */
	private reconcileStreak(now: Date): void {
		const result = computeStreak(this.state, this.getGoals(), now);
		if (result.state === this.state) return;
		const before = this.state;
		this.state = result.state;
		if (
			before.streakShieldCharges !== this.state.streakShieldCharges ||
			before.streakShieldUsedDates.length !==
				this.state.streakShieldUsedDates.length
		) {
			this.persist();
		}
	}

	private getFaceVisibleMs(nowMs: number): number {
		return computeFaceVisibleMsInWindow(
			this.faceSegments,
			nowMs,
			BLINK_RATE_WINDOW_MS,
			this.faceVisibleSinceMs,
		);
	}

	private computeLiveBpm(nowMs: number): number {
		if (this.faceCoverageMode) {
			const faceVisibleMs = this.getFaceVisibleMs(nowMs);
			return computeBlinksPerMinute(this.blinkTimestamps, nowMs, {
				faceVisibleMs,
			});
		}
		return computeBlinksPerMinute(this.blinkTimestamps, nowMs);
	}

	private rateWarmup(nowMs: number): { ready: boolean; warmupMs: number } {
		if (this.rateSessionStartedAt === null) {
			return { ready: false, warmupMs: 0 };
		}
		if (this.faceCoverageMode) {
			const faceVisibleMs = this.getFaceVisibleMs(nowMs);
			const readyAt = blinkRateCoverageReadyMs();
			return {
				ready: isBlinkRateCoverageReady(faceVisibleMs),
				warmupMs: Math.min(faceVisibleMs, readyAt),
			};
		}
		const elapsed = Math.max(0, nowMs - this.rateSessionStartedAt);
		const warmupMs = Math.min(elapsed, BLINK_RATE_WINDOW_MS);
		return {
			ready: elapsed >= BLINK_RATE_WINDOW_MS,
			warmupMs,
		};
	}

	private closeFaceSegment(nowMs: number): void {
		if (this.faceVisibleSinceMs === null) return;
		const startMs = this.faceVisibleSinceMs;
		const endMs = nowMs;
		this.faceVisibleSinceMs = null;
		if (endMs <= startMs) return;
		this.faceSegments.push({ startMs, endMs });
		this.pendingFaceTrackingMs += endMs - startMs;
		this.pruneFaceSegments(nowMs);
	}

	private pruneFaceSegments(nowMs: number): void {
		this.faceSegments = pruneFaceVisibleSegments(
			this.faceSegments,
			nowMs,
			BLINK_RATE_WINDOW_MS,
		);
	}

	private resetFaceClock(): void {
		this.faceVisible = false;
		this.faceVisibleSinceMs = null;
		this.faceSegments = [];
		this.pendingFaceTrackingMs = 0;
	}

	private markChartsDirty(): void {
		this.chartsDirty = true;
	}

	private flushTracking(now: Date = new Date()): void {
		if (this.trackingStartedAt === null) return;
		const nowMs = now.getTime();

		if (this.faceCoverageMode) {
			if (this.faceVisibleSinceMs !== null) {
				const delta = nowMs - this.faceVisibleSinceMs;
				if (delta > 0) {
					this.pendingFaceTrackingMs += delta;
					this.faceSegments.push({
						startMs: this.faceVisibleSinceMs,
						endMs: nowMs,
					});
				}
				this.faceVisibleSinceMs = nowMs;
			}
			const elapsed = this.pendingFaceTrackingMs;
			this.pendingFaceTrackingMs = 0;
			this.trackingStartedAt = nowMs;
			this.pruneFaceSegments(nowMs);
			if (elapsed <= 0) return;
			this.state = addTrackingMs(this.state, elapsed, now);
			this.persist();
			this.reconcileAchievements({ celebrate: "live" }, now);
			return;
		}

		const elapsed = nowMs - this.trackingStartedAt;
		this.trackingStartedAt = nowMs;
		if (elapsed <= 0) return;
		this.state = addTrackingMs(this.state, elapsed, now);
		this.persist();
		this.reconcileAchievements({ celebrate: "live" }, now);
	}

	private startFlushTimer(): void {
		this.stopFlushTimer();
		this.flushTimer = setInterval(() => {
			this.flushTracking();
			this.schedulePush();
		}, TRACKING_FLUSH_MS);
	}

	private stopFlushTimer(): void {
		if (this.flushTimer) {
			clearInterval(this.flushTimer);
			this.flushTimer = null;
		}
	}

	private startRateTick(): void {
		this.stopRateTick();
		this.rateTickTimer = setInterval(() => {
			this.tickLiveRate();
		}, RATE_TICK_MS);
	}

	private stopRateTick(): void {
		if (this.rateTickTimer) {
			clearInterval(this.rateTickTimer);
			this.rateTickTimer = null;
		}
	}

	/**
	 * While warming up: push once per elapsed second for progress UI.
	 * After ready: only push when BPM changes (decay / new blinks).
	 */
	private tickLiveRate(nowMs: number = Date.now()): void {
		if (!this.livePushEnabled || this.rateSessionStartedAt === null) return;

		this.pruneFaceSegments(nowMs);
		const { ready, warmupMs } = this.rateWarmup(nowMs);
		if (!ready) {
			const sec = Math.floor(warmupMs / 1000);
			if (sec === this.lastPushedWarmupSec) return;
			this.lastPushedWarmupSec = sec;
			this.schedulePush();
			return;
		}

		if (this.blinkTimestamps.length === 0) {
			if (this.lastPushedBpm === 0) return;
			this.schedulePush();
			return;
		}
		this.blinkTimestamps = pruneBlinkTimestamps(this.blinkTimestamps, nowMs);
		const bpm = this.computeLiveBpm(nowMs);
		if (bpm === this.lastPushedBpm) return;
		this.schedulePush();
	}

	private persist(): void {
		this.store.set(BLINK_STATS_STORE_KEY, this.state);
	}

	private pushSnapshot(now: Date = new Date()): void {
		if (!this.onPush || !this.livePushEnabled) return;
		const snapshot = this.getSnapshot(now);
		this.lastPushedBpm = snapshot.blinksPerMinute;
		if (!snapshot.blinkRateReady) {
			this.lastPushedWarmupSec = Math.floor(snapshot.blinkRateWarmupMs / 1000);
		}
		this.onPush(snapshot);
	}

	private schedulePush(immediate = false): void {
		if (!this.onPush || !this.livePushEnabled) return;
		if (immediate) {
			if (this.pushTimer) {
				clearTimeout(this.pushTimer);
				this.pushTimer = null;
			}
			this.pushSnapshot();
			return;
		}
		if (this.pushTimer) return;
		this.pushTimer = setTimeout(() => {
			this.pushTimer = null;
			this.pushSnapshot();
		}, PUSH_THROTTLE_MS);
	}
}
