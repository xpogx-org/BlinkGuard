import { describe, expect, it } from "vitest";
import {
	cameraCaptureChipMessageKey,
	cameraCaptureStatusMessageKey,
	composeTrayTooltip,
	deriveCameraCaptureSurface,
	sanitizeCameraCaptureStatusPayload,
	type CameraCaptureStatusPayload,
} from "../../../shared/camera-capture-status";
import type { FocusPauseStatePayload } from "../../../shared/session-pause-status";
import { trayTooltipLabel } from "../../../shared/session-pause-status";

const active: FocusPauseStatePayload = {
	reason: null,
	fullscreenDetectionSupported: true,
	sessionPauseMode: "active",
	sessionIdleCause: null,
};

const monitoring: CameraCaptureStatusPayload = {
	capturing: true,
	surface: "monitoring",
};

const preview: CameraCaptureStatusPayload = {
	capturing: true,
	surface: "preview",
};

const idle: CameraCaptureStatusPayload = {
	capturing: false,
	surface: "idle",
};

describe("deriveCameraCaptureSurface", () => {
	it("maps capturing + tracking to the three surfaces", () => {
		expect(deriveCameraCaptureSurface(false, false)).toBe("idle");
		expect(deriveCameraCaptureSurface(false, true)).toBe("idle");
		expect(deriveCameraCaptureSurface(true, false)).toBe("preview");
		expect(deriveCameraCaptureSurface(true, true)).toBe("monitoring");
	});
});

describe("sanitizeCameraCaptureStatusPayload", () => {
	it("defaults unknown / missing capturing to idle", () => {
		expect(sanitizeCameraCaptureStatusPayload(null)).toEqual(idle);
		expect(sanitizeCameraCaptureStatusPayload({})).toEqual(idle);
		expect(sanitizeCameraCaptureStatusPayload({ capturing: false })).toEqual(
			idle,
		);
		expect(
			sanitizeCameraCaptureStatusPayload({
				capturing: true,
				surface: "idle",
			}),
		).toEqual(monitoring);
	});

	it("keeps preview and monitoring when capturing", () => {
		expect(
			sanitizeCameraCaptureStatusPayload({
				capturing: true,
				surface: "preview",
			}),
		).toEqual(preview);
		expect(
			sanitizeCameraCaptureStatusPayload({
				capturing: true,
				surface: "monitoring",
			}),
		).toEqual(monitoring);
		expect(
			sanitizeCameraCaptureStatusPayload({
				capturing: true,
				surface: "nope",
			}),
		).toEqual(monitoring);
	});
});

describe("cameraCaptureStatusMessageKey / chip keys", () => {
	it("maps surfaces for tray menu and Setup chip", () => {
		expect(cameraCaptureStatusMessageKey(null)).toBe("tray.cameraIdle");
		expect(cameraCaptureStatusMessageKey(idle)).toBe("tray.cameraIdle");
		expect(cameraCaptureStatusMessageKey(preview)).toBe("tray.cameraPreview");
		expect(cameraCaptureStatusMessageKey(monitoring)).toBe("tray.cameraOn");
		expect(cameraCaptureChipMessageKey("idle")).toBe("camera.status.idle");
		expect(cameraCaptureChipMessageKey("preview")).toBe(
			"camera.status.preview",
		);
		expect(cameraCaptureChipMessageKey("monitoring")).toBe(
			"camera.status.live",
		);
	});
});

describe("composeTrayTooltip", () => {
	it("is product name when neither camera nor pause", () => {
		expect(composeTrayTooltip("en", null, null)).toBe("BlinkGuard");
		expect(composeTrayTooltip("en", active, idle)).toBe("BlinkGuard");
	});

	it("appends camera-only fragments", () => {
		expect(composeTrayTooltip("en", null, monitoring)).toBe(
			"BlinkGuard — Camera on",
		);
		expect(composeTrayTooltip("en", active, preview)).toBe(
			"BlinkGuard — Camera preview",
		);
	});

	it("keeps pause-only the same shape as trayTooltipLabel", () => {
		const paused: FocusPauseStatePayload = {
			...active,
			sessionPauseMode: "inactive",
			sessionIdleCause: "lock",
		};
		expect(composeTrayTooltip("en", paused, idle)).toBe(
			trayTooltipLabel("en", paused),
		);
	});

	it("composes camera then pause", () => {
		const paused: FocusPauseStatePayload = {
			...active,
			reason: "quiet-hours",
		};
		expect(composeTrayTooltip("en", paused, monitoring)).toBe(
			"BlinkGuard — Camera on — Paused: quiet hours",
		);
	});

	it("appends glance after pause and camera", () => {
		const paused: FocusPauseStatePayload = {
			...active,
			reason: "quiet-hours",
		};
		expect(
			composeTrayTooltip(
				"en",
				paused,
				monitoring,
				"12/min · Low · Today 40 blinks",
			),
		).toBe(
			"BlinkGuard — Camera on — Paused: quiet hours — 12/min · Low · Today 40 blinks",
		);
	});
});
