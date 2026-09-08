import type { AppearancePreference } from "../../../../shared/preferences";

/** Light → System → Night. Matches the expanding chrome row. */
export const APPEARANCE_OPTIONS = ["light", "system", "dark"] as const;

export type AppearanceOption = (typeof APPEARANCE_OPTIONS)[number];

/** `Button` size `icon` is `h-9` / `w-9` (2.25rem). */
export const APPEARANCE_BUTTON_REM = 2.25;
export const APPEARANCE_GAP_REM = 0.5;
export const APPEARANCE_STRIDE_REM = APPEARANCE_BUTTON_REM + APPEARANCE_GAP_REM;

/** Index of System — the visual center of the open row. */
export const APPEARANCE_CENTER_INDEX = 1;

export function appearanceOptionIndex(
	appearance: AppearancePreference,
): number {
	const index = APPEARANCE_OPTIONS.indexOf(appearance);
	return index >= 0 ? index : APPEARANCE_CENTER_INDEX;
}

/**
 * Offset from the collapsed round button (the current selection).
 * Expanded: Light / System / Night keep that order, so neighbors
 * slide right from Light, both ways from System, and left from Night.
 * Collapsed: every icon sits on the selected button.
 */
export function appearanceButtonOffsetRem(
	index: number,
	selectedIndex: number,
	expanded: boolean,
): number {
	if (!expanded) return 0;
	return (index - selectedIndex) * APPEARANCE_STRIDE_REM;
}

/**
 * Translate the open cluster so System sits on the collapsed button.
 * Opening from Light or Night (side options) therefore recenters the
 * whole row; System already is the center and needs no shift.
 */
export function appearanceClusterShiftRem(
	selectedIndex: number,
	expanded: boolean,
): number {
	if (!expanded) return 0;
	return (selectedIndex - APPEARANCE_CENTER_INDEX) * APPEARANCE_STRIDE_REM;
}
