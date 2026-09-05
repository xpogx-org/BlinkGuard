/** JSON-safe tray menu row shapes (Electron-free). */

import { theme } from "./theme";

export type TraySnoozeItemSpec = {
	id: "snooze-blink" | "snooze-exercise" | "snooze-look-away";
	label: string;
};

export type TrayHushDurationItemSpec = {
	id: "hush-15" | "hush-30" | "hush-60" | "hush-until-resume";
	label: string;
};

export type TraySetupItemSpec = {
	id: string;
	label: string;
	checked: boolean;
};

export type TrayMenuItemSpec =
	| { id: "show"; label: string; accelerator?: string }
	| { id: "tracking"; label: string; isTracking: boolean; accelerator?: string }
	| { id: "hush"; label: string; active: boolean; accelerator?: string }
	| { id: "hush-token"; label: string; accelerator?: string }
	| { id: "hush-longer"; label: string; submenu: TrayHushDurationItemSpec[] }
	| { id: "camera"; label: string; enabled: false }
	| { id: "glance"; label: string; enabled: false }
	| { id: "pause"; label: string; enabled: false }
	| { id: "snooze"; label: string; submenu: TraySnoozeItemSpec[] }
	| { id: "setups"; label: string; submenu: TraySetupItemSpec[] }
	| { id: "check-for-updates"; label: string }
	| { id: "separator" }
	| { id: "quit"; label: string };

export type TraySetupSummary = {
	id: string;
	name: string;
};

export type TraySetupsSnapshot = {
	profiles: TraySetupSummary[];
	activeSetupId: string | null;
};

export type TrayMenuItemActionId =
	| "show"
	| "tracking"
	| "hush"
	| "hush-token"
	| "check-for-updates"
	| "quit";

export type TrayMenuSnoozeActionId = TraySnoozeItemSpec["id"];

export type TrayMenuHushDurationActionId = TrayHushDurationItemSpec["id"];

export type TrayMenuActionPayload =
	| { kind: "item"; id: TrayMenuItemActionId }
	| { kind: "snooze"; id: TrayMenuSnoozeActionId }
	| { kind: "hush-duration"; id: TrayMenuHushDurationActionId }
	| { kind: "setup"; id: string };

export type TrayMenuRenderPayload = {
	spec: TrayMenuItemSpec[];
	darkMode: boolean;
	colors: { background: string; text: string };
	transparency: number;
};

export type TrayMenuSizePayload = {
	width: number;
	height: number;
	/** Transparent padding around the card so box-shadow is not clipped. */
	inset?: number;
};

import { POPUP_SHADOW_INSET } from "./popup-window-chrome";

/** Matches `--popup-shadow-inset` in `public/css/base.css`. */
export const TRAY_MENU_SHADOW_INSET = POPUP_SHADOW_INSET;

/** Tray menu always uses app default popup palette — not user popup color presets. */
export function buildTrayMenuTheme(
	darkMode: boolean,
): Pick<TrayMenuRenderPayload, "darkMode" | "colors" | "transparency"> {
	if (darkMode !== false) {
		return {
			darkMode: true,
			colors: {
				background: theme.popup.bg,
				text: theme.popup.text,
			},
			transparency: theme.popup.transparency,
		};
	}
	return {
		darkMode: false,
		colors: {
			background: "#ffffff",
			text: "#0f172a",
		},
		transparency: 0.06,
	};
}

const TRAY_MENU_ITEM_ACTION_IDS: readonly TrayMenuItemActionId[] = [
	"show",
	"tracking",
	"hush",
	"hush-token",
	"check-for-updates",
	"quit",
];

const TRAY_MENU_SNOOZE_ACTION_IDS: readonly TrayMenuSnoozeActionId[] = [
	"snooze-blink",
	"snooze-exercise",
	"snooze-look-away",
];

const TRAY_MENU_HUSH_DURATION_ACTION_IDS: readonly TrayMenuHushDurationActionId[] =
	["hush-15", "hush-30", "hush-60", "hush-until-resume"];

export function isTrayMenuItemActionId(
	id: string,
): id is TrayMenuItemActionId {
	return (TRAY_MENU_ITEM_ACTION_IDS as readonly string[]).includes(id);
}

export function isTrayMenuSnoozeActionId(
	id: string,
): id is TrayMenuSnoozeActionId {
	return (TRAY_MENU_SNOOZE_ACTION_IDS as readonly string[]).includes(id);
}

export function isTrayMenuHushDurationActionId(
	id: string,
): id is TrayMenuHushDurationActionId {
	return (TRAY_MENU_HUSH_DURATION_ACTION_IDS as readonly string[]).includes(id);
}

export function sanitizeTrayMenuActionPayload(
	raw: unknown,
): TrayMenuActionPayload | null {
	if (raw === null || typeof raw !== "object") return null;
	const record = raw as Record<string, unknown>;
	const kind = record.kind;
	if (kind === "item") {
		const id = record.id;
		if (typeof id !== "string" || !isTrayMenuItemActionId(id)) return null;
		return { kind: "item", id };
	}
	if (kind === "snooze") {
		const id = record.id;
		if (typeof id !== "string" || !isTrayMenuSnoozeActionId(id)) return null;
		return { kind: "snooze", id };
	}
	if (kind === "hush-duration") {
		const id = record.id;
		if (typeof id !== "string" || !isTrayMenuHushDurationActionId(id)) {
			return null;
		}
		return { kind: "hush-duration", id };
	}
	if (kind === "setup") {
		const id = record.id;
		if (typeof id !== "string" || id.length === 0 || id.length > 128) {
			return null;
		}
		return { kind: "setup", id };
	}
	return null;
}

export function sanitizeTrayMenuSizePayload(
	raw: unknown,
): TrayMenuSizePayload | null {
	if (raw === null || typeof raw !== "object") return null;
	const record = raw as Record<string, unknown>;
	const width = record.width;
	const height = record.height;
	const insetRaw = record.inset;
	if (
		typeof width !== "number" ||
		typeof height !== "number" ||
		!Number.isFinite(width) ||
		!Number.isFinite(height) ||
		width < 80 ||
		width > 900 ||
		height < 1 ||
		height > 2000
	) {
		return null;
	}
	let inset: number = TRAY_MENU_SHADOW_INSET;
	if (insetRaw !== undefined) {
		if (
			typeof insetRaw !== "number" ||
			!Number.isFinite(insetRaw) ||
			insetRaw < 0 ||
			insetRaw > 64
		) {
			return null;
		}
		inset = Math.round(insetRaw);
	}
	return { width: Math.round(width), height: Math.round(height), inset };
}
