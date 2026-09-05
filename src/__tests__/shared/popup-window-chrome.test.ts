import { describe, expect, it } from "vitest";
import {
	POPUP_SHADOW_INSET,
	popupCardPosition,
	popupCardSize,
	popupWindowPosition,
	popupWindowSize,
	withPopupWindowChrome,
} from "../../../shared/popup-window-chrome";

describe("popup-window-chrome", () => {
	it("expands card geometry for the transparent shadow gutter", () => {
		expect(POPUP_SHADOW_INSET).toBe(32);
		expect(popupWindowSize({ width: 280, height: 120 })).toEqual({
			width: 344,
			height: 184,
		});
		expect(popupWindowPosition({ x: 100, y: 200 })).toEqual({
			x: 68,
			y: 168,
		});
	});

	it("round-trips card geometry from window bounds", () => {
		const card = { width: 300, height: 120 };
		const point = { x: 400, y: 500 };
		const frame = withPopupWindowChrome(card, point);
		expect(popupCardSize(frame.size)).toEqual(card);
		expect(popupCardPosition(frame.position)).toEqual(point);
	});
});
