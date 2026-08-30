import { t, type Locale } from "./i18n";

export type SessionIdleCause =
	| "suspend"
	| "lock"
	| "display-off"
	| "lid"
	| "unknown";

export type SessionPauseMode = "active" | "camera-only" | "inactive";

export type FocusPauseUiReason =
	| "quiet-hours"
	| "fullscreen"
	| "app-rule"
	| "session-idle"
	| "manual-hush"
	| null;

export type FocusPauseStatePayload = {
	reason: FocusPauseUiReason;
	fullscreenDetectionSupported: boolean;
	sessionPauseMode: SessionPauseMode;
	sessionIdleCause: SessionIdleCause | null;
};

const TRAY_PRODUCT_NAME = "BlinkGuard";

const PAUSE_REASONS: ReadonlySet<Exclude<FocusPauseUiReason, null>> = new Set([
	"quiet-hours",
	"fullscreen",
	"app-rule",
	"session-idle",
	"manual-hush",
]);

const SESSION_PAUSE_MODES: ReadonlySet<SessionPauseMode> = new Set([
	"active",
	"camera-only",
	"inactive",
]);

const SESSION_IDLE_CAUSES: ReadonlySet<SessionIdleCause> = new Set([
	"suspend",
	"lock",
	"display-off",
	"lid",
	"unknown",
]);

const SESSION_IDLE_CAUSE_KEYS: Record<SessionIdleCause, string> = {
	suspend: "session.paused.suspend",
	lock: "session.paused.lock",
	"display-off": "session.paused.displayOff",
	lid: "session.paused.lid",
	unknown: "session.paused",
};

function pickLiteral<T extends string>(
	value: unknown,
	allowed: ReadonlySet<T>,
): T | null {
	return typeof value === "string" && allowed.has(value as T)
		? (value as T)
		: null;
}

function sessionIdleCauseKey(cause: SessionIdleCause | null): string {
	return cause ? SESSION_IDLE_CAUSE_KEYS[cause] : "session.paused";
}

/** Settings banner / tray copy key. Inactive overlays focus reasons; lid is last. */
export function pauseStatusMessageKey(
	input: Pick<
		FocusPauseStatePayload,
		"reason" | "sessionPauseMode" | "sessionIdleCause"
	>,
): string | null {
	if (
		input.sessionPauseMode === "inactive" ||
		input.reason === "session-idle"
	) {
		return sessionIdleCauseKey(input.sessionIdleCause);
	}
	if (input.reason === "manual-hush") return "hush.active";
	if (input.reason === "quiet-hours") return "quietHours.paused";
	if (input.reason === "fullscreen") return "fullscreen.paused";
	if (input.reason === "app-rule") return "appRules.paused";
	if (input.sessionPauseMode === "camera-only") return "session.paused.lid";
	return null;
}

/** True while manual prompt hush is active. */
export function isPromptHushed(
	promptSuppressUntil: number,
	now = Date.now(),
): boolean {
	return promptSuppressUntil > now;
}

/** Overlay manual hush on focus pause UI when session idle does not win. */
export function overlayManualHush(
	payload: FocusPauseStatePayload,
	promptSuppressUntil: number,
	now = Date.now(),
): FocusPauseStatePayload {
	if (
		payload.sessionPauseMode === "inactive" ||
		payload.reason === "session-idle"
	) {
		return payload;
	}
	if (isPromptHushed(promptSuppressUntil, now)) {
		return { ...payload, reason: "manual-hush" };
	}
	return payload;
}

export function sanitizeFocusPauseStatePayload(
	input: unknown,
): FocusPauseStatePayload {
	const rec =
		input && typeof input === "object"
			? (input as Record<string, unknown>)
			: {};
	return {
		reason: pickLiteral(rec.reason, PAUSE_REASONS),
		fullscreenDetectionSupported: rec.fullscreenDetectionSupported !== false,
		sessionPauseMode:
			pickLiteral(rec.sessionPauseMode, SESSION_PAUSE_MODES) ?? "active",
		sessionIdleCause: pickLiteral(rec.sessionIdleCause, SESSION_IDLE_CAUSES),
	};
}

export function trayTooltipLabel(
	locale: Locale,
	payload: FocusPauseStatePayload | null,
): string {
	const key = payload ? pauseStatusMessageKey(payload) : null;
	return key ? `${TRAY_PRODUCT_NAME} — ${t(locale, key)}` : TRAY_PRODUCT_NAME;
}
