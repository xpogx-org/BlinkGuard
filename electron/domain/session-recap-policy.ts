import type { FocusPauseReason } from "./focus-policy";
import type { SessionRecapDelta } from "../../shared/session-recap";
import type { TodayBlinkSummary } from "../../shared/blink-stats";

export type SessionRecapPauseReason =
	| FocusPauseReason
	| "session-idle"
	| "manual-hush";

export const SESSION_RECAP_MIN_TRACKING_MS = 5 * 60_000;
export const SESSION_RECAP_IDLE_MS = 25 * 60_000;
export const OVERLAY_COOLDOWN_MS = 30 * 60_000;
export const NATIVE_LOCK_COOLDOWN_MS = 2 * 60 * 60_000;
export const LOCK_SHORT_RETURN_MS = 3 * 60_000;
export const RECAP_OVERLAY_DISMISS_MS = 5_000;
export const IDLE_POLL_INTERVAL_MS = 60_000;

export function qualifiesSession(
	delta: SessionRecapDelta,
	minMs = SESSION_RECAP_MIN_TRACKING_MS,
): boolean {
	return (
		delta.trackingMs >= minMs || delta.eyeCareCompleted >= 1
	);
}

export function qualifiesQuitToday(
	today: TodayBlinkSummary,
	lastSessionQualified: boolean,
	minMs = SESSION_RECAP_MIN_TRACKING_MS,
): boolean {
	return lastSessionQualified || today.trackingMs >= minMs;
}

export function shouldSuppressRecap(reason: SessionRecapPauseReason): boolean {
	if (reason === null || reason === "session-idle") return false;
	return true;
}

export function overlayCooldownAllows(
	now: number,
	lastOverlayAt: number | null,
): boolean {
	if (lastOverlayAt === null) return true;
	return now - lastOverlayAt >= OVERLAY_COOLDOWN_MS;
}

export function nativeLockCooldownAllows(
	now: number,
	lastNativeLockAt: number | null,
	lastUnlockAt: number | null,
): boolean {
	if (lastNativeLockAt === null) return true;
	if (
		lastUnlockAt !== null &&
		now - lastUnlockAt < LOCK_SHORT_RETURN_MS
	) {
		return false;
	}
	return now - lastNativeLockAt >= NATIVE_LOCK_COOLDOWN_MS;
}

export function streakLineEligible(streakCurrent: number): boolean {
	return streakCurrent >= 2;
}
