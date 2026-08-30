import { globalShortcut } from "electron";
import type { AppPreferences } from "../../../shared/preferences";
import {
	SHORTCUT_ACTIONS,
	findDuplicateShortcutActions,
	sanitizeKeyboardShortcuts,
	type KeyboardShortcuts,
	type ShortcutAction,
	type ShortcutErrorPayload,
} from "../../../shared/preferences";
import { IPC_CHANNELS } from "../../../shared/ipc-channels";
import type { AppRuntimeState } from "../../application/app-runtime-state";
import type { ExerciseService } from "../../application/exercise-service";
import type { LookAwayService } from "../../application/look-away-service";
import type { ReminderService } from "../../application/reminder-service";
import {
	startTrackingSession,
	stopTrackingSession,
} from "../../application/tracking-session";
import type { InteractionLogger } from "../logging/interaction-logger";
import type { WindowManager } from "../windows/window-manager";

export class ShortcutController {
	private openCameraPreview: () => void = () => {};
	private captureMode = false;

	constructor(
		private readonly preferences: AppPreferences,
		private readonly state: AppRuntimeState,
		private readonly reminders: ReminderService,
		private readonly exercises: ExerciseService,
		private readonly lookAway: LookAwayService,
		private readonly windows: WindowManager,
		private readonly interactions: InteractionLogger | null = null,
		private readonly onSnoozeAll: () => void = () => {},
	) {}

	/** Late-bind after PreferenceActions exists (avoids ctor cycle). */
	setOpenCameraPreview(callback: () => void): void {
		this.openCameraPreview = callback;
	}

	private sessionDeps() {
		return {
			reminders: this.reminders,
			exercises: this.exercises,
			lookAway: this.lookAway,
			preferences: this.preferences,
		};
	}

	unregisterAll(): void {
		globalShortcut.unregisterAll();
	}

	/**
	 * While the settings UI records a binding, drop all globals so pressing an
	 * existing accelerator does not fire its action.
	 */
	setCaptureMode(capturing: boolean): void {
		this.captureMode = capturing;
		if (capturing) {
			this.unregisterAll();
			return;
		}
		this.registerAll(this.preferences.keyboardShortcuts);
	}

	registerAll(raw: KeyboardShortcuts): void {
		const map = sanitizeKeyboardShortcuts(raw);
		this.unregisterAll();

		// Stay silent while the UI is capturing a new chord.
		if (this.captureMode) {
			return;
		}

		const errors: ShortcutErrorPayload["errors"] = {};
		const conflicts = findDuplicateShortcutActions(map);
		const conflicted = new Set(conflicts);
		for (const action of conflicts) {
			errors[action] = map[action];
		}

		for (const action of SHORTCUT_ACTIONS) {
			const accel = map[action];
			if (!accel || conflicted.has(action)) continue;
			try {
				const registered = globalShortcut.register(accel, () => {
					this.runAction(action, accel);
				});
				if (!registered) {
					errors[action] = accel;
				}
			} catch (error) {
				console.error(
					"Error registering global shortcut:",
					action,
					accel,
					error,
				);
				errors[action] = accel;
			}
		}

		this.windows.sendToMain(IPC_CHANNELS.shortcutError, {
			errors,
			conflicts,
		} satisfies ShortcutErrorPayload);
	}

	private runAction(action: ShortcutAction, shortcut: string): void {
		switch (action) {
			case "trackingToggle":
				this.toggleTracking(shortcut);
				return;
			case "snoozeAll":
				this.onSnoozeAll();
				this.interactions?.append({
					source: "shortcut",
					action: "snooze-all",
					detail: { shortcut },
				});
				return;
			case "openSettings":
				this.windows.showMain();
				this.interactions?.append({
					source: "shortcut",
					action: "open-settings",
					detail: { shortcut },
				});
				return;
			case "openCameraPreview":
				this.openCameraPreview();
				this.interactions?.append({
					source: "shortcut",
					action: "open-camera-preview",
					detail: { shortcut },
				});
				return;
		}
	}

	private toggleTracking(shortcut: string): void {
		if (this.state.isAutoResuming) {
			this.state.isAutoResuming = false;
			stopTrackingSession(this.sessionDeps(), false);
		}
		const wasTracking = this.preferences.isTracking;
		if (wasTracking) {
			stopTrackingSession(this.sessionDeps(), true);
		} else {
			startTrackingSession(this.sessionDeps());
		}
		this.interactions?.append({
			source: "shortcut",
			action: "toggle-tracking",
			detail: {
				shortcut,
				wasTracking,
				isTracking: this.preferences.isTracking,
			},
		});
		this.windows.sendPreferences();
	}
}
