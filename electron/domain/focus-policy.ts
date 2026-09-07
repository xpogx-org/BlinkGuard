import type {
	PauseAppRule,
	QuietHoursByWeekday,
	WeekdayKey,
} from "../../shared/preferences";

export type FocusPauseReason = "quiet-hours" | "fullscreen" | "app-rule" | null;

export type PauseAppForeground = {
	processName: string;
	windowTitle: string;
};

const WEEKDAY_KEYS: readonly WeekdayKey[] = [
	"sun",
	"mon",
	"tue",
	"wed",
	"thu",
	"fri",
	"sat",
];

/** Map local Date.getDay() (Sun=0) → named Monday-first key. Never persist the int. */
export function weekdayKeyFromDate(now: Date): WeekdayKey {
	return WEEKDAY_KEYS[now.getDay()] ?? "mon";
}

function previousWeekdayKey(key: WeekdayKey): WeekdayKey {
	const ordered: WeekdayKey[] = [
		"mon",
		"tue",
		"wed",
		"thu",
		"fri",
		"sat",
		"sun",
	];
	const index = ordered.indexOf(key);
	return ordered[(index + 6) % 7] ?? "sun";
}

type ResolvedWindow = { start: string; end: string } | null;

function resolveDayWindow(
	override: QuietHoursByWeekday[WeekdayKey] | undefined,
	defaultStart: string,
	defaultEnd: string,
): ResolvedWindow {
	if (!override || override.mode === "default") {
		return { start: defaultStart, end: defaultEnd };
	}
	if (override.mode === "off") return null;
	return { start: override.start, end: override.end };
}

/**
 * True when local clock is inside the weekday-aware quiet-hours schedule.
 * Overnight option A: today's resolved window OR yesterday's wrapping tail
 * (`start > end` and `nowMinutes < end`).
 */
export function isInQuietHoursForSchedule(
	now: Date,
	enabled: boolean,
	defaultStart: string,
	defaultEnd: string,
	overrides: QuietHoursByWeekday = {},
): boolean {
	if (!enabled) return false;

	const todayKey = weekdayKeyFromDate(now);
	const todayWindow = resolveDayWindow(
		overrides[todayKey],
		defaultStart,
		defaultEnd,
	);
	if (
		todayWindow &&
		isInQuietHours(now, todayWindow.start, todayWindow.end)
	) {
		return true;
	}

	const yesterdayKey = previousWeekdayKey(todayKey);
	const yesterdayWindow = resolveDayWindow(
		overrides[yesterdayKey],
		defaultStart,
		defaultEnd,
	);
	if (!yesterdayWindow) return false;

	const startMinutes = parseQuietHoursMinutes(yesterdayWindow.start);
	const endMinutes = parseQuietHoursMinutes(yesterdayWindow.end);
	if (startMinutes === null || endMinutes === null) return false;
	// Only the overnight wrap's morning tail belongs to yesterday.
	if (startMinutes <= endMinutes) return false;

	const nowMinutes = now.getHours() * 60 + now.getMinutes();
	return nowMinutes < endMinutes;
}

function processBasename(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) return "";
	const segments = trimmed.split(/[/\\]/);
	return (segments[segments.length - 1] ?? trimmed).toLowerCase();
}

function stripExeSuffix(name: string): string {
	return name.replace(/\.exe$/i, "");
}

function processFieldMatches(ruleProcess: string, foregroundProcess: string): boolean {
	const rule = processBasename(ruleProcess);
	if (!rule) return true;
	const foreground = processBasename(foregroundProcess);
	if (!foreground) return false;
	const ruleBare = stripExeSuffix(rule);
	const foregroundBare = stripExeSuffix(foreground);
	return foreground.includes(rule) || foregroundBare.includes(ruleBare);
}

export function matchesPauseAppRule(
	rule: PauseAppRule,
	foreground: PauseAppForeground,
): boolean {
	const process = rule.processName.trim();
	const title = rule.windowTitle.trim();
	if (!process && !title) return false;
	const processOk = processFieldMatches(process, foreground.processName);
	const titleOk =
		!title ||
		foreground.windowTitle.toLowerCase().includes(title.toLowerCase());
	return processOk && titleOk;
}

export function foregroundMatchesAppRules(
	rules: readonly PauseAppRule[],
	foreground: PauseAppForeground,
): boolean {
	return rules.some((rule) => matchesPauseAppRule(rule, foreground));
}

const HH_MM = /^(\d{1,2}):(\d{2})(?::\d{2})?$/;

/** Minutes since midnight, or null when the string is not a valid local HH:mm. */
export function parseQuietHoursMinutes(value: string): number | null {
	const match = HH_MM.exec(value.trim());
	if (!match) return null;
	const hours = Number(match[1]);
	const minutes = Number(match[2]);
	if (
		!Number.isInteger(hours) ||
		!Number.isInteger(minutes) ||
		hours < 0 ||
		hours > 23 ||
		minutes < 0 ||
		minutes > 59
	) {
		return null;
	}
	return hours * 60 + minutes;
}

export function isValidQuietHoursTime(value: string): boolean {
	return parseQuietHoursMinutes(value) !== null;
}

/** Normalize to zero-padded HH:mm for storage / time inputs. */
export function normalizeQuietHoursTime(value: string): string | null {
	const minutes = parseQuietHoursMinutes(value);
	if (minutes === null) return null;
	const hours = Math.floor(minutes / 60);
	const mins = minutes % 60;
	return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

/**
 * True when local clock is inside [start, end).
 * Overnight windows (e.g. 22:00–08:00) wrap midnight.
 * Equal start/end is treated as an empty window (never quiet).
 */
export function isInQuietHours(
	now: Date,
	start: string,
	end: string,
): boolean {
	const startMinutes = parseQuietHoursMinutes(start);
	const endMinutes = parseQuietHoursMinutes(end);
	if (startMinutes === null || endMinutes === null) return false;
	if (startMinutes === endMinutes) return false;

	const nowMinutes = now.getHours() * 60 + now.getMinutes();
	if (startMinutes < endMinutes) {
		return nowMinutes >= startMinutes && nowMinutes < endMinutes;
	}
	return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

export type ResolveFocusPauseInput = {
	quietHoursEnabled: boolean;
	inQuietHours: boolean;
	pauseOnFullscreen: boolean;
	isFullscreen: boolean;
	appRuleMatched: boolean;
};

export function resolveFocusPauseReason(
	input: ResolveFocusPauseInput,
): FocusPauseReason {
	if (input.quietHoursEnabled && input.inQuietHours) return "quiet-hours";
	if (input.pauseOnFullscreen && input.isFullscreen) return "fullscreen";
	if (input.appRuleMatched) return "app-rule";
	return null;
}

export function shouldSuppressNotifications(
	input: ResolveFocusPauseInput,
): boolean {
	return resolveFocusPauseReason(input) !== null;
}

/**
 * Quiet hours freezes the timer-mode tracking clock (and soft-pauses the
 * camera). Fullscreen / app-rule pause prompts without freezing minutes —
 * the user is still at the desk.
 */
export function shouldFreezeTrackingForFocusPause(
	reason: FocusPauseReason,
): boolean {
	return reason === "quiet-hours";
}
