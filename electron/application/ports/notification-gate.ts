import type { FocusPauseReason } from "../../domain/focus-policy";

export type NotificationPauseReason =
	| FocusPauseReason
	| "session-idle"
	| "manual-hush";

/** Soft-pause gate for interruptive popups and sounds. */
export interface NotificationGate {
	notificationsAllowed(): boolean;
	pauseReason(): NotificationPauseReason;
}
