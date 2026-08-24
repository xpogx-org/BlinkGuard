import { describe, expect, it } from "vitest";
import {
	type BuildTrayMenuSpecInput,
	buildTrayMenuSpec,
	trackingTrayLabelKey,
} from "../../../electron/infrastructure/tray/tray-menu-model";
import type { CameraCaptureStatusPayload } from "../../../shared/camera-capture-status";
import { t } from "../../../shared/i18n";

const monitoring: CameraCaptureStatusPayload = {
	capturing: true,
	surface: "monitoring",
};

const idle: CameraCaptureStatusPayload = {
	capturing: false,
	surface: "idle",
};

function spec(overrides: Partial<BuildTrayMenuSpecInput> = {}) {
	return buildTrayMenuSpec({
		locale: "en",
		isTracking: false,
		capture: null,
		snoozeMinutes: 5,
		includeSnoozeBlink: true,
		includeSnoozeExercise: true,
		includeSnoozeLookAway: true,
		includeCheckForUpdates: true,
		...overrides,
	});
}

function itemIds(items: ReturnType<typeof buildTrayMenuSpec>) {
	return items.map((item) => item.id);
}

describe("trackingTrayLabelKey", () => {
	it("maps armed tracking to Stop reminders", () => {
		expect(trackingTrayLabelKey(false)).toBe("tracking.start");
		expect(trackingTrayLabelKey(true)).toBe("tracking.stop");
	});
});

describe("buildTrayMenuSpec", () => {
	it("places Start/Stop after Show and before the camera status row", () => {
		expect(itemIds(spec({ isTracking: false }))).toEqual([
			"show",
			"tracking",
			"camera",
			"snooze-blink",
			"snooze-exercise",
			"snooze-look-away",
			"check-for-updates",
			"separator",
			"quit",
		]);
		expect(
			spec({ isTracking: false }).find((item) => item.id === "tracking"),
		).toEqual({
			id: "tracking",
			label: t("en", "tracking.start"),
			isTracking: false,
		});
		expect(
			spec({ isTracking: true }).find((item) => item.id === "tracking"),
		).toEqual({
			id: "tracking",
			label: t("en", "tracking.stop"),
			isTracking: true,
		});
	});

	it("keeps the disabled camera row and ignores capture/pause for the tracking label", () => {
		const idleMenu = spec({ isTracking: true, capture: idle });
		const liveMenu = spec({ isTracking: true, capture: monitoring });
		expect(idleMenu.find((item) => item.id === "camera")).toEqual({
			id: "camera",
			label: t("en", "tray.cameraIdle"),
			enabled: false,
		});
		expect(liveMenu.find((item) => item.id === "camera")).toEqual({
			id: "camera",
			label: t("en", "tray.cameraOn"),
			enabled: false,
		});
		expect(idleMenu.find((item) => item.id === "tracking")?.label).toBe(
			t("en", "tracking.stop"),
		);
		expect(liveMenu.find((item) => item.id === "tracking")?.label).toBe(
			t("en", "tracking.stop"),
		);
		expect(
			spec({ isTracking: false, capture: monitoring }).find(
				(item) => item.id === "tracking",
			)?.label,
		).toBe(t("en", "tracking.start"));
	});
});
