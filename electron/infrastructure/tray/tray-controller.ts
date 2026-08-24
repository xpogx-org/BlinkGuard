import { Menu, Tray, nativeImage, type MenuItemConstructorOptions } from "electron";
import path from "node:path";
import {
	composeTrayTooltip,
	type CameraCaptureStatusPayload,
} from "../../../shared/camera-capture-status";
import type { Locale } from "../../../shared/i18n";
import type { FocusPauseStatePayload } from "../../../shared/session-pause-status";
import type { InteractionLogger } from "../logging/interaction-logger";
import type { AppPaths } from "../paths/app-paths";
import type { WindowManager } from "../windows/window-manager";
import {
	buildTrayMenuSpec,
	type TrayMenuItemSpec,
} from "./tray-menu-model";

export class TrayController {
	private tray: Tray | null = null;
	private pauseState: FocusPauseStatePayload | null = null;
	private captureState: CameraCaptureStatusPayload | null = null;
	private isTracking = false;

	constructor(
		private readonly paths: AppPaths,
		private readonly windows: WindowManager,
		private readonly onQuit: () => void,
		private readonly getLocale: () => Locale = () => "en",
		private readonly getSnoozeMinutes: () => number = () => 5,
		private readonly onCheckForUpdates: (() => void) | null = null,
		private readonly interactions: InteractionLogger | null = null,
		private readonly onSnoozeBlink: (() => void) | null = null,
		private readonly onSnoozeExercise: (() => void) | null = null,
		private readonly onSnoozeLookAway: (() => void) | null = null,
		private readonly getIsTracking: () => boolean = () => false,
		private readonly onToggleTracking: (() => void) | null = null,
	) {}

	create(): void {
		if (this.tray) return;
		const icon = this.loadIcon();
		this.tray = new Tray(icon);
		this.isTracking = this.getIsTracking();
		this.rebuildMenu(this.getLocale());
		this.tray.on("click", () => {
			this.interactions?.append({ source: "tray", action: "click-show" });
			this.windows.showMain();
		});
		this.tray.on("double-click", () => {
			this.interactions?.append({
				source: "tray",
				action: "double-click-show",
			});
			this.windows.showMain();
		});
	}

	rebuildMenu(locale: Locale = this.getLocale()): void {
		if (!this.tray) return;
		const spec = buildTrayMenuSpec({
			locale,
			isTracking: this.isTracking,
			capture: this.captureState,
			snoozeMinutes: this.getSnoozeMinutes(),
			includeSnoozeBlink: this.onSnoozeBlink != null,
			includeSnoozeExercise: this.onSnoozeExercise != null,
			includeSnoozeLookAway: this.onSnoozeLookAway != null,
			includeCheckForUpdates: this.onCheckForUpdates != null,
		});
		const items = spec.map((item) => this.toMenuItem(item));
		this.tray.setContextMenu(Menu.buildFromTemplate(items));
		this.applyTooltip(locale);
	}

	setPauseState(payload: FocusPauseStatePayload): void {
		this.pauseState = payload;
		this.applyTooltip();
	}

	setCaptureState(payload: CameraCaptureStatusPayload): void {
		if (
			this.captureState &&
			this.captureState.capturing === payload.capturing &&
			this.captureState.surface === payload.surface
		) {
			return;
		}
		this.captureState = payload;
		this.rebuildMenu();
	}

	setTrackingState(isTracking: boolean): void {
		if (this.isTracking === isTracking) return;
		this.isTracking = isTracking;
		this.rebuildMenu();
	}

	destroy(): void {
		if (!this.tray) return;
		this.tray.destroy();
		this.tray = null;
	}

	private applyTooltip(locale: Locale = this.getLocale()): void {
		this.tray?.setToolTip(
			composeTrayTooltip(locale, this.pauseState, this.captureState),
		);
	}

	private toMenuItem(item: TrayMenuItemSpec): MenuItemConstructorOptions {
		switch (item.id) {
			case "show":
				return {
					label: item.label,
					click: () => {
						this.interactions?.append({ source: "tray", action: "menu-show" });
						this.windows.showMain();
					},
				};
			case "tracking":
				return {
					label: item.label,
					click: () => {
						this.interactions?.append({
							source: "tray",
							action: item.isTracking
								? "menu-stop-tracking"
								: "menu-start-tracking",
						});
						this.onToggleTracking?.();
					},
				};
			case "camera":
				return { label: item.label, enabled: false };
			case "snooze-blink":
				return this.snoozeMenuItem(item.label, "menu-snooze-blink", this.onSnoozeBlink);
			case "snooze-exercise":
				return this.snoozeMenuItem(
					item.label,
					"menu-snooze-exercise",
					this.onSnoozeExercise,
				);
			case "snooze-look-away":
				return this.snoozeMenuItem(
					item.label,
					"menu-snooze-look-away",
					this.onSnoozeLookAway,
				);
			case "check-for-updates":
				return {
					label: item.label,
					click: () => {
						this.interactions?.append({
							source: "tray",
							action: "menu-check-for-updates",
						});
						this.onCheckForUpdates?.();
					},
				};
			case "separator":
				return { type: "separator" };
			case "quit":
				return {
					label: item.label,
					click: () => {
						this.interactions?.append({ source: "tray", action: "menu-quit" });
						this.onQuit();
					},
				};
		}
	}

	private snoozeMenuItem(
		label: string,
		action: string,
		handler: (() => void) | null,
	): MenuItemConstructorOptions {
		return {
			label,
			click: () => {
				this.interactions?.append({ source: "tray", action });
				handler?.();
			},
		};
	}

	private loadIcon() {
		const pngPath = path.join(this.paths.root, "assets", "icons", "icon.png");
		let image = nativeImage.createFromPath(pngPath);
		if (image.isEmpty() && process.platform === "win32") {
			const icoPath = path.join(
				this.paths.root,
				"assets",
				"icons",
				"icon.ico",
			);
			image = nativeImage.createFromPath(icoPath);
		}
		return image;
	}
}
