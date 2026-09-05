import type { Point, Size } from "./preferences";
import { theme } from "./theme";

/** Transparent gutter around popup cards so CSS box-shadow is not clipped (`hasShadow: false`). */
export const POPUP_SHADOW_INSET = theme.popup.shadowInset;

export function popupWindowSize(cardSize: Size): Size {
	const inset = POPUP_SHADOW_INSET;
	return {
		width: Math.round(cardSize.width + inset * 2),
		height: Math.round(cardSize.height + inset * 2),
	};
}

export function popupWindowPosition(cardPosition: Point): Point {
	const inset = POPUP_SHADOW_INSET;
	return {
		x: Math.round(cardPosition.x - inset),
		y: Math.round(cardPosition.y - inset),
	};
}

export function popupCardSize(windowSize: Size): Size {
	const inset = POPUP_SHADOW_INSET;
	return {
		width: Math.max(1, Math.round(windowSize.width - inset * 2)),
		height: Math.max(1, Math.round(windowSize.height - inset * 2)),
	};
}

export function popupCardPosition(windowPosition: Point): Point {
	const inset = POPUP_SHADOW_INSET;
	return {
		x: Math.round(windowPosition.x + inset),
		y: Math.round(windowPosition.y + inset),
	};
}

export function withPopupWindowChrome(
	cardSize: Size,
	cardPosition: Point,
): { size: Size; position: Point } {
	return {
		size: popupWindowSize(cardSize),
		position: popupWindowPosition(cardPosition),
	};
}
