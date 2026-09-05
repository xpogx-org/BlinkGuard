import { tokenSnoozeMinutes } from "../../../shared/blink-stats";
import {
	cameraCaptureStatusMessageKey,
	type CameraCaptureStatusPayload,
} from "../../../shared/camera-capture-status";
import { TRAY_HUSH_DURATION_MINUTES } from "../../../shared/hush-durations";
import { pluralKey, t, type Locale } from "../../../shared/i18n";
import {
	appendProcessOnlyPauseAppRule,
	type PauseAppRule,
	processOnlyPauseAppRule,
} from "../../../shared/preferences";
import { SETTINGS_PROFILE_CAP } from "../../../shared/settings-profiles";
import {
	endHushLabel,
	hushActiveLabel,
	pauseStatusMessageKey,
	type FocusPauseStatePayload,
} from "../../../shared/session-pause-status";
import type {
	TrayHushDurationItemSpec,
	TrayMenuItemSpec,
	TraySetupItemSpec,
	TraySetupSummary,
	TraySnoozeItemSpec,
} from "../../../shared/tray-menu";

export type {
	TrayMenuItemSpec,
	TraySetupItemSpec,
	TraySetupSummary,
	TraySetupsSnapshot,
	TraySnoozeItemSpec,
} from "../../../shared/tray-menu";

export function trackingTrayLabelKey(
	isTracking: boolean,
): "tracking.start" | "tracking.stop" {
	return isTracking ? "tracking.stop" : "tracking.start";
}

export type BuildTrayMenuSpecInput = {
	locale: Locale;
	isTracking: boolean;
	capture: CameraCaptureStatusPayload | null;
	pause: FocusPauseStatePayload | null;
	glanceLabel?: string | null;
	snoozeMinutes: number;
	includeSnoozeBlink: boolean;
	includeSnoozeExercise: boolean;
	includeSnoozeLookAway: boolean;
	includeCheckForUpdates: boolean;
	showAccelerator: string;
	trackingAccelerator: string;
	includeHush?: boolean;
	isPromptHushed?: boolean;
	promptSuppressUntil?: number;
	promptHushUntilResume?: boolean;
	hushAccelerator?: string;
	snoozeTokenCharges?: number;
	tokenSnoozeAccelerator?: string;
	setups?: TraySetupSummary[];
	activeSetupId?: string | null;
	pauseAppRules?: PauseAppRule[];
	lastExternal?: PauseAppRule | null;
};

/** Tray click on the already-active radio is a no-op (do not re-apply). */
export function shouldSwitchTraySetup(
	clickedId: string,
	activeSetupId: string | null,
): boolean {
	return clickedId.length > 0 && clickedId !== activeSetupId;
}

/** Tray always confirms dirty — same outcome as Settings “Switch anyway”. */
export function traySwitchPayload(id: string): {
	id: string;
	confirmDirty: true;
} {
	return { id, confirmDirty: true };
}

export function buildTrayMenuSpec(
	input: BuildTrayMenuSpecInput,
): TrayMenuItemSpec[] {
	const {
		locale,
		isTracking,
		capture,
		pause,
		snoozeMinutes,
		showAccelerator,
		trackingAccelerator,
	} = input;
	const items: TrayMenuItemSpec[] = [
		{
			id: "show",
			label: t(locale, "tray.show"),
			...optionalAccelerator(showAccelerator),
		},
		{
			id: "tracking",
			label: t(locale, trackingTrayLabelKey(isTracking)),
			isTracking,
			...optionalAccelerator(trackingAccelerator),
		},
	];
	if (input.includeHush) {
		const suppressUntil = input.promptSuppressUntil ?? 0;
		const untilResume = input.promptHushUntilResume ?? false;
		items.push({
			id: "hush",
			label: input.isPromptHushed
				? endHushLabel(locale, suppressUntil, untilResume)
				: t(locale, pluralKey("tray.hush", locale, snoozeMinutes), {
						n: snoozeMinutes,
					}),
			active: Boolean(input.isPromptHushed),
			...optionalAccelerator(
				input.isPromptHushed ? "" : (input.hushAccelerator ?? ""),
			),
		});
		if (!input.isPromptHushed) {
			const longerSubmenu = hushLongerSubmenuSpec(locale);
			if (longerSubmenu.length > 0) {
				items.push({
					id: "hush-longer",
					label: t(locale, "tray.hushLonger"),
					submenu: longerSubmenu,
				});
			}
			const tokenCharges = input.snoozeTokenCharges ?? 0;
			if (tokenCharges > 0) {
				const tokenMinutes = tokenSnoozeMinutes(snoozeMinutes);
				items.push({
					id: "hush-token",
					label: t(
						locale,
						pluralKey("tray.hushWithToken", locale, tokenMinutes),
						{
							n: tokenMinutes,
							count: tokenCharges,
						},
					),
					...optionalAccelerator(input.tokenSnoozeAccelerator ?? ""),
				});
			}
		}
	}
	items.push({ id: "separator" });
	items.push({
		id: "camera",
		label: t(locale, cameraCaptureStatusMessageKey(capture)),
		enabled: false,
	});
	const glanceLabel = input.glanceLabel?.trim();
	if (glanceLabel) {
		items.push({
			id: "glance",
			label: glanceLabel,
			enabled: false,
		});
	}
	const pauseKey = pause ? pauseStatusMessageKey(pause) : null;
	if (pauseKey) {
		const label =
			pauseKey === "hush.active" && input.isPromptHushed
				? hushActiveLabel(
						locale,
						input.promptSuppressUntil ?? 0,
						input.promptHushUntilResume ?? false,
					)
				: t(locale, pauseKey);
		items.push({
			id: "pause",
			label,
			enabled: false,
		});
	}
	const pauseAppRules = input.pauseAppRules ?? [];
	const lastExternal = input.lastExternal ?? null;
	const pauseAppAppend = appendProcessOnlyPauseAppRule(
		pauseAppRules,
		lastExternal,
	);
	const pauseAppProcess = processOnlyPauseAppRule(lastExternal)?.processName ?? "";
	items.push({
		id: "pause-app",
		label: pauseAppProcess
			? t(locale, "tray.pauseAppNamed", { name: pauseAppProcess })
			: t(locale, "tray.pauseApp"),
		enabled: pauseAppAppend.ok,
	});
	items.push({ id: "separator" });
	const snoozeSubmenu = snoozeSubmenuSpec(locale, snoozeMinutes, input);
	if (snoozeSubmenu.length > 0) {
		items.push({
			id: "snooze",
			label: t(locale, "tray.snooze"),
			submenu: snoozeSubmenu,
		});
	}
	const setupsSubmenu = setupsSubmenuSpec(
		input.setups ?? [],
		input.activeSetupId ?? null,
	);
	if (setupsSubmenu.length > 0) {
		items.push({
			id: "setups",
			label: t(locale, "tray.setups"),
			submenu: setupsSubmenu,
		});
	}
	if (input.includeCheckForUpdates) {
		items.push({
			id: "check-for-updates",
			label: t(locale, "tray.checkForUpdates"),
		});
	}
	if (items[items.length - 1]?.id !== "separator") {
		items.push({ id: "separator" });
	}
	items.push({ id: "quit", label: t(locale, "tray.quit") });
	return items;
}

function hushLongerSubmenuSpec(locale: Locale): TrayHushDurationItemSpec[] {
	const submenu: TrayHushDurationItemSpec[] = TRAY_HUSH_DURATION_MINUTES.map(
		(minutes) => ({
			id: `hush-${minutes}` as TrayHushDurationItemSpec["id"],
			label: t(locale, pluralKey("tray.hushDuration", locale, minutes), {
				n: minutes,
			}),
		}),
	);
	submenu.push({
		id: "hush-until-resume",
		label: t(locale, "tray.hushUntilResume"),
	});
	return submenu;
}

function snoozeSubmenuSpec(
	locale: Locale,
	snoozeMinutes: number,
	input: Pick<
		BuildTrayMenuSpecInput,
		"includeSnoozeBlink" | "includeSnoozeExercise" | "includeSnoozeLookAway"
	>,
): TraySnoozeItemSpec[] {
	const submenu: TraySnoozeItemSpec[] = [];
	if (input.includeSnoozeBlink) {
		submenu.push({
			id: "snooze-blink",
			label: snoozeLabel(locale, "tray.snoozeBlink", snoozeMinutes),
		});
	}
	if (input.includeSnoozeExercise) {
		submenu.push({
			id: "snooze-exercise",
			label: snoozeLabel(locale, "tray.snoozeExercise", snoozeMinutes),
		});
	}
	if (input.includeSnoozeLookAway) {
		submenu.push({
			id: "snooze-look-away",
			label: snoozeLabel(locale, "tray.snoozeLookAway", snoozeMinutes),
		});
	}
	return submenu;
}

function setupsSubmenuSpec(
	setups: TraySetupSummary[],
	activeSetupId: string | null,
): TraySetupItemSpec[] {
	const capped = setups.slice(0, SETTINGS_PROFILE_CAP);
	return capped.map((setup) => ({
		id: setup.id,
		label: setup.name,
		checked: setup.id === activeSetupId,
	}));
}

function optionalAccelerator(accelerator: string): { accelerator?: string } {
	return accelerator ? { accelerator } : {};
}

function snoozeLabel(
	locale: Locale,
	key: "tray.snoozeBlink" | "tray.snoozeExercise" | "tray.snoozeLookAway",
	n: number,
): string {
	return t(locale, pluralKey(key, locale, n), { n });
}
