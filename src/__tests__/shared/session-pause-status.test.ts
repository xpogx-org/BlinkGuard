import { describe, expect, it } from "vitest";
import {
	type FocusPauseStatePayload,
	isPromptHushed,
	overlayManualHush,
	pauseStatusMessageKey,
	sanitizeFocusPauseStatePayload,
	trayTooltipLabel,
} from "../../../shared/session-pause-status";

const active: FocusPauseStatePayload = {
	reason: null,
	fullscreenDetectionSupported: true,
	sessionPauseMode: "active",
	sessionIdleCause: null,
};

describe("pauseStatusMessageKey", () => {
	it("maps inactive causes ahead of focus reasons", () => {
		expect(
			pauseStatusMessageKey({
				...active,
				reason: "quiet-hours",
				sessionPauseMode: "inactive",
				sessionIdleCause: "lock",
			}),
		).toBe("session.paused.lock");
		expect(
			pauseStatusMessageKey({
				...active,
				sessionPauseMode: "inactive",
				sessionIdleCause: "display-off",
			}),
		).toBe("session.paused.displayOff");
		expect(
			pauseStatusMessageKey({
				...active,
				sessionPauseMode: "inactive",
				sessionIdleCause: "suspend",
			}),
		).toBe("session.paused.suspend");
		expect(
			pauseStatusMessageKey({
				...active,
				sessionPauseMode: "inactive",
				sessionIdleCause: null,
			}),
		).toBe("session.paused");
		expect(
			pauseStatusMessageKey({
				...active,
				sessionPauseMode: "inactive",
				sessionIdleCause: "lid",
			}),
		).toBe("session.paused.lid");
		expect(
			pauseStatusMessageKey({
				...active,
				reason: "session-idle",
				sessionIdleCause: "unknown",
			}),
		).toBe("session.paused");
	});

	it("maps focus reasons when the session is not fully inactive", () => {
		expect(pauseStatusMessageKey({ ...active, reason: "quiet-hours" })).toBe(
			"quietHours.paused",
		);
		expect(pauseStatusMessageKey({ ...active, reason: "fullscreen" })).toBe(
			"fullscreen.paused",
		);
		expect(pauseStatusMessageKey({ ...active, reason: "app-rule" })).toBe(
			"appRules.paused",
		);
		expect(pauseStatusMessageKey({ ...active, reason: "manual-hush" })).toBe(
			"hush.active",
		);
	});

	it("maps camera-only lid after focus reasons", () => {
		expect(
			pauseStatusMessageKey({
				...active,
				reason: "quiet-hours",
				sessionPauseMode: "camera-only",
				sessionIdleCause: "lid",
			}),
		).toBe("quietHours.paused");
		expect(
			pauseStatusMessageKey({
				...active,
				sessionPauseMode: "camera-only",
				sessionIdleCause: "lid",
			}),
		).toBe("session.paused.lid");
	});

	it("is null when nothing is paused", () => {
		expect(pauseStatusMessageKey(active)).toBeNull();
	});
});

describe("sanitizeFocusPauseStatePayload", () => {
	it("fills missing mode and cause so partial IPC stays safe", () => {
		expect(
			sanitizeFocusPauseStatePayload({
				reason: null,
				fullscreenDetectionSupported: false,
			}),
		).toEqual({
			reason: null,
			fullscreenDetectionSupported: false,
			sessionPauseMode: "active",
			sessionIdleCause: null,
		});
	});

	it("keeps known reason, mode, and cause values", () => {
		expect(
			sanitizeFocusPauseStatePayload({
				reason: "session-idle",
				fullscreenDetectionSupported: true,
				sessionPauseMode: "inactive",
				sessionIdleCause: "lock",
			}),
		).toEqual({
			reason: "session-idle",
			fullscreenDetectionSupported: true,
			sessionPauseMode: "inactive",
			sessionIdleCause: "lock",
		});
		expect(
			sanitizeFocusPauseStatePayload({
				reason: "manual-hush",
				fullscreenDetectionSupported: true,
			}),
		).toEqual({
			reason: "manual-hush",
			fullscreenDetectionSupported: true,
			sessionPauseMode: "active",
			sessionIdleCause: null,
		});
		expect(sanitizeFocusPauseStatePayload(null).reason).toBeNull();
		expect(
			sanitizeFocusPauseStatePayload({
				reason: "nope",
				sessionPauseMode: "nope",
				sessionIdleCause: "nope",
			}),
		).toEqual({
			reason: null,
			fullscreenDetectionSupported: true,
			sessionPauseMode: "active",
			sessionIdleCause: null,
		});
	});
});

describe("trayTooltipLabel", () => {
	it("keeps the product name when there is no pause status", () => {
		expect(trayTooltipLabel("en", null)).toBe("BlinkGuard");
		expect(trayTooltipLabel("en", active)).toBe("BlinkGuard");
	});

	it("appends localized pause copy", () => {
		expect(
			trayTooltipLabel("en", {
				...active,
				sessionPauseMode: "inactive",
				sessionIdleCause: "lock",
			}),
		).toBe("BlinkGuard — Paused: lock screen");
		expect(
			trayTooltipLabel("uk", {
				...active,
				sessionPauseMode: "camera-only",
				sessionIdleCause: "lid",
			}),
		).toBe("BlinkGuard — Камера на паузі: кришка закрита");
		expect(
			trayTooltipLabel("en", {
				...active,
				reason: "manual-hush",
			}),
		).toBe("BlinkGuard — Prompts hushed");
	});
});

describe("overlayManualHush", () => {
	it("overlays manual hush unless session idle wins", () => {
		const until = Date.now() + 60_000;
		expect(
			overlayManualHush({ ...active, reason: "quiet-hours" }, until),
		).toEqual({
			...active,
			reason: "manual-hush",
		});
		expect(
			overlayManualHush(
				{
					...active,
					sessionPauseMode: "inactive",
					sessionIdleCause: "lock",
				},
				until,
			),
		).toEqual({
			...active,
			sessionPauseMode: "inactive",
			sessionIdleCause: "lock",
		});
	});

	it("isPromptHushed reflects suppress-until epoch", () => {
		expect(isPromptHushed(Date.now() + 1)).toBe(true);
		expect(isPromptHushed(Date.now() - 1)).toBe(false);
	});
});
