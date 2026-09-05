import { describe, expect, it, vi } from "vitest";
import {
	createTrayMenuActionDeps,
	handleTrayMenuAction,
} from "../../../electron/infrastructure/tray/tray-menu-actions";
import type { WindowManager } from "../../../electron/infrastructure/windows/window-manager";

function deps(overrides: Partial<ReturnType<typeof createTrayMenuActionDeps>> = {}) {
	const windows = { showMain: vi.fn() } as unknown as WindowManager;
	return createTrayMenuActionDeps({
		windows,
		onQuit: vi.fn(),
		onCheckForUpdates: vi.fn(),
		interactions: { append: vi.fn() } as unknown as import("../../../electron/infrastructure/logging/interaction-logger").InteractionLogger,
		onSnoozeBlink: vi.fn(),
		onSnoozeExercise: vi.fn(),
		onSnoozeLookAway: vi.fn(),
		isTracking: false,
		onToggleTracking: vi.fn(),
		getActiveSetupId: () => "a",
		getSetupIds: () => ["a", "b"],
		onSwitchSetup: vi.fn(),
		onHush: vi.fn(),
		onEndHush: vi.fn(),
		isPromptHushed: false,
		onHushWithToken: vi.fn(),
		onHushDuration: vi.fn(),
		onHushUntilResume: vi.fn(),
		onPauseApp: vi.fn(() => false),
		...overrides,
	});
}

describe("handleTrayMenuAction", () => {
	it("opens settings for show", () => {
		const d = deps();
		handleTrayMenuAction({ kind: "item", id: "show" }, d);
		expect(d.windows.showMain).toHaveBeenCalledOnce();
		expect(d.interactions?.append).toHaveBeenCalledWith({
			source: "tray",
			action: "menu-show",
		});
	});

	it("toggles tracking with the correct log action", () => {
		const onToggleTracking = vi.fn();
		const d = deps({ isTracking: true, onToggleTracking });
		handleTrayMenuAction({ kind: "item", id: "tracking" }, d);
		expect(onToggleTracking).toHaveBeenCalledOnce();
		expect(d.interactions?.append).toHaveBeenCalledWith({
			source: "tray",
			action: "menu-stop-tracking",
		});
	});

	it("routes hush vs end hush from prompt state", () => {
		const onHush = vi.fn();
		const onEndHush = vi.fn();
		handleTrayMenuAction(
			{ kind: "item", id: "hush" },
			deps({ onHush, onEndHush, isPromptHushed: false }),
		);
		expect(onHush).toHaveBeenCalledOnce();
		handleTrayMenuAction(
			{ kind: "item", id: "hush" },
			deps({ onHush, onEndHush, isPromptHushed: true }),
		);
		expect(onEndHush).toHaveBeenCalledOnce();
	});

	it("routes meeting hush durations", () => {
		const onHushDuration = vi.fn();
		const onHushUntilResume = vi.fn();
		const d = deps({ onHushDuration, onHushUntilResume });
		handleTrayMenuAction({ kind: "hush-duration", id: "hush-30" }, d);
		expect(onHushDuration).toHaveBeenCalledWith(30);
		handleTrayMenuAction({ kind: "hush-duration", id: "hush-until-resume" }, d);
		expect(onHushUntilResume).toHaveBeenCalledOnce();
	});

	it("snoozes blink reminders", () => {
		const onSnoozeBlink = vi.fn();
		const d = deps({ onSnoozeBlink });
		handleTrayMenuAction({ kind: "snooze", id: "snooze-blink" }, d);
		expect(onSnoozeBlink).toHaveBeenCalledOnce();
	});

	it("no-ops setup switch for the active setup", () => {
		const onSwitchSetup = vi.fn();
		const d = deps({
			getActiveSetupId: () => "a",
			getSetupIds: () => ["a", "b"],
			onSwitchSetup,
		});
		handleTrayMenuAction({ kind: "setup", id: "a" }, d);
		expect(onSwitchSetup).not.toHaveBeenCalled();
	});

	it("switches to another setup when allowed", () => {
		const onSwitchSetup = vi.fn();
		const d = deps({
			getActiveSetupId: () => "a",
			getSetupIds: () => ["a", "b"],
			onSwitchSetup,
		});
		handleTrayMenuAction({ kind: "setup", id: "b" }, d);
		expect(onSwitchSetup).toHaveBeenCalledWith("b");
	});

	it("rejects unknown setup ids", () => {
		const onSwitchSetup = vi.fn();
		const d = deps({
			getActiveSetupId: () => "a",
			getSetupIds: () => ["a"],
			onSwitchSetup,
		});
		handleTrayMenuAction({ kind: "setup", id: "missing" }, d);
		expect(onSwitchSetup).not.toHaveBeenCalled();
	});

	it("logs pause-app only when the handler reports success", () => {
		const onPauseApp = vi.fn(() => true);
		const d = deps({ onPauseApp });
		handleTrayMenuAction({ kind: "item", id: "pause-app" }, d);
		expect(onPauseApp).toHaveBeenCalledOnce();
		expect(d.interactions?.append).toHaveBeenCalledWith({
			source: "tray",
			action: "menu-pause-app",
		});

		const noop = deps({ onPauseApp: vi.fn(() => false) });
		handleTrayMenuAction({ kind: "item", id: "pause-app" }, noop);
		expect(noop.interactions?.append).not.toHaveBeenCalled();
	});
});
