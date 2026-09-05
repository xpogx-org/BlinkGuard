import { describe, expect, it } from "vitest";
import {
	computeTrayMenuBounds,
	TRAY_MENU_GAP,
	TRAY_MENU_SHADOW_INSET,
	trayMenuContentBottom,
	trayMenuContentTop,
} from "../../../electron/infrastructure/tray/tray-menu-bounds";

const workArea = { x: 0, y: 0, width: 1920, height: 1040 };

describe("computeTrayMenuBounds", () => {
	it("anchors the card above a bottom-tray icon with a tight gap", () => {
		const trayBounds = { x: 1800, y: 1010, width: 24, height: 24 };
		const bounds = computeTrayMenuBounds({
			trayBounds,
			menuWidth: 260,
			menuHeight: 320,
			workArea,
		});
		expect(trayMenuContentBottom(bounds)).toBe(trayBounds.y - TRAY_MENU_GAP);
		expect(bounds.x).toBeGreaterThanOrEqual(4);
	});

	it("anchors the card below a top-tray icon when there is room", () => {
		const trayBounds = { x: 1800, y: 40, width: 24, height: 24 };
		const bounds = computeTrayMenuBounds({
			trayBounds,
			menuWidth: 260,
			menuHeight: 320,
			workArea,
		});
		expect(trayMenuContentTop(bounds)).toBe(
			trayBounds.y + trayBounds.height + TRAY_MENU_GAP,
		);
	});

	it("reserves transparent inset around the card for box-shadow", () => {
		const trayBounds = { x: 1800, y: 1010, width: 24, height: 24 };
		const bounds = computeTrayMenuBounds({
			trayBounds,
			menuWidth: 260,
			menuHeight: 320,
			workArea,
		});
		expect(bounds.width).toBe(260);
		expect(bounds.height).toBe(320);
		expect(trayMenuContentBottom(bounds) - trayMenuContentTop(bounds)).toBe(
			320 - TRAY_MENU_SHADOW_INSET * 2,
		);
	});

	it("flips when the preferred side would overflow", () => {
		const trayBounds = { x: 1800, y: 1010, width: 24, height: 24 };
		const bounds = computeTrayMenuBounds({
			trayBounds,
			menuWidth: 260,
			menuHeight: 900,
			workArea,
		});
		expect(bounds.y).toBeGreaterThanOrEqual(4);
		expect(bounds.y + bounds.height).toBeLessThanOrEqual(
			1036 + TRAY_MENU_SHADOW_INSET,
		);
	});

	it("clamps horizontally inside the work area with margin", () => {
		const trayBounds = { x: 0, y: 1010, width: 24, height: 24 };
		const bounds = computeTrayMenuBounds({
			trayBounds,
			menuWidth: 260,
			menuHeight: 200,
			workArea,
		});
		expect(bounds.x).toBeGreaterThanOrEqual(4);
		expect(bounds.x + bounds.width).toBeLessThanOrEqual(1916);
	});
});
