/** Tray meeting-length hush options (minutes). */
export const TRAY_HUSH_DURATION_MINUTES = [15, 30, 60] as const;

export type TrayHushDurationMinutes =
	(typeof TRAY_HUSH_DURATION_MINUTES)[number];

const TRAY_HUSH_DURATION_SET: ReadonlySet<number> = new Set(
	TRAY_HUSH_DURATION_MINUTES,
);

export function isTrayHushDurationMinutes(
	value: unknown,
): value is TrayHushDurationMinutes {
	return typeof value === "number" && TRAY_HUSH_DURATION_SET.has(value);
}
