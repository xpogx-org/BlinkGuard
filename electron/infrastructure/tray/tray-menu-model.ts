import {
	cameraCaptureStatusMessageKey,
	type CameraCaptureStatusPayload,
} from "../../../shared/camera-capture-status";
import { pluralKey, t, type Locale } from "../../../shared/i18n";
import { SETTINGS_PROFILE_CAP } from "../../../shared/settings-profiles";
import {
	pauseStatusMessageKey,
	type FocusPauseStatePayload,
} from "../../../shared/session-pause-status";

export function trackingTrayLabelKey(
	isTracking: boolean,
): "tracking.start" | "tracking.stop" {
	return isTracking ? "tracking.stop" : "tracking.start";
}

export type TraySnoozeItemSpec = {
	id: "snooze-blink" | "snooze-exercise" | "snooze-look-away";
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
	| { id: "camera"; label: string; enabled: false }
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

export type BuildTrayMenuSpecInput = {
	locale: Locale;
	isTracking: boolean;
	capture: CameraCaptureStatusPayload | null;
	pause: FocusPauseStatePayload | null;
	snoozeMinutes: number;
	includeSnoozeBlink: boolean;
	includeSnoozeExercise: boolean;
	includeSnoozeLookAway: boolean;
	includeCheckForUpdates: boolean;
	showAccelerator: string;
	trackingAccelerator: string;
	includeHush?: boolean;
	isPromptHushed?: boolean;
	hushAccelerator?: string;
	setups?: TraySetupSummary[];
	activeSetupId?: string | null;
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
		items.push({
			id: "hush",
			label: input.isPromptHushed
				? t(locale, "tray.endHush")
				: t(locale, pluralKey("tray.hush", locale, snoozeMinutes), {
						n: snoozeMinutes,
					}),
			active: Boolean(input.isPromptHushed),
			...optionalAccelerator(
				input.isPromptHushed ? "" : (input.hushAccelerator ?? ""),
			),
		});
	}
	items.push({ id: "separator" });
	items.push({
		id: "camera",
		label: t(locale, cameraCaptureStatusMessageKey(capture)),
		enabled: false,
	});
	const pauseKey = pause ? pauseStatusMessageKey(pause) : null;
	if (pauseKey) {
		items.push({
			id: "pause",
			label: t(locale, pauseKey),
			enabled: false,
		});
	}
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
