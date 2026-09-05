import {
	BrowserWindow,
	ipcMain,
	screen,
	type Point,
	type Rectangle,
	type Tray,
} from "electron";
import path from "node:path";
import { IPC_CHANNELS } from "../../../shared/ipc-channels";
import {
	sanitizeTrayMenuActionPayload,
	sanitizeTrayMenuSizePayload,
	TRAY_MENU_SHADOW_INSET,
	type TrayMenuActionPayload,
	type TrayMenuRenderPayload,
	type TrayMenuSizePayload,
} from "../../../shared/tray-menu";
import type { AppPaths } from "../paths/app-paths";
import {
	createPanelWindow,
	pinPanelAboveSystemChrome,
} from "../windows/panel-window";
import { computeTrayMenuBounds } from "./tray-menu-bounds";

/** Room to lay out menu off-screen before the single reveal at tray. */
const MEASURE_BOUNDS = { x: -24000, y: -24000, width: 360, height: 900 };
const FALLBACK_MENU_SIZE: TrayMenuSizePayload = {
	width: 280 + TRAY_MENU_SHADOW_INSET * 2,
	height: 420 + TRAY_MENU_SHADOW_INSET * 2,
	inset: TRAY_MENU_SHADOW_INSET,
};

export class TrayMenuWindow {
	private window: BrowserWindow | null = null;
	private pendingPayload: TrayMenuRenderPayload | null = null;
	private trayBounds: Rectangle | null = null;
	private cursorPoint: Point | undefined;
	private menuSize: TrayMenuSizePayload | null = null;
	private awaitingReveal = false;
	private shownAtMs = 0;
	private revealFallbackTimer: ReturnType<typeof setTimeout> | null = null;
	private blurHideTimer: ReturnType<typeof setTimeout> | null = null;
	private boundsApplyTimer: ReturnType<typeof setImmediate> | null = null;
	private readonly ipcDisposers: Array<() => void> = [];

	constructor(
		private readonly paths: AppPaths,
		private readonly onAction: (payload: TrayMenuActionPayload) => void,
	) {
		this.registerIpc();
	}

	show(tray: Tray, payload: TrayMenuRenderPayload, cursor?: Point): void {
		this.trayBounds = tray.getBounds();
		this.cursorPoint = cursor;
		this.pendingPayload = payload;
		const win = this.ensureWindow();
		if (win.isVisible() && !this.awaitingReveal) {
			this.pushRenderWhenReady(win, payload);
			return;
		}
		this.awaitingReveal = true;
		this.menuSize = null;
		win.setBounds(MEASURE_BOUNDS);
		if (!win.isVisible()) {
			win.showInactive();
		}
		this.pushRenderWhenReady(win, payload);
		this.scheduleRevealFallback(win);
	}

	update(payload: TrayMenuRenderPayload): void {
		this.pendingPayload = payload;
		if (!this.window || this.window.isDestroyed() || !this.window.isVisible()) {
			return;
		}
		if (this.awaitingReveal) return;
		this.pushRender(payload);
	}

	hide(): void {
		this.awaitingReveal = false;
		this.clearRevealFallback();
		this.clearBlurTimer();
		if (!this.window || this.window.isDestroyed()) return;
		this.window.hide();
	}

	isVisible(): boolean {
		return Boolean(
			this.window &&
				!this.window.isDestroyed() &&
				this.window.isVisible() &&
				!this.awaitingReveal,
		);
	}

	destroy(): void {
		this.awaitingReveal = false;
		this.clearRevealFallback();
		this.clearBlurTimer();
		this.clearBoundsApplyTimer();
		for (const dispose of this.ipcDisposers) dispose();
		this.ipcDisposers.length = 0;
		if (this.window && !this.window.isDestroyed()) {
			this.window.destroy();
		}
		this.window = null;
	}

	private registerIpc(): void {
		const readyHandler = (event: Electron.IpcMainEvent) => {
			if (!this.isSenderWindow(event.sender)) return;
			if (this.pendingPayload) {
				this.pushRenderTo(event.sender, this.pendingPayload);
			}
		};
		ipcMain.on(IPC_CHANNELS.trayMenuReady, readyHandler);
		this.ipcDisposers.push(() =>
			ipcMain.removeListener(IPC_CHANNELS.trayMenuReady, readyHandler),
		);

		const sizeHandler = (event: Electron.IpcMainEvent, raw: unknown) => {
			if (!this.isSenderWindow(event.sender)) return;
			const size = sanitizeTrayMenuSizePayload(raw);
			if (!size) return;
			if (!this.window || this.window.isDestroyed()) return;

			const unchanged =
				this.menuSize?.width === size.width &&
				this.menuSize?.height === size.height;
			this.menuSize = size;

			if (this.awaitingReveal) {
				this.revealAtTray(this.window);
				return;
			}

			if (unchanged || !this.window.isVisible()) return;
			this.scheduleApplyBounds(this.window);
		};
		ipcMain.on(IPC_CHANNELS.trayMenuSize, sizeHandler);
		this.ipcDisposers.push(() =>
			ipcMain.removeListener(IPC_CHANNELS.trayMenuSize, sizeHandler),
		);

		const hideHandler = (event: Electron.IpcMainEvent) => {
			if (!this.isSenderWindow(event.sender)) return;
			this.hide();
		};
		ipcMain.on(IPC_CHANNELS.trayMenuHide, hideHandler);
		this.ipcDisposers.push(() =>
			ipcMain.removeListener(IPC_CHANNELS.trayMenuHide, hideHandler),
		);

		ipcMain.handle(IPC_CHANNELS.trayMenuAction, (event, raw: unknown) => {
			if (!this.isSenderWindow(event.sender)) return;
			const payload = sanitizeTrayMenuActionPayload(raw);
			if (!payload) return;
			this.onAction(payload);
			this.hide();
		});
		this.ipcDisposers.push(() =>
			ipcMain.removeHandler(IPC_CHANNELS.trayMenuAction),
		);
	}

	private ensureWindow(): BrowserWindow {
		if (this.window && !this.window.isDestroyed()) {
			return this.window;
		}
		const win = createPanelWindow(
			{
				width: MEASURE_BOUNDS.width,
				height: MEASURE_BOUNDS.height,
				x: MEASURE_BOUNDS.x,
				y: MEASURE_BOUNDS.y,
				focusable: true,
			},
			this.paths.preload,
		);
		win.on("blur", () => {
			if (Date.now() - this.shownAtMs < 250) return;
			this.clearBlurTimer();
			this.blurHideTimer = setTimeout(() => {
				this.blurHideTimer = null;
				if (win.isDestroyed() || !win.isVisible()) return;
				if (win.isFocused()) return;
				this.hide();
			}, 120);
		});
		win.on("closed", () => {
			if (this.window === win) this.window = null;
		});
		void win.loadFile(path.join(this.paths.publicDir, "tray-menu.html"));
		this.window = win;
		return win;
	}

	private pushRenderWhenReady(
		win: BrowserWindow,
		payload: TrayMenuRenderPayload,
	): void {
		const send = () => this.pushRender(payload);
		if (win.webContents.isLoading()) {
			win.webContents.once("did-finish-load", send);
			return;
		}
		send();
	}

	private revealAtTray(win: BrowserWindow): void {
		this.clearRevealFallback();
		this.awaitingReveal = false;
		if (!this.menuSize) {
			this.menuSize = FALLBACK_MENU_SIZE;
		}
		this.applyBounds(win);
		this.shownAtMs = Date.now();
		win.show();
		this.pushReveal(win);
		win.focus();
	}

	private pushReveal(win: BrowserWindow): void {
		if (win.isDestroyed() || win.webContents.isDestroyed()) return;
		win.webContents.send(IPC_CHANNELS.trayMenuReveal);
	}

	private applyBounds(win: BrowserWindow): void {
		if (!this.menuSize) return;
		const trayBounds = this.resolveTrayBounds(this.cursorPoint);
		const anchor = this.cursorPoint ?? {
			x: trayBounds.x + trayBounds.width / 2,
			y: trayBounds.y + trayBounds.height / 2,
		};
		const display = screen.getDisplayNearestPoint(anchor);
		const bounds = computeTrayMenuBounds({
			trayBounds,
			menuWidth: this.menuSize.width,
			menuHeight: this.menuSize.height,
			workArea: display.workArea,
			shadowInset: this.menuSize.inset ?? TRAY_MENU_SHADOW_INSET,
		});
		win.setBounds(bounds);
		pinPanelAboveSystemChrome(win, bounds, true);
	}

	/** Coalesce rapid resize ticks during submenu animation (reduces Windows flicker). */
	private scheduleApplyBounds(win: BrowserWindow): void {
		if (this.boundsApplyTimer) return;
		this.boundsApplyTimer = setImmediate(() => {
			this.boundsApplyTimer = null;
			if (win.isDestroyed() || !win.isVisible()) return;
			this.applyBounds(win);
		});
	}

	private scheduleRevealFallback(win: BrowserWindow): void {
		this.clearRevealFallback();
		this.revealFallbackTimer = setTimeout(() => {
			this.revealFallbackTimer = null;
			if (!this.awaitingReveal || win.isDestroyed()) return;
			this.revealAtTray(win);
		}, 400);
	}

	private clearRevealFallback(): void {
		if (!this.revealFallbackTimer) return;
		clearTimeout(this.revealFallbackTimer);
		this.revealFallbackTimer = null;
	}

	private resolveTrayBounds(cursor?: Point): Rectangle {
		const trayBounds = this.trayBounds;
		if (trayBounds && trayBounds.width > 0 && trayBounds.height > 0) {
			return trayBounds;
		}
		const point = cursor ?? screen.getCursorScreenPoint();
		return {
			x: point.x,
			y: point.y,
			width: 24,
			height: 24,
		};
	}

	private pushRender(payload: TrayMenuRenderPayload): void {
		if (!this.window || this.window.isDestroyed()) return;
		this.pushRenderTo(this.window.webContents, payload);
	}

	private pushRenderTo(
		webContents: Electron.WebContents,
		payload: TrayMenuRenderPayload,
	): void {
		if (webContents.isDestroyed()) return;
		webContents.send(IPC_CHANNELS.trayMenuRender, payload);
	}

	private isSenderWindow(sender: Electron.WebContents): boolean {
		return Boolean(
			this.window &&
				!this.window.isDestroyed() &&
				sender.id === this.window.webContents.id,
		);
	}

	private clearBlurTimer(): void {
		if (!this.blurHideTimer) return;
		clearTimeout(this.blurHideTimer);
		this.blurHideTimer = null;
	}

	private clearBoundsApplyTimer(): void {
		if (!this.boundsApplyTimer) return;
		clearImmediate(this.boundsApplyTimer);
		this.boundsApplyTimer = null;
	}
}
