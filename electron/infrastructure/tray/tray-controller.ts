import {
	Tray,
	nativeImage,
	type NativeImage,
	type Point,
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
import {
	formatTraySessionGlance,
	traySessionGlanceEqual,
	type TraySessionGlanceInput,
} from "../../../shared/tray-session-glance";
import type { TrayMenuRenderPayload } from "../../../shared/tray-menu";
import type { InteractionLogger } from "../logging/interaction-logger";
import type { AppPaths } from "../paths/app-paths";
import type { WindowManager } from "../windows/window-manager";
import {
	buildTrayMenuSpec,
	type TraySetupsSnapshot,
} from "./tray-menu-model";
import {
	createTrayMenuActionDeps,
	handleTrayMenuAction,
} from "./tray-menu-actions";
import { TrayMenuWindow } from "./tray-menu-window";

const EMPTY_SETUPS: TraySetupsSnapshot = {
	profiles: [],
	activeSetupId: null,
};

export type TrayThemeSnapshot = {
	darkMode: boolean;
	colors: { background: string; text: string };
	transparency: number;
};

export class TrayController {
	private tray: Tray | null = null;
	private pauseState: FocusPauseStatePayload | null = null;
	private captureState: CameraCaptureStatusPayload | null = null;
	private isTracking = false;
	private sessionGlance: TraySessionGlanceInput | null = null;
	private colorIcon: NativeImage | null = null;
	private idleIcon: NativeImage | null = null;
	private cachedMenuPayload: TrayMenuRenderPayload | null = null;

	constructor(
		private readonly paths: AppPaths,
		private readonly windows: WindowManager,
		private readonly trayMenu: TrayMenuWindow,
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
		private readonly getTheme: () => TrayThemeSnapshot = () => ({
			darkMode: true,
			colors: { background: "#0f172a", text: "#f8fafc" },
			transparency: 0.15,
		}),
	) {}

	create(): void {
		if (this.tray) return;
		this.colorIcon = this.loadIcon();
		this.idleIcon = desaturateNativeImage(this.colorIcon);
		this.isTracking = this.getIsTracking();
		this.tray = new Tray(this.iconForTracking());
		this.refreshTrayMenu(this.getLocale());
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
		this.tray.on("right-click", () => {
			this.toggleTrayMenu();
		});
	}

	rebuildMenu(locale: Locale = this.getLocale()): void {
		this.refreshTrayMenu(locale);
	}

	refreshTrayMenu(locale: Locale = this.getLocale()): void {
		const payload = this.buildTrayMenuPayload(locale);
		this.cachedMenuPayload = payload;
		this.trayMenu.update(payload);
		this.applyTooltip(locale);
	}

	setPauseState(payload: FocusPauseStatePayload): void {
		this.pauseState = payload;
		this.refreshTrayMenu();
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
		this.refreshTrayMenu();
	}

	setTrackingState(isTracking: boolean): void {
		if (this.isTracking === isTracking) return;
		this.isTracking = isTracking;
		this.applyIcon();
		this.refreshTrayMenu();
	}

	setSessionGlance(input: TraySessionGlanceInput): void {
		if (traySessionGlanceEqual(this.sessionGlance, input)) return;
		this.sessionGlance = input;
		this.applyTooltip();
	}

	destroy(): void {
		this.trayMenu.destroy();
		if (!this.tray) return;
		this.tray.destroy();
		this.tray = null;
	}

	handleTrayMenuAction(payload: Parameters<typeof handleTrayMenuAction>[0]): void {
		const setups = this.getSetups();
		handleTrayMenuAction(
			payload,
			createTrayMenuActionDeps({
				windows: this.windows,
				onQuit: this.onQuit,
				onCheckForUpdates: this.onCheckForUpdates,
				interactions: this.interactions,
				onSnoozeBlink: this.onSnoozeBlink,
				onSnoozeExercise: this.onSnoozeExercise,
				onSnoozeLookAway: this.onSnoozeLookAway,
				isTracking: this.isTracking,
				onToggleTracking: this.onToggleTracking,
				getActiveSetupId: () => setups.activeSetupId,
				getSetupIds: () => setups.profiles.map((profile) => profile.id),
				onSwitchSetup: this.onSwitchSetup,
				onHush: this.onHush,
				onEndHush: this.onEndHush,
				isPromptHushed: this.getIsPromptHushed(),
				onHushWithToken: this.onHushWithToken,
			}),
		);
	}

	private toggleTrayMenu(cursor?: Point): void {
		if (!this.tray) return;
		if (this.trayMenu.isVisible()) {
			this.trayMenu.hide();
			return;
		}
		const payload =
			this.cachedMenuPayload ?? this.buildTrayMenuPayload(this.getLocale());
		this.trayMenu.show(this.tray, payload, cursor);
	}

	private buildTrayMenuPayload(locale: Locale): TrayMenuRenderPayload {
		const shortcuts = this.getKeyboardShortcuts();
		const setups = this.getSetups();
		const glanceLabel = formatTraySessionGlance(locale, this.sessionGlance);
		const theme = this.getTheme();
		return {
			spec: buildTrayMenuSpec({
				locale,
				isTracking: this.isTracking,
				capture: this.captureState,
				pause: this.pauseState,
				glanceLabel: glanceLabel || null,
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
			}),
			darkMode: theme.darkMode,
			colors: theme.colors,
			transparency: theme.transparency,
		};
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
		const glance = formatTraySessionGlance(locale, this.sessionGlance);
		this.tray?.setToolTip(
			composeTrayTooltip(locale, this.pauseState, this.captureState, glance),
		);
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
