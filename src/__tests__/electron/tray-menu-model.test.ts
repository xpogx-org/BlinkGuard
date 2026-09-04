import { describe, expect, it } from "vitest";
import {
	type BuildTrayMenuSpecInput,
	buildTrayMenuSpec,
	shouldSwitchTraySetup,
	trackingTrayLabelKey,
	traySwitchPayload,
} from "../../../electron/infrastructure/tray/tray-menu-model";
import type { CameraCaptureStatusPayload } from "../../../shared/camera-capture-status";
import { t } from "../../../shared/i18n";
import {
	type FocusPauseStatePayload,
	pauseStatusMessageKey,
} from "../../../shared/session-pause-status";
import { SETTINGS_PROFILE_CAP } from "../../../shared/settings-profiles";

const monitoring: CameraCaptureStatusPayload = {
	capturing: true,
	surface: "monitoring",
};

const idle: CameraCaptureStatusPayload = {
	capturing: false,
	surface: "idle",
};

const quietHoursPause: FocusPauseStatePayload = {
	reason: "quiet-hours",
	fullscreenDetectionSupported: true,
	sessionPauseMode: "active",
	sessionIdleCause: null,
};

function spec(overrides: Partial<BuildTrayMenuSpecInput> = {}) {
	return buildTrayMenuSpec({
		locale: "en",
		isTracking: false,
		capture: null,
		pause: null,
		snoozeMinutes: 5,
		includeSnoozeBlink: true,
		includeSnoozeExercise: true,
		includeSnoozeLookAway: true,
		includeCheckForUpdates: true,
		showAccelerator: "",
		trackingAccelerator: "",
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
	it("groups actions, status, snooze, and quit with separators", () => {
		expect(itemIds(spec({ isTracking: false }))).toEqual([
			"show",
			"tracking",
			"separator",
			"camera",
			"separator",
			"snooze",
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
		expect(
			spec({ isTracking: true, pause: quietHoursPause }).find(
				(item) => item.id === "tracking",
			)?.label,
		).toBe(t("en", "tracking.stop"));
		expect(
			spec({ isTracking: false, capture: monitoring }).find(
				(item) => item.id === "tracking",
			)?.label,
		).toBe(t("en", "tracking.start"));
	});

	it("inserts glance row between camera and pause when label is provided", () => {
		const items = spec({
			capture: monitoring,
			pause: quietHoursPause,
			glanceLabel: "12/min · Low · Today 40 blinks",
		});
		const ids = itemIds(items);
		const cameraIdx = ids.indexOf("camera");
		const glanceIdx = ids.indexOf("glance");
		const pauseIdx = ids.indexOf("pause");
		expect(glanceIdx).toBeGreaterThan(cameraIdx);
		expect(pauseIdx).toBeGreaterThan(glanceIdx);
		expect(items.find((item) => item.id === "glance")).toEqual({
			id: "glance",
			label: "12/min · Low · Today 40 blinks",
			enabled: false,
		});
	});

	it("inserts hush before camera when includeHush is set", () => {
		const idleHush = spec({ includeHush: true, isPromptHushed: false });
		expect(itemIds(idleHush)).toEqual([
			"show",
			"tracking",
			"hush",
			"separator",
			"camera",
			"separator",
			"snooze",
			"check-for-updates",
			"separator",
			"quit",
		]);
		expect(idleHush.find((item) => item.id === "hush")).toEqual({
			id: "hush",
			label: t("en", "tray.hush", { n: 5 }),
			active: false,
		});
		expect(
			spec({ includeHush: true, isPromptHushed: true }).find(
				(item) => item.id === "hush",
			),
		).toEqual({
			id: "hush",
			label: t("en", "tray.endHush"),
			active: true,
		});
	});

	it("shows extended hush with token when charges are banked", () => {
		const withToken = spec({
			includeHush: true,
			isPromptHushed: false,
			snoozeTokenCharges: 2,
		});
		expect(itemIds(withToken)).toEqual([
			"show",
			"tracking",
			"hush",
			"hush-token",
			"separator",
			"camera",
			"separator",
			"snooze",
			"check-for-updates",
			"separator",
			"quit",
		]);
		expect(withToken.find((item) => item.id === "hush-token")).toEqual({
			id: "hush-token",
			label: t("en", "tray.hushWithToken", { n: 10, count: 2 }),
		});
		expect(
			spec({
				includeHush: true,
				isPromptHushed: false,
				snoozeTokenCharges: 0,
			}).some((item) => item.id === "hush-token"),
		).toBe(false);
		expect(
			spec({
				includeHush: true,
				isPromptHushed: true,
				snoozeTokenCharges: 2,
			}).some((item) => item.id === "hush-token"),
		).toBe(false);
	});

	it("inserts a disabled pause row only when pauseStatusMessageKey is set", () => {
		const pauseKey = pauseStatusMessageKey(quietHoursPause);
		expect(pauseKey).toBe("quietHours.paused");
		expect(spec({ pause: null }).some((item) => item.id === "pause")).toBe(
			false,
		);
		expect(itemIds(spec({ pause: quietHoursPause }))).toEqual([
			"show",
			"tracking",
			"separator",
			"camera",
			"pause",
			"separator",
			"snooze",
			"check-for-updates",
			"separator",
			"quit",
		]);
		expect(
			spec({ pause: quietHoursPause }).find((item) => item.id === "pause"),
		).toEqual({
			id: "pause",
			label: t("en", pauseKey ?? "quietHours.paused"),
			enabled: false,
		});
	});

	it("nests per-kind snooze items and omits the parent when none are included", () => {
		const snooze = spec().find((item) => item.id === "snooze");
		expect(snooze).toEqual({
			id: "snooze",
			label: t("en", "tray.snooze"),
			submenu: [
				{
					id: "snooze-blink",
					label: t("en", "tray.snoozeBlink", { n: 5 }),
				},
				{
					id: "snooze-exercise",
					label: t("en", "tray.snoozeExercise", { n: 5 }),
				},
				{
					id: "snooze-look-away",
					label: t("en", "tray.snoozeLookAway", { n: 5 }),
				},
			],
		});
		expect(
			itemIds(
				spec({
					includeSnoozeBlink: false,
					includeSnoozeExercise: false,
					includeSnoozeLookAway: false,
					includeCheckForUpdates: false,
				}),
			),
		).toEqual(["show", "tracking", "separator", "camera", "separator", "quit"]);
	});

	it("attaches accelerators only when they are non-empty", () => {
		expect(spec().find((item) => item.id === "show")).toEqual({
			id: "show",
			label: t("en", "tray.show"),
		});
		expect(
			spec({ showAccelerator: "Ctrl+," }).find((item) => item.id === "show"),
		).toEqual({
			id: "show",
			label: t("en", "tray.show"),
			accelerator: "Ctrl+,",
		});
		expect(
			spec({ trackingAccelerator: "Ctrl+I" }).find(
				(item) => item.id === "tracking",
			),
		).toEqual({
			id: "tracking",
			label: t("en", "tracking.start"),
			isTracking: false,
			accelerator: "Ctrl+I",
		});
	});

	it("nests setups after snooze with the active radio checked", () => {
		const menu = spec({
			setups: [
				{ id: "desk", name: "Desk" },
				{ id: "weekend", name: "Weekend" },
			],
			activeSetupId: "weekend",
		});
		expect(itemIds(menu)).toEqual([
			"show",
			"tracking",
			"separator",
			"camera",
			"separator",
			"snooze",
			"setups",
			"check-for-updates",
			"separator",
			"quit",
		]);
		expect(menu.find((item) => item.id === "setups")).toEqual({
			id: "setups",
			label: t("en", "tray.setups"),
			submenu: [
				{ id: "desk", label: "Desk", checked: false },
				{ id: "weekend", label: "Weekend", checked: true },
			],
		});
	});

	it("omits the setups submenu when the list is empty", () => {
		expect(spec({ setups: [] }).some((item) => item.id === "setups")).toBe(
			false,
		);
		expect(spec().some((item) => item.id === "setups")).toBe(false);
	});

	it("caps setups submenu children at SETTINGS_PROFILE_CAP", () => {
		const setups = Array.from({ length: SETTINGS_PROFILE_CAP + 2 }, (_, i) => ({
			id: `id-${i + 1}`,
			name: `Setup ${i + 1}`,
		}));
		const submenu = spec({ setups, activeSetupId: "id-1" }).find(
			(item) => item.id === "setups",
		);
		expect(submenu && "submenu" in submenu ? submenu.submenu : []).toHaveLength(
			SETTINGS_PROFILE_CAP,
		);
	});
});

describe("shouldSwitchTraySetup", () => {
	it("no-ops the already-active setup and empty ids", () => {
		expect(shouldSwitchTraySetup("desk", "desk")).toBe(false);
		expect(shouldSwitchTraySetup("", "desk")).toBe(false);
		expect(shouldSwitchTraySetup("weekend", "desk")).toBe(true);
		expect(shouldSwitchTraySetup("weekend", null)).toBe(true);
	});
});

describe("traySwitchPayload", () => {
	it("always confirms dirty so tray matches Switch anyway", () => {
		expect(traySwitchPayload("weekend")).toEqual({
			id: "weekend",
			confirmDirty: true,
		});
	});
});
