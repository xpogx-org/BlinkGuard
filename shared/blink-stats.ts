import {
	achievementSnapshotFields,
	isAchievementId,
	type AchievementId,
	type AchievementProgress,
} from "./achievements";
import {
	BLINK_REWARD_IDS,
	BLINK_REWARDS,
	discountedRewardCost,
	isBlinkRewardId,
	REWARD_CATEGORY_ORDER,
	shopDiscountPercent,
	shopDiscountUpgradeCost,
	SHOP_DISCOUNT_MAX_LEVEL,
	SNOOZE_TOKEN_MAX_CHARGES,
	type BlinkRewardId,
	type RewardCategory,
} from "./blink-rewards";
import {
	canEquipCheerTheme,
	normalizeEquippedCheerTheme,
	normalizeUnlockedCheerThemeIds,
	type CheerThemeId,
	type EquippedCheerTheme,
} from "./cheer-themes";
import {
	normalizeEquippedPopupPresetId,
	normalizeUnlockedPopupPresetIds,
	type PopupPresetId,
} from "./popup-presets";
import { BLINK_RATE_WINDOW_MS } from "./blink-rate";
import {
	monthLabels,
	t,
	weekdayLabels,
	type Locale,
} from "./i18n";
import {
	DEFAULT_GOALS_CONFIG,
	type GoalsConfig,
} from "./preferences";

export type { GoalsConfig };
export { DEFAULT_GOALS_CONFIG };

export const BLINK_STATS_RETENTION_DAYS = 366;
export const BLINK_STATS_STORE_KEY = "state";

export type EyeCarePromptKind = "lookAway" | "exercise";
export type EyeCarePromptOutcome = "completed" | "skipped" | "snoozed";

export type EyeCareDayCounts = {
	lookAwayCompleted: number;
	lookAwaySkipped: number;
	lookAwaySnoozed: number;
	exerciseCompleted: number;
	exerciseSkipped: number;
	exerciseSnoozed: number;
};

export type EyeCareStatsRecorder = {
	recordEyeCare(kind: EyeCarePromptKind, outcome: EyeCarePromptOutcome): void;
};

export const NOOP_EYE_CARE_STATS: EyeCareStatsRecorder = {
	recordEyeCare: () => {},
};

export const EMPTY_EYE_CARE_COUNTS: EyeCareDayCounts = {
	lookAwayCompleted: 0,
	lookAwaySkipped: 0,
	lookAwaySnoozed: 0,
	exerciseCompleted: 0,
	exerciseSkipped: 0,
	exerciseSnoozed: 0,
};

const EYE_CARE_FIELD: Record<
	EyeCarePromptKind,
	Record<EyeCarePromptOutcome, keyof EyeCareDayCounts>
> = {
	lookAway: {
		completed: "lookAwayCompleted",
		skipped: "lookAwaySkipped",
		snoozed: "lookAwaySnoozed",
	},
	exercise: {
		completed: "exerciseCompleted",
		skipped: "exerciseSkipped",
		snoozed: "exerciseSnoozed",
	},
};

export type DayBlinkStats = {
	date: string;
	blinks: number;
	trackingMs: number;
	sessions: number;
	hourlyBlinks: number[];
} & EyeCareDayCounts;

export type BlinkStatsState = {
	days: DayBlinkStats[];
	/** Lifetime credited blinks (survives day retention prune). */
	totalBlinks: number;
	/** Blinks spent on rewards. */
	spentBlinks: number;
	/** One-time reward unlocks (e.g. statsFlair). */
	unlockedRewardIds: BlinkRewardId[];
	/** One-time achievement unlocks. */
	unlockedAchievementIds: AchievementId[];
	/** Purchased streak-shield charges (0 or 1). */
	streakShieldCharges: number;
	/** Local dates where a streak shield already covered a miss. */
	streakShieldUsedDates: string[];
	/** Lifetime purchase counts per reward id. */
	rewardPurchaseCounts: Partial<Record<BlinkRewardId, number>>;
	/** Shop discount upgrade level (0…10 → 0%…50%). */
	shopDiscountLevel: number;
	/** Shop-unlocked cheer themes (bounce, fanfare, sparkle). */
	unlockedCheerThemeIds: CheerThemeId[];
	/** Active cheer pattern; `random` cycles all families. */
	equippedCheerTheme: EquippedCheerTheme;
	/** Shop-unlocked popup color presets. */
	unlockedPopupPresetIds: PopupPresetId[];
	/** Equipped popup preset; null = user custom colors. */
	equippedPopupPresetId: PopupPresetId | null;
	/** Banked snooze tokens from shop (0…2). */
	snoozeTokenCharges: number;
};

export type GoalMetricProgress = {
	current: number;
	target: number;
	enabled: boolean;
	met: boolean;
};

export type GoalsProgressSummary = {
	enabled: boolean;
	dailyBlinks: GoalMetricProgress;
	dailyTrackingMinutes: GoalMetricProgress;
	weeklyBlinks: GoalMetricProgress;
	weeklyTrackingMinutes: GoalMetricProgress;
	/** All enabled daily metrics met (false when no daily goals active). */
	dailyMet: boolean;
};

export type StreakSummary = {
	current: number;
	shieldCharges: number;
};

export type RewardEquipKind = "cheerTheme" | "popupPreset";

export type RewardOffer = {
	id: BlinkRewardId;
	category: RewardCategory;
	titleKey: string;
	descriptionKey: string;
	/** Effective cost of the next purchase (discount applied except for shopDiscount). */
	cost: number;
	owned: boolean;
	charges: number;
	canBuy: boolean;
	/** Banked snooze tokens can be spent for extended hush. */
	canUse?: boolean;
	purchaseCount: number;
	/** Cap for progress UI; null when unlimited (cheer). */
	maxPurchases: number | null;
	/** Current shop-wide discount percent from state. */
	discountPercent: number;
	atMax: boolean;
	cheerThemeId?: CheerThemeId;
	popupPresetId?: PopupPresetId;
	equipKind?: RewardEquipKind;
	isEquipped?: boolean;
	canEquip?: boolean;
};

/** Token hush lasts twice the user's snoozeMinutes setting. */
export const SNOOZE_TOKEN_DURATION_MULTIPLIER = 2;

export function tokenSnoozeMinutes(baseMinutes: number): number {
	return Math.max(1, baseMinutes) * SNOOZE_TOKEN_DURATION_MULTIPLIER;
}

export type ChartBucket = {
	label: string;
	value: number;
};

export type TodayBlinkSummary = {
	date: string;
	blinks: number;
	trackingMs: number;
	sessions: number;
} & EyeCareDayCounts;

export type BlinkTotalsSummary = {
	/** Lifetime earned blinks. */
	total: number;
	/** Already spent. */
	spent: number;
	/** total - spent; available to spend later. */
	available: number;
};

export const DEFAULT_BLINK_STATS: BlinkStatsState = {
	days: [],
	totalBlinks: 0,
	spentBlinks: 0,
	unlockedRewardIds: [],
	unlockedAchievementIds: [],
	streakShieldCharges: 0,
	streakShieldUsedDates: [],
	rewardPurchaseCounts: {},
	shopDiscountLevel: 0,
	unlockedCheerThemeIds: [],
	equippedCheerTheme: "random",
	unlockedPopupPresetIds: [],
	equippedPopupPresetId: null,
	snoozeTokenCharges: 0,
};

export function emptyHourlyBlinks(): number[] {
	return Array.from({ length: 24 }, () => 0);
}

export function emptyDayStats(date: string): DayBlinkStats {
	return {
		date,
		blinks: 0,
		trackingMs: 0,
		sessions: 0,
		hourlyBlinks: emptyHourlyBlinks(),
		...EMPTY_EYE_CARE_COUNTS,
	};
}

/** Local calendar date as YYYY-MM-DD. */
export function localDateKey(now: Date = new Date()): string {
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

export function localHour(now: Date = new Date()): number {
	return now.getHours();
}

function cloneDay(day: DayBlinkStats): DayBlinkStats {
	return {
		...day,
		hourlyBlinks: [...day.hourlyBlinks],
	};
}

function cloneState(state: BlinkStatsState): BlinkStatsState {
	return {
		days: state.days.map(cloneDay),
		totalBlinks: state.totalBlinks,
		spentBlinks: state.spentBlinks,
		unlockedRewardIds: [...state.unlockedRewardIds],
		unlockedAchievementIds: [...state.unlockedAchievementIds],
		streakShieldCharges: state.streakShieldCharges,
		streakShieldUsedDates: [...state.streakShieldUsedDates],
		rewardPurchaseCounts: { ...state.rewardPurchaseCounts },
		shopDiscountLevel: state.shopDiscountLevel,
		unlockedCheerThemeIds: [...state.unlockedCheerThemeIds],
		equippedCheerTheme: state.equippedCheerTheme,
		unlockedPopupPresetIds: [...state.unlockedPopupPresetIds],
		equippedPopupPresetId: state.equippedPopupPresetId,
		snoozeTokenCharges: state.snoozeTokenCharges,
	};
}

export function ensureDay(
	state: BlinkStatsState,
	date: string,
): BlinkStatsState {
	const next = cloneState(state);
	const index = next.days.findIndex((day) => day.date === date);
	if (index === -1) {
		next.days.push(emptyDayStats(date));
		next.days.sort((a, b) => a.date.localeCompare(b.date));
	}
	return next;
}

export function pruneDays(
	state: BlinkStatsState,
	retentionDays = BLINK_STATS_RETENTION_DAYS,
	today: string = localDateKey(),
): BlinkStatsState {
	const cutoff = shiftDateKey(today, -(retentionDays - 1));
	return {
		days: state.days
			.filter((day) => day.date >= cutoff)
			.sort((a, b) => a.date.localeCompare(b.date)),
		totalBlinks: state.totalBlinks,
		spentBlinks: state.spentBlinks,
		unlockedRewardIds: state.unlockedRewardIds,
		unlockedAchievementIds: state.unlockedAchievementIds,
		streakShieldCharges: state.streakShieldCharges,
		streakShieldUsedDates: state.streakShieldUsedDates.filter(
			(date) => date >= cutoff,
		),
		rewardPurchaseCounts: { ...(state.rewardPurchaseCounts ?? {}) },
		shopDiscountLevel: state.shopDiscountLevel ?? 0,
		unlockedCheerThemeIds: [...state.unlockedCheerThemeIds],
		equippedCheerTheme: state.equippedCheerTheme,
		unlockedPopupPresetIds: [...state.unlockedPopupPresetIds],
		equippedPopupPresetId: state.equippedPopupPresetId,
		snoozeTokenCharges: state.snoozeTokenCharges,
	};
}

export function recordBlink(
	state: BlinkStatsState,
	now: Date = new Date(),
): BlinkStatsState {
	const date = localDateKey(now);
	const hour = localHour(now);
	let next = ensureDay(state, date);
	next = cloneState(next);
	const day = next.days.find((entry) => entry.date === date);
	if (!day) return pruneDays(next);
	day.blinks += 1;
	if (hour >= 0 && hour < 24) {
		day.hourlyBlinks[hour] += 1;
	}
	next.totalBlinks += 1;
	return pruneDays(next, BLINK_STATS_RETENTION_DAYS, date);
}

export function addTrackingMs(
	state: BlinkStatsState,
	ms: number,
	now: Date = new Date(),
): BlinkStatsState {
	if (ms <= 0) return state;
	const date = localDateKey(now);
	let next = ensureDay(state, date);
	next = cloneState(next);
	const day = next.days.find((entry) => entry.date === date);
	if (!day) return pruneDays(next);
	day.trackingMs += ms;
	return pruneDays(next, BLINK_STATS_RETENTION_DAYS, date);
}

export function recordSessionStart(
	state: BlinkStatsState,
	now: Date = new Date(),
): BlinkStatsState {
	const date = localDateKey(now);
	let next = ensureDay(state, date);
	next = cloneState(next);
	const day = next.days.find((entry) => entry.date === date);
	if (!day) return pruneDays(next);
	day.sessions += 1;
	return pruneDays(next, BLINK_STATS_RETENTION_DAYS, date);
}

export function recordEyeCareOutcome(
	state: BlinkStatsState,
	kind: EyeCarePromptKind,
	outcome: EyeCarePromptOutcome,
	now: Date = new Date(),
): BlinkStatsState {
	const date = localDateKey(now);
	let next = ensureDay(state, date);
	next = cloneState(next);
	const day = next.days.find((entry) => entry.date === date);
	if (!day) return pruneDays(next);
	const field = EYE_CARE_FIELD[kind][outcome];
	day[field] += 1;
	return pruneDays(next, BLINK_STATS_RETENTION_DAYS, date);
}

export function weekEyeCareTotals(
	state: BlinkStatsState,
	today: string = localDateKey(),
): EyeCareDayCounts {
	const monday = startOfWeekMonday(today);
	const totals = { ...EMPTY_EYE_CARE_COUNTS };
	for (let offset = 0; offset < 7; offset += 1) {
		const date = shiftDateKey(monday, offset);
		const day = dayByDate(state, date);
		if (!day) continue;
		totals.lookAwayCompleted += day.lookAwayCompleted;
		totals.lookAwaySkipped += day.lookAwaySkipped;
		totals.lookAwaySnoozed += day.lookAwaySnoozed;
		totals.exerciseCompleted += day.exerciseCompleted;
		totals.exerciseSkipped += day.exerciseSkipped;
		totals.exerciseSnoozed += day.exerciseSnoozed;
	}
	return totals;
}

export function availableBlinks(state: BlinkStatsState): number {
	return Math.max(0, state.totalBlinks - state.spentBlinks);
}

export function totalsSummary(state: BlinkStatsState): BlinkTotalsSummary {
	return {
		total: state.totalBlinks,
		spent: state.spentBlinks,
		available: availableBlinks(state),
	};
}

/**
 * Deduct from the spendable blink balance.
 * Returns null when amount is invalid or exceeds available.
 */
export function spendBlinks(
	state: BlinkStatsState,
	amount: number,
): BlinkStatsState | null {
	if (!Number.isFinite(amount) || amount <= 0) return null;
	const spend = Math.floor(amount);
	if (spend > availableBlinks(state)) return null;
	const next = cloneState(state);
	next.spentBlinks += spend;
	return next;
}

export function trackingMinutes(ms: number): number {
	return Math.floor(Math.max(0, ms) / 60_000);
}

function metricProgress(
	current: number,
	target: number,
): GoalMetricProgress {
	const enabled = target > 0;
	return {
		current,
		target,
		enabled,
		met: enabled && current >= target,
	};
}

function dayByDate(
	state: BlinkStatsState,
	date: string,
): DayBlinkStats | undefined {
	return state.days.find((day) => day.date === date);
}

/** Sum blinks / tracking for the local Mon–Sun week containing `today`. */
export function weekTotals(
	state: BlinkStatsState,
	today: string = localDateKey(),
): { blinks: number; trackingMs: number } {
	const monday = startOfWeekMonday(today);
	let blinks = 0;
	let trackingMs = 0;
	for (let offset = 0; offset < 7; offset += 1) {
		const date = shiftDateKey(monday, offset);
		const day = dayByDate(state, date);
		if (!day) continue;
		blinks += day.blinks;
		trackingMs += day.trackingMs;
	}
	return { blinks, trackingMs };
}

/** True when every enabled daily goal is met for that local date. */
export function dayMeetsDailyGoals(
	state: BlinkStatsState,
	date: string,
	goals: GoalsConfig,
): boolean {
	if (!goals.goalsEnabled) return false;
	const blinkTarget = goals.dailyBlinkGoal;
	const trackTarget = goals.dailyTrackingMinutesGoal;
	if (blinkTarget <= 0 && trackTarget <= 0) return false;
	const day = dayByDate(state, date);
	if (blinkTarget > 0 && (day?.blinks ?? 0) < blinkTarget) return false;
	if (
		trackTarget > 0 &&
		trackingMinutes(day?.trackingMs ?? 0) < trackTarget
	) {
		return false;
	}
	return true;
}

export function goalProgress(
	state: BlinkStatsState,
	goals: GoalsConfig,
	now: Date = new Date(),
): GoalsProgressSummary {
	const today = localDateKey(now);
	const day = dayByDate(state, today);
	const week = weekTotals(state, today);
	const dailyBlinks = metricProgress(day?.blinks ?? 0, goals.dailyBlinkGoal);
	const dailyTrackingMinutes = metricProgress(
		trackingMinutes(day?.trackingMs ?? 0),
		goals.dailyTrackingMinutesGoal,
	);
	const weeklyBlinks = metricProgress(week.blinks, goals.weeklyBlinkGoal);
	const weeklyTrackingMinutes = metricProgress(
		trackingMinutes(week.trackingMs),
		goals.weeklyTrackingMinutesGoal,
	);
	const enabled = goals.goalsEnabled;
	const dailyActive =
		enabled && (dailyBlinks.enabled || dailyTrackingMinutes.enabled);
	const dailyMet =
		dailyActive &&
		(!dailyBlinks.enabled || dailyBlinks.met) &&
		(!dailyTrackingMinutes.enabled || dailyTrackingMinutes.met);

	return {
		enabled,
		dailyBlinks: enabled
			? dailyBlinks
			: { ...dailyBlinks, enabled: false, met: false },
		dailyTrackingMinutes: enabled
			? dailyTrackingMinutes
			: { ...dailyTrackingMinutes, enabled: false, met: false },
		weeklyBlinks: enabled
			? weeklyBlinks
			: { ...weeklyBlinks, enabled: false, met: false },
		weeklyTrackingMinutes: enabled
			? weeklyTrackingMinutes
			: { ...weeklyTrackingMinutes, enabled: false, met: false },
		dailyMet,
	};
}

export type StreakComputeResult = {
	streak: StreakSummary;
	/** State after applying any new shield consumptions (may equal input). */
	state: BlinkStatsState;
};

/**
 * Consecutive local days meeting all enabled daily goals.
 * Incomplete today does not count; shields cover past misses only (once each).
 */
export function computeStreak(
	state: BlinkStatsState,
	goals: GoalsConfig,
	now: Date = new Date(),
): StreakComputeResult {
	const today = localDateKey(now);
	if (
		!goals.goalsEnabled ||
		(goals.dailyBlinkGoal <= 0 && goals.dailyTrackingMinutesGoal <= 0)
	) {
		return {
			streak: { current: 0, shieldCharges: state.streakShieldCharges },
			state,
		};
	}

	let charges = state.streakShieldCharges;
	const used = new Set(state.streakShieldUsedDates);
	const newlyUsed: string[] = [];

	const covers = (date: string, allowShield: boolean): boolean => {
		if (dayMeetsDailyGoals(state, date, goals)) return true;
		if (!allowShield) return false;
		if (used.has(date) || newlyUsed.includes(date)) return true;
		if (charges <= 0) return false;
		charges -= 1;
		newlyUsed.push(date);
		return true;
	};

	let cursor = today;
	if (!covers(today, false)) {
		cursor = shiftDateKey(today, -1);
	}

	let current = 0;
	// Cap walk to retention window.
	for (let i = 0; i < BLINK_STATS_RETENTION_DAYS; i += 1) {
		const allowShield = cursor < today;
		if (!covers(cursor, allowShield)) break;
		current += 1;
		cursor = shiftDateKey(cursor, -1);
	}

	if (newlyUsed.length === 0 && charges === state.streakShieldCharges) {
		return {
			streak: { current, shieldCharges: state.streakShieldCharges },
			state,
		};
	}

	const next = cloneState(state);
	next.streakShieldCharges = charges;
	next.streakShieldUsedDates = [
		...new Set([...next.streakShieldUsedDates, ...newlyUsed]),
	].sort();
	return {
		streak: { current, shieldCharges: charges },
		state: pruneDays(next, BLINK_STATS_RETENTION_DAYS, today),
	};
}

export function rewardOffers(
	state: BlinkStatsState,
): RewardOffer[] {
	const available = availableBlinks(state);
	const discountPercent = shopDiscountPercent(state.shopDiscountLevel);
	const cheerCtx = {
		unlockedCheerThemeIds: state.unlockedCheerThemeIds,
		equippedCheerTheme: state.equippedCheerTheme,
	};
	const offers = (Object.keys(BLINK_REWARDS) as BlinkRewardId[]).map((id) => {
		const def = BLINK_REWARDS[id];
		let purchaseCount =
			id === "shopDiscount"
				? state.shopDiscountLevel ?? 0
				: id === "snoozeToken"
					? state.snoozeTokenCharges
					: (state.rewardPurchaseCounts?.[id] ?? 0);
		let owned = def.oneTime && state.unlockedRewardIds.includes(id);
		let charges =
			id === "streakShield"
				? state.streakShieldCharges
				: id === "snoozeToken"
					? state.snoozeTokenCharges
					: 0;
		let atMaxCharges =
			id === "streakShield" &&
			charges >= (def.maxCharges ?? 1);
		const atMaxSnooze =
			id === "snoozeToken" &&
			state.snoozeTokenCharges >= (def.maxStock ?? SNOOZE_TOKEN_MAX_CHARGES);
		const atMaxDiscount =
			id === "shopDiscount" &&
			state.shopDiscountLevel >= (def.maxLevels ?? SHOP_DISCOUNT_MAX_LEVEL);

		if (def.cheerThemeId) {
			owned = state.unlockedCheerThemeIds.includes(def.cheerThemeId);
		}
		if (def.popupPresetId) {
			owned = state.unlockedPopupPresetIds.includes(def.popupPresetId);
		}

		const atMax = owned || atMaxCharges || atMaxDiscount || atMaxSnooze;

		let maxPurchases: number | null = null;
		if (id === "shopDiscount") {
			maxPurchases = def.maxLevels ?? SHOP_DISCOUNT_MAX_LEVEL;
		} else if (def.oneTime) {
			maxPurchases = 1;
		} else if (id === "streakShield") {
			maxPurchases = def.maxCharges ?? 1;
		} else if (id === "snoozeToken") {
			maxPurchases = def.maxStock ?? SNOOZE_TOKEN_MAX_CHARGES;
		}

		let cost: number;
		if (id === "shopDiscount") {
			cost = shopDiscountUpgradeCost(state.shopDiscountLevel) ?? def.cost;
		} else {
			cost = discountedRewardCost(def.cost, discountPercent);
		}

		const canBuy = !atMax && available >= cost;

		let equipKind: RewardEquipKind | undefined;
		let isEquipped = false;
		let canEquip = false;
		if (def.cheerThemeId && owned) {
			equipKind = "cheerTheme";
			isEquipped = state.equippedCheerTheme === def.cheerThemeId;
			canEquip =
				!isEquipped && canEquipCheerTheme(cheerCtx, def.cheerThemeId);
		}
		if (def.popupPresetId && owned) {
			equipKind = "popupPreset";
			isEquipped = state.equippedPopupPresetId === def.popupPresetId;
			canEquip = !isEquipped;
		}

		const canUse =
			id === "snoozeToken" ? state.snoozeTokenCharges > 0 : undefined;

		return {
			id,
			category: def.category,
			titleKey: def.titleKey,
			descriptionKey: def.descriptionKey,
			cost,
			owned,
			charges,
			canBuy,
			canUse,
			purchaseCount,
			maxPurchases,
			discountPercent,
			atMax,
			cheerThemeId: def.cheerThemeId,
			popupPresetId: def.popupPresetId,
			equipKind,
			isEquipped,
			canEquip,
		};
	});
	return offers.sort(
		(a, b) =>
			REWARD_CATEGORY_ORDER.indexOf(a.category) -
			REWARD_CATEGORY_ORDER.indexOf(b.category),
	);
}

/**
 * Spend blinks and apply reward side effects (unlock / shield charge / discount).
 * Cheer only deducts balance. Returns null when purchase is invalid.
 */
export function applyRewardPurchase(
	state: BlinkStatsState,
	rewardId: BlinkRewardId,
): BlinkStatsState | null {
	const def = BLINK_REWARDS[rewardId];
	if (!def) return null;
	if (def.oneTime && state.unlockedRewardIds.includes(rewardId)) {
		return null;
	}
	if (
		rewardId === "streakShield" &&
		state.streakShieldCharges >= (def.maxCharges ?? 1)
	) {
		return null;
	}
	if (
		rewardId === "shopDiscount" &&
		state.shopDiscountLevel >= (def.maxLevels ?? SHOP_DISCOUNT_MAX_LEVEL)
	) {
		return null;
	}
	if (
		rewardId === "snoozeToken" &&
		state.snoozeTokenCharges >= (def.maxStock ?? SNOOZE_TOKEN_MAX_CHARGES)
	) {
		return null;
	}
	if (def.cheerThemeId && state.unlockedCheerThemeIds.includes(def.cheerThemeId)) {
		return null;
	}
	if (
		def.popupPresetId &&
		state.unlockedPopupPresetIds.includes(def.popupPresetId)
	) {
		return null;
	}

	const discountPercent = shopDiscountPercent(state.shopDiscountLevel);
	const cost =
		rewardId === "shopDiscount"
			? shopDiscountUpgradeCost(state.shopDiscountLevel)
			: discountedRewardCost(def.cost, discountPercent);
	if (cost == null || cost <= 0) return null;

	const spent = spendBlinks(state, cost);
	if (!spent) return null;
	const next = cloneState(spent);
	if (def.oneTime) {
		next.unlockedRewardIds = [...next.unlockedRewardIds, rewardId];
	}
	if (rewardId === "streakShield") {
		next.streakShieldCharges = Math.min(
			def.maxCharges ?? 1,
			next.streakShieldCharges + 1,
		);
	}
	if (rewardId === "snoozeToken") {
		next.snoozeTokenCharges = Math.min(
			def.maxStock ?? SNOOZE_TOKEN_MAX_CHARGES,
			next.snoozeTokenCharges + 1,
		);
	}
	if (def.cheerThemeId) {
		next.unlockedCheerThemeIds = [
			...new Set([...next.unlockedCheerThemeIds, def.cheerThemeId]),
		];
	}
	if (def.popupPresetId) {
		next.unlockedPopupPresetIds = [
			...new Set([...next.unlockedPopupPresetIds, def.popupPresetId]),
		];
	}
	if (rewardId === "shopDiscount") {
		next.shopDiscountLevel = Math.min(
			def.maxLevels ?? SHOP_DISCOUNT_MAX_LEVEL,
			next.shopDiscountLevel + 1,
		);
		next.rewardPurchaseCounts = {
			...next.rewardPurchaseCounts,
			shopDiscount: next.shopDiscountLevel,
		};
	} else {
		next.rewardPurchaseCounts = {
			...next.rewardPurchaseCounts,
			[rewardId]: (next.rewardPurchaseCounts[rewardId] ?? 0) + 1,
		};
	}
	return next;
}

/** Spend one banked snooze token; null when charges are 0. */
export function consumeSnoozeToken(
	state: BlinkStatsState,
): BlinkStatsState | null {
	if (state.snoozeTokenCharges <= 0) return null;
	const next = cloneState(state);
	next.snoozeTokenCharges -= 1;
	return next;
}

export function equipCheerTheme(
	state: BlinkStatsState,
	themeId: CheerThemeId,
): BlinkStatsState | null {
	const ctx = {
		unlockedCheerThemeIds: state.unlockedCheerThemeIds,
		equippedCheerTheme: state.equippedCheerTheme,
	};
	if (!canEquipCheerTheme(ctx, themeId)) return null;
	const next = cloneState(state);
	next.equippedCheerTheme = themeId;
	return next;
}

export function equipCheerThemeRandom(
	state: BlinkStatsState,
): BlinkStatsState {
	const next = cloneState(state);
	next.equippedCheerTheme = "random";
	return next;
}

export function equipPopupPreset(
	state: BlinkStatsState,
	presetId: PopupPresetId,
): BlinkStatsState | null {
	if (!state.unlockedPopupPresetIds.includes(presetId)) return null;
	const next = cloneState(state);
	next.equippedPopupPresetId = presetId;
	return next;
}

export function clearEquippedPopupPreset(
	state: BlinkStatsState,
): BlinkStatsState {
	if (state.equippedPopupPresetId == null) return state;
	const next = cloneState(state);
	next.equippedPopupPresetId = null;
	return next;
}

export function todaySummary(
	state: BlinkStatsState,
	today: string = localDateKey(),
): TodayBlinkSummary {
	const day = state.days.find((entry) => entry.date === today);
	return {
		date: today,
		blinks: day?.blinks ?? 0,
		trackingMs: day?.trackingMs ?? 0,
		sessions: day?.sessions ?? 0,
		lookAwayCompleted: day?.lookAwayCompleted ?? 0,
		lookAwaySkipped: day?.lookAwaySkipped ?? 0,
		lookAwaySnoozed: day?.lookAwaySnoozed ?? 0,
		exerciseCompleted: day?.exerciseCompleted ?? 0,
		exerciseSkipped: day?.exerciseSkipped ?? 0,
		exerciseSnoozed: day?.exerciseSnoozed ?? 0,
	};
}

export function toDayChart(
	state: BlinkStatsState,
	today: string = localDateKey(),
): ChartBucket[] {
	const day = state.days.find((entry) => entry.date === today);
	const hours = day?.hourlyBlinks ?? emptyHourlyBlinks();
	return hours.map((value, hour) => ({
		label: String(hour).padStart(2, "0"),
		value,
	}));
}

export function toWeekChart(
	state: BlinkStatsState,
	today: string = localDateKey(),
	locale: Locale = "en",
): ChartBucket[] {
	const byDate = new Map(state.days.map((day) => [day.date, day.blinks]));
	const monday = startOfWeekMonday(today);
	const labels = weekdayLabels(locale);
	return labels.map((label, offset) => {
		const date = shiftDateKey(monday, offset);
		return {
			label,
			value: byDate.get(date) ?? 0,
		};
	});
}

export function toMonthChart(
	state: BlinkStatsState,
	today: string = localDateKey(),
): ChartBucket[] {
	const byDate = new Map(state.days.map((day) => [day.date, day.blinks]));
	const daysInMonth = daysInCalendarMonth(today);
	const yearMonth = today.slice(0, 7);
	const buckets: ChartBucket[] = [];
	for (let day = 1; day <= daysInMonth; day += 1) {
		const date = `${yearMonth}-${String(day).padStart(2, "0")}`;
		buckets.push({
			label: String(day),
			value: byDate.get(date) ?? 0,
		});
	}
	return buckets;
}

export function toYearChart(
	state: BlinkStatsState,
	today: string = localDateKey(),
	locale: Locale = "en",
): ChartBucket[] {
	const year = today.slice(0, 4);
	const monthly = Array.from({ length: 12 }, () => 0);
	for (const day of state.days) {
		if (!day.date.startsWith(`${year}-`)) continue;
		const month = Number(day.date.slice(5, 7));
		if (month >= 1 && month <= 12) {
			monthly[month - 1] += day.blinks;
		}
	}
	const labels = monthLabels(locale);
	return labels.map((label, index) => ({
		label,
		value: monthly[index] ?? 0,
	}));
}

/** Snapshot payload pushed to the settings renderer. */
export type BlinkStatsSnapshot = {
	today: TodayBlinkSummary;
	totals: BlinkTotalsSummary;
	dayChart: ChartBucket[];
	weekChart: ChartBucket[];
	monthChart: ChartBucket[];
	yearChart: ChartBucket[];
	/** Live credited blinks/min over the last rolling minute (ephemeral). */
	blinksPerMinute: number;
	/** False until coverage / wall warmup is met for the live rate. */
	blinkRateReady: boolean;
	/** Progress ms toward {@link blinkRateWarmupTargetMs} (0…target). */
	blinkRateWarmupMs: number;
	/**
	 * Warmup denominator for UI: face-coverage ready ms (camera) or full
	 * window (timer / MGD).
	 */
	blinkRateWarmupTargetMs: number;
	goals: GoalsProgressSummary;
	streak: StreakSummary;
	rewards: RewardOffer[];
	/** True when stats-flair cosmetic is unlocked. */
	hasStatsFlair: boolean;
	equippedCheerTheme: EquippedCheerTheme;
	equippedPopupPresetId: PopupPresetId | null;
	unlockedCheerThemeIds: CheerThemeId[];
	unlockedPopupPresetIds: PopupPresetId[];
	unlockedAchievementIds: AchievementId[];
	achievementsUnlocked: number;
	achievementsTotal: number;
	achievementProgress: Partial<Record<AchievementId, AchievementProgress>>;
	weekEyeCare: EyeCareDayCounts;
};

export function toBlinkStatsSnapshot(
	state: BlinkStatsState,
	now: Date = new Date(),
	blinksPerMinute = 0,
	blinkRateReady = false,
	blinkRateWarmupMs = 0,
	locale: Locale = "en",
	goals: GoalsConfig = DEFAULT_GOALS_CONFIG,
	streak: StreakSummary = {
		current: 0,
		shieldCharges: state.streakShieldCharges,
	},
	blinkRateWarmupTargetMs: number = BLINK_RATE_WINDOW_MS,
): BlinkStatsSnapshot {
	const today = localDateKey(now);
	return {
		today: todaySummary(state, today),
		totals: totalsSummary(state),
		dayChart: toDayChart(state, today),
		weekChart: toWeekChart(state, today, locale),
		monthChart: toMonthChart(state, today),
		yearChart: toYearChart(state, today, locale),
		blinksPerMinute,
		blinkRateReady,
		blinkRateWarmupMs,
		blinkRateWarmupTargetMs,
		goals: goalProgress(state, goals, now),
		streak,
		rewards: rewardOffers(state),
		hasStatsFlair: state.unlockedRewardIds.includes("statsFlair"),
		equippedCheerTheme: state.equippedCheerTheme,
		equippedPopupPresetId: state.equippedPopupPresetId,
		unlockedCheerThemeIds: [...state.unlockedCheerThemeIds],
		unlockedPopupPresetIds: [...state.unlockedPopupPresetIds],
		weekEyeCare: weekEyeCareTotals(state, today),
		...achievementSnapshotFields({
			stats: state,
			streak: streak.current,
			goals,
			hasCompletedOnboarding: false,
			hasEarCalibration: false,
		}),
	};
}

export function formatTrackingDuration(
	ms: number,
	locale: Locale = "en",
): string {
	const totalMinutes = Math.floor(Math.max(0, ms) / 60_000);
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	if (hours <= 0) return t(locale, "stats.duration.minutes", { m: minutes });
	return t(locale, "stats.duration.hoursMinutes", { h: hours, m: minutes });
}

export function shiftDateKey(dateKey: string, dayOffset: number): string {
	const [year, month, day] = dateKey.split("-").map(Number);
	const date = new Date(year, month - 1, day);
	date.setDate(date.getDate() + dayOffset);
	return localDateKey(date);
}

/** Monday of the ISO-style local week that contains `dateKey`. */
export function startOfWeekMonday(dateKey: string): string {
	const [year, month, day] = dateKey.split("-").map(Number);
	const date = new Date(year, month - 1, day);
	const dayOfWeek = date.getDay(); // 0 Sun … 6 Sat
	const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
	date.setDate(date.getDate() - daysFromMonday);
	return localDateKey(date);
}

/** Number of days in the local calendar month that contains `dateKey`. */
export function daysInCalendarMonth(dateKey: string): number {
	const [year, month] = dateKey.split("-").map(Number);
	return new Date(year, month, 0).getDate();
}

function nonNegativeInt(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value)) return null;
	return Math.max(0, Math.floor(value));
}

export function normalizeBlinkStatsState(raw: unknown): BlinkStatsState {
	if (!raw || typeof raw !== "object") return { ...DEFAULT_BLINK_STATS };
	const record = raw as Record<string, unknown>;
	const daysRaw = record.days;
	if (!Array.isArray(daysRaw)) return { ...DEFAULT_BLINK_STATS };

	const days: DayBlinkStats[] = [];
	for (const entry of daysRaw) {
		if (!entry || typeof entry !== "object") continue;
		const day = entry as Record<string, unknown>;
		if (typeof day.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day.date)) {
			continue;
		}
		const hourly = Array.isArray(day.hourlyBlinks)
			? day.hourlyBlinks.map((value) =>
					typeof value === "number" && Number.isFinite(value)
						? Math.max(0, Math.floor(value))
						: 0,
				)
			: emptyHourlyBlinks();
		while (hourly.length < 24) hourly.push(0);
		days.push({
			date: day.date,
			blinks: nonNegativeInt(day.blinks) ?? 0,
			trackingMs: nonNegativeInt(day.trackingMs) ?? 0,
			sessions: nonNegativeInt(day.sessions) ?? 0,
			hourlyBlinks: hourly.slice(0, 24),
			lookAwayCompleted: nonNegativeInt(day.lookAwayCompleted) ?? 0,
			lookAwaySkipped: nonNegativeInt(day.lookAwaySkipped) ?? 0,
			lookAwaySnoozed: nonNegativeInt(day.lookAwaySnoozed) ?? 0,
			exerciseCompleted: nonNegativeInt(day.exerciseCompleted) ?? 0,
			exerciseSkipped: nonNegativeInt(day.exerciseSkipped) ?? 0,
			exerciseSnoozed: nonNegativeInt(day.exerciseSnoozed) ?? 0,
		});
	}

	const daysSum = days.reduce((sum, day) => sum + day.blinks, 0);
	const totalBlinks = nonNegativeInt(record.totalBlinks) ?? daysSum;
	let spentBlinks = nonNegativeInt(record.spentBlinks) ?? 0;
	if (spentBlinks > totalBlinks) spentBlinks = totalBlinks;

	const unlockedRewardIds: BlinkRewardId[] = [];
	if (Array.isArray(record.unlockedRewardIds)) {
		for (const id of record.unlockedRewardIds) {
			if (isBlinkRewardId(id) && !unlockedRewardIds.includes(id)) {
				unlockedRewardIds.push(id);
			}
		}
	}

	const unlockedAchievementIds: AchievementId[] = [];
	if (Array.isArray(record.unlockedAchievementIds)) {
		for (const id of record.unlockedAchievementIds) {
			if (isAchievementId(id) && !unlockedAchievementIds.includes(id)) {
				unlockedAchievementIds.push(id);
			}
		}
	}

	let streakShieldCharges = nonNegativeInt(record.streakShieldCharges) ?? 0;
	streakShieldCharges = Math.min(1, streakShieldCharges);

	const streakShieldUsedDates: string[] = [];
	if (Array.isArray(record.streakShieldUsedDates)) {
		for (const date of record.streakShieldUsedDates) {
			if (
				typeof date === "string" &&
				/^\d{4}-\d{2}-\d{2}$/.test(date) &&
				!streakShieldUsedDates.includes(date)
			) {
				streakShieldUsedDates.push(date);
			}
		}
		streakShieldUsedDates.sort();
	}

	const rewardPurchaseCounts: Partial<Record<BlinkRewardId, number>> = {};
	if (
		record.rewardPurchaseCounts &&
		typeof record.rewardPurchaseCounts === "object" &&
		!Array.isArray(record.rewardPurchaseCounts)
	) {
		const counts = record.rewardPurchaseCounts as Record<string, unknown>;
		for (const id of BLINK_REWARD_IDS) {
			const value = nonNegativeInt(counts[id]);
			if (value != null && value > 0) {
				rewardPurchaseCounts[id] = value;
			}
		}
	}

	let shopDiscountLevel = nonNegativeInt(record.shopDiscountLevel) ?? 0;
	shopDiscountLevel = Math.min(SHOP_DISCOUNT_MAX_LEVEL, shopDiscountLevel);
	if (
		rewardPurchaseCounts.shopDiscount != null &&
		rewardPurchaseCounts.shopDiscount !== shopDiscountLevel
	) {
		// Prefer explicit level; keep count aligned.
		rewardPurchaseCounts.shopDiscount = shopDiscountLevel;
	} else if (shopDiscountLevel > 0) {
		rewardPurchaseCounts.shopDiscount = shopDiscountLevel;
	}

	const unlockedCheerThemeIds = normalizeUnlockedCheerThemeIds(
		record.unlockedCheerThemeIds,
	);
	const equippedCheerTheme = normalizeEquippedCheerTheme(
		record.equippedCheerTheme,
	);
	const unlockedPopupPresetIds = normalizeUnlockedPopupPresetIds(
		record.unlockedPopupPresetIds,
	);
	const equippedPopupPresetId = normalizeEquippedPopupPresetId(
		record.equippedPopupPresetId,
	);
	let snoozeTokenCharges = nonNegativeInt(record.snoozeTokenCharges) ?? 0;
	snoozeTokenCharges = Math.min(SNOOZE_TOKEN_MAX_CHARGES, snoozeTokenCharges);

	return pruneDays({
		days,
		totalBlinks: Math.max(totalBlinks, daysSum),
		spentBlinks,
		unlockedRewardIds,
		unlockedAchievementIds,
		streakShieldCharges,
		streakShieldUsedDates,
		rewardPurchaseCounts,
		shopDiscountLevel,
		unlockedCheerThemeIds,
		equippedCheerTheme,
		unlockedPopupPresetIds,
		equippedPopupPresetId,
		snoozeTokenCharges,
	});
}
