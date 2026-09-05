import { levelFromTotalBlinks } from "./blink-profile";
import type { BlinkStatsState } from "./blink-stats";
import { goalsConfigForCamera, type GoalsConfig } from "./preferences";

export const ACHIEVEMENT_IDS = [
	"firstBlink",
	"firstSession",
	"gettingStarted",
	"blinks1k",
	"blinks10k",
	"blinks50k",
	"blinks250k",
	"level10",
	"level25",
	"level50",
	"streak3",
	"streak7",
	"streak30",
	"goalDay",
	"tracking10h",
	"activeDays7",
	"firstCheer",
	"calibrated",
] as const;

export type AchievementId = (typeof ACHIEVEMENT_IDS)[number];

export const ACHIEVEMENT_COUNT = ACHIEVEMENT_IDS.length;

export type AchievementCategory = "start" | "progression" | "habit" | "explore";

export const ACHIEVEMENT_CATEGORIES: readonly AchievementCategory[] = [
	"start",
	"progression",
	"habit",
	"explore",
];

/** Lucide icon ids mapped in the Achievements panel. */
export type AchievementIconName =
	| "eye"
	| "play"
	| "sparkles"
	| "activity"
	| "trendingUp"
	| "zap"
	| "trophy"
	| "award"
	| "medal"
	| "gem"
	| "flame"
	| "calendar"
	| "calendarDays"
	| "target"
	| "clock"
	| "sun"
	| "partyPopper"
	| "crosshair";

export type AchievementDefinition = {
	id: AchievementId;
	category: AchievementCategory;
	icon: AchievementIconName;
	/** Numeric progress target; omit for boolean unlocks. */
	progressTarget?: number;
};

export type AchievementEvalContext = {
	stats: BlinkStatsState;
	streak: number;
	goals: GoalsConfig;
	cameraEnabled: boolean;
	hasCompletedOnboarding: boolean;
	hasEarCalibration: boolean;
};

export type AchievementProgress = {
	current: number;
	target: number;
};

export type CheerCelebration =
	| { kind: "cheer" }
	| { kind: "levelUp"; level: number }
	| { kind: "achievement"; id: AchievementId }
	| { kind: "achievementSummary"; count: number };

const TRACKING_10H_MS = 10 * 60 * 60 * 1000;

export const ACHIEVEMENTS: Record<AchievementId, AchievementDefinition> = {
	firstBlink: { id: "firstBlink", category: "start", icon: "eye" },
	firstSession: { id: "firstSession", category: "start", icon: "play" },
	gettingStarted: {
		id: "gettingStarted",
		category: "start",
		icon: "sparkles",
	},
	blinks1k: {
		id: "blinks1k",
		category: "progression",
		icon: "activity",
		progressTarget: 1_000,
	},
	blinks10k: {
		id: "blinks10k",
		category: "progression",
		icon: "trendingUp",
		progressTarget: 10_000,
	},
	blinks50k: {
		id: "blinks50k",
		category: "progression",
		icon: "zap",
		progressTarget: 50_000,
	},
	blinks250k: {
		id: "blinks250k",
		category: "progression",
		icon: "trophy",
		progressTarget: 250_000,
	},
	level10: {
		id: "level10",
		category: "progression",
		icon: "award",
		progressTarget: 10,
	},
	level25: {
		id: "level25",
		category: "progression",
		icon: "medal",
		progressTarget: 25,
	},
	level50: {
		id: "level50",
		category: "progression",
		icon: "gem",
		progressTarget: 50,
	},
	streak3: {
		id: "streak3",
		category: "habit",
		icon: "flame",
		progressTarget: 3,
	},
	streak7: {
		id: "streak7",
		category: "habit",
		icon: "calendar",
		progressTarget: 7,
	},
	streak30: {
		id: "streak30",
		category: "habit",
		icon: "calendarDays",
		progressTarget: 30,
	},
	goalDay: { id: "goalDay", category: "habit", icon: "target" },
	tracking10h: {
		id: "tracking10h",
		category: "habit",
		icon: "clock",
		progressTarget: TRACKING_10H_MS,
	},
	activeDays7: {
		id: "activeDays7",
		category: "habit",
		icon: "sun",
		progressTarget: 7,
	},
	firstCheer: { id: "firstCheer", category: "explore", icon: "partyPopper" },
	calibrated: { id: "calibrated", category: "explore", icon: "crosshair" },
};

export function isAchievementId(value: unknown): value is AchievementId {
	return typeof value === "string" && ACHIEVEMENT_ID_SET.has(value);
}

const ACHIEVEMENT_ID_SET: ReadonlySet<string> = new Set(ACHIEVEMENT_IDS);

export const ACHIEVEMENT_IDS_BY_CATEGORY: Record<
	AchievementCategory,
	AchievementId[]
> = {
	start: [],
	progression: [],
	habit: [],
	explore: [],
};

for (const id of ACHIEVEMENT_IDS) {
	ACHIEVEMENT_IDS_BY_CATEGORY[ACHIEVEMENTS[id].category].push(id);
}

export function achievementIdsByCategory(
	category: AchievementCategory,
): AchievementId[] {
	return ACHIEVEMENT_IDS_BY_CATEGORY[category];
}

export function achievementTitleKey(id: AchievementId): string {
	return `achievements.${id}.title`;
}

export function achievementDescKey(id: AchievementId): string {
	return `achievements.${id}.desc`;
}

function trackingMinutes(ms: number): number {
	return Math.floor(Math.max(0, ms) / 60_000);
}

function totalSessions(stats: BlinkStatsState): number {
	return stats.days.reduce((sum, day) => sum + day.sessions, 0);
}

function totalTrackingMs(stats: BlinkStatsState): number {
	return stats.days.reduce((sum, day) => sum + day.trackingMs, 0);
}

function activeBlinkDays(stats: BlinkStatsState): number {
	return stats.days.reduce(
		(sum, day) => sum + (day.blinks > 0 ? 1 : 0),
		0,
	);
}

function anyDayMeetsDailyGoals(
	stats: BlinkStatsState,
	goals: GoalsConfig,
	cameraEnabled: boolean,
): boolean {
	const effective = goalsConfigForCamera(goals, cameraEnabled);
	if (!effective.goalsEnabled) return false;
	const blinkTarget = effective.dailyBlinkGoal;
	const trackTarget = effective.dailyTrackingMinutesGoal;
	if (blinkTarget <= 0 && trackTarget <= 0) return false;
	return stats.days.some((day) => {
		if (blinkTarget > 0 && day.blinks < blinkTarget) return false;
		if (trackTarget > 0 && trackingMinutes(day.trackingMs) < trackTarget) {
			return false;
		}
		return true;
	});
}

function isEarned(id: AchievementId, ctx: AchievementEvalContext): boolean {
	const { stats } = ctx;
	const level = levelFromTotalBlinks(stats.totalBlinks);
	switch (id) {
		case "firstBlink":
			return stats.totalBlinks >= 1;
		case "firstSession":
			return totalSessions(stats) >= 1;
		case "gettingStarted":
			return ctx.hasCompletedOnboarding;
		case "blinks1k":
			return stats.totalBlinks >= 1_000;
		case "blinks10k":
			return stats.totalBlinks >= 10_000;
		case "blinks50k":
			return stats.totalBlinks >= 50_000;
		case "blinks250k":
			return stats.totalBlinks >= 250_000;
		case "level10":
			return level >= 10;
		case "level25":
			return level >= 25;
		case "level50":
			return level >= 50;
		case "streak3":
			return ctx.streak >= 3;
		case "streak7":
			return ctx.streak >= 7;
		case "streak30":
			return ctx.streak >= 30;
		case "goalDay":
			return anyDayMeetsDailyGoals(stats, ctx.goals, ctx.cameraEnabled);
		case "tracking10h":
			return totalTrackingMs(stats) >= TRACKING_10H_MS;
		case "activeDays7":
			return activeBlinkDays(stats) >= 7;
		case "firstCheer":
			return (stats.rewardPurchaseCounts.cheer ?? 0) >= 1;
		case "calibrated":
			return ctx.hasEarCalibration;
	}
}

/** All currently earned ids in catalog order (includes already unlocked). */
export function evaluateAchievements(
	ctx: AchievementEvalContext,
): AchievementId[] {
	return ACHIEVEMENT_IDS.filter((id) => isEarned(id, ctx));
}

export function newlyUnlockedAchievements(
	already: readonly string[],
	earned: readonly AchievementId[],
): AchievementId[] {
	const have = new Set(already);
	return earned.filter((id) => !have.has(id));
}

export function mergeUnlockedAchievementIds(
	already: readonly AchievementId[],
	earned: readonly AchievementId[],
): AchievementId[] {
	const next = [...already];
	for (const id of earned) {
		if (!next.includes(id)) next.push(id);
	}
	return next;
}

export function achievementProgress(
	id: AchievementId,
	ctx: AchievementEvalContext,
): AchievementProgress | null {
	const def = ACHIEVEMENTS[id];
	const target = def.progressTarget;
	if (target == null) return null;
	const { stats } = ctx;
	switch (id) {
		case "blinks1k":
		case "blinks10k":
		case "blinks50k":
		case "blinks250k":
			return { current: stats.totalBlinks, target };
		case "level10":
		case "level25":
		case "level50":
			return {
				current: levelFromTotalBlinks(stats.totalBlinks),
				target,
			};
		case "streak3":
		case "streak7":
		case "streak30":
			return { current: ctx.streak, target };
		case "tracking10h":
			return { current: totalTrackingMs(stats), target };
		case "activeDays7":
			return { current: activeBlinkDays(stats), target };
		default:
			return null;
	}
}

export function achievementProgressMap(
	ctx: AchievementEvalContext,
): Partial<Record<AchievementId, AchievementProgress>> {
	const map: Partial<Record<AchievementId, AchievementProgress>> = {};
	for (const id of ACHIEVEMENT_IDS) {
		const progress = achievementProgress(id, ctx);
		if (progress) map[id] = progress;
	}
	return map;
}

export function achievementSnapshotFields(ctx: AchievementEvalContext): {
	unlockedAchievementIds: AchievementId[];
	achievementsUnlocked: number;
	achievementsTotal: number;
	achievementProgress: Partial<Record<AchievementId, AchievementProgress>>;
} {
	return {
		unlockedAchievementIds: [...ctx.stats.unlockedAchievementIds],
		achievementsUnlocked: ctx.stats.unlockedAchievementIds.length,
		achievementsTotal: ACHIEVEMENT_COUNT,
		achievementProgress: achievementProgressMap(ctx),
	};
}
