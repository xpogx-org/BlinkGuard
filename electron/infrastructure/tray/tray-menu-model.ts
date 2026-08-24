import {
	cameraCaptureStatusMessageKey,
	type CameraCaptureStatusPayload,
} from "../../../shared/camera-capture-status";
import { pluralKey, t, type Locale } from "../../../shared/i18n";

export function trackingTrayLabelKey(
	isTracking: boolean,
): "tracking.start" | "tracking.stop" {
	return isTracking ? "tracking.stop" : "tracking.start";
}

export type TrayMenuItemSpec =
	| { id: "show"; label: string }
	| { id: "tracking"; label: string; isTracking: boolean }
	| { id: "camera"; label: string; enabled: false }
	| { id: "snooze-blink"; label: string }
	| { id: "snooze-exercise"; label: string }
	| { id: "snooze-look-away"; label: string }
	| { id: "check-for-updates"; label: string }
	| { id: "separator" }
	| { id: "quit"; label: string };

export type BuildTrayMenuSpecInput = {
	locale: Locale;
	isTracking: boolean;
	capture: CameraCaptureStatusPayload | null;
	snoozeMinutes: number;
	includeSnoozeBlink: boolean;
	includeSnoozeExercise: boolean;
	includeSnoozeLookAway: boolean;
	includeCheckForUpdates: boolean;
};

export function buildTrayMenuSpec(
	input: BuildTrayMenuSpecInput,
): TrayMenuItemSpec[] {
	const { locale, isTracking, capture, snoozeMinutes } = input;
	const items: TrayMenuItemSpec[] = [
		{ id: "show", label: t(locale, "tray.show") },
		{
			id: "tracking",
			label: t(locale, trackingTrayLabelKey(isTracking)),
			isTracking,
		},
		{
			id: "camera",
			label: t(locale, cameraCaptureStatusMessageKey(capture)),
			enabled: false,
		},
	];
	if (input.includeSnoozeBlink) {
		items.push({
			id: "snooze-blink",
			label: snoozeLabel(locale, "tray.snoozeBlink", snoozeMinutes),
		});
	}
	if (input.includeSnoozeExercise) {
		items.push({
			id: "snooze-exercise",
			label: snoozeLabel(locale, "tray.snoozeExercise", snoozeMinutes),
		});
	}
	if (input.includeSnoozeLookAway) {
		items.push({
			id: "snooze-look-away",
			label: snoozeLabel(locale, "tray.snoozeLookAway", snoozeMinutes),
		});
	}
	if (input.includeCheckForUpdates) {
		items.push({
			id: "check-for-updates",
			label: t(locale, "tray.checkForUpdates"),
		});
	}
	items.push(
		{ id: "separator" },
		{ id: "quit", label: t(locale, "tray.quit") },
	);
	return items;
}

function snoozeLabel(
	locale: Locale,
	key: "tray.snoozeBlink" | "tray.snoozeExercise" | "tray.snoozeLookAway",
	n: number,
): string {
	return t(locale, pluralKey(key, locale, n), { n });
}
