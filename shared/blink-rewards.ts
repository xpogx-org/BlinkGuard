/** Catalog of spendable blink rewards (costs in lifetime blinks). */

import type { CheerThemeId } from "./cheer-themes";
import type { PopupPresetId } from "./popup-presets";

export const BLINK_REWARD_IDS = [
	"cheer",
	"statsFlair",
	"streakShield",
	"shopDiscount",
	"cheerThemeBounce",
	"cheerThemeFanfare",
	"cheerThemeSparkle",
	"popupPresetAurora",
	"popupPresetSunset",
	"snoozeToken",
] as const;

export type BlinkRewardId = (typeof BLINK_REWARD_IDS)[number];

export type RewardCategory = "cosmetic" | "utility" | "meta";

export type BlinkRewardDefinition = {
	id: BlinkRewardId;
	cost: number;
	/** One-time unlock stored in unlockedRewardIds. */
	oneTime: boolean;
	/** Max streak-shield charges (only for streakShield). */
	maxCharges?: number;
	/** Max shop-discount upgrade levels (only for shopDiscount). */
	maxLevels?: number;
	/** Max snooze-token bank (only for snoozeToken). */
	maxStock?: number;
	category: RewardCategory;
	titleKey: string;
	descriptionKey: string;
	cheerThemeId?: CheerThemeId;
	popupPresetId?: PopupPresetId;
};

/** Max shop discount level (each level = +5%, max 50%). */
export const SHOP_DISCOUNT_MAX_LEVEL = 10;

/** Base blink cost for the first shop-discount upgrade (level 0 → 1). */
export const SHOP_DISCOUNT_BASE_COST = 1500;

/** Max banked snooze tokens from shop purchases. */
export const SNOOZE_TOKEN_MAX_CHARGES = 2;

/**
 * Costs tuned for camera tracking (~12–15 credited blinks/min):
 * Cheer ≈ 30–40 min, flair ≈ one workday, shield ≈ more than a day.
 * Shop discount upgrades escalate: 1500, 3000, …, 15000.
 */
export const BLINK_REWARDS: Record<BlinkRewardId, BlinkRewardDefinition> = {
	cheer: {
		id: "cheer",
		cost: 500,
		oneTime: false,
		category: "cosmetic",
		titleKey: "rewards.cheer",
		descriptionKey: "rewards.cheerDesc",
	},
	statsFlair: {
		id: "statsFlair",
		cost: 5000,
		oneTime: true,
		category: "cosmetic",
		titleKey: "rewards.statsFlair",
		descriptionKey: "rewards.statsFlairDesc",
	},
	streakShield: {
		id: "streakShield",
		cost: 8000,
		oneTime: false,
		maxCharges: 1,
		category: "utility",
		titleKey: "rewards.streakShield",
		descriptionKey: "rewards.streakShieldDesc",
	},
	shopDiscount: {
		id: "shopDiscount",
		cost: SHOP_DISCOUNT_BASE_COST,
		oneTime: false,
		maxLevels: SHOP_DISCOUNT_MAX_LEVEL,
		category: "meta",
		titleKey: "rewards.shopDiscount",
		descriptionKey: "rewards.shopDiscountDesc",
	},
	cheerThemeBounce: {
		id: "cheerThemeBounce",
		cost: 1200,
		oneTime: true,
		category: "cosmetic",
		titleKey: "rewards.cheerThemeBounce",
		descriptionKey: "rewards.cheerThemeBounceDesc",
		cheerThemeId: "bounce",
	},
	cheerThemeFanfare: {
		id: "cheerThemeFanfare",
		cost: 1200,
		oneTime: true,
		category: "cosmetic",
		titleKey: "rewards.cheerThemeFanfare",
		descriptionKey: "rewards.cheerThemeFanfareDesc",
		cheerThemeId: "fanfare",
	},
	cheerThemeSparkle: {
		id: "cheerThemeSparkle",
		cost: 1200,
		oneTime: true,
		category: "cosmetic",
		titleKey: "rewards.cheerThemeSparkle",
		descriptionKey: "rewards.cheerThemeSparkleDesc",
		cheerThemeId: "sparkle",
	},
	popupPresetAurora: {
		id: "popupPresetAurora",
		cost: 2500,
		oneTime: true,
		category: "cosmetic",
		titleKey: "rewards.popupPresetAurora",
		descriptionKey: "rewards.popupPresetAuroraDesc",
		popupPresetId: "aurora",
	},
	popupPresetSunset: {
		id: "popupPresetSunset",
		cost: 2500,
		oneTime: true,
		category: "cosmetic",
		titleKey: "rewards.popupPresetSunset",
		descriptionKey: "rewards.popupPresetSunsetDesc",
		popupPresetId: "sunset",
	},
	snoozeToken: {
		id: "snoozeToken",
		cost: 600,
		oneTime: false,
		maxStock: SNOOZE_TOKEN_MAX_CHARGES,
		category: "utility",
		titleKey: "rewards.snoozeToken",
		descriptionKey: "rewards.snoozeTokenDesc",
	},
};

export const REWARD_CATEGORY_ORDER: readonly RewardCategory[] = [
	"cosmetic",
	"utility",
	"meta",
];

export function isBlinkRewardId(value: unknown): value is BlinkRewardId {
	return (
		typeof value === "string" &&
		(BLINK_REWARD_IDS as readonly string[]).includes(value)
	);
}

/** Discount percent from owned level (0…10 → 0%…50%). */
export function shopDiscountPercent(level: number): number {
	if (!Number.isFinite(level)) return 0;
	const clamped = Math.max(0, Math.min(SHOP_DISCOUNT_MAX_LEVEL, Math.floor(level)));
	return clamped * 5;
}

/**
 * Cost of the next shop-discount upgrade at `currentLevel` (0…9).
 * Returns null when already at max.
 */
export function shopDiscountUpgradeCost(currentLevel: number): number | null {
	if (!Number.isFinite(currentLevel)) return null;
	const level = Math.max(0, Math.floor(currentLevel));
	if (level >= SHOP_DISCOUNT_MAX_LEVEL) return null;
	return SHOP_DISCOUNT_BASE_COST * (level + 1);
}

/** Apply shop discount to a base catalog cost (never below 1). */
export function discountedRewardCost(baseCost: number, percent: number): number {
	if (!Number.isFinite(baseCost) || baseCost <= 0) return 0;
	const pct = Number.isFinite(percent)
		? Math.max(0, Math.min(50, Math.floor(percent)))
		: 0;
	return Math.max(1, Math.floor(baseCost * (100 - pct) / 100));
}
