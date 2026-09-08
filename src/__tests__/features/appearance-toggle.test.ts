import { describe, expect, it } from "vitest";
import {
	APPEARANCE_OPTIONS,
	APPEARANCE_STRIDE_REM,
	appearanceButtonOffsetRem,
	appearanceClusterShiftRem,
	appearanceOptionIndex,
} from "@/features/settings/model/appearance-toggle";

describe("appearance toggle layout", () => {
	it("orders Light, System, Night", () => {
		expect([...APPEARANCE_OPTIONS]).toEqual(["light", "system", "dark"]);
		expect(appearanceOptionIndex("light")).toBe(0);
		expect(appearanceOptionIndex("system")).toBe(1);
		expect(appearanceOptionIndex("dark")).toBe(2);
	});

	it("slides neighbors right out of Light", () => {
		expect(appearanceButtonOffsetRem(0, 0, false)).toBe(0);
		expect(appearanceButtonOffsetRem(1, 0, false)).toBe(0);
		expect(appearanceButtonOffsetRem(2, 0, false)).toBe(0);
		expect(appearanceButtonOffsetRem(0, 0, true)).toBe(0);
		expect(appearanceButtonOffsetRem(1, 0, true)).toBe(APPEARANCE_STRIDE_REM);
		expect(appearanceButtonOffsetRem(2, 0, true)).toBe(
			APPEARANCE_STRIDE_REM * 2,
		);
	});

	it("slides Light right and Night left into System", () => {
		expect(appearanceButtonOffsetRem(0, 1, true)).toBe(-APPEARANCE_STRIDE_REM);
		expect(appearanceButtonOffsetRem(1, 1, true)).toBe(0);
		expect(appearanceButtonOffsetRem(2, 1, true)).toBe(APPEARANCE_STRIDE_REM);
		expect(appearanceButtonOffsetRem(0, 1, false)).toBe(0);
		expect(appearanceButtonOffsetRem(1, 1, false)).toBe(0);
		expect(appearanceButtonOffsetRem(2, 1, false)).toBe(0);
	});

	it("slides neighbors left into Night", () => {
		expect(appearanceButtonOffsetRem(0, 2, true)).toBe(
			-APPEARANCE_STRIDE_REM * 2,
		);
		expect(appearanceButtonOffsetRem(1, 2, true)).toBe(-APPEARANCE_STRIDE_REM);
		expect(appearanceButtonOffsetRem(2, 2, true)).toBe(0);
		expect(appearanceButtonOffsetRem(0, 2, false)).toBe(0);
		expect(appearanceButtonOffsetRem(2, 2, false)).toBe(0);
	});

	it("recenters the open row when opening from a side option", () => {
		expect(appearanceClusterShiftRem(0, false)).toBe(0);
		expect(appearanceClusterShiftRem(1, false)).toBe(0);
		expect(appearanceClusterShiftRem(0, true)).toBe(-APPEARANCE_STRIDE_REM);
		expect(appearanceClusterShiftRem(1, true)).toBe(0);
		expect(appearanceClusterShiftRem(2, true)).toBe(APPEARANCE_STRIDE_REM);
	});
});
