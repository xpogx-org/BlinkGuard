import type { PopupColors } from "./preferences";

export const POPUP_PRESET_IDS = ["aurora", "sunset"] as const;

export type PopupPresetId = (typeof POPUP_PRESET_IDS)[number];

export type PopupGlowTokens = {
	outer: string;
	mid: string;
	inner: string;
	accent: string;
	accent2: string;
};

export type PopupPresetDefinition = {
	id: PopupPresetId;
	colors: PopupColors;
	glow: PopupGlowTokens;
};

export const POPUP_PRESETS: Record<PopupPresetId, PopupPresetDefinition> = {
	aurora: {
		id: "aurora",
		colors: {
			background: "#0c4a6e",
			text: "#ecfeff",
			transparency: 0.1,
		},
		glow: {
			outer: "rgba(34, 211, 238, 0.22)",
			mid: "rgba(56, 189, 248, 0.16)",
			inner: "rgba(125, 211, 252, 0.1)",
			accent: "#67e8f9",
			accent2: "#7dd3fc",
		},
	},
	sunset: {
		id: "sunset",
		colors: {
			background: "#7c2d12",
			text: "#fff7ed",
			transparency: 0.1,
		},
		glow: {
			outer: "rgba(251, 146, 60, 0.24)",
			mid: "rgba(249, 115, 22, 0.17)",
			inner: "rgba(253, 186, 116, 0.11)",
			accent: "#fdba74",
			accent2: "#fb923c",
		},
	},
};

export const POPUP_PRESET_REWARD_ID: Record<
	PopupPresetId,
	`popupPreset${string}`
> = {
	aurora: "popupPresetAurora",
	sunset: "popupPresetSunset",
};

/** IPC payload for popup windows (colors + optional animated glow). */
export type PopupAppearancePayload = PopupColors & {
	glowPreset?: PopupPresetId | null;
	glow?: PopupGlowTokens | null;
};

export function buildPopupAppearancePayload(
	colors: PopupColors,
	glowPreset: PopupPresetId | null,
): PopupAppearancePayload {
	if (!glowPreset) {
		return { ...colors, glowPreset: null, glow: null };
	}
	const preset = POPUP_PRESETS[glowPreset];
	return {
		...colors,
		glowPreset,
		glow: preset.glow,
	};
}

export function isPopupPresetId(value: unknown): value is PopupPresetId {
	return (
		typeof value === "string" &&
		(POPUP_PRESET_IDS as readonly string[]).includes(value)
	);
}

export function popupPresetFromRewardId(
	rewardId: string,
): PopupPresetId | null {
	for (const presetId of POPUP_PRESET_IDS) {
		if (POPUP_PRESET_REWARD_ID[presetId] === rewardId) return presetId;
	}
	return null;
}

export function normalizeUnlockedPopupPresetIds(
	raw: unknown,
): PopupPresetId[] {
	if (!Array.isArray(raw)) return [];
	const out: PopupPresetId[] = [];
	for (const entry of raw) {
		if (isPopupPresetId(entry) && !out.includes(entry)) {
			out.push(entry);
		}
	}
	return out;
}

export function normalizeEquippedPopupPresetId(
	value: unknown,
): PopupPresetId | null {
	if (isPopupPresetId(value)) return value;
	return null;
}
