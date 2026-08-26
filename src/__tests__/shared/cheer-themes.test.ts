import { describe, expect, it } from "vitest";
import {
	canEquipCheerTheme,
	CHEER_THEME_IDS,
	normalizeEquippedCheerTheme,
	normalizeUnlockedCheerThemeIds,
	resolveCheerTheme,
} from "../../../shared/cheer-themes";

describe("cheer-themes", () => {
	it("resolves equipped theme when unlocked or free", () => {
		const ctx = {
			unlockedCheerThemeIds: ["bounce"] as const,
			equippedCheerTheme: "bounce" as const,
		};
		expect(resolveCheerTheme(ctx, null, () => 0)).toBe("bounce");
	});

	it("falls back to random pool when equipped theme is locked", () => {
		const ctx = {
			unlockedCheerThemeIds: [] as const,
			equippedCheerTheme: "bounce" as const,
		};
		expect(resolveCheerTheme(ctx, null, () => 0)).toBe(CHEER_THEME_IDS[0]);
	});

	it("honors debug override", () => {
		const ctx = {
			unlockedCheerThemeIds: [] as const,
			equippedCheerTheme: "random" as const,
		};
		expect(resolveCheerTheme(ctx, "waltz", () => 0)).toBe("waltz");
	});

	it("canEquip allows free themes without unlock", () => {
		const ctx = {
			unlockedCheerThemeIds: [] as const,
			equippedCheerTheme: "random" as const,
		};
		expect(canEquipCheerTheme(ctx, "chime")).toBe(true);
		expect(canEquipCheerTheme(ctx, "fanfare")).toBe(false);
	});

	it("normalizes equipped and unlocked arrays", () => {
		expect(normalizeEquippedCheerTheme("nope")).toBe("random");
		expect(normalizeEquippedCheerTheme("sparkle")).toBe("sparkle");
		expect(
			normalizeUnlockedCheerThemeIds(["bounce", "bounce", "nope"]),
		).toEqual(["bounce"]);
	});
});
