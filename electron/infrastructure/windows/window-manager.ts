import { BrowserWindow, screen, type Display } from "electron";
import path from "node:path";
import {
	achievementTitleKey,
	type CheerCelebration,
} from "../../../shared/achievements";
import type { DebugOverlayKind } from "../../../shared/debug-preview";
import {
	pluralKey,
	resolveCatalog,
	resolveExercisePrompts,
	resolveLookAwayHint,
	resolveLookAwayTitle,
	resolvePopupMessage,
	t,
} from "../../../shared/i18n";
import {
	capPopupPositionsByDisplayId,
	capPopupSizesByDisplayId,
	samePopupPositionsByDisplayId,
	samePopupSizesByDisplayId,
	sanitizeExercisePrompts,
	sanitizeLookAwayHint,
	sanitizeLookAwayTitle,
	seedPopupPositionsFromLegacy,
	seedPopupSizesFromPositionIds,
	toRendererPreferences,
	type AppPreferences,
	type Point,
	type Size,
} from "../../../shared/preferences";
import { IPC_CHANNELS } from "../../../shared/ipc-channels";
import { buildOverlayPayload } from "../../../shared/session-recap";
import type { SessionRecapOverlayPayload } from "../../../shared/session-recap";
import { buildPopupAppearancePayload } from "../../../shared/popup-presets";
import {
	POPUP_SHADOW_INSET,
	popupCardPosition,
	popupCardSize,
	popupWindowSize,
	withPopupWindowChrome,
} from "../../../shared/popup-window-chrome";
import { BLINK_RATE_COACH_DISMISS_MS } from "../../domain/blink-rate-coaching";
import { RECAP_OVERLAY_DISMISS_MS } from "../../domain/session-recap-policy";
import {
	EXERCISE_POPUP_VISIBLE_MS,
	REMINDER_POPUP_VISIBLE_MS,
} from "../../domain/reminder-policy";
import type { AppPaths } from "../paths/app-paths";
import {
	createPanelWindow,
	pinPanelAboveSystemChrome,
} from "./panel-window";
import {
	getActiveDisplay,
	getDisplayForPopupRect,
	getDisplayIdContainingPoint,
	getLeftBiasedPopupPosition,
	getRightBiasedPopupPosition,
	getTopCenterPopupPosition,
	clampPopupSizeToWorkArea,
	ambientDesktopBounds,
	systemChromeRects,
	layoutForDisplays,
	migratePopupPositionsToWorkAreaRelative,
	nextUnsavedDisplayId,
	resolveOpenWindowPosition,
	resolvePopupPositionForDisplay,
	resolvePopupSizeForDisplay,
	toWorkAreaRelativePosition,
} from "./window-position";

type ReminderKind = "starting" | "blink" | "stopped";
type ForceShowOptions = { force?: boolean; message?: string };
const DISPLAY_RECOVER_DEBOUNCE_MS = 150;
/** Short debug previews (ambient glow, no-face) auto-hide after this. */
const DEBUG_PREVIEW_SHORT_DISMISS_MS = 3_000;

export type PopupPlacementPersist = {
	map: Record<string, Point>;
	sizes?: Record<string, Size>;
	/** Last-save mirrors; omit to leave unchanged. */
	position?: Point;
	size?: Size;
};

export class WindowManager {
	main: BrowserWindow | null = null;
	reminder: BrowserWindow | null = null;
	exercise: BrowserWindow | null = null;
	lookAway: BrowserWindow | null = null;
	camera: BrowserWindow | null = null;
	editor: BrowserWindow | null = null;
	noFace: BrowserWindow | null = null;
	ambient: BrowserWindow | null = null;
	/** Taskbar/dock strips only — keeps the OS bar visible while glow paints over it. */
	private ambientChrome: BrowserWindow[] = [];
	calibrationNudge: BrowserWindow | null = null;
	cheerToast: BrowserWindow | null = null;
	recapToast: BrowserWindow | null = null;
	private calibrationNudgeDismissTimer: ReturnType<typeof setTimeout> | null =
		null;
	private cheerToastDismissTimer: ReturnType<typeof setTimeout> | null = null;
	private recapDismissTimer: ReturnType<typeof setTimeout> | null = null;
	private ambientPreviewDismissTimer: ReturnType<typeof setTimeout> | null =
		null;
	private onMainLoaded: (() => void) | null = null;
	private displayRecoverTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly onDisplayLayoutChanged = (): void => {
		this.scheduleDisplayRecovery();
	};

	constructor(
		private readonly paths: AppPaths,
		private readonly preferences: AppPreferences,
		private readonly devServerUrl: string | undefined,
		private readonly persistPopupPlacement?: (
			update: PopupPlacementPersist,
		) => void,
	) {}

	setOnMainLoaded(handler: (() => void) | null): void {
		this.onMainLoaded = handler;
	}

	private sendI18n(window: BrowserWindow): void {
		const locale = this.preferences.locale === "uk" ? "uk" : "en";
		const n = this.preferences.snoozeMinutes;
		const snoozeKeys = [
			"popup.blink.snooze",
			"popup.exercise.snooze",
			"popup.lookAway.snooze",
		] as const;
		const messages = { ...resolveCatalog(locale) };
		for (const key of snoozeKeys) {
			messages[key] = t(locale, pluralKey(key, locale, n), { n });
		}
		window.webContents.send(IPC_CHANNELS.applyI18n, {
			locale,
			messages,
		});
	}

	createMain(
		onClose: (event: Electron.Event) => void,
		options: { showOnReady?: boolean } = {},
	): BrowserWindow {
		const showOnReady = options.showOnReady ?? true;
		const darkMode = this.preferences.darkMode !== false;
		const window = new BrowserWindow({
			width: 1024,
			height: 768,
			minWidth: 720,
			minHeight: 520,
			show: false,
			// Match renderer boot splash / shell background for current theme.
			backgroundColor: darkMode ? "#0B1220" : "#F4F7F9",
			icon: path.join(this.paths.root, "assets", "icons", "icon.png"),
			autoHideMenuBar: true,
			webPreferences: {
				preload: this.paths.preload,
				nodeIntegration: false,
				contextIsolation: true,
				webSecurity: true,
			},
		});
		this.main = window;
		window.on("close", onClose);
		window.once("ready-to-show", () => {
			if (!showOnReady || window.isDestroyed()) return;
			window.show();
		});
		window.webContents.on("did-finish-load", () => {
			this.sendToMain(
				IPC_CHANNELS.mainProcessMessage,
				new Date().toLocaleString(),
			);
			this.sendPreferences();
			this.onMainLoaded?.();
		});
		const darkQuery = darkMode ? "1" : "0";
		if (this.devServerUrl) {
			const url = new URL(this.devServerUrl);
			url.searchParams.set("dark", darkQuery);
			void window.loadURL(url.toString());
		} else {
			void window.loadFile(path.join(this.paths.rendererDist, "index.html"), {
				query: { dark: darkQuery },
			});
		}
		return window;
	}

	activateMain(onClose: (event: Electron.Event) => void): void {
		if (this.main && !this.main.isDestroyed()) {
			if (!this.main.isVisible()) this.main.show();
			this.main.focus();
			return;
		}
		if (BrowserWindow.getAllWindows().length === 0) this.createMain(onClose);
	}

	showMain(): void {
		if (this.main && !this.main.isDestroyed()) {
			this.main.show();
			this.main.focus();
		}
	}

	sendToMain(channel: string, ...args: unknown[]): void {
		if (this.main && !this.main.isDestroyed()) {
			this.main.webContents.send(channel, ...args);
		}
	}

	sendPreferences(): void {
		this.sendToMain(
			IPC_CHANNELS.loadPreferences,
			toRendererPreferences(this.preferences),
		);
	}

	/** Notify an open blink reminder popup of camera mode (settings-profile switch). */
	sendCameraModeToReminder(enabled: boolean): void {
		if (this.reminder && !this.reminder.isDestroyed()) {
			this.reminder.webContents.send(IPC_CHANNELS.cameraMode, enabled);
		}
	}

	showReminder(
		kind: ReminderKind,
		options: ForceShowOptions = {},
	): BrowserWindow | null {
		if (
			!options.force &&
			kind !== "stopped" &&
			!this.preferences.isTracking
		) {
			return null;
		}
		this.closeReminder();
		const display = getActiveDisplay();
		const cardSize = this.popupSizeForDisplay(display);
		const cardPosition = this.ensurePopupPosition(display);
		const frame = withPopupWindowChrome(cardSize, cardPosition);
		const interactive =
			kind === "blink" && !this.preferences.blinkPopupClickThrough;
		const popup = createPanelWindow({
			width: frame.size.width,
			height: frame.size.height,
			x: frame.position.x,
			y: frame.position.y,
			focusable: interactive,
		}, this.paths.preload);
		this.reminder = popup;
		void popup.loadFile(path.join(this.paths.publicDir, `${kind}.html`));
		popup.webContents.on("did-finish-load", () => {
			this.sendI18n(popup);
			popup.webContents.send(
				IPC_CHANNELS.updateColors,
				this.popupAppearancePayload(),
			);
			if (kind === "blink") {
				const locale =
					this.preferences.locale === "uk" ? "uk" : "en";
				popup.webContents.send(
					IPC_CHANNELS.updateMessage,
					options.message ??
						resolvePopupMessage(this.preferences.popupMessage, locale),
				);
				popup.webContents.send(
					IPC_CHANNELS.cameraMode,
					this.preferences.cameraEnabled,
				);
				this.sendClickThrough(popup);
			}
			if (!interactive) {
				popup.setIgnoreMouseEvents(true);
			}
		});
		this.presentPanel(popup, interactive);
		popup.on("closed", () => {
			if (this.reminder === popup) this.reminder = null;
		});
		// Blink overlays stay until blink/snooze/gate (ReminderService). Only
		// starting/stopped auto-close here.
		if (kind === "stopped" || kind === "starting") {
			setTimeout(
				() => this.closeReminderIfCurrent(popup),
				REMINDER_POPUP_VISIBLE_MS,
			);
		}
		return popup;
	}

	closeReminder(): void {
		this.closeWindow("reminder");
	}

	closeReminderIfCurrent(token: unknown): boolean {
		if (this.reminder !== token) return false;
		this.closeReminder();
		return true;
	}

	hasReminder(): boolean {
		return !!this.reminder && !this.reminder.isDestroyed();
	}

	showAmbient(options: ForceShowOptions = {}): void {
		if (!options.force && !this.preferences.isTracking) {
			return;
		}
		if (this.ambient && !this.ambient.isDestroyed()) {
			this.repositionAmbient();
			return;
		}
		const display = getActiveDisplay();
		const desktop = ambientDesktopBounds(display.bounds, display.workArea);
		const popup = this.createAmbientOverlay(desktop);
		this.ambient = popup;
		popup.on("closed", () => {
			if (this.ambient === popup) this.ambient = null;
			this.closeAmbientChromeOverlays();
		});
		this.syncAmbientChromeOverlays();
		this.raiseReminderAboveAmbient();
	}

	hideAmbient(): void {
		this.clearAmbientPreviewDismissTimer();
		this.closeAmbientChromeOverlays();
		this.closeWindow("ambient");
	}

	hasAmbient(): boolean {
		return !!this.ambient && !this.ambient.isDestroyed();
	}

	showNoFace(options: ForceShowOptions = {}): void {
		if (
			!options.force &&
			(!this.preferences.isTracking ||
				!this.preferences.cameraEnabled ||
				(this.noFace && !this.noFace.isDestroyed()))
		) {
			return;
		}
		if (this.noFace && !this.noFace.isDestroyed()) {
			this.hideNoFace();
		}
		const cardSize = { width: 220, height: 48 };
		const winSize = popupWindowSize(cardSize);
		const { x, y } = getTopCenterPopupPosition(winSize.width);
		const popup = createPanelWindow({
			width: winSize.width,
			height: winSize.height,
			x,
			y,
			focusable: false,
		}, this.paths.preload);
		this.noFace = popup;
		void popup.loadFile(path.join(this.paths.publicDir, "no-face.html"));
		popup.webContents.on("did-finish-load", () => {
			this.sendI18n(popup);
			popup.setIgnoreMouseEvents(true);
		});
		popup.once("ready-to-show", () => popup.showInactive());
		popup.on("closed", () => {
			if (this.noFace === popup) this.noFace = null;
		});
	}

	hideNoFace(): void {
		this.closeWindow("noFace");
	}

	hasNoFace(): boolean {
		return !!this.noFace && !this.noFace.isDestroyed();
	}

	showCalibrationNudge(
		reason: "stale" | "drift",
		options: ForceShowOptions = {},
	): void {
		if (
			!options.force &&
			(!this.preferences.isTracking ||
				!this.preferences.cameraEnabled ||
				(this.calibrationNudge && !this.calibrationNudge.isDestroyed()))
		) {
			return;
		}
		if (this.calibrationNudge && !this.calibrationNudge.isDestroyed()) {
			this.hideCalibrationNudge();
		}
		const cardSize = { width: 320, height: 48 };
		const winSize = popupWindowSize(cardSize);
		const { x, y } = getTopCenterPopupPosition(winSize.width);
		const popup = createPanelWindow(
			{
				width: winSize.width,
				height: winSize.height,
				x,
				y,
				focusable: false,
			},
			this.paths.preload,
		);
		this.calibrationNudge = popup;
		void popup.loadFile(
			path.join(this.paths.publicDir, "calibration-nudge.html"),
			{ query: { reason } },
		);
		popup.webContents.on("did-finish-load", () => {
			this.sendI18n(popup);
			popup.setIgnoreMouseEvents(true);
		});
		popup.once("ready-to-show", () => popup.showInactive());
		popup.on("closed", () => {
			if (this.calibrationNudge === popup) this.calibrationNudge = null;
			if (this.calibrationNudgeDismissTimer) {
				clearTimeout(this.calibrationNudgeDismissTimer);
				this.calibrationNudgeDismissTimer = null;
			}
		});
		if (this.calibrationNudgeDismissTimer) {
			clearTimeout(this.calibrationNudgeDismissTimer);
		}
		this.calibrationNudgeDismissTimer = setTimeout(() => {
			this.calibrationNudgeDismissTimer = null;
			if (this.calibrationNudge === popup) this.hideCalibrationNudge();
		}, BLINK_RATE_COACH_DISMISS_MS);
	}

	hideCalibrationNudge(): void {
		if (this.calibrationNudgeDismissTimer) {
			clearTimeout(this.calibrationNudgeDismissTimer);
			this.calibrationNudgeDismissTimer = null;
		}
		this.closeWindow("calibrationNudge");
	}

	hasCalibrationNudge(): boolean {
		return !!this.calibrationNudge && !this.calibrationNudge.isDestroyed();
	}

	/** Short celebration toast after Cheer / level-up / achievement. */
	showCheerToast(celebration?: CheerCelebration): void {
		if (this.cheerToast && !this.cheerToast.isDestroyed()) {
			this.hideCheerToast();
		}
		const kind = celebration?.kind ?? "cheer";
		const isStacked = kind !== "cheer";
		const level =
			celebration?.kind === "levelUp" &&
			typeof celebration.level === "number" &&
			Number.isFinite(celebration.level)
				? Math.max(1, Math.floor(celebration.level))
				: 1;
		const cardSize = { width: 360, height: isStacked ? 140 : 120 };
		const winSize = popupWindowSize(cardSize);
		const { x, y } = getTopCenterPopupPosition(winSize.width);
		const popup = createPanelWindow(
			{
				width: winSize.width,
				height: winSize.height,
				x,
				y,
				focusable: false,
			},
			this.paths.preload,
		);
		this.cheerToast = popup;
		void popup.loadFile(path.join(this.paths.publicDir, "cheer.html"));
		popup.webContents.on("did-finish-load", () => {
			this.sendI18n(popup);
			if (isStacked) {
				const locale = this.preferences.locale === "uk" ? "uk" : "en";
				let message = t(locale, "popup.levelUp.message", { level });
				let subtitle = t(locale, "popup.levelUp.subtitle");
				if (celebration?.kind === "achievement") {
					message = t(locale, achievementTitleKey(celebration.id));
					subtitle = t(locale, "popup.achievement.subtitle");
				} else if (celebration?.kind === "achievementSummary") {
					const count =
						typeof celebration.count === "number" &&
						Number.isFinite(celebration.count)
							? Math.max(1, Math.floor(celebration.count))
							: 1;
					message = t(locale, "popup.achievementSummary.message");
					subtitle = t(
						locale,
						pluralKey("popup.achievementSummary.subtitle", locale, count),
						{ n: count },
					);
				}
				void popup.webContents.executeJavaScript(
					`(() => {
						const msg = document.getElementById("cheer-message");
						const sub = document.getElementById("cheer-subtitle");
						const stack = document.getElementById("cheer-text");
						if (msg) {
							msg.removeAttribute("data-i18n");
							msg.textContent = ${JSON.stringify(message)};
						}
						if (sub) {
							sub.hidden = false;
							sub.textContent = ${JSON.stringify(subtitle)};
						}
						if (stack) stack.classList.add("cheer-text--stacked");
					})();`,
				);
			}
			popup.setIgnoreMouseEvents(true);
		});
		popup.once("ready-to-show", () => popup.showInactive());
		popup.on("closed", () => {
			if (this.cheerToast === popup) this.cheerToast = null;
			if (this.cheerToastDismissTimer) {
				clearTimeout(this.cheerToastDismissTimer);
				this.cheerToastDismissTimer = null;
			}
		});
		if (this.cheerToastDismissTimer) {
			clearTimeout(this.cheerToastDismissTimer);
		}
		this.cheerToastDismissTimer = setTimeout(() => {
			this.cheerToastDismissTimer = null;
			if (this.cheerToast === popup) this.hideCheerToast();
		}, BLINK_RATE_COACH_DISMISS_MS);
	}

	hideCheerToast(): void {
		if (this.cheerToastDismissTimer) {
			clearTimeout(this.cheerToastDismissTimer);
			this.cheerToastDismissTimer = null;
		}
		this.closeWindow("cheerToast");
	}

	/** Desk session recap overlay on qualified stop / idle auto-stop. */
	showSessionRecap(payload: SessionRecapOverlayPayload): void {
		if (this.recapToast && !this.recapToast.isDestroyed()) {
			this.hideSessionRecap();
		}
		const cardSize = { width: 400, height: 160 };
		const winSize = popupWindowSize(cardSize);
		const { x, y } = getTopCenterPopupPosition(winSize.width);
		const popup = createPanelWindow(
			{
				width: winSize.width,
				height: winSize.height,
				x,
				y,
				focusable: false,
			},
			this.paths.preload,
		);
		this.recapToast = popup;
		void popup.loadFile(path.join(this.paths.publicDir, "recap.html"));
		popup.webContents.on("did-finish-load", () => {
			this.sendI18n(popup);
			void popup.webContents.executeJavaScript(
				`(() => {
					const title = document.getElementById("recap-title");
					const session = document.getElementById("recap-session");
					const today = document.getElementById("recap-today");
					const streak = document.getElementById("recap-streak");
					const lines = ${JSON.stringify(payload.sessionLines)};
					if (title) title.textContent = ${JSON.stringify(payload.title)};
					if (session) {
						session.replaceChildren();
						for (const line of lines) {
							const row = document.createElement("div");
							row.textContent = line;
							session.appendChild(row);
						}
					}
					if (today) today.textContent = ${JSON.stringify(payload.todaySubtitle)};
					if (streak) {
						const streakLine = ${JSON.stringify(payload.streakLine ?? "")};
						if (streakLine) {
							streak.hidden = false;
							streak.textContent = streakLine;
						} else {
							streak.hidden = true;
							streak.textContent = "";
						}
					}
				})();`,
			);
			popup.setIgnoreMouseEvents(true);
		});
		popup.once("ready-to-show", () => popup.showInactive());
		popup.on("closed", () => {
			if (this.recapToast === popup) this.recapToast = null;
			if (this.recapDismissTimer) {
				clearTimeout(this.recapDismissTimer);
				this.recapDismissTimer = null;
			}
		});
		if (this.recapDismissTimer) {
			clearTimeout(this.recapDismissTimer);
		}
		this.recapDismissTimer = setTimeout(() => {
			this.recapDismissTimer = null;
			if (this.recapToast === popup) this.hideSessionRecap();
		}, RECAP_OVERLAY_DISMISS_MS);
	}

	hideSessionRecap(): void {
		if (this.recapDismissTimer) {
			clearTimeout(this.recapDismissTimer);
			this.recapDismissTimer = null;
		}
		this.closeWindow("recapToast");
	}

	showExercise(prompt: string, onClosed: () => void): BrowserWindow | null {
		if (this.exercise && !this.exercise.isDestroyed()) return null;
		const interactive = !this.preferences.blinkPopupClickThrough;
		const cardSize = { width: 340, height: 200 };
		const winSize = popupWindowSize(cardSize);
		const { x, y } = getLeftBiasedPopupPosition(winSize.width, winSize.height);
		const popup = createPanelWindow({
			width: winSize.width,
			height: winSize.height,
			x,
			y,
			focusable: interactive,
		}, this.paths.preload);
		this.exercise = popup;
		void popup.loadFile(path.join(this.paths.publicDir, "exercise.html"));
		popup.webContents.on("did-finish-load", () => {
			this.sendI18n(popup);
			popup.webContents.send(
				IPC_CHANNELS.updateColors,
				this.popupAppearancePayload(),
			);
			popup.webContents.send(IPC_CHANNELS.updateExercisePrompt, prompt);
			this.sendClickThrough(popup);
			if (!interactive) {
				popup.setIgnoreMouseEvents(true);
			}
		});
		this.presentPanel(popup, interactive);
		popup.on("closed", () => {
			if (this.exercise === popup) this.exercise = null;
			onClosed();
		});
		return popup;
	}

	closeExercise(): void {
		this.closeWindow("exercise");
	}

	closeExerciseIfCurrent(token: unknown): boolean {
		if (this.exercise !== token) return false;
		this.closeExercise();
		return true;
	}

	/** Dev/settings preview: show overlays without tracking / camera gates. */
	previewDebugOverlay(kind: DebugOverlayKind): void {
		switch (kind) {
			case "blink":
			case "starting":
			case "stopped": {
				const popup = this.showReminder(kind, { force: true });
				if (!popup) return;
				// starting/stopped auto-close inside showReminder; blink stays up.
				return;
			}
			case "ambient": {
				this.showAmbient({ force: true });
				this.scheduleAmbientPreviewDismiss();
				return;
			}
			case "noFace": {
				this.showNoFace({ force: true });
				setTimeout(() => this.hideNoFace(), DEBUG_PREVIEW_SHORT_DISMISS_MS);
				return;
			}
			case "exercise": {
				this.closeExercise();
				const locale =
					this.preferences.locale === "uk" ? "uk" : "en";
				const prompts = resolveExercisePrompts(
					sanitizeExercisePrompts(
						this.preferences.exercisePrompts,
						locale,
					),
					locale,
				);
				const popup = this.showExercise(
					prompts[0] ?? "Look far away",
					() => {},
				);
				if (popup) {
					setTimeout(
						() => this.closeExerciseIfCurrent(popup),
						EXERCISE_POPUP_VISIBLE_MS,
					);
				}
				return;
			}
			case "lookAway": {
				this.closeLookAway();
				const popup = this.showLookAway(() => {});
				if (popup) {
					const durationMs =
						Math.max(1, this.preferences.lookAwayDuration) * 1000;
					setTimeout(
						() => this.closeLookAwayIfCurrent(popup),
						durationMs,
					);
				}
				return;
			}
			case "recap": {
				const locale =
					this.preferences.locale === "uk" ? "uk" : "en";
				this.showSessionRecap(
					buildOverlayPayload(
						{
							blinks: 1240,
							trackingMs: 6_120_000,
							lookAwayCompleted: 8,
							exerciseCompleted: 3,
							eyeCareCompleted: 11,
						},
						{
							date: "2026-08-30",
							blinks: 1240,
							trackingMs: 15_120_000,
							sessions: 2,
							lookAwayCompleted: 8,
							lookAwaySkipped: 0,
							lookAwaySnoozed: 0,
							exerciseCompleted: 3,
							exerciseSkipped: 0,
							exerciseSnoozed: 0,
						},
						{ current: 3, shieldCharges: 0 },
						locale,
					),
				);
				return;
			}
			default: {
				const _exhaustive: never = kind;
				return _exhaustive;
			}
		}
	}

	showLookAway(onClosed: () => void): BrowserWindow | null {
		if (this.lookAway && !this.lookAway.isDestroyed()) return null;
		const interactive = !this.preferences.blinkPopupClickThrough;
		const cardSize = { width: 340, height: 220 };
		const winSize = popupWindowSize(cardSize);
		const { x, y } = getRightBiasedPopupPosition(winSize.width, winSize.height);
		const popup = createPanelWindow({
			width: winSize.width,
			height: winSize.height,
			x,
			y,
			focusable: interactive,
		}, this.paths.preload);
		this.lookAway = popup;
		void popup.loadFile(path.join(this.paths.publicDir, "look-away.html"), {
			query: {
				duration: String(Math.max(1, this.preferences.lookAwayDuration)),
			},
		});
		popup.webContents.on("did-finish-load", () => {
			this.sendI18n(popup);
			popup.webContents.send(
				IPC_CHANNELS.updateColors,
				this.popupAppearancePayload(),
			);
			const locale =
				this.preferences.locale === "uk" ? "uk" : "en";
			popup.webContents.send(IPC_CHANNELS.updateLookAwayCopy, {
				title: resolveLookAwayTitle(
					sanitizeLookAwayTitle(this.preferences.lookAwayTitle, locale),
					locale,
				),
				hint: resolveLookAwayHint(
					sanitizeLookAwayHint(this.preferences.lookAwayHint, locale),
					locale,
				),
			});
			this.sendClickThrough(popup);
			if (!interactive) {
				popup.setIgnoreMouseEvents(true);
			}
		});
		this.presentPanel(popup, interactive);
		popup.on("closed", () => {
			if (this.lookAway === popup) this.lookAway = null;
			onClosed();
		});
		return popup;
	}

	closeLookAway(): void {
		this.closeWindow("lookAway");
	}

	closeLookAwayIfCurrent(token: unknown): boolean {
		if (this.lookAway !== token) return false;
		this.closeLookAway();
		return true;
	}

	isCameraOpen(): boolean {
		return Boolean(this.camera && !this.camera.isDestroyed());
	}

	showCamera(onClosed: () => void): BrowserWindow {
		if (this.camera && !this.camera.isDestroyed()) {
			this.camera.focus();
			return this.camera;
		}
		const { width, height } = screen.getPrimaryDisplay().workAreaSize;
		const locale = this.preferences.locale === "uk" ? "uk" : "en";
		const window = new BrowserWindow({
			width: Math.min(640, width * 0.8),
			height: Math.min(480, height * 0.8),
			title: t(locale, "window.cameraTitle"),
			icon: path.join(this.paths.root, "assets", "icons", "icon.png"),
			webPreferences: {
				nodeIntegration: false,
				contextIsolation: true,
				preload: this.paths.preload,
			},
		});
		this.camera = window;
		void window.loadFile(path.join(this.paths.publicDir, "camera.html"));
		window.webContents.on("did-finish-load", () => this.sendI18n(window));
		window.on("close", onClosed);
		window.on("closed", () => {
			if (this.camera === window) this.camera = null;
			onClosed();
		});
		return window;
	}

	closeCamera(): void {
		this.closeWindow("camera");
	}

	sendToCamera(channel: string, ...args: unknown[]): void {
		if (this.camera && !this.camera.isDestroyed()) {
			this.camera.webContents.send(channel, ...args);
		}
	}

	showEditor(): BrowserWindow {
		if (this.editor && !this.editor.isDestroyed()) {
			this.editor.focus();
			return this.editor;
		}
		const display = getActiveDisplay();
		const cardSize = this.popupSizeForDisplay(display);
		const cardPosition = this.ensurePopupPosition(display);
		const frame = withPopupWindowChrome(cardSize, cardPosition);
		const window = createPanelWindow({
			width: frame.size.width,
			height: frame.size.height,
			x: frame.position.x,
			y: frame.position.y,
			focusable: true,
			resizable: true,
			minWidth: 200 + POPUP_SHADOW_INSET * 2,
			minHeight: 80 + POPUP_SHADOW_INSET * 2,
		}, this.paths.preload);
		this.editor = window;
		void window.loadFile(path.join(this.paths.publicDir, "popup-editor.html"));
		window.webContents.on("did-finish-load", () => {
			this.sendI18n(window);
			window.webContents.send(
				IPC_CHANNELS.updateColors,
				this.popupAppearancePayload(),
			);
			window.webContents.send(IPC_CHANNELS.currentPopupState, {
				size: cardSize,
				position: cardPosition,
				multiDisplay: screen.getAllDisplays().length > 1,
				hasNextUnsaved: false,
			});
		});
		window.once("ready-to-show", () => window.show());
		window.on("closed", () => {
			if (this.editor === window) this.editor = null;
		});
		return window;
	}

	closeEditor(): void {
		this.closeWindow("editor");
	}

	/**
	 * True when another live display has no saved position (not the one just saved).
	 */
	hasNextUnsavedDisplay(currentDisplayId: string): boolean {
		return (
			nextUnsavedDisplayId(
				screen.getAllDisplays().map((display) => String(display.id)),
				Object.keys(this.preferences.popupPositionsByDisplayId),
				currentDisplayId,
			) !== null
		);
	}

	sendEditorSetupNextState(hasNextUnsaved: boolean): void {
		if (!this.editor || this.editor.isDestroyed()) return;
		const bounds = this.editor.getBounds();
		this.editor.webContents.send(IPC_CHANNELS.currentPopupState, {
			size: popupCardSize({ width: bounds.width, height: bounds.height }),
			position: popupCardPosition({ x: bounds.x, y: bounds.y }),
			multiDisplay: screen.getAllDisplays().length > 1,
			hasNextUnsaved,
		});
	}

	/**
	 * Move the open editor onto the next unsaved display. Does not persist.
	 * Returns whether the window was moved.
	 */
	moveEditorToNextUnsaved(): boolean {
		if (!this.editor || this.editor.isDestroyed()) return false;
		const bounds = this.editor.getBounds();
		const cardSize = popupCardSize({
			width: bounds.width,
			height: bounds.height,
		});
		const cardPosition = popupCardPosition({ x: bounds.x, y: bounds.y });
		const source = getDisplayForPopupRect(
			cardPosition.x,
			cardPosition.y,
			cardSize.width,
			cardSize.height,
		);
		const currentId = String(source.id);
		const live = screen.getAllDisplays();
		const nextId = nextUnsavedDisplayId(
			live.map((display) => String(display.id)),
			Object.keys(this.preferences.popupPositionsByDisplayId),
			currentId,
		);
		const target = live.find((display) => String(display.id) === nextId);
		if (!nextId || !target) {
			this.sendEditorSetupNextState(false);
			return false;
		}
		const layouts = layoutForDisplays(
			cardPosition,
			cardSize,
			source.workArea,
			[{ id: nextId, workArea: target.workArea }],
		);
		const layout = layouts[nextId];
		if (!layout) {
			this.sendEditorSetupNextState(false);
			return false;
		}
		const frame = withPopupWindowChrome(layout.size, layout.position);
		this.editor.setSize(frame.size.width, frame.size.height);
		this.editor.setPosition(frame.position.x, frame.position.y);
		this.editor.webContents.send(IPC_CHANNELS.currentPopupState, {
			size: layout.size,
			position: layout.position,
			multiDisplay: live.length > 1,
			hasNextUnsaved: false,
		});
		return true;
	}

	applyPopupAppearance(): void {
		// Push colors/transparency/glow into CSS (card alpha). Do not use
		// BrowserWindow.setOpacity — it soft-composites glyphs on Windows GPUs.
		const payload = this.popupAppearancePayload();
		for (const window of [
			this.reminder,
			this.editor,
			this.ambient,
			this.exercise,
			this.lookAway,
			...this.ambientChrome,
		]) {
			if (window && !window.isDestroyed()) {
				window.webContents.send(IPC_CHANNELS.updateColors, payload);
			}
		}
	}

	private popupAppearancePayload() {
		return buildPopupAppearancePayload(
			this.preferences.popupColors,
			this.preferences.popupGlowPreset ?? null,
		);
	}

	/**
	 * Clamp a candidate top-left to the target display's workArea.
	 * Visual only — does not persist (Save / commitPlacement write maps).
	 */
	clampPopupPosition(
		candidate: Point | null,
		size?: Size,
		targetDisplay?: Display,
	): Point {
		const popupSize = size ?? this.preferences.popupSize;
		const display = targetDisplay ?? this.displayForCandidate(candidate, popupSize);
		const { position } = resolvePopupPositionForDisplay(
			candidate,
			popupSize,
			display.workArea,
		);
		return position;
	}

	savePopupPlacement(position: Point, displayId: string): void {
		this.commitPlacement(position, displayId);
	}

	saveEditorGeometry(size: Size, candidate: Point): string {
		const display = this.displayForCandidate(candidate, size);
		const fitted = clampPopupSizeToWorkArea(size, display.workArea);
		const position = this.clampPopupPosition(candidate, fitted, display);
		const displayId = String(display.id);
		this.commitPlacement(position, displayId, fitted);
		this.applyPopupGeometry(fitted, position);
		return displayId;
	}

	saveEditorGeometryAll(size: Size, candidate: Point): Point {
		const source = this.displayForCandidate(candidate, size);
		const displays = screen.getAllDisplays().map((display) => ({
			id: String(display.id),
			workArea: display.workArea,
		}));
		const layouts = layoutForDisplays(
			candidate,
			size,
			source.workArea,
			displays,
		);
		const positions = { ...this.preferences.popupPositionsByDisplayId };
		const sizes = { ...this.preferences.popupSizesByDisplayId };
		const workAreaById = new Map(
			displays.map((display) => [display.id, display.workArea]),
		);
		for (const [id, layout] of Object.entries(layouts)) {
			const workArea = workAreaById.get(id);
			positions[id] = workArea
				? toWorkAreaRelativePosition(layout.position, workArea)
				: layout.position;
			sizes[id] = layout.size;
		}
		const self = layouts[String(source.id)];
		const nextPosition = self?.position ?? candidate;
		const nextSize = self?.size ?? size;
		const liveIds = displays.map((display) => display.id);
		this.persistPopupPlacement?.({
			map: capPopupPositionsByDisplayId(positions, liveIds),
			sizes: capPopupSizesByDisplayId(sizes, liveIds),
			position: nextPosition,
			size: nextSize,
		});
		return this.applyPopupGeometry(nextSize, nextPosition);
	}

	getPrimaryDisplayId(): string {
		return String(screen.getPrimaryDisplay().id);
	}

	getPopupPositionSeedDisplayId(legacyPoint: Point | null): string {
		const fallbackId = this.getPrimaryDisplayId();
		if (!legacyPoint) return fallbackId;
		return getDisplayIdContainingPoint(
			legacyPoint,
			screen.getAllDisplays(),
			fallbackId,
		);
	}

	applyPopupGeometry(size: Size, position: Point): Point {
		const resolved = this.clampPopupPosition(position, size);
		const frame = withPopupWindowChrome(size, resolved);
		if (this.reminder && !this.reminder.isDestroyed()) {
			this.reminder.setSize(frame.size.width, frame.size.height);
			this.reminder.setPosition(frame.position.x, frame.position.y);
		}
		return resolved;
	}

	/**
	 * Revalidate reminder/editor independently after hot-plug / metrics changes.
	 * Moves windows on-screen only — does not rewrite per-display maps (so a
	 * powered-off / Win+P display keeps its saved position and size).
	 * Exercise / look-away stay ephemeral left/right bias on the active display.
	 */
	recoverOpenPopupPositions(): void {
		this.migrateLegacyPopupPositions();
		this.recoverTrackedPopup(this.reminder);
		this.recoverTrackedPopup(this.editor);

		if (this.exercise && !this.exercise.isDestroyed()) {
			const cardSize = { width: 340, height: 200 };
			const winSize = popupWindowSize(cardSize);
			const next = getLeftBiasedPopupPosition(winSize.width, winSize.height);
			this.setWindowPositionIfOpen(this.exercise, next);
		}
		if (this.lookAway && !this.lookAway.isDestroyed()) {
			const cardSize = { width: 340, height: 220 };
			const winSize = popupWindowSize(cardSize);
			const next = getRightBiasedPopupPosition(winSize.width, winSize.height);
			this.setWindowPositionIfOpen(this.lookAway, next);
		}
		this.repositionAmbient();
	}

	registerDisplayListeners(): void {
		screen.on("display-removed", this.onDisplayLayoutChanged);
		screen.on("display-metrics-changed", this.onDisplayLayoutChanged);
	}

	disposeDisplayListeners(): void {
		screen.removeListener("display-removed", this.onDisplayLayoutChanged);
		screen.removeListener(
			"display-metrics-changed",
			this.onDisplayLayoutChanged,
		);
		if (this.displayRecoverTimer) {
			clearTimeout(this.displayRecoverTimer);
			this.displayRecoverTimer = null;
		}
	}

	destroyAll(): void {
		this.clearAmbientPreviewDismissTimer();
		this.disposeDisplayListeners();
		for (const window of BrowserWindow.getAllWindows()) {
			if (!window.isDestroyed()) window.destroy();
		}
		this.main = null;
		this.reminder = null;
		this.exercise = null;
		this.lookAway = null;
		this.camera = null;
		this.editor = null;
		this.noFace = null;
		this.ambient = null;
		this.ambientChrome = [];
		this.calibrationNudge = null;
		this.cheerToast = null;
		this.recapToast = null;
	}

	private scheduleDisplayRecovery(): void {
		if (this.displayRecoverTimer) {
			clearTimeout(this.displayRecoverTimer);
		}
		this.displayRecoverTimer = setTimeout(() => {
			this.displayRecoverTimer = null;
			this.recoverOpenPopupPositions();
		}, DISPLAY_RECOVER_DEBOUNCE_MS);
	}

	private createAmbientOverlay(bounds: {
		x: number;
		y: number;
		width: number;
		height: number;
	}): BrowserWindow {
		const popup = createPanelWindow(
			{
				width: bounds.width,
				height: bounds.height,
				x: bounds.x,
				y: bounds.y,
				focusable: false,
				coverSystemChrome: true,
			},
			this.paths.preload,
		);
		void popup.loadFile(path.join(this.paths.publicDir, "ambient.html"));
		popup.webContents.on("did-finish-load", () => {
			this.sendI18n(popup);
			popup.webContents.send(
				IPC_CHANNELS.updateColors,
				this.popupAppearancePayload(),
			);
			popup.setIgnoreMouseEvents(true);
			pinPanelAboveSystemChrome(popup, bounds);
		});
		popup.once("ready-to-show", () => {
			if (popup.isDestroyed()) return;
			pinPanelAboveSystemChrome(popup, bounds);
			popup.showInactive();
			pinPanelAboveSystemChrome(popup, bounds);
			this.raiseReminderAboveAmbient();
		});
		return popup;
	}

	private scheduleAmbientPreviewDismiss(): void {
		this.clearAmbientPreviewDismissTimer();
		const popup = this.ambient;
		this.ambientPreviewDismissTimer = setTimeout(() => {
			this.ambientPreviewDismissTimer = null;
			if (this.ambient === popup) this.hideAmbient();
		}, DEBUG_PREVIEW_SHORT_DISMISS_MS);
	}

	private clearAmbientPreviewDismissTimer(): void {
		if (this.ambientPreviewDismissTimer) {
			clearTimeout(this.ambientPreviewDismissTimer);
			this.ambientPreviewDismissTimer = null;
		}
	}

	private closeAmbientChromeOverlays(): void {
		for (const overlay of this.ambientChrome) {
			if (!overlay.isDestroyed()) overlay.close();
		}
		this.ambientChrome = [];
	}

	private syncAmbientChromeOverlays(): void {
		const display = getActiveDisplay();
		const rects = systemChromeRects(display.bounds, display.workArea);
		this.closeAmbientChromeOverlays();
		this.ambientChrome = rects.map((rect) => {
			const overlay = this.createAmbientOverlay(rect);
			overlay.on("closed", () => {
				this.ambientChrome = this.ambientChrome.filter(
					(open) => open !== overlay,
				);
			});
			return overlay;
		});
	}

	private raiseReminderAboveAmbient(): void {
		if (this.reminder && !this.reminder.isDestroyed()) {
			this.reminder.moveTop();
		}
	}

	private repositionAmbient(): void {
		if (!this.ambient || this.ambient.isDestroyed()) return;
		const display = getActiveDisplay();
		const desktop = ambientDesktopBounds(display.bounds, display.workArea);
		pinPanelAboveSystemChrome(this.ambient, desktop);
		this.syncAmbientChromeOverlays();
		this.raiseReminderAboveAmbient();
	}

	private setWindowPositionIfOpen(
		window: BrowserWindow | null,
		position: Point,
	): void {
		if (!window || window.isDestroyed()) return;
		const [x, y] = window.getPosition();
		if (x === position.x && y === position.y) return;
		window.setPosition(position.x, position.y);
	}

	private sendClickThrough(popup: BrowserWindow): void {
		popup.webContents.send(
			IPC_CHANNELS.blinkClickThrough,
			this.preferences.blinkPopupClickThrough,
		);
	}

	private presentPanel(popup: BrowserWindow, interactive: boolean): void {
		popup.once("ready-to-show", () => {
			if (popup.isDestroyed()) return;
			if (interactive) {
				popup.show();
				popup.focus();
			} else {
				popup.showInactive();
			}
			// Stay above ambient glow when both are visible.
			popup.moveTop();
		});
	}

	private ensurePopupPosition(targetDisplay?: Display): Point {
		this.migrateLegacyPopupPositions();
		const display = targetDisplay ?? getActiveDisplay();
		const displayId = String(display.id);
		const saved =
			this.preferences.popupPositionsByDisplayId[displayId] ?? null;
		const popupSize = this.popupSizeForDisplay(display);
		const { position } = resolvePopupPositionForDisplay(
			saved,
			popupSize,
			display.workArea,
		);
		return position;
	}

	migrateLegacyPopupPositions(): void {
		const seedId = this.getPopupPositionSeedDisplayId(
			this.preferences.popupPosition,
		);
		const seeded = seedPopupPositionsFromLegacy(
			this.preferences.popupPositionsByDisplayId,
			this.preferences.popupPosition,
			seedId,
		);
		const next = migratePopupPositionsToWorkAreaRelative(
			seeded,
			screen.getAllDisplays().map((display) => ({
				id: String(display.id),
				workArea: display.workArea,
			})),
		);
		if (
			!samePopupPositionsByDisplayId(
				next,
				this.preferences.popupPositionsByDisplayId,
			)
		) {
			this.persistPopupPlacement?.({ map: next });
		}
		this.migrateLegacyPopupSizes();
	}

	private migrateLegacyPopupSizes(): void {
		const next = seedPopupSizesFromPositionIds(
			this.preferences.popupSizesByDisplayId,
			Object.keys(this.preferences.popupPositionsByDisplayId),
			this.preferences.popupSize,
		);
		if (
			samePopupSizesByDisplayId(
				next,
				this.preferences.popupSizesByDisplayId,
			)
		) {
			return;
		}
		this.persistPopupPlacement?.({
			map: this.preferences.popupPositionsByDisplayId,
			sizes: next,
		});
	}

	private recoverTrackedPopup(window: BrowserWindow | null): void {
		if (!window || window.isDestroyed()) return;
		const bounds = window.getBounds();
		const cardSize = popupCardSize({
			width: bounds.width,
			height: bounds.height,
		});
		const cardPosition = popupCardPosition({ x: bounds.x, y: bounds.y });
		const display = getDisplayForPopupRect(
			cardPosition.x,
			cardPosition.y,
			cardSize.width,
			cardSize.height,
		);
		const saved =
			this.preferences.popupPositionsByDisplayId[String(display.id)] ??
			null;
		const { position, recovered } = resolveOpenWindowPosition(
			cardPosition,
			saved,
			display.workArea,
			cardSize,
		);
		const fittedCard = clampPopupSizeToWorkArea(cardSize, display.workArea);
		const frame = withPopupWindowChrome(fittedCard, position);
		const sizeChanged =
			fittedCard.width !== cardSize.width ||
			fittedCard.height !== cardSize.height;
		if (!recovered && !sizeChanged) return;
		if (recovered) {
			this.setWindowPositionIfOpen(window, frame.position);
		}
		if (sizeChanged) {
			window.setSize(frame.size.width, frame.size.height);
		}
	}

	private displayForCandidate(candidate: Point | null, size: Size): Display {
		if (!candidate) return getActiveDisplay();
		return getDisplayForPopupRect(
			candidate.x,
			candidate.y,
			size.width,
			size.height,
		);
	}

	private popupSizeForDisplay(display: Display): Size {
		const saved =
			this.preferences.popupSizesByDisplayId[String(display.id)] ?? null;
		return resolvePopupSizeForDisplay(
			saved,
			this.preferences.popupSize,
			display.workArea,
		);
	}

	private commitPlacement(
		position: Point,
		displayId: string,
		size?: Size,
	): void {
		const liveIds = screen.getAllDisplays().map((display) => String(display.id));
		this.persistPopupPlacement?.({
			map: capPopupPositionsByDisplayId(
				{
					...this.preferences.popupPositionsByDisplayId,
					[displayId]: this.toStoredPopupPosition(position, displayId),
				},
				liveIds,
			),
			sizes: size
				? capPopupSizesByDisplayId(
						{
							...this.preferences.popupSizesByDisplayId,
							[displayId]: size,
						},
						liveIds,
					)
				: undefined,
			position,
			size,
		});
	}

	private toStoredPopupPosition(position: Point, displayId: string): Point {
		const display = screen
			.getAllDisplays()
			.find((entry) => String(entry.id) === displayId);
		if (!display) return position;
		return toWorkAreaRelativePosition(position, display.workArea);
	}

	private closeWindow(
		key:
			| "reminder"
			| "exercise"
			| "lookAway"
			| "camera"
			| "editor"
			| "noFace"
			| "ambient"
			| "calibrationNudge"
			| "cheerToast"
			| "recapToast",
	): void {
		const window = this[key];
		if (window && !window.isDestroyed()) window.close();
		this[key] = null;
	}
}
