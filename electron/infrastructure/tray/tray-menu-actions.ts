import type { InteractionLogger } from "../logging/interaction-logger";
import type { WindowManager } from "../windows/window-manager";
import { shouldSwitchTraySetup } from "./tray-menu-model";
import type {
	TrayMenuActionPayload,
	TrayMenuHushDurationActionId,
	TrayMenuItemActionId,
} from "../../../shared/tray-menu";

export type TrayMenuActionDeps = {
	windows: WindowManager;
	onQuit: () => void;
	onCheckForUpdates: (() => void) | null;
	interactions: InteractionLogger | null;
	onSnoozeBlink: (() => void) | null;
	onSnoozeExercise: (() => void) | null;
	onSnoozeLookAway: (() => void) | null;
	isTracking: boolean;
	onToggleTracking: (() => void) | null;
	getActiveSetupId: () => string | null;
	getSetupIds: () => readonly string[];
	onSwitchSetup: ((id: string) => void) | null;
	onHush: (() => void) | null;
	onEndHush: (() => void) | null;
	isPromptHushed: boolean;
	onHushWithToken: (() => void) | null;
	onHushDuration: ((minutes: number) => void) | null;
	onHushUntilResume: (() => void) | null;
	onPauseApp: (() => boolean) | null;
};

export function handleTrayMenuAction(
	payload: TrayMenuActionPayload,
	deps: TrayMenuActionDeps,
): void {
	switch (payload.kind) {
		case "item":
			handleTrayMenuItemAction(payload.id, deps);
			return;
		case "snooze":
			handleTrayMenuSnoozeAction(payload.id, deps);
			return;
		case "hush-duration":
			handleTrayMenuHushDurationAction(payload.id, deps);
			return;
		case "setup":
			handleTrayMenuSetupAction(payload.id, deps);
			return;
	}
}

function handleTrayMenuItemAction(
	id: TrayMenuItemActionId,
	deps: TrayMenuActionDeps,
): void {
	switch (id) {
		case "show":
			deps.interactions?.append({ source: "tray", action: "menu-show" });
			deps.windows.showMain();
			return;
		case "tracking":
			deps.interactions?.append({
				source: "tray",
				action: deps.isTracking
					? "menu-stop-tracking"
					: "menu-start-tracking",
			});
			deps.onToggleTracking?.();
			return;
		case "hush":
			if (deps.isPromptHushed) {
				deps.interactions?.append({
					source: "tray",
					action: "menu-end-hush",
				});
				deps.onEndHush?.();
				return;
			}
			deps.interactions?.append({ source: "tray", action: "menu-hush" });
			deps.onHush?.();
			return;
		case "hush-token":
			deps.interactions?.append({
				source: "tray",
				action: "menu-hush-with-token",
			});
			deps.onHushWithToken?.();
			return;
		case "pause-app": {
			const added = deps.onPauseApp?.() ?? false;
			if (added) {
				deps.interactions?.append({
					source: "tray",
					action: "menu-pause-app",
				});
			}
			return;
		}
		case "check-for-updates":
			deps.interactions?.append({
				source: "tray",
				action: "menu-check-for-updates",
			});
			deps.onCheckForUpdates?.();
			return;
		case "quit":
			deps.interactions?.append({ source: "tray", action: "menu-quit" });
			deps.onQuit();
			return;
	}
}

function handleTrayMenuHushDurationAction(
	id: TrayMenuHushDurationActionId,
	deps: TrayMenuActionDeps,
): void {
	if (id === "hush-until-resume") {
		deps.interactions?.append({
			source: "tray",
			action: "menu-hush-until-resume",
		});
		deps.onHushUntilResume?.();
		return;
	}
	const minutes = Number.parseInt(id.slice("hush-".length), 10);
	if (!Number.isFinite(minutes) || minutes <= 0) return;
	deps.interactions?.append({
		source: "tray",
		action: `menu-hush-${minutes}`,
	});
	deps.onHushDuration?.(minutes);
}

function handleTrayMenuSnoozeAction(
	id: "snooze-blink" | "snooze-exercise" | "snooze-look-away",
	deps: TrayMenuActionDeps,
): void {
	switch (id) {
		case "snooze-blink":
			deps.interactions?.append({
				source: "tray",
				action: "menu-snooze-blink",
			});
			deps.onSnoozeBlink?.();
			return;
		case "snooze-exercise":
			deps.interactions?.append({
				source: "tray",
				action: "menu-snooze-exercise",
			});
			deps.onSnoozeExercise?.();
			return;
		case "snooze-look-away":
			deps.interactions?.append({
				source: "tray",
				action: "menu-snooze-look-away",
			});
			deps.onSnoozeLookAway?.();
			return;
	}
}

function handleTrayMenuSetupAction(id: string, deps: TrayMenuActionDeps): void {
	if (!deps.getSetupIds().includes(id)) return;
	if (!shouldSwitchTraySetup(id, deps.getActiveSetupId())) {
		return;
	}
	deps.interactions?.append({
		source: "tray",
		action: "setup-switch",
		detail: { id },
	});
	deps.onSwitchSetup?.(id);
}

export function createTrayMenuActionDeps(
	input: TrayMenuActionDeps,
): TrayMenuActionDeps {
	return input;
}
