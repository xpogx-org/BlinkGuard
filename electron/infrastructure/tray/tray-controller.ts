import {
	Menu,
	Tray,
	nativeImage,
	type MenuItemConstructorOptions,
	type NativeImage,
} from "electron";
import path from "node:path";
import {
	composeTrayTooltip,
	type CameraCaptureStatusPayload,
} from "../../../shared/camera-capture-status";
import type { Locale } from "../../../shared/i18n";
import {
	DEFAULT_KEYBOARD_SHORTCUTS,
	type KeyboardShortcuts,
} from "../../../shared/preferences";
import type { FocusPauseStatePayload } from "../../../shared/session-pause-status";
import type { InteractionLogger } from "../logging/interaction-logger";
import type { AppPaths } from "../paths/app-paths";
import type { WindowManager } from "../windows/window-manager";
import {
	buildTrayMenuSpec,
	shouldSwitchTraySetup,
	type TrayMenuItemSpec,
	type TraySetupsSnapshot,
	type TraySetupItemSpec,
	type TraySnoozeItemSpec,
} from "./tray-menu-model";

const EMPTY_SETUPS: TraySetupsSnapshot = {
	profiles: [],
	activeSetupId: null,
};

export class TrayController {
	private tray: Tray | null = null;
	private pauseState: FocusPauseStatePayload | null = null;
	private captureState: CameraCaptureStatusPayload | null = null;
	private isTracking = false;
	private colorIcon: NativeImage | null = null;
	private idleIcon: NativeImage | null = null;

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
		private readonly getKeyboardShortcuts: () => KeyboardShortcuts = () =>
			DEFAULT_KEYBOARD_SHORTCUTS,
		private readonly getSetups: () => TraySetupsSnapshot = () => EMPTY_SETUPS,
		private readonly onSwitchSetup: ((id: string) => void) | null = null,
		private readonly getIsPromptHushed: () => boolean = () => false,
		private readonly onHush: (() => void) | null = null,
		private readonly onEndHush: (() => void) | null = null,
		private readonly getSnoozeTokenCharges: () => number = () => 0,
		private readonly onHushWithToken: (() => void) | null = null,
	) {}

	create(): void {
		if (this.tray) return;
		this.colorIcon = this.loadIcon();
		this.idleIcon = desaturateNativeImage(this.colorIcon);
		this.isTracking = this.getIsTracking();
		this.tray = new Tray(this.iconForTracking());
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
		const shortcuts = this.getKeyboardShortcuts();
		const setups = this.getSetups();
		const spec = buildTrayMenuSpec({
			locale,
			isTracking: this.isTracking,
			capture: this.captureState,
			pause: this.pauseState,
			snoozeMinutes: this.getSnoozeMinutes(),
			includeSnoozeBlink: this.onSnoozeBlink != null,
			includeSnoozeExercise: this.onSnoozeExercise != null,
			includeSnoozeLookAway: this.onSnoozeLookAway != null,
			includeCheckForUpdates: this.onCheckForUpdates != null,
			showAccelerator: shortcuts.openSettings,
			trackingAccelerator: shortcuts.trackingToggle,
			includeHush: this.onHush != null,
			isPromptHushed: this.getIsPromptHushed(),
			hushAccelerator: shortcuts.snoozeAll,
			snoozeTokenCharges: this.getSnoozeTokenCharges(),
			tokenSnoozeAccelerator: shortcuts.snoozeWithToken,
			setups: setups.profiles,
			activeSetupId: setups.activeSetupId,
		});
		const items = spec.map((item) => this.toMenuItem(item));
		this.tray.setContextMenu(Menu.buildFromTemplate(items));
		this.applyTooltip(locale);
	}

	setPauseState(payload: FocusPauseStatePayload): void {
		this.pauseState = payload;
		this.rebuildMenu();
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
		this.applyIcon();
		this.rebuildMenu();
	}

	destroy(): void {
		if (!this.tray) return;
		this.tray.destroy();
		this.tray = null;
	}

	private applyIcon(): void {
		this.tray?.setImage(this.iconForTracking());
	}

	private iconForTracking(): NativeImage {
		const fallback = this.colorIcon ?? nativeImage.createEmpty();
		if (this.isTracking) return this.colorIcon ?? fallback;
		return this.idleIcon ?? fallback;
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
					...optionalAccelerator(item.accelerator),
					click: () => {
						this.interactions?.append({ source: "tray", action: "menu-show" });
						this.windows.showMain();
					},
				};
			case "tracking":
				return {
					label: item.label,
					type: "checkbox",
					checked: item.isTracking,
					...optionalAccelerator(item.accelerator),
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
			case "hush":
				return {
					label: item.label,
					...optionalAccelerator(item.accelerator),
					click: () => {
						if (item.active) {
							this.interactions?.append({
								source: "tray",
								action: "menu-end-hush",
							});
							this.onEndHush?.();
							return;
						}
						this.interactions?.append({
							source: "tray",
							action: "menu-hush",
						});
						this.onHush?.();
					},
				};
			case "hush-token":
				return {
					label: item.label,
					...optionalAccelerator(item.accelerator),
					click: () => {
						this.interactions?.append({
							source: "tray",
							action: "menu-hush-with-token",
						});
						this.onHushWithToken?.();
					},
				};
			case "camera":
			case "pause":
				return { label: item.label, enabled: false };
			case "snooze":
				return {
					label: item.label,
					submenu: item.submenu.map((child) => this.snoozeSubmenuItem(child)),
				};
			case "setups":
				return {
					label: item.label,
					submenu: item.submenu.map((child) => this.setupSubmenuItem(child)),
				};
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

	private setupSubmenuItem(
		item: TraySetupItemSpec,
	): MenuItemConstructorOptions {
		return {
			label: item.label,
			type: "radio",
			checked: item.checked,
			click: () => {
				if (!shouldSwitchTraySetup(item.id, item.checked ? item.id : null)) {
					return;
				}
				this.interactions?.append({
					source: "tray",
					action: "setup-switch",
					detail: { id: item.id },
				});
				this.onSwitchSetup?.(item.id);
			},
		};
	}

	private snoozeSubmenuItem(
		item: TraySnoozeItemSpec,
	): MenuItemConstructorOptions {
		switch (item.id) {
			case "snooze-blink":
				return this.snoozeMenuItem(
					item.label,
					"menu-snooze-blink",
					this.onSnoozeBlink,
				);
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

	private loadIcon(): NativeImage {
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

function optionalAccelerator(
	accelerator: string | undefined,
): Pick<MenuItemConstructorOptions, "accelerator"> {
	return accelerator ? { accelerator } : {};
}

/** In-memory grayscale copy of the color tray icon (no second art file). */
function desaturateNativeImage(image: NativeImage): NativeImage {
	if (image.isEmpty()) return image;
	const { width, height } = image.getSize();
	if (width === 0 || height === 0) return image;
	const src = image.toBitmap();
	const dst = Buffer.from(src);
	for (let i = 0; i < dst.length; i += 4) {
		const blue = dst[i] ?? 0;
		const green = dst[i + 1] ?? 0;
		const red = dst[i + 2] ?? 0;
		const gray = (red * 77 + green * 150 + blue * 29) >> 8;
		dst[i] = gray;
		dst[i + 1] = gray;
		dst[i + 2] = gray;
	}
	return nativeImage.createFromBitmap(dst, { width, height });
}
