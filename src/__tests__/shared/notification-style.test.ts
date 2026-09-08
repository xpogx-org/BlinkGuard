import { describe, expect, it } from "vitest";
import {
	DEFAULT_NOTIFICATION_STYLE,
	notificationSurfaces,
	resolvePromptSurfaces,
	sanitizeNotificationStyle,
	withNativeFallback,
} from "../../../shared/notification-style";

describe("sanitizeNotificationStyle", () => {
	it("keeps overlay, native, and both", () => {
		expect(sanitizeNotificationStyle("overlay")).toBe("overlay");
		expect(sanitizeNotificationStyle("native")).toBe("native");
		expect(sanitizeNotificationStyle("both")).toBe("both");
	});

	it("falls back to overlay for missing or garbage values", () => {
		expect(sanitizeNotificationStyle(undefined)).toBe(
			DEFAULT_NOTIFICATION_STYLE,
		);
		expect(sanitizeNotificationStyle(null)).toBe("overlay");
		expect(sanitizeNotificationStyle("toast")).toBe("overlay");
		expect(sanitizeNotificationStyle(1)).toBe("overlay");
	});
});

describe("notificationSurfaces", () => {
	it("maps overlay / native / both", () => {
		expect(notificationSurfaces("overlay")).toEqual({
			overlay: true,
			native: false,
		});
		expect(notificationSurfaces("native")).toEqual({
			overlay: false,
			native: true,
		});
		expect(notificationSurfaces("both")).toEqual({
			overlay: true,
			native: true,
		});
	});
});

describe("resolvePromptSurfaces", () => {
	it("falls back to overlay when native was requested but is not usable", () => {
		expect(resolvePromptSurfaces("native", false)).toEqual({
			overlay: true,
			native: false,
		});
		expect(resolvePromptSurfaces("both", false)).toEqual({
			overlay: true,
			native: false,
		});
	});

	it("keeps overlay-only when native is unused", () => {
		expect(resolvePromptSurfaces("overlay", false)).toEqual({
			overlay: true,
			native: false,
		});
		expect(resolvePromptSurfaces("overlay", true)).toEqual({
			overlay: true,
			native: false,
		});
	});
});

describe("withNativeFallback", () => {
	it("shows overlay when native was requested but did not show", () => {
		expect(withNativeFallback({ overlay: false, native: true }, false)).toEqual(
			{ overlay: true, nativeShown: false },
		);
	});

	it("keeps both when native showed", () => {
		expect(withNativeFallback({ overlay: true, native: true }, true)).toEqual({
			overlay: true,
			nativeShown: true,
		});
	});
});
