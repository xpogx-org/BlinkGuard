import { BLINK_RATE_LOW_MAX } from "./blink-rate";
import { theme } from "./theme";
import {
	type CameraDevicePref,
	sanitizeCameraDevice,
} from "./camera-devices";
import {
	sanitizeClassifierBias,
	sanitizeClassifierThreshold,
} from "./classifier-calibration";
import { isValidEarCalibration } from "./ear-calibration";
import {
	isPopupPresetId,
	type PopupPresetId,
} from "./popup-presets";
import {
	defaultExercisePrompts,
	defaultLookAwayHint,
	defaultLookAwayTitle,
	defaultPopupMessage,
	sanitizeLocale,
	type Locale,
} from "./i18n";
import {
	DEFAULT_NOTIFICATION_STYLE,
	sanitizeNotificationStyle,
	type NotificationStyle,
} from "./notification-style";

export type { Locale };

export interface Point {
	x: number;
	y: number;
}

export interface Size {
	width: number;
	height: number;
}

export interface PopupColors {
	background: string;
	text: string;
	transparency: number;
}

export type CameraQuality = "performance" | "medium" | "high" | "ultra";

/** Foreground match rule; empty fields are wildcards. Both empty is dropped. */
export type PauseAppRule = {
	processName: string;
	windowTitle: string;
};

/** Monday-first weekday keys for quiet-hours overrides (never persist Date.getDay()). */
export const QUIET_HOURS_WEEKDAY_KEYS = [
	"mon",
	"tue",
	"wed",
	"thu",
	"fri",
	"sat",
	"sun",
] as const;

export type WeekdayKey = (typeof QUIET_HOURS_WEEKDAY_KEYS)[number];

export type QuietHoursDayOverride =
	| { mode: "default" }
	| { mode: "off" }
	| { mode: "custom"; start: string; end: string };

/** Sparse per-weekday quiet-hours overrides; missing key / `{}` = inherit default window. */
export type QuietHoursByWeekday = Partial<
	Record<WeekdayKey, QuietHoursDayOverride>
>;

export const PAUSE_APP_RULE_FIELD_MAX = 128;
export const PAUSE_APP_RULES_MAX = 32;
export const PAUSE_APP_CANDIDATES_MAX = 64;

export type PauseAppPickerPayload = {
	lastFocused: PauseAppRule | null;
	running: PauseAppRule[];
};

export function emptyPauseAppPicker(): PauseAppPickerPayload {
	return { lastFocused: null, running: [] };
}

function pauseAppRuleFromUnknown(item: unknown): PauseAppRule | null {
	if (!item || typeof item !== "object") return null;
	const record = item as Record<string, unknown>;
	const processRaw =
		typeof record.processName === "string"
			? record.processName
			: typeof record.p === "string"
				? record.p
				: "";
	const titleRaw =
		typeof record.windowTitle === "string"
			? record.windowTitle
			: typeof record.t === "string"
				? record.t
				: "";
	const processName = processRaw.trim().slice(0, PAUSE_APP_RULE_FIELD_MAX);
	const windowTitle = titleRaw.trim().slice(0, PAUSE_APP_RULE_FIELD_MAX);
	if (!processName && !windowTitle) return null;
	return { processName, windowTitle };
}

/** Deduped running-app picker rows (process+title); not the persisted cap. */
export function sanitizePauseAppCandidates(input: unknown): PauseAppRule[] {
	if (!Array.isArray(input)) return [];
	const seen = new Set<string>();
	const cleaned: PauseAppRule[] = [];
	for (const item of input) {
		const rule = pauseAppRuleFromUnknown(item);
		if (!rule) continue;
		const key = `${rule.processName.toLowerCase()}\0${rule.windowTitle.toLowerCase()}`;
		if (seen.has(key)) continue;
		seen.add(key);
		cleaned.push(rule);
		if (cleaned.length >= PAUSE_APP_CANDIDATES_MAX) break;
	}
	return cleaned;
}

export function sanitizePauseAppPickerPayload(
	input: unknown,
): PauseAppPickerPayload {
	if (!input || typeof input !== "object") return emptyPauseAppPicker();
	const record = input as Record<string, unknown>;
	return {
		lastFocused: pauseAppRuleFromUnknown(record.lastFocused),
		running: sanitizePauseAppCandidates(record.running),
	};
}

export function samePauseAppRules(a: PauseAppRule[], b: PauseAppRule[]): boolean {
	return (
		a.length === b.length &&
		a.every(
			(rule, index) =>
				rule.processName === b[index].processName &&
				rule.windowTitle === b[index].windowTitle,
		)
	);
}

/** Coerce stored/IPC app-rule blocklist; empty list disables the feature. */
export function sanitizePauseAppRules(input: unknown): PauseAppRule[] {
	if (!Array.isArray(input)) return [];
	const cleaned: PauseAppRule[] = [];
	for (const item of input) {
		const rule = pauseAppRuleFromUnknown(item);
		if (!rule) continue;
		cleaned.push(rule);
		if (cleaned.length >= PAUSE_APP_RULES_MAX) break;
	}
	return cleaned;
}

const BLINK_RATE_THRESHOLD_MIN = 1;
const BLINK_RATE_THRESHOLD_MAX = 60;

const AUTO_STOP_NO_FACE_MINUTES_MIN = 1;
const AUTO_STOP_NO_FACE_MINUTES_MAX = 30;
const AUTO_STOP_NO_FACE_MINUTES_DEFAULT = 2;

const SNOOZE_MINUTES_MIN = 1;
const SNOOZE_MINUTES_MAX = 30;
const SNOOZE_MINUTES_DEFAULT = 5;

const SOUND_VOLUME_MIN = 0;
const SOUND_VOLUME_MAX = 100;
const SOUND_VOLUME_DEFAULT = 100;

/** Camera miss-gap / timer base interval (ms). */
const REMINDER_INTERVAL_MS_MIN = 1_000;
const REMINDER_INTERVAL_MS_MAX = 10_000;
const REMINDER_INTERVAL_MS_DEFAULT = 3_000;

/** No-camera micro-break cue cadence (ms). */
const MICRO_BREAK_INTERVAL_MS_MIN = 15_000;
const MICRO_BREAK_INTERVAL_MS_MAX = 120_000;
const MICRO_BREAK_INTERVAL_MS_DEFAULT = 30_000;

/** Blink prompt intensity ladder profile. */
export type BlinkPromptProfile = "standard" | "gentle" | "strong";

/** Global shortcut actions bound via Electron `globalShortcut`. */
export const SHORTCUT_ACTIONS = [
	"trackingToggle",
	"snoozeAll",
	"openSettings",
	"openCameraPreview",
] as const;

export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];

/** Per-action accelerator strings; `""` means unbound. */
export type KeyboardShortcuts = Record<ShortcutAction, string>;

/** Failed accelerators after registerAll (action → accelerator). */
export type ShortcutErrorMap = Partial<Record<ShortcutAction, string>>;

export type ShortcutErrorPayload = {
	errors: ShortcutErrorMap;
	/** Actions that share the same accelerator within the map (none registered). */
	conflicts: ShortcutAction[];
};

export const DEFAULT_KEYBOARD_SHORTCUTS: Readonly<KeyboardShortcuts> = {
	trackingToggle: "Ctrl+I",
	snoozeAll: "Ctrl+Shift+S",
	openSettings: "",
	openCameraPreview: "",
};

export function sameKeyboardShortcuts(
	a: KeyboardShortcuts,
	b: KeyboardShortcuts,
): boolean {
	return SHORTCUT_ACTIONS.every((action) => a[action] === b[action]);
}

/** Actions that share a non-empty accelerator with at least one other action. */
export function findDuplicateShortcutActions(
	map: KeyboardShortcuts,
): ShortcutAction[] {
	const byAccel = new Map<string, ShortcutAction[]>();
	for (const action of SHORTCUT_ACTIONS) {
		const accel = map[action];
		if (!accel) continue;
		const group = byAccel.get(accel) ?? [];
		group.push(action);
		byAccel.set(accel, group);
	}
	const duplicates: ShortcutAction[] = [];
	for (const [, actions] of byAccel) {
		if (actions.length < 2) continue;
		duplicates.push(...actions);
	}
	return duplicates;
}

/**
 * Coerce stored/IPC shortcut map. Empty strings stay unbound.
 * Legacy `keyboardShortcut` migrates into `trackingToggle` when the map is absent.
 */
export function sanitizeKeyboardShortcuts(
	input: unknown,
	legacyShortcut?: unknown,
): KeyboardShortcuts {
	const defaults = { ...DEFAULT_KEYBOARD_SHORTCUTS };
	if (input && typeof input === "object") {
		const record = input as Record<string, unknown>;
		const next = { ...defaults };
		for (const action of SHORTCUT_ACTIONS) {
			if (typeof record[action] === "string") {
				next[action] = record[action].trim();
			}
		}
		return next;
	}
	if (typeof legacyShortcut === "string" && legacyShortcut.trim()) {
		return { ...defaults, trackingToggle: legacyShortcut.trim() };
	}
	return defaults;
}

/** Headroom for ambitious weekly blink targets (workday-scale). */
const GOAL_BLINKS_MAX = 100_000;
const GOAL_TRACKING_MINUTES_MAX = 24 * 7 * 60;

export type GoalsConfig = {
	goalsEnabled: boolean;
	dailyBlinkGoal: number;
	dailyTrackingMinutesGoal: number;
	weeklyBlinkGoal: number;
	weeklyTrackingMinutesGoal: number;
};

/**
 * Defaults aim at healthier screen-time habits with camera tracking:
 * ~12–15 blinks/min (better than typical CVS drop to ~5) over a workday,
 * plus several hours of monitoring Mon–Fri.
 */
export const DEFAULT_GOALS_CONFIG: Readonly<GoalsConfig> = {
	goalsEnabled: true,
	/** ~12.5 blinks/min × 6h focused screen time. */
	dailyBlinkGoal: 4500,
	/** Cover a typical core workday with tracking on. */
	dailyTrackingMinutesGoal: 300,
	/** ~4–5 solid workdays in a Mon–Sun week. */
	weeklyBlinkGoal: 20_000,
	/** ~5 × 5h monitored days. */
	weeklyTrackingMinutesGoal: 1500,
};

function sanitizeGoalBlinks(input: unknown, fallback: number): number {
	if (input === null || input === undefined || input === "") return fallback;
	const n = typeof input === "number" ? input : Number(input);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(GOAL_BLINKS_MAX, Math.max(0, Math.round(n)));
}

function sanitizeGoalMinutes(input: unknown, fallback: number): number {
	if (input === null || input === undefined || input === "") return fallback;
	const n = typeof input === "number" ? input : Number(input);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(GOAL_TRACKING_MINUTES_MAX, Math.max(0, Math.round(n)));
}

/** Coerce stored/IPC goals config; 0 disables that metric. */
export function sanitizeGoalsConfig(input: unknown): GoalsConfig {
	const defaults = DEFAULT_GOALS_CONFIG;
	if (!input || typeof input !== "object") {
		return { ...defaults };
	}
	const record = input as Record<string, unknown>;
	return {
		goalsEnabled:
			typeof record.goalsEnabled === "boolean"
				? record.goalsEnabled
				: defaults.goalsEnabled,
		dailyBlinkGoal: sanitizeGoalBlinks(
			record.dailyBlinkGoal,
			defaults.dailyBlinkGoal,
		),
		dailyTrackingMinutesGoal: sanitizeGoalMinutes(
			record.dailyTrackingMinutesGoal,
			defaults.dailyTrackingMinutesGoal,
		),
		weeklyBlinkGoal: sanitizeGoalBlinks(
			record.weeklyBlinkGoal,
			defaults.weeklyBlinkGoal,
		),
		weeklyTrackingMinutesGoal: sanitizeGoalMinutes(
			record.weeklyTrackingMinutesGoal,
			defaults.weeklyTrackingMinutesGoal,
		),
	};
}

export function goalsConfigFromPreferences(
	preferences: Pick<
		PersistedPreferences,
		| "goalsEnabled"
		| "dailyBlinkGoal"
		| "dailyTrackingMinutesGoal"
		| "weeklyBlinkGoal"
		| "weeklyTrackingMinutesGoal"
	>,
): GoalsConfig {
	return {
		goalsEnabled: preferences.goalsEnabled,
		dailyBlinkGoal: preferences.dailyBlinkGoal,
		dailyTrackingMinutesGoal: preferences.dailyTrackingMinutesGoal,
		weeklyBlinkGoal: preferences.weeklyBlinkGoal,
		weeklyTrackingMinutesGoal: preferences.weeklyTrackingMinutesGoal,
	};
}

/** Coerce stored/IPC blink-rate coaching threshold to 1…60. */
export function sanitizeBlinkRateThresholdPerMin(input: unknown): number {
	if (input === null || input === undefined || input === "") {
		return BLINK_RATE_LOW_MAX;
	}
	const n = typeof input === "number" ? input : Number(input);
	if (!Number.isFinite(n)) return BLINK_RATE_LOW_MAX;
	return Math.min(
		BLINK_RATE_THRESHOLD_MAX,
		Math.max(BLINK_RATE_THRESHOLD_MIN, Math.round(n)),
	);
}

/** Coerce stored/IPC auto-stop-on-no-face minutes to 1…30. */
export function sanitizeAutoStopNoFaceMinutes(input: unknown): number {
	if (input === null || input === undefined || input === "") {
		return AUTO_STOP_NO_FACE_MINUTES_DEFAULT;
	}
	const n = typeof input === "number" ? input : Number(input);
	if (!Number.isFinite(n)) return AUTO_STOP_NO_FACE_MINUTES_DEFAULT;
	return Math.min(
		AUTO_STOP_NO_FACE_MINUTES_MAX,
		Math.max(AUTO_STOP_NO_FACE_MINUTES_MIN, Math.round(n)),
	);
}

/** Coerce stored/IPC snooze duration minutes to 1…30. */
export function sanitizeSnoozeMinutes(input: unknown): number {
	if (input === null || input === undefined || input === "") {
		return SNOOZE_MINUTES_DEFAULT;
	}
	const n = typeof input === "number" ? input : Number(input);
	if (!Number.isFinite(n)) return SNOOZE_MINUTES_DEFAULT;
	return Math.min(
		SNOOZE_MINUTES_MAX,
		Math.max(SNOOZE_MINUTES_MIN, Math.round(n)),
	);
}

/** Coerce stored/IPC notification sound volume to 0…100. */
export function sanitizeSoundVolume(input: unknown): number {
	if (input === null || input === undefined || input === "") {
		return SOUND_VOLUME_DEFAULT;
	}
	const n = typeof input === "number" ? input : Number(input);
	if (!Number.isFinite(n)) return SOUND_VOLUME_DEFAULT;
	return Math.min(
		SOUND_VOLUME_MAX,
		Math.max(SOUND_VOLUME_MIN, Math.round(n)),
	);
}

/** Coerce stored/IPC blink prompt profile; unknown → standard. */
export function sanitizeBlinkPromptProfile(input: unknown): BlinkPromptProfile {
	return input === "standard" || input === "gentle" || input === "strong"
		? input
		: "standard";
}

/** Coerce stored/IPC camera miss-gap interval to 1_000…10_000 ms. */
export function sanitizeReminderIntervalMs(input: unknown): number {
	if (input === null || input === undefined || input === "") {
		return REMINDER_INTERVAL_MS_DEFAULT;
	}
	const n = typeof input === "number" ? input : Number(input);
	if (!Number.isFinite(n) || n <= 0) return REMINDER_INTERVAL_MS_DEFAULT;
	return Math.min(
		REMINDER_INTERVAL_MS_MAX,
		Math.max(REMINDER_INTERVAL_MS_MIN, Math.round(n)),
	);
}

/**
 * Coerce stored/IPC micro-break interval to 15_000…120_000 ms.
 * Missing/invalid → 30s; never copies reminderInterval.
 */
export function sanitizeSessionRecapEnabled(value: unknown): boolean {
	return typeof value === "boolean"
		? value
		: DEFAULT_PREFERENCES.sessionRecapEnabled;
}

export function sanitizeMicroBreakIntervalMs(input: unknown): number {
	if (input === null || input === undefined || input === "") {
		return MICRO_BREAK_INTERVAL_MS_DEFAULT;
	}
	const n = typeof input === "number" ? input : Number(input);
	if (!Number.isFinite(n) || n <= 0) return MICRO_BREAK_INTERVAL_MS_DEFAULT;
	return Math.min(
		MICRO_BREAK_INTERVAL_MS_MAX,
		Math.max(MICRO_BREAK_INTERVAL_MS_MIN, Math.round(n)),
	);
}

export interface PersistedPreferences {
	darkMode: boolean;
	/** Camera miss-gap in ms; 1_000…10_000. */
	reminderInterval: number;
	/** Blink prompt intensity profile. */
	blinkPromptProfile: BlinkPromptProfile;
	/** No-camera micro-break cue cadence in ms; 15_000…120_000. */
	microBreakInterval: number;
	cameraEnabled: boolean;
	cameraQuality: CameraQuality;
	/** Preferred capture device; null = Automatic OpenCV index scan. */
	cameraDevice: CameraDevicePref | null;
	/** Stop tracking after sustained no-face while camera monitoring. */
	autoStopNoFaceEnabled: boolean;
	/** Minutes without a face before auto-stop (1…30). */
	autoStopNoFaceMinutes: number;
	/** Low-BPM ladder boost when live camera blink rate is below threshold (not a soft toast). */
	blinkRateCoachingEnabled: boolean;
	/** Ladder / ICMU threshold: boost when blinks/min is strictly below this value (default = Low band). */
	blinkRateThresholdPerMin: number;
	/** Personal open-eye EAR baseline; null when unset. */
	earCalibration: number | null;
	/** Epoch ms of last successful EAR calibration; null if never / unknown. */
	calibrationAt: number | null;
	/** Soft toast when EAR baseline is stale or the sidecar reports drift. */
	calibrationNudgeEnabled: boolean;
	/** Epoch ms when the user dismissed a stale/drift banner; null if not snoozed. */
	calibrationNudgeDismissedAt: number | null;
	/** Epoch ms of last sidecar baseline_drift_nudge; null if none this baseline. */
	lastBaselineDriftAt: number | null;
	/** Stage 5 personal classifier logit bias; null when unset. */
	classifierBias: number | null;
	/** Stage 5 personal classifier threshold; null = baked 0.25. */
	classifierThreshold: number | null;
	eyeExercisesEnabled: boolean;
	exerciseInterval: number;
	/** Rotating eye-exercise instruction texts shown in the exercise popup. */
	exercisePrompts: string[];
	/**
	 * When true (default), exercise/look-away timers run even if Start/Stop
	 * blink reminders is off. When false, Stop also pauses eye-care.
	 */
	eyeCareIndependentOfTracking: boolean;
	/** Periodic 20-20-20 style look-away breaks. */
	lookAwayEnabled: boolean;
	/** Minutes between look-away prompts. */
	lookAwayInterval: number;
	/** Seconds to look away (countdown in popup). */
	lookAwayDuration: number;
	/** Look-away popup title (user-editable; built-ins localize). */
	lookAwayTitle: string;
	/** Look-away popup hint (user-editable; built-ins localize). */
	lookAwayHint: string;
	popupPosition: Point | null;
	/** Blink/editor top-left per Electron `display.id` (string). */
	popupPositionsByDisplayId: Record<string, Point>;
	popupSize: Size;
	/** Blink/editor size per Electron `display.id` (string). */
	popupSizesByDisplayId: Record<string, Size>;
	popupColors: PopupColors;
	/** Shop reward glow preset applied to popups; null = custom / no glow. */
	popupGlowPreset: PopupPresetId | null;
	popupMessage: string;
	/** When true, blink / exercise / look-away popups ignore mouse (watermark); snooze via tray. */
	blinkPopupClickThrough: boolean;
	/** How blink / exercise / look-away prompts appear. Default overlay (current). */
	notificationStyle: NotificationStyle;
	/** Desk session recap overlay / native summaries on stop, lock, quit. */
	sessionRecapEnabled: boolean;
	/** Minutes to suppress/re-show prompts after Snooze (1…30). */
	snoozeMinutes: number;
	/** Per-action global accelerators; empty string = unbound. */
	keyboardShortcuts: KeyboardShortcuts;
	mgdMode: boolean;
	soundEnabled: boolean;
	/** Notification sound loudness 0…100 (HTML audio volume = value / 100). */
	soundVolume: number;
	/** Opt-in: start BlinkGuard at OS login (hidden to tray). */
	launchAtLogin: boolean;
	/** Whether blink reminders are active; persisted across restarts. */
	isTracking: boolean;
	/** Suppress interruptive popups during a local-time window. */
	quietHoursEnabled: boolean;
	/** Quiet-hours start as local HH:mm (24h). */
	quietHoursStart: string;
	/** Quiet-hours end as local HH:mm (24h); may be earlier than start (overnight). */
	quietHoursEnd: string;
	/**
	 * Optional per-weekday quiet-hours overrides (inherit / off / custom).
	 * Missing map or `{}` = every day uses quietHoursStart/End.
	 */
	quietHoursByWeekday: QuietHoursByWeekday;
	/** Suppress interruptive popups while another app is fullscreen. */
	pauseOnFullscreen: boolean;
	/** Foreground process/title blocklist; empty = off. */
	pauseAppRules: PauseAppRule[];
	/** First-run setup completed or skipped; false until Finish/Skip. */
	hasCompletedOnboarding: boolean;
	/** UI language for settings and popups. */
	locale: Locale;
	/** Master switch for daily/weekly blink and tracking goals. */
	goalsEnabled: boolean;
	/** Daily blink target (0 = off). */
	dailyBlinkGoal: number;
	/** Daily tracking minutes target (0 = off). */
	dailyTrackingMinutesGoal: number;
	/** Weekly blink target Mon–Sun (0 = off). */
	weeklyBlinkGoal: number;
	/** Weekly tracking minutes target Mon–Sun (0 = off). */
	weeklyTrackingMinutesGoal: number;
}

export type AppPreferences = PersistedPreferences;

/** Settings UI: interval fields are seconds (ms / 1000). */
export type RendererPreferences = Omit<
	AppPreferences,
	"reminderInterval" | "microBreakInterval"
> & {
	reminderInterval: number;
	microBreakInterval: number;
};

export const DEFAULT_EXERCISE_PROMPTS: readonly string[] =
	defaultExercisePrompts("en");

/** Coerce stored/IPC exercise prompts; never returns an empty list. */
export function sanitizeExercisePrompts(
	input: unknown,
	locale: Locale = "en",
): string[] {
	const fallback = defaultExercisePrompts(sanitizeLocale(locale));
	if (!Array.isArray(input)) {
		return [...fallback];
	}
	const cleaned = input
		.filter((item): item is string => typeof item === "string")
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
	return cleaned.length > 0 ? cleaned : [...fallback];
}

/** Coerce stored/IPC look-away title; empty → locale default. */
export function sanitizeLookAwayTitle(
	input: unknown,
	locale: Locale = "en",
): string {
	if (typeof input === "string" && input.trim()) {
		return input.trim();
	}
	return defaultLookAwayTitle(sanitizeLocale(locale));
}

/** Coerce stored/IPC look-away hint; empty → locale default. */
export function sanitizeLookAwayHint(
	input: unknown,
	locale: Locale = "en",
): string {
	if (typeof input === "string" && input.trim()) {
		return input.trim();
	}
	return defaultLookAwayHint(sanitizeLocale(locale));
}

export const DEFAULT_PREFERENCES: Readonly<PersistedPreferences> = {
	darkMode: true,
	reminderInterval: REMINDER_INTERVAL_MS_DEFAULT,
	blinkPromptProfile: "standard",
	microBreakInterval: MICRO_BREAK_INTERVAL_MS_DEFAULT,
	cameraEnabled: false,
	cameraQuality: "medium",
	cameraDevice: null,
	autoStopNoFaceEnabled: true,
	autoStopNoFaceMinutes: AUTO_STOP_NO_FACE_MINUTES_DEFAULT,
	blinkRateCoachingEnabled: true,
	blinkRateThresholdPerMin: BLINK_RATE_LOW_MAX,
	earCalibration: null,
	calibrationAt: null,
	calibrationNudgeEnabled: true,
	calibrationNudgeDismissedAt: null,
	lastBaselineDriftAt: null,
	classifierBias: null,
	classifierThreshold: null,
	eyeExercisesEnabled: true,
	exerciseInterval: 40,
	exercisePrompts: [...DEFAULT_EXERCISE_PROMPTS],
	eyeCareIndependentOfTracking: true,
	lookAwayEnabled: true,
	lookAwayInterval: 20,
	lookAwayDuration: 20,
	lookAwayTitle: defaultLookAwayTitle("en"),
	lookAwayHint: defaultLookAwayHint("en"),
	popupPosition: null,
	popupPositionsByDisplayId: {},
	popupSize: { width: 300, height: 120 },
	popupSizesByDisplayId: {},
	popupColors: {
		background: theme.popup.bg,
		text: theme.popup.text,
		transparency: theme.popup.transparency,
	},
	popupGlowPreset: null,
	popupMessage: defaultPopupMessage("en"),
	blinkPopupClickThrough: true,
	notificationStyle: DEFAULT_NOTIFICATION_STYLE,
	sessionRecapEnabled: true,
	snoozeMinutes: SNOOZE_MINUTES_DEFAULT,
	keyboardShortcuts: { ...DEFAULT_KEYBOARD_SHORTCUTS },
	mgdMode: false,
	soundEnabled: false,
	soundVolume: SOUND_VOLUME_DEFAULT,
	launchAtLogin: false,
	isTracking: false,
	quietHoursEnabled: true,
	quietHoursStart: "22:00",
	quietHoursEnd: "08:00",
	quietHoursByWeekday: {},
	pauseOnFullscreen: true,
	pauseAppRules: [],
	hasCompletedOnboarding: false,
	locale: "en",
	goalsEnabled: DEFAULT_GOALS_CONFIG.goalsEnabled,
	dailyBlinkGoal: DEFAULT_GOALS_CONFIG.dailyBlinkGoal,
	dailyTrackingMinutesGoal: DEFAULT_GOALS_CONFIG.dailyTrackingMinutesGoal,
	weeklyBlinkGoal: DEFAULT_GOALS_CONFIG.weeklyBlinkGoal,
	weeklyTrackingMinutesGoal: DEFAULT_GOALS_CONFIG.weeklyTrackingMinutesGoal,
};

export function toRendererPreferences(
	preferences: AppPreferences,
): RendererPreferences {
	return {
		...preferences,
		reminderInterval: preferences.reminderInterval / 1000,
		microBreakInterval: preferences.microBreakInterval / 1000,
	};
}

const QUIET_HOURS_HH_MM = /^(\d{1,2}):(\d{2})(?::\d{2})?$/;

function parseQuietHoursMinutes(value: string): number | null {
	const match = QUIET_HOURS_HH_MM.exec(value.trim());
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

function normalizeQuietHoursTime(value: string): string | null {
	const minutes = parseQuietHoursMinutes(value);
	if (minutes === null) return null;
	const hours = Math.floor(minutes / 60);
	const mins = minutes % 60;
	return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

/**
 * Coerce stored/IPC weekday quiet-hours map. Missing/invalid → inherit-all (`{}`).
 * Drops `{mode:"default"}` so upgrades stay sparse; `off` ignores times.
 */
export function sanitizeQuietHoursByWeekday(
	input: unknown,
): QuietHoursByWeekday {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		return {};
	}
	const record = input as Record<string, unknown>;
	const cleaned: QuietHoursByWeekday = {};
	for (const key of QUIET_HOURS_WEEKDAY_KEYS) {
		if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
		const raw = record[key];
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
		const day = raw as Record<string, unknown>;
		const mode = day.mode;
		if (mode === "off") {
			cleaned[key] = { mode: "off" };
			continue;
		}
		if (mode === "custom") {
			const start =
				typeof day.start === "string"
					? normalizeQuietHoursTime(day.start)
					: null;
			const end =
				typeof day.end === "string" ? normalizeQuietHoursTime(day.end) : null;
			if (start === null || end === null) continue;
			cleaned[key] = { mode: "custom", start, end };
			continue;
		}
		// mode "default" or unknown → omit (inherit)
	}
	return cleaned;
}

/** Structural equality; key order must not spuriously fail. */
export function sameQuietHoursByWeekday(
	a: QuietHoursByWeekday,
	b: QuietHoursByWeekday,
): boolean {
	for (const key of QUIET_HOURS_WEEKDAY_KEYS) {
		const left = a[key];
		const right = b[key];
		if (left === right) continue;
		if (!left || !right) return false;
		if (left.mode !== right.mode) return false;
		if (left.mode === "custom" && right.mode === "custom") {
			if (left.start !== right.start || left.end !== right.end) return false;
		}
	}
	return true;
}

function isCameraQualityValue(value: unknown): value is CameraQuality {
	return (
		value === "performance" ||
		value === "medium" ||
		value === "high" ||
		value === "ultra"
	);
}

/** Epoch ms from a number or ISO date string; invalid / missing → null. */
export function sanitizeEpochMs(value: unknown): number | null {
	if (value === null || value === undefined || value === "") return null;
	if (typeof value === "number" && Number.isFinite(value) && value > 0) {
		return Math.round(value);
	}
	if (typeof value === "string" && value.trim()) {
		const asNumber = Number(value);
		if (Number.isFinite(asNumber) && asNumber > 0) {
			return Math.round(asNumber);
		}
		const parsed = Date.parse(value);
		if (Number.isFinite(parsed) && parsed > 0) return parsed;
	}
	return null;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function asFiniteNumber(value: unknown, fallback: number): number {
	const n = typeof value === "number" ? value : Number(value);
	return Number.isFinite(n) ? n : fallback;
}

function asPositiveMinutes(value: unknown, fallback: number): number {
	const n = asFiniteNumber(value, fallback);
	return n > 0 ? Math.round(n) : fallback;
}

function asPositiveSeconds(value: unknown, fallback: number): number {
	const n = asFiniteNumber(value, fallback);
	return n > 0 ? Math.round(n) : fallback;
}

function sanitizePopupPosition(value: unknown): Point | null {
	if (value === null || value === undefined) return null;
	if (!value || typeof value !== "object") return null;
	const record = value as Record<string, unknown>;
	const x = asFiniteNumber(record.x, Number.NaN);
	const y = asFiniteNumber(record.y, Number.NaN);
	if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
	return { x: Math.round(x), y: Math.round(y) };
}

export const POPUP_POSITIONS_BY_DISPLAY_MAX = 16;

/** Coerce stored/IPC per-display popup points; drop junk keys. */
export function sanitizePopupPositionsByDisplayId(
	value: unknown,
): Record<string, Point> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const out: Record<string, Point> = {};
	for (const [rawKey, rawPoint] of Object.entries(
		value as Record<string, unknown>,
	)) {
		const id = rawKey.trim();
		if (!id) continue;
		const point = sanitizePopupPosition(rawPoint);
		if (!point) continue;
		out[id] = point;
		if (Object.keys(out).length >= POPUP_POSITIONS_BY_DISPLAY_MAX) break;
	}
	return out;
}

export function samePopupPositionsByDisplayId(
	a: Record<string, Point>,
	b: Record<string, Point>,
): boolean {
	const keysA = Object.keys(a);
	const keysB = Object.keys(b);
	if (keysA.length !== keysB.length) return false;
	return keysA.every((key) => {
		const other = b[key];
		return !!other && a[key].x === other.x && a[key].y === other.y;
	});
}

/**
 * If the map is empty and a legacy single point exists, seed it under
 * `seedDisplayId`. Existing map entries win (do not overwrite).
 */
export function seedPopupPositionsFromLegacy(
	map: Record<string, Point>,
	legacyPoint: Point | null,
	seedDisplayId: string,
): Record<string, Point> {
	if (Object.keys(map).length > 0) return { ...map };
	const id = seedDisplayId.trim();
	if (!legacyPoint || !id) return {};
	return { [id]: { x: legacyPoint.x, y: legacyPoint.y } };
}

/** Drop map keys that are not in the live display-id list (tests / explicit reset). */
export function prunePopupPositionsByDisplayId(
	map: Record<string, Point>,
	liveDisplayIds: readonly string[],
): Record<string, Point> {
	const live = new Set(liveDisplayIds);
	const next: Record<string, Point> = {};
	for (const [id, point] of Object.entries(map)) {
		if (!live.has(id)) continue;
		next[id] = point;
	}
	return next;
}

function capPopupMapByDisplayId<T>(
	map: Record<string, T>,
	liveDisplayIds: readonly string[],
	max: number,
): Record<string, T> {
	const keys = Object.keys(map);
	if (keys.length <= max) return { ...map };
	const live = new Set(liveDisplayIds);
	const liveEntries: [string, T][] = [];
	const disconnected: [string, T][] = [];
	for (const entry of Object.entries(map)) {
		(live.has(entry[0]) ? liveEntries : disconnected).push(entry);
	}
	return Object.fromEntries([...liveEntries, ...disconnected].slice(0, max));
}

/**
 * Keep disconnected-display layouts. Only drop extras when over `max`,
 * preferring live ids so a dock/unplug cycle does not forget a screen.
 */
export function capPopupPositionsByDisplayId(
	map: Record<string, Point>,
	liveDisplayIds: readonly string[],
	max = POPUP_POSITIONS_BY_DISPLAY_MAX,
): Record<string, Point> {
	return capPopupMapByDisplayId(map, liveDisplayIds, max);
}

function sanitizePopupSize(value: unknown, fallback: Size): Size {
	if (!value || typeof value !== "object") return { ...fallback };
	const record = value as Record<string, unknown>;
	const width = asFiniteNumber(record.width, fallback.width);
	const height = asFiniteNumber(record.height, fallback.height);
	return {
		width: Math.max(1, Math.round(width)),
		height: Math.max(1, Math.round(height)),
	};
}

function parsePopupSize(value: unknown): Size | null {
	if (!value || typeof value !== "object") return null;
	const record = value as Record<string, unknown>;
	const width = asFiniteNumber(record.width, Number.NaN);
	const height = asFiniteNumber(record.height, Number.NaN);
	if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
	if (width < 1 || height < 1) return null;
	return { width: Math.round(width), height: Math.round(height) };
}

/** Coerce stored/IPC per-display popup sizes; drop junk keys. */
export function sanitizePopupSizesByDisplayId(
	value: unknown,
): Record<string, Size> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const out: Record<string, Size> = {};
	for (const [rawKey, rawSize] of Object.entries(
		value as Record<string, unknown>,
	)) {
		const id = rawKey.trim();
		if (!id) continue;
		const size = parsePopupSize(rawSize);
		if (!size) continue;
		out[id] = size;
		if (Object.keys(out).length >= POPUP_POSITIONS_BY_DISPLAY_MAX) break;
	}
	return out;
}

export function samePopupSizesByDisplayId(
	a: Record<string, Size>,
	b: Record<string, Size>,
): boolean {
	const keysA = Object.keys(a);
	const keysB = Object.keys(b);
	if (keysA.length !== keysB.length) return false;
	return keysA.every((key) => {
		const other = b[key];
		return (
			!!other && a[key].width === other.width && a[key].height === other.height
		);
	});
}

/**
 * If the size map is empty, copy the mirror size onto each position-map id.
 * Existing size entries win.
 */
export function seedPopupSizesFromPositionIds(
	sizes: Record<string, Size>,
	positionIds: readonly string[],
	mirror: Size,
): Record<string, Size> {
	if (Object.keys(sizes).length > 0) return { ...sizes };
	if (positionIds.length === 0) return {};
	const out: Record<string, Size> = {};
	for (const id of positionIds) {
		if (!id) continue;
		out[id] = { width: mirror.width, height: mirror.height };
	}
	return out;
}

export function prunePopupSizesByDisplayId(
	map: Record<string, Size>,
	liveDisplayIds: readonly string[],
): Record<string, Size> {
	const live = new Set(liveDisplayIds);
	const next: Record<string, Size> = {};
	for (const [id, size] of Object.entries(map)) {
		if (!live.has(id)) continue;
		next[id] = size;
	}
	return next;
}

export function capPopupSizesByDisplayId(
	map: Record<string, Size>,
	liveDisplayIds: readonly string[],
	max = POPUP_POSITIONS_BY_DISPLAY_MAX,
): Record<string, Size> {
	return capPopupMapByDisplayId(map, liveDisplayIds, max);
}

function sanitizePopupColors(value: unknown, fallback: PopupColors): PopupColors {
	if (!value || typeof value !== "object") return { ...fallback };
	const record = value as Record<string, unknown>;
	const background =
		typeof record.background === "string" && record.background.trim()
			? record.background
			: fallback.background;
	const text =
		typeof record.text === "string" && record.text.trim()
			? record.text
			: fallback.text;
	const transparency = asFiniteNumber(record.transparency, fallback.transparency);
	return {
		background,
		text,
		transparency: Math.min(1, Math.max(0, transparency)),
	};
}

function sanitizePopupGlowPreset(value: unknown): PopupPresetId | null {
	if (isPopupPresetId(value)) return value;
	return null;
}

export type SanitizePersistedPreferencesOptions = {
	/** When true, always persist isTracking as false (backup import). */
	forceIsTrackingFalse?: boolean;
};

/**
 * Coerce arbitrary JSON into a full PersistedPreferences object.
 * Missing/invalid fields fall back to DEFAULT_PREFERENCES (and related sanitizers).
 */
export function sanitizePersistedPreferences(
	input: unknown,
	options?: SanitizePersistedPreferencesOptions,
): PersistedPreferences {
	const defaults = DEFAULT_PREFERENCES;
	const record =
		input && typeof input === "object"
			? (input as Record<string, unknown>)
			: {};

	const locale = sanitizeLocale(record.locale ?? defaults.locale);
	const earRaw = record.earCalibration;
	const earCalibration =
		earRaw === null
			? null
			: isValidEarCalibration(earRaw)
				? earRaw
				: defaults.earCalibration;
	const calibrationAt = sanitizeEpochMs(record.calibrationAt);
	const calibrationNudgeDismissedAt = sanitizeEpochMs(
		record.calibrationNudgeDismissedAt,
	);
	const lastBaselineDriftAt = sanitizeEpochMs(record.lastBaselineDriftAt);
	const classifierBias = sanitizeClassifierBias(record.classifierBias);
	const classifierThreshold = sanitizeClassifierThreshold(
		record.classifierThreshold,
	);

	const quietStartRaw =
		typeof record.quietHoursStart === "string"
			? record.quietHoursStart
			: defaults.quietHoursStart;
	const quietEndRaw =
		typeof record.quietHoursEnd === "string"
			? record.quietHoursEnd
			: defaults.quietHoursEnd;
	const quietHoursStart =
		normalizeQuietHoursTime(quietStartRaw) ?? defaults.quietHoursStart;
	const quietHoursEnd =
		normalizeQuietHoursTime(quietEndRaw) ?? defaults.quietHoursEnd;

	const goals = sanitizeGoalsConfig({
		goalsEnabled: record.goalsEnabled,
		dailyBlinkGoal: record.dailyBlinkGoal,
		dailyTrackingMinutesGoal: record.dailyTrackingMinutesGoal,
		weeklyBlinkGoal: record.weeklyBlinkGoal,
		weeklyTrackingMinutesGoal: record.weeklyTrackingMinutesGoal,
	});

	const isTracking = options?.forceIsTrackingFalse
		? false
		: asBoolean(record.isTracking, defaults.isTracking);

	return {
		darkMode: asBoolean(record.darkMode, defaults.darkMode),
		reminderInterval: sanitizeReminderIntervalMs(record.reminderInterval),
		blinkPromptProfile: sanitizeBlinkPromptProfile(record.blinkPromptProfile),
		microBreakInterval: sanitizeMicroBreakIntervalMs(record.microBreakInterval),
		cameraEnabled: asBoolean(record.cameraEnabled, defaults.cameraEnabled),
		cameraQuality: isCameraQualityValue(record.cameraQuality)
			? record.cameraQuality
			: defaults.cameraQuality,
		cameraDevice: sanitizeCameraDevice(record.cameraDevice),
		autoStopNoFaceEnabled: asBoolean(
			record.autoStopNoFaceEnabled,
			defaults.autoStopNoFaceEnabled,
		),
		autoStopNoFaceMinutes: sanitizeAutoStopNoFaceMinutes(
			record.autoStopNoFaceMinutes,
		),
		blinkRateCoachingEnabled: asBoolean(
			record.blinkRateCoachingEnabled,
			defaults.blinkRateCoachingEnabled,
		),
		blinkRateThresholdPerMin: sanitizeBlinkRateThresholdPerMin(
			record.blinkRateThresholdPerMin,
		),
		earCalibration,
		calibrationAt: earCalibration == null ? null : calibrationAt,
		calibrationNudgeEnabled: asBoolean(
			record.calibrationNudgeEnabled,
			defaults.calibrationNudgeEnabled,
		),
		calibrationNudgeDismissedAt,
		lastBaselineDriftAt,
		classifierBias,
		classifierThreshold,
		eyeExercisesEnabled: asBoolean(
			record.eyeExercisesEnabled,
			defaults.eyeExercisesEnabled,
		),
		exerciseInterval: asPositiveMinutes(
			record.exerciseInterval,
			defaults.exerciseInterval,
		),
		exercisePrompts: sanitizeExercisePrompts(record.exercisePrompts, locale),
		eyeCareIndependentOfTracking: asBoolean(
			record.eyeCareIndependentOfTracking,
			defaults.eyeCareIndependentOfTracking,
		),
		lookAwayEnabled: asBoolean(record.lookAwayEnabled, defaults.lookAwayEnabled),
		lookAwayInterval: asPositiveMinutes(
			record.lookAwayInterval,
			defaults.lookAwayInterval,
		),
		lookAwayDuration: asPositiveSeconds(
			record.lookAwayDuration,
			defaults.lookAwayDuration,
		),
		lookAwayTitle: sanitizeLookAwayTitle(record.lookAwayTitle, locale),
		lookAwayHint: sanitizeLookAwayHint(record.lookAwayHint, locale),
		popupPosition: sanitizePopupPosition(record.popupPosition),
		popupPositionsByDisplayId: sanitizePopupPositionsByDisplayId(
			record.popupPositionsByDisplayId,
		),
		popupSize: sanitizePopupSize(record.popupSize, defaults.popupSize),
		popupSizesByDisplayId: sanitizePopupSizesByDisplayId(
			record.popupSizesByDisplayId,
		),
		popupColors: sanitizePopupColors(record.popupColors, defaults.popupColors),
		popupGlowPreset: sanitizePopupGlowPreset(record.popupGlowPreset),
		popupMessage:
			typeof record.popupMessage === "string" && record.popupMessage.trim()
				? record.popupMessage
				: defaults.popupMessage,
		blinkPopupClickThrough: asBoolean(
			record.blinkPopupClickThrough,
			defaults.blinkPopupClickThrough,
		),
		notificationStyle: sanitizeNotificationStyle(record.notificationStyle),
		sessionRecapEnabled: sanitizeSessionRecapEnabled(
			record.sessionRecapEnabled,
		),
		snoozeMinutes: sanitizeSnoozeMinutes(record.snoozeMinutes),
		keyboardShortcuts: sanitizeKeyboardShortcuts(
			record.keyboardShortcuts,
			record.keyboardShortcut,
		),
		mgdMode: asBoolean(record.mgdMode, defaults.mgdMode),
		soundEnabled: asBoolean(record.soundEnabled, defaults.soundEnabled),
		soundVolume: sanitizeSoundVolume(record.soundVolume),
		launchAtLogin: asBoolean(record.launchAtLogin, defaults.launchAtLogin),
		isTracking,
		quietHoursEnabled: asBoolean(
			record.quietHoursEnabled,
			defaults.quietHoursEnabled,
		),
		quietHoursStart,
		quietHoursEnd,
		quietHoursByWeekday: sanitizeQuietHoursByWeekday(
			record.quietHoursByWeekday,
		),
		pauseOnFullscreen: asBoolean(
			record.pauseOnFullscreen,
			defaults.pauseOnFullscreen,
		),
		pauseAppRules: sanitizePauseAppRules(record.pauseAppRules),
		hasCompletedOnboarding: asBoolean(
			record.hasCompletedOnboarding,
			defaults.hasCompletedOnboarding,
		),
		locale,
		goalsEnabled: goals.goalsEnabled,
		dailyBlinkGoal: goals.dailyBlinkGoal,
		dailyTrackingMinutesGoal: goals.dailyTrackingMinutesGoal,
		weeklyBlinkGoal: goals.weeklyBlinkGoal,
		weeklyTrackingMinutesGoal: goals.weeklyTrackingMinutesGoal,
	};
}
