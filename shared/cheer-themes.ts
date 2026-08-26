/** Procedural cheer fanfare pattern ids (Web Audio in public/js/sound.js). */

export const CHEER_THEME_IDS = [
	"classic",
	"bounce",
	"fanfare",
	"sparkle",
	"chime",
	"waltz",
] as const;

export type CheerThemeId = (typeof CHEER_THEME_IDS)[number];

export type EquippedCheerTheme = CheerThemeId | "random";

/** Shop-unlock required before equipping these themes. */
export const SHOP_CHEER_THEME_IDS: readonly CheerThemeId[] = [
	"bounce",
	"fanfare",
	"sparkle",
];

/** Always equippable without a shop purchase. */
export const FREE_EQUIP_CHEER_THEME_IDS: readonly CheerThemeId[] = [
	"classic",
	"chime",
	"waltz",
];

export const CHEER_THEME_REWARD_ID: Partial<
	Record<CheerThemeId, `cheerTheme${string}`>
> = {
	bounce: "cheerThemeBounce",
	fanfare: "cheerThemeFanfare",
	sparkle: "cheerThemeSparkle",
};

export function isCheerThemeId(value: unknown): value is CheerThemeId {
	return (
		typeof value === "string" &&
		(CHEER_THEME_IDS as readonly string[]).includes(value)
	);
}

export function cheerThemeFromRewardId(
	rewardId: string,
): CheerThemeId | null {
	for (const themeId of SHOP_CHEER_THEME_IDS) {
		if (CHEER_THEME_REWARD_ID[themeId] === rewardId) return themeId;
	}
	return null;
}

export type CheerThemePickContext = {
	unlockedCheerThemeIds: readonly CheerThemeId[];
	equippedCheerTheme: EquippedCheerTheme;
};

export function canEquipCheerTheme(
	ctx: CheerThemePickContext,
	themeId: CheerThemeId,
): boolean {
	if ((FREE_EQUIP_CHEER_THEME_IDS as readonly string[]).includes(themeId)) {
		return true;
	}
	return ctx.unlockedCheerThemeIds.includes(themeId);
}

/** Themes available when `equippedCheerTheme` is `random`. */
export function randomCheerThemePool(): CheerThemeId[] {
	return [...CHEER_THEME_IDS];
}

/**
 * Resolve which pattern id to play.
 * `override` wins when it is a valid theme id (debug preview).
 */
export function resolveCheerTheme(
	ctx: CheerThemePickContext,
	override?: string | null,
	rng: () => number = Math.random,
): CheerThemeId {
	if (override && isCheerThemeId(override)) {
		return override;
	}
	if (ctx.equippedCheerTheme !== "random") {
		if (canEquipCheerTheme(ctx, ctx.equippedCheerTheme)) {
			return ctx.equippedCheerTheme;
		}
	}
	const pool = randomCheerThemePool();
	const index = Math.floor(rng() * pool.length);
	return pool[Math.min(pool.length - 1, Math.max(0, index))] ?? "classic";
}

export function normalizeEquippedCheerTheme(
	value: unknown,
): EquippedCheerTheme {
	if (value === "random") return "random";
	if (isCheerThemeId(value)) return value;
	return "random";
}

export function normalizeUnlockedCheerThemeIds(
	raw: unknown,
): CheerThemeId[] {
	if (!Array.isArray(raw)) return [];
	const out: CheerThemeId[] = [];
	for (const entry of raw) {
		if (isCheerThemeId(entry) && !out.includes(entry)) {
			out.push(entry);
		}
	}
	return out;
}
