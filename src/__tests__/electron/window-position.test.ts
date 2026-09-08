import { beforeEach, describe, expect, it, vi } from "vitest";

const getCursorScreenPoint = vi.fn();
const getDisplayNearestPoint = vi.fn();
const getAllDisplays = vi.fn();

vi.mock("electron", () => ({
	screen: {
		getCursorScreenPoint: (...args: unknown[]) => getCursorScreenPoint(...args),
		getDisplayNearestPoint: (...args: unknown[]) =>
			getDisplayNearestPoint(...args),
		getAllDisplays: (...args: unknown[]) => getAllDisplays(...args),
	},
}));

import {
	ambientDesktopBounds,
	clampPopupSizeToWorkArea,
	fromWorkAreaRelativePosition,
	getActiveDisplay,
	getCenteredPopupPosition,
	getDisplayIdContainingPoint,
	getLeftBiasedPopupPosition,
	getRightBiasedPopupPosition,
	getTopCenterPopupPosition,
	isPointInAnyWorkArea,
	isPointInWorkArea,
	isSystemChromeVisible,
	layoutForDisplays,
	migratePopupPositionsToWorkAreaRelative,
	nextUnsavedDisplayId,
	resolveOpenWindowPosition,
	resolvePopupPosition,
	resolvePopupPositionForDisplay,
	resolvePopupSizeForDisplay,
	resolveVisiblePopupPosition,
	systemChromeRects,
	toWorkAreaRelativePosition,
} from "../../../electron/infrastructure/windows/window-position";
import { POPUP_SHADOW_INSET } from "../../../shared/popup-window-chrome";

const primaryWorkArea = {
	x: 0,
	y: 0,
	width: 1920,
	height: 1080,
};

const secondaryWorkArea = {
	x: 1920,
	y: 100,
	width: 1600,
	height: 900,
};

describe("window-position", () => {
	beforeEach(() => {
		getCursorScreenPoint.mockReset();
		getDisplayNearestPoint.mockReset();
		getAllDisplays.mockReset();
		getCursorScreenPoint.mockReturnValue({ x: 2500, y: 400 });
		getDisplayNearestPoint.mockReturnValue({
			workArea: secondaryWorkArea,
			workAreaSize: {
				width: secondaryWorkArea.width,
				height: secondaryWorkArea.height,
			},
		});
		getAllDisplays.mockReturnValue([
			{ workArea: primaryWorkArea },
			{ workArea: secondaryWorkArea },
		]);
	});

	describe("isSystemChromeVisible", () => {
		const bounds = { x: 0, y: 0, width: 1920, height: 1080 };

		it("is true when a bottom taskbar shrinks workArea", () => {
			expect(
				isSystemChromeVisible(bounds, {
					x: 0,
					y: 0,
					width: 1920,
					height: 1040,
				}),
			).toBe(true);
		});

		it("is true when a top menu bar or left dock insets workArea", () => {
			expect(
				isSystemChromeVisible(bounds, {
					x: 0,
					y: 25,
					width: 1920,
					height: 1055,
				}),
			).toBe(true);
			expect(
				isSystemChromeVisible(bounds, {
					x: 48,
					y: 0,
					width: 1872,
					height: 1080,
				}),
			).toBe(true);
		});

		it("is false when workArea matches bounds (hidden / auto-hide chrome)", () => {
			expect(isSystemChromeVisible(bounds, bounds)).toBe(false);
		});
	});

	describe("ambientDesktopBounds / systemChromeRects", () => {
		const bounds = { x: 0, y: 0, width: 1920, height: 1080 };

		it("keeps the desktop glow in workArea when a bottom taskbar is visible", () => {
			const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
			expect(ambientDesktopBounds(bounds, workArea)).toEqual(workArea);
			expect(systemChromeRects(bounds, workArea)).toEqual([
				{ x: 0, y: 1040, width: 1920, height: 40 },
			]);
		});

		it("returns full bounds and no chrome strips when chrome is hidden", () => {
			expect(ambientDesktopBounds(bounds, bounds)).toEqual(bounds);
			expect(systemChromeRects(bounds, bounds)).toEqual([]);
		});
	});

	it("resolves the display nearest the cursor", () => {
		const display = getActiveDisplay();

		expect(getCursorScreenPoint).toHaveBeenCalledOnce();
		expect(getDisplayNearestPoint).toHaveBeenCalledWith({ x: 2500, y: 400 });
		expect(display.workArea).toEqual(secondaryWorkArea);
	});

	it("centers a popup on the active display workArea including origin", () => {
		expect(getCenteredPopupPosition(300, 120)).toEqual({
			x: 1920 + Math.floor((1600 - 300) / 2),
			y: 100 + Math.floor((900 - 120) / 2),
		});
	});

	it("places a popup right-of-center on the active display workArea", () => {
		expect(getRightBiasedPopupPosition(300, 120)).toEqual({
			x: 1920 + Math.floor((1600 - 300) * 0.72),
			y: 100 + Math.floor((900 - 120) / 2),
		});
	});

	it("places a popup left-of-center on the active display workArea", () => {
		expect(getLeftBiasedPopupPosition(300, 120)).toEqual({
			x: 1920 + Math.floor((1600 - 300) * 0.28),
			y: 100 + Math.floor((900 - 120) / 2),
		});
	});

	it("places a toast at the top-center of the active display workArea", () => {
		expect(getTopCenterPopupPosition(220)).toEqual({
			x: 1920 + Math.floor((1600 - 220) / 2),
			y: 100 + 4,
		});
	});

	describe("isPointInAnyWorkArea / resolvePopupPosition", () => {
		const fallback = { x: 810, y: 480 };

		it("keeps a point on the primary workArea", () => {
			const saved = { x: 100, y: 200 };
			expect(isPointInAnyWorkArea(saved, [primaryWorkArea])).toBe(true);
			expect(
				resolvePopupPosition(
					saved,
					{ width: 300, height: 120 },
					[primaryWorkArea],
					fallback,
				),
			).toEqual({ position: saved, recovered: false });
		});

		it("keeps a point on the secondary workArea", () => {
			const saved = { x: 2500, y: 400 };
			expect(
				isPointInAnyWorkArea(saved, [primaryWorkArea, secondaryWorkArea]),
			).toBe(true);
			expect(
				resolvePopupPosition(
					saved,
					{ width: 300, height: 120 },
					[primaryWorkArea, secondaryWorkArea],
					fallback,
				),
			).toEqual({ position: saved, recovered: false });
		});

		it("recovers a point on a removed secondary display", () => {
			const saved = { x: 2500, y: 400 };
			expect(isPointInAnyWorkArea(saved, [primaryWorkArea])).toBe(false);
			expect(
				resolvePopupPosition(
					saved,
					{ width: 300, height: 120 },
					[primaryWorkArea],
					fallback,
				),
			).toEqual({ position: fallback, recovered: true });
		});

		it("uses fallback for null saved without marking recovered", () => {
			expect(
				resolvePopupPosition(
					null,
					{ width: 300, height: 120 },
					[primaryWorkArea],
					fallback,
				),
			).toEqual({ position: fallback, recovered: false });
		});

		it("treats the inclusive top-left workArea corner as valid", () => {
			expect(isPointInAnyWorkArea({ x: 0, y: 0 }, [primaryWorkArea])).toBe(
				true,
			);
			expect(
				isPointInAnyWorkArea({ x: 1920, y: 100 }, [secondaryWorkArea]),
			).toBe(true);
		});

		it("treats the exclusive bottom-right edge as off-screen", () => {
			expect(isPointInAnyWorkArea({ x: 1920, y: 0 }, [primaryWorkArea])).toBe(
				false,
			);
			expect(isPointInAnyWorkArea({ x: 0, y: 1080 }, [primaryWorkArea])).toBe(
				false,
			);
		});

		it("resolveVisiblePopupPosition recovers via active-display center", () => {
			getAllDisplays.mockReturnValue([{ workArea: primaryWorkArea }]);
			const result = resolveVisiblePopupPosition(
				{ x: 2500, y: 400 },
				{ width: 300, height: 120 },
			);
			expect(result).toEqual({
				position: getCenteredPopupPosition(300, 120),
				recovered: true,
			});
		});
	});

	describe("resolvePopupPositionForDisplay / resolveOpenWindowPosition", () => {
		const popupSize = { width: 300, height: 120 };
		const primaryCenter = {
			x: Math.floor((1920 - 300) / 2),
			y: Math.floor((1080 - 120) / 2),
		};

		it("keeps a saved point on the target workArea", () => {
			expect(
				resolvePopupPositionForDisplay(
					{ x: 100, y: 200 },
					popupSize,
					primaryWorkArea,
				),
			).toEqual({ position: { x: 100, y: 200 }, recovered: false });
		});

		it("does not reuse another display's coordinates on this display", () => {
			expect(
				resolvePopupPositionForDisplay(
					{ x: 2500, y: 400 },
					popupSize,
					primaryWorkArea,
				),
			).toEqual({ position: primaryCenter, recovered: true });
		});

		it("applies a workArea-relative saved offset after the display origin moves", () => {
			const offset = { x: 80, y: 90 };
			expect(
				resolvePopupPositionForDisplay(offset, popupSize, secondaryWorkArea),
			).toEqual({
				position: fromWorkAreaRelativePosition(offset, secondaryWorkArea),
				recovered: false,
			});
			const shiftedSecondary = { ...secondaryWorkArea, x: 0, y: 0 };
			expect(
				resolvePopupPositionForDisplay(offset, popupSize, shiftedSecondary),
			).toEqual({
				position: fromWorkAreaRelativePosition(offset, shiftedSecondary),
				recovered: false,
			});
		});

		it("round-trips screen coordinates through workArea-relative storage", () => {
			const screenPoint = { x: 2100, y: 180 };
			const relative = toWorkAreaRelativePosition(
				screenPoint,
				secondaryWorkArea,
			);
			expect(relative).toEqual({
				x: screenPoint.x - secondaryWorkArea.x,
				y: screenPoint.y - secondaryWorkArea.y,
			});
			expect(fromWorkAreaRelativePosition(relative, secondaryWorkArea)).toEqual(
				screenPoint,
			);
		});

		it("migrates in-workArea absolute points to relative offsets", () => {
			const map = {
				"1": { x: 100, y: 200 },
				"2": { x: 2100, y: 180 },
			};
			expect(
				migratePopupPositionsToWorkAreaRelative(map, [
					{ id: "1", workArea: primaryWorkArea },
					{ id: "2", workArea: secondaryWorkArea },
				]),
			).toEqual({
				"1": { x: 100, y: 200 },
				"2": toWorkAreaRelativePosition({ x: 2100, y: 180 }, secondaryWorkArea),
			});
		});

		it("centers on miss without marking recovered", () => {
			expect(
				resolvePopupPositionForDisplay(null, popupSize, primaryWorkArea),
			).toEqual({ position: primaryCenter, recovered: false });
		});

		it("leaves an open window on the matched display", () => {
			expect(
				resolveOpenWindowPosition(
					{ x: 100, y: 200 },
					{ x: 10, y: 10 },
					primaryWorkArea,
					popupSize,
				),
			).toEqual({ position: { x: 100, y: 200 }, recovered: false });
		});

		it("recovers an off-screen window via the matched display saved point", () => {
			expect(
				resolveOpenWindowPosition(
					{ x: 2500, y: 400 },
					{ x: 80, y: 90 },
					primaryWorkArea,
					popupSize,
				),
			).toEqual({ position: { x: 80, y: 90 }, recovered: true });
		});

		it("centers when the off-screen window has no saved point on the matched display", () => {
			expect(
				resolveOpenWindowPosition(
					{ x: 2500, y: 400 },
					null,
					primaryWorkArea,
					popupSize,
				),
			).toEqual({ position: primaryCenter, recovered: true });
		});

		it("treats workArea hit-tests as inclusive top-left", () => {
			expect(isPointInWorkArea({ x: 0, y: 0 }, primaryWorkArea)).toBe(true);
			expect(isPointInWorkArea({ x: 1920, y: 0 }, primaryWorkArea)).toBe(false);
		});

		it("seeds a legacy point under the display that contains it", () => {
			const displays = [
				{ id: 1, workArea: primaryWorkArea },
				{ id: 2, workArea: secondaryWorkArea },
			];
			expect(
				getDisplayIdContainingPoint({ x: 2500, y: 400 }, displays, "1"),
			).toBe("2");
			expect(
				getDisplayIdContainingPoint({ x: 100, y: 100 }, displays, "1"),
			).toBe("1");
			expect(
				getDisplayIdContainingPoint({ x: -50, y: -50 }, displays, "1"),
			).toBe("1");
		});
	});

	describe("layoutForDisplays / resolvePopupSizeForDisplay", () => {
		const sourceSize = { width: 300, height: 120 };

		it("uses the mirror size when this display has no saved size", () => {
			expect(
				resolvePopupSizeForDisplay(null, sourceSize, primaryWorkArea),
			).toEqual(sourceSize);
		});

		it("prefers this display's saved size over the mirror", () => {
			expect(
				resolvePopupSizeForDisplay(
					{ width: 400, height: 180 },
					sourceSize,
					primaryWorkArea,
				),
			).toEqual({ width: 400, height: 180 });
		});

		it("clamps a saved size that is larger than the workArea", () => {
			expect(
				clampPopupSizeToWorkArea(
					{ width: 3000, height: 2000 },
					primaryWorkArea,
				),
			).toEqual({
				width: primaryWorkArea.width - POPUP_SHADOW_INSET * 2,
				height: primaryWorkArea.height - POPUP_SHADOW_INSET * 2,
			});
		});

		it("copies size and relative offset onto every display", () => {
			const current = { x: 192, y: 108 };
			const layouts = layoutForDisplays(current, sourceSize, primaryWorkArea, [
				{ id: "1", workArea: primaryWorkArea },
				{ id: "2", workArea: secondaryWorkArea },
			]);
			expect(layouts["1"]).toEqual({
				size: sourceSize,
				position: current,
			});
			expect(layouts["2"]?.size).toEqual(sourceSize);
			expect(layouts["2"]?.position.x).toBe(
				secondaryWorkArea.x +
					Math.floor((192 / 1920) * secondaryWorkArea.width),
			);
			expect(layouts["2"]?.position.y).toBe(
				secondaryWorkArea.y +
					Math.floor((108 / 1080) * secondaryWorkArea.height),
			);
		});

		it("shrinks size on a smaller display so the window stays on-screen", () => {
			const tiny = { x: 0, y: 0, width: 200, height: 90 };
			const layouts = layoutForDisplays(
				{ x: 100, y: 40 },
				{ width: 300, height: 120 },
				primaryWorkArea,
				[{ id: "tiny", workArea: tiny }],
			);
			expect(layouts.tiny?.size).toEqual({
				width: tiny.width - POPUP_SHADOW_INSET * 2,
				height: tiny.height - POPUP_SHADOW_INSET * 2,
			});
			expect(layouts.tiny?.position).toEqual({
				x: Math.floor((100 / primaryWorkArea.width) * tiny.width),
				y: Math.floor((40 / primaryWorkArea.height) * tiny.height),
			});
		});
	});

	describe("nextUnsavedDisplayId", () => {
		const live = ["1", "2", "3"];

		it("picks the next live id after current that is not saved", () => {
			expect(nextUnsavedDisplayId(live, ["1"], "1")).toBe("2");
			expect(nextUnsavedDisplayId(live, ["1", "2"], "2")).toBe("3");
		});

		it("wraps to the first unsaved display", () => {
			expect(nextUnsavedDisplayId(live, ["3"], "3")).toBe("1");
			expect(nextUnsavedDisplayId(live, ["2", "3"], "3")).toBe("1");
		});

		it("returns null when every other live display is saved", () => {
			expect(nextUnsavedDisplayId(live, ["1", "2", "3"], "1")).toBeNull();
			expect(nextUnsavedDisplayId(["1"], [], "1")).toBeNull();
			expect(nextUnsavedDisplayId([], [], "1")).toBeNull();
		});

		it("skips saved ids between current and the next unset display", () => {
			expect(nextUnsavedDisplayId(live, ["2"], "1")).toBe("3");
		});
	});
});
