import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { notificationInstances, FakeNotification } = vi.hoisted(() => {
	const { EventEmitter } =
		require("node:events") as typeof import("node:events");
	const notificationInstances: FakeNotification[] = [];

	class FakeNotification extends EventEmitter {
		static isSupported = vi.fn(() => true);
		static handleActivation = vi.fn();
		readonly options: Record<string, unknown>;
		show = vi.fn();
		close = vi.fn();

		constructor(options: Record<string, unknown>) {
			super();
			this.options = options;
			notificationInstances.push(this);
		}
	}

	return { notificationInstances, FakeNotification };
});

vi.mock("electron", () => ({
	Notification: FakeNotification,
}));

import {
	OsNotificationPlayer,
	osToastId,
} from "../../../electron/infrastructure/notifications/os-notification-player";

describe("OsNotificationPlayer", () => {
	beforeEach(() => {
		notificationInstances.length = 0;
		FakeNotification.isSupported.mockReturnValue(true);
		FakeNotification.handleActivation.mockReset();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns shown false when notifications are unsupported", () => {
		FakeNotification.isSupported.mockReturnValue(false);
		const player = new OsNotificationPlayer({ platform: "win32" });
		expect(
			player.show("blink", {
				title: "Blink",
				body: "Blink!",
				snoozeLabel: "Snooze",
			}),
		).toEqual({ shown: false });
		expect(notificationInstances).toHaveLength(0);
	});

	it("creates a silent tagged notification with a snooze action", () => {
		const player = new OsNotificationPlayer({ platform: "darwin" });
		const result = player.show("blink", {
			title: "Blink Reminder",
			body: "Blink!",
			snoozeLabel: "Snooze",
		});
		expect(result).toEqual({ shown: true });
		expect(notificationInstances[0]?.options).toMatchObject({
			id: osToastId("blink"),
			title: "Blink Reminder",
			body: "Blink!",
			silent: true,
			actions: [{ type: "button", text: "Snooze" }],
		});
		expect(notificationInstances[0]?.show).toHaveBeenCalledOnce();
	});

	it("replaces the previous toast of the same kind", () => {
		const player = new OsNotificationPlayer({ platform: "darwin" });
		player.show("blink", {
			title: "A",
			body: "1",
			snoozeLabel: "Snooze",
		});
		player.show("blink", {
			title: "B",
			body: "2",
			snoozeLabel: "Snooze",
		});
		expect(notificationInstances[0]?.close).toHaveBeenCalledOnce();
		expect(notificationInstances).toHaveLength(2);
	});

	it("dismiss and dismissAll close stored instances", () => {
		const player = new OsNotificationPlayer({ platform: "darwin" });
		player.show("blink", {
			title: "Blink",
			body: "x",
			snoozeLabel: "Snooze",
		});
		player.show("exercise", {
			title: "Exercise",
			body: "y",
			snoozeLabel: "Snooze",
		});
		player.dismiss("blink");
		expect(notificationInstances[0]?.close).toHaveBeenCalledOnce();
		player.dismissAll();
		expect(notificationInstances[1]?.close).toHaveBeenCalledOnce();
	});

	it("invokes onFailed once when the notification fails", () => {
		const player = new OsNotificationPlayer({ platform: "darwin" });
		const onFailed = vi.fn();
		player.show(
			"lookAway",
			{ title: "Look away", body: "20s", snoozeLabel: "Snooze" },
			{ onFailed },
		);
		notificationInstances[0]?.emit("failed");
		notificationInstances[0]?.emit("failed");
		expect(onFailed).toHaveBeenCalledOnce();
	});

	it("routes macOS click and snooze through handlers, not overlay focus", () => {
		const player = new OsNotificationPlayer({ platform: "darwin" });
		const onClick = vi.fn();
		const onSnooze = vi.fn();
		player.setActivationHandlers({ onClick, onSnooze });
		player.show("exercise", {
			title: "Exercise",
			body: "Roll your eyes",
			snoozeLabel: "Snooze",
		});
		notificationInstances[0]?.emit("click");
		expect(onClick).toHaveBeenCalledWith("exercise");
		notificationInstances[0]?.emit("action", { actionIndex: 0 });
		expect(onSnooze).toHaveBeenCalledWith("exercise");
	});

	it("registers Windows handleActivation once and maps click to onClick", () => {
		const player = new OsNotificationPlayer({ platform: "win32" });
		const onClick = vi.fn();
		player.setActivationHandlers({
			onClick,
			onSnooze: vi.fn(),
		});
		player.setActivationHandlers({
			onClick,
			onSnooze: vi.fn(),
		});
		expect(FakeNotification.handleActivation).toHaveBeenCalledOnce();
		player.show("blink", {
			title: "Blink",
			body: "x",
			snoozeLabel: "Snooze",
		});
		const callback = FakeNotification.handleActivation.mock
			.calls[0]?.[0] as (details: { type: string; arguments?: string }) => void;
		callback({ type: "click", arguments: osToastId("blink") });
		expect(onClick).toHaveBeenCalledWith("blink");
	});

	it("adds a second action for token hush and routes action index 1", () => {
		const player = new OsNotificationPlayer({ platform: "darwin" });
		const onSnooze = vi.fn();
		const onSnoozeWithToken = vi.fn();
		player.setActivationHandlers({
			onClick: vi.fn(),
			onSnooze,
			onSnoozeWithToken,
		});
		player.show("blink", {
			title: "Blink",
			body: "x",
			snoozeLabel: "Snooze",
			tokenSnoozeLabel: "Hush all with token (10 min)",
		});
		expect(notificationInstances[0]?.options.actions).toEqual([
			{ type: "button", text: "Snooze" },
			{ type: "button", text: "Hush all with token (10 min)" },
		]);
		notificationInstances[0]?.emit("action", { actionIndex: 0 });
		expect(onSnooze).toHaveBeenCalledWith("blink");
		notificationInstances[0]?.emit("action", { actionIndex: 1 });
		expect(onSnoozeWithToken).toHaveBeenCalledOnce();
	});
});
