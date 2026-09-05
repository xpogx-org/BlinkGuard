import { screen, type Display } from "electron";
import type { Point, Size } from "../../../shared/preferences";
import { POPUP_SHADOW_INSET } from "../../../shared/popup-window-chrome";

export type WorkArea = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export function getActiveDisplay(): Display {
	return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

export function getAllWorkAreas(): WorkArea[] {
	return screen.getAllDisplays().map((display) => display.workArea);
}

export function getCenteredPopupPositionForWorkArea(
	workArea: WorkArea,
	popupWidth: number,
	popupHeight: number,
): Point {
	const { x, y, width, height } = workArea;
	return {
		x: Math.floor(x + (width - popupWidth) / 2),
		y: Math.floor(y + (height - popupHeight) / 2),
	};
}

export function getCenteredPopupPosition(
	popupWidth: number,
	popupHeight: number,
) {
	return getCenteredPopupPositionForWorkArea(
		getActiveDisplay().workArea,
		popupWidth,
		popupHeight,
	);
}

/** Vertically centered, horizontally in the right third of the work area. */
export function getRightBiasedPopupPosition(
	popupWidth: number,
	popupHeight: number,
) {
	const { x, y, width, height } = getActiveDisplay().workArea;
	return {
		x: Math.floor(x + (width - popupWidth) * 0.72),
		y: Math.floor(y + (height - popupHeight) / 2),
	};
}

/** Vertically centered, horizontally in the left third of the work area. */
export function getLeftBiasedPopupPosition(
	popupWidth: number,
	popupHeight: number,
) {
	const { x, y, width, height } = getActiveDisplay().workArea;
	return {
		x: Math.floor(x + (width - popupWidth) * 0.28),
		y: Math.floor(y + (height - popupHeight) / 2),
	};
}

export function getTopCenterPopupPosition(popupWidth: number) {
	const { x, y, width } = getActiveDisplay().workArea;
	return {
		x: Math.floor(x + (width - popupWidth) / 2),
		y: Math.floor(y + 4),
	};
}

/**
 * True when Dock / taskbar / menu bar insets the usable workArea.
 * Auto-hide (or already-fullscreen) usually makes workArea equal bounds.
 */
export function isSystemChromeVisible(
	bounds: WorkArea,
	workArea: WorkArea,
): boolean {
	return (
		workArea.x > bounds.x ||
		workArea.y > bounds.y ||
		workArea.x + workArea.width < bounds.x + bounds.width ||
		workArea.y + workArea.height < bounds.y + bounds.height
	);
}

/**
 * Desktop region for ambient: keep the window inside `workArea` when a
 * taskbar/dock is showing so Windows does not treat us as fullscreen and hide it.
 */
export function ambientDesktopBounds(
	bounds: WorkArea,
	workArea: WorkArea,
): WorkArea {
	return isSystemChromeVisible(bounds, workArea) ? workArea : bounds;
}

/** Taskbar / dock / menu-bar strips (`bounds` minus `workArea`). */
export function systemChromeRects(
	bounds: WorkArea,
	workArea: WorkArea,
): WorkArea[] {
	const rects: WorkArea[] = [];
	if (workArea.y > bounds.y) {
		rects.push({
			x: bounds.x,
			y: bounds.y,
			width: bounds.width,
			height: workArea.y - bounds.y,
		});
	}
	if (workArea.x > bounds.x) {
		rects.push({
			x: bounds.x,
			y: workArea.y,
			width: workArea.x - bounds.x,
			height: workArea.height,
		});
	}
	const workRight = workArea.x + workArea.width;
	const boundsRight = bounds.x + bounds.width;
	if (workRight < boundsRight) {
		rects.push({
			x: workRight,
			y: workArea.y,
			width: boundsRight - workRight,
			height: workArea.height,
		});
	}
	const workBottom = workArea.y + workArea.height;
	const boundsBottom = bounds.y + bounds.height;
	if (workBottom < boundsBottom) {
		rects.push({
			x: bounds.x,
			y: workBottom,
			width: bounds.width,
			height: boundsBottom - workBottom,
		});
	}
	return rects.filter((rect) => rect.width > 0 && rect.height > 0);
}

/** Inclusive top/left, exclusive bottom/right — matches typical workArea hit-tests. */
export function isPointInWorkArea(point: Point, area: WorkArea): boolean {
	return (
		point.x >= area.x &&
		point.y >= area.y &&
		point.x < area.x + area.width &&
		point.y < area.y + area.height
	);
}

export function isPointInAnyWorkArea(
	point: Point,
	workAreas: readonly WorkArea[],
): boolean {
	return workAreas.some((area) => isPointInWorkArea(point, area));
}

export function resolvePopupPosition(
	saved: Point | null,
	_popupSize: Size,
	workAreas: readonly WorkArea[],
	fallbackCenter: Point,
): { position: Point; recovered: boolean } {
	if (!saved) {
		return { position: fallbackCenter, recovered: false };
	}
	if (isPointInAnyWorkArea(saved, workAreas)) {
		return { position: saved, recovered: false };
	}
	return { position: fallbackCenter, recovered: true };
}

/** Resolve saved position against live displays; recover to active-display center. */
export function resolveVisiblePopupPosition(
	saved: Point | null,
	popupSize: Size,
): { position: Point; recovered: boolean } {
	return resolvePopupPosition(
		saved,
		popupSize,
		getAllWorkAreas(),
		getCenteredPopupPosition(popupSize.width, popupSize.height),
	);
}

/** Screen top-left → offset from this workArea origin (survives origin shifts). */
export function toWorkAreaRelativePosition(
	position: Point,
	workArea: WorkArea,
): Point {
	return {
		x: position.x - workArea.x,
		y: position.y - workArea.y,
	};
}

export function fromWorkAreaRelativePosition(
	offset: Point,
	workArea: WorkArea,
): Point {
	return {
		x: workArea.x + offset.x,
		y: workArea.y + offset.y,
	};
}

/**
 * Convert in-workArea absolute points to workArea-relative offsets.
 * Off-screen / already-relative entries are left unchanged.
 */
export function migratePopupPositionsToWorkAreaRelative(
	map: Record<string, Point>,
	displays: readonly DisplayWorkArea[],
): Record<string, Point> {
	const next = { ...map };
	for (const display of displays) {
		const saved = next[display.id];
		if (!saved) continue;
		if (!isPointInWorkArea(saved, display.workArea)) continue;
		const relative = toWorkAreaRelativePosition(saved, display.workArea);
		if (relative.x === saved.x && relative.y === saved.y) continue;
		next[display.id] = relative;
	}
	return next;
}

/**
 * Keep the point if it sits on this workArea; otherwise treat it as a
 * workArea-relative offset (origin shift / secondary display). True miss → center.
 */
export function resolvePopupPositionForDisplay(
	saved: Point | null,
	popupSize: Size,
	workArea: WorkArea,
): { position: Point; recovered: boolean } {
	const fallback = getCenteredPopupPositionForWorkArea(
		workArea,
		popupSize.width,
		popupSize.height,
	);
	if (!saved) {
		return { position: fallback, recovered: false };
	}
	if (isPointInWorkArea(saved, workArea)) {
		return { position: saved, recovered: false };
	}
	const translated = fromWorkAreaRelativePosition(saved, workArea);
	if (isPointInWorkArea(translated, workArea)) {
		return { position: translated, recovered: false };
	}
	return { position: fallback, recovered: true };
}

/**
 * Leave an open window where it is when still on the matched display.
 * Otherwise use that display's saved point, or center.
 */
export function resolveOpenWindowPosition(
	current: Point,
	savedForMatchedDisplay: Point | null,
	matchedWorkArea: WorkArea,
	popupSize: Size,
): { position: Point; recovered: boolean } {
	if (isPointInWorkArea(current, matchedWorkArea)) {
		return { position: current, recovered: false };
	}
	return {
		position: resolvePopupPositionForDisplay(
			savedForMatchedDisplay,
			popupSize,
			matchedWorkArea,
		).position,
		recovered: true,
	};
}

export function getDisplayIdContainingPoint(
	point: Point,
	displays: readonly { id: number; workArea: WorkArea }[],
	fallbackId: string,
): string {
	const match = displays.find((display) =>
		isPointInWorkArea(point, display.workArea),
	);
	return match ? String(match.id) : fallbackId;
}

export function getDisplayForPopupRect(
	x: number,
	y: number,
	width: number,
	height: number,
): Display {
	return screen.getDisplayMatching({ x, y, width, height });
}

export type DisplayWorkArea = {
	id: string;
	workArea: WorkArea;
};

export type PopupLayout = {
	position: Point;
	size: Size;
};

/** Shrink a popup card so the window (card + shadow gutter) fits inside workArea. */
export function clampPopupSizeToWorkArea(size: Size, workArea: WorkArea): Size {
	const inset = POPUP_SHADOW_INSET;
	const maxWidth = Math.max(1, workArea.width - inset * 2);
	const maxHeight = Math.max(1, workArea.height - inset * 2);
	return {
		width: Math.max(1, Math.min(Math.round(size.width), maxWidth)),
		height: Math.max(1, Math.min(Math.round(size.height), maxHeight)),
	};
}

export function resolvePopupSizeForDisplay(
	saved: Size | null,
	mirror: Size,
	workArea: WorkArea,
): Size {
	return clampPopupSizeToWorkArea(saved ?? mirror, workArea);
}

function clampTopLeftToWorkArea(
	point: Point,
	size: Size,
	workArea: WorkArea,
): Point {
	const maxX = workArea.x + Math.max(0, workArea.width - size.width);
	const maxY = workArea.y + Math.max(0, workArea.height - size.height);
	return {
		x: Math.min(Math.max(Math.round(point.x), workArea.x), maxX),
		y: Math.min(Math.max(Math.round(point.y), workArea.y), maxY),
	};
}

export function workAreaRelativeOffset(
	position: Point,
	workArea: WorkArea,
): { rx: number; ry: number } {
	const rx = workArea.width <= 0 ? 0 : (position.x - workArea.x) / workArea.width;
	const ry =
		workArea.height <= 0 ? 0 : (position.y - workArea.y) / workArea.height;
	return { rx, ry };
}

/**
 * Copy current size + workArea-relative top-left onto every display, clamped.
 */
export function layoutForDisplays(
	currentPosition: Point,
	currentSize: Size,
	sourceWorkArea: WorkArea,
	displays: readonly DisplayWorkArea[],
): Record<string, PopupLayout> {
	const offset = workAreaRelativeOffset(currentPosition, sourceWorkArea);
	const out: Record<string, PopupLayout> = {};
	for (const display of displays) {
		const size = clampPopupSizeToWorkArea(currentSize, display.workArea);
		const raw = {
			x: Math.floor(display.workArea.x + offset.rx * display.workArea.width),
			y: Math.floor(display.workArea.y + offset.ry * display.workArea.height),
		};
		out[display.id] = {
			size,
			position: clampTopLeftToWorkArea(raw, size, display.workArea),
		};
	}
	return out;
}

/**
 * First live display after `currentId` (wrapping) that is not in `savedIds`.
 * `currentId` itself is never returned.
 */
export function nextUnsavedDisplayId(
	liveIds: readonly string[],
	savedIds: readonly string[],
	currentId: string,
): string | null {
	if (liveIds.length === 0) return null;
	const saved = new Set(savedIds);
	const start = liveIds.indexOf(currentId);
	const ordered =
		start < 0
			? liveIds
			: [...liveIds.slice(start + 1), ...liveIds.slice(0, start)];
	for (const id of ordered) {
		if (!id || saved.has(id)) continue;
		return id;
	}
	return null;
}
