import { TRAY_MENU_SHADOW_INSET } from "../../../shared/tray-menu";

export type PlainRect = {
	x: number;
	y: number;
	width: number;
	height: number;
};

const WORK_MARGIN = 4;
/** Tight gap between menu card edge and tray icon. */
export const TRAY_MENU_GAP = 2;

export { TRAY_MENU_SHADOW_INSET };

export function computeTrayMenuBounds(input: {
	trayBounds: PlainRect;
	menuWidth: number;
	menuHeight: number;
	workArea: PlainRect;
	shadowInset?: number;
}): PlainRect {
	const { trayBounds, menuWidth, menuHeight, workArea } = input;
	const inset = input.shadowInset ?? TRAY_MENU_SHADOW_INSET;
	const workLeft = workArea.x + WORK_MARGIN;
	const workTop = workArea.y + WORK_MARGIN;
	const workRight = workArea.x + workArea.width - WORK_MARGIN;
	const workBottom = workArea.y + workArea.height - WORK_MARGIN;
	const maxWidth = Math.max(1, workRight - workLeft);
	const maxHeight = Math.max(1, workBottom - workTop);
	const width = Math.min(menuWidth, maxWidth);
	const height = Math.min(menuHeight, maxHeight);
	const contentWidth = Math.max(1, width - inset * 2);
	const contentHeight = Math.max(1, height - inset * 2);

	let x = trayBounds.x + trayBounds.width - inset - contentWidth;
	if (x < workLeft) x = workLeft;
	if (x + width > workRight) x = workRight - width;

	const trayCenterY = trayBounds.y + trayBounds.height / 2;
	const workMidY = workArea.y + workArea.height / 2;
	const anchorAbove = trayCenterY >= workMidY;

	const yAbove = trayBounds.y - TRAY_MENU_GAP - inset - contentHeight;
	const yBelow = trayBounds.y + trayBounds.height + TRAY_MENU_GAP - inset;

	let y = anchorAbove ? yAbove : yBelow;

	if (y < workTop) {
		y = yBelow;
	}
	if (y + height > workBottom + inset) {
		y = yAbove;
	}
	if (y < workTop) y = workTop;
	if (y + height > workBottom + inset) {
		y = workBottom + inset - height;
	}

	return {
		x: Math.round(x),
		y: Math.round(y),
		width: Math.round(width),
		height: Math.round(height),
	};
}

/** Card edge used for tray gap checks (ignores transparent shadow padding). */
export function trayMenuContentBottom(
	bounds: PlainRect,
	inset = TRAY_MENU_SHADOW_INSET,
): number {
	return bounds.y + inset + Math.max(1, bounds.height - inset * 2);
}

export function trayMenuContentTop(
	bounds: PlainRect,
	inset = TRAY_MENU_SHADOW_INSET,
): number {
	return bounds.y + inset;
}
