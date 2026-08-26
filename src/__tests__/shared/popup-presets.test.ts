import { describe, expect, it } from "vitest";
import {
	buildPopupAppearancePayload,
	POPUP_PRESETS,
} from "../../../shared/popup-presets";

describe("popup-presets", () => {
	it("includes glow tokens when a preset is active", () => {
		const payload = buildPopupAppearancePayload(
			POPUP_PRESETS.aurora.colors,
			"aurora",
		);
		expect(payload.glowPreset).toBe("aurora");
		expect(payload.glow?.accent).toBe(POPUP_PRESETS.aurora.glow.accent);
	});

	it("clears glow when preset is null", () => {
		const payload = buildPopupAppearancePayload(
			POPUP_PRESETS.sunset.colors,
			null,
		);
		expect(payload.glowPreset).toBeNull();
		expect(payload.glow).toBeNull();
	});
});
