export const DEBUG_OVERLAY_KINDS = [
	"blink",
	"starting",
	"stopped",
	"lookAway",
	"exercise",
	"ambient",
	"noFace",
	"recap",
] as const;

export type DebugOverlayKind = (typeof DEBUG_OVERLAY_KINDS)[number];

export function isDebugOverlayKind(
	value: unknown,
): value is DebugOverlayKind {
	return (
		typeof value === "string" &&
		(DEBUG_OVERLAY_KINDS as readonly string[]).includes(value)
	);
}

export const DEBUG_SOUND_KINDS = [
	"blink",
	"exercise",
	"lookAway",
	"starting",
	"stopped",
	"cheer",
] as const;

export type DebugSoundKind = (typeof DEBUG_SOUND_KINDS)[number];

export function isDebugSoundKind(value: unknown): value is DebugSoundKind {
	return (
		typeof value === "string" &&
		(DEBUG_SOUND_KINDS as readonly string[]).includes(value)
	);
}
