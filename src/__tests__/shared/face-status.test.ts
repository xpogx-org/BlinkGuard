import { describe, expect, it } from "vitest";
import { isFaceStatus, isReliableFaceStatus } from "../../../shared/face-status";

describe("isReliableFaceStatus", () => {
	it("is true only for faceDetected with ok status", () => {
		expect(isReliableFaceStatus(true, "ok")).toBe(true);
		expect(isReliableFaceStatus(true, "too_far")).toBe(false);
		expect(isReliableFaceStatus(true, "too_close")).toBe(false);
		expect(isReliableFaceStatus(true, "head_too_high")).toBe(false);
		expect(isReliableFaceStatus(true, "head_too_low")).toBe(false);
		expect(isReliableFaceStatus(true, "unreliable_landmarks")).toBe(false);
		expect(isReliableFaceStatus(false, "ok")).toBe(false);
		expect(isReliableFaceStatus(true, undefined)).toBe(false);
	});
});

describe("isFaceStatus", () => {
	it("accepts known wire values", () => {
		expect(isFaceStatus("ok")).toBe(true);
		expect(isFaceStatus("too_close")).toBe(true);
		expect(isFaceStatus("head_too_high")).toBe(true);
		expect(isFaceStatus("head_too_low")).toBe(true);
		expect(isFaceStatus("unreliable_landmarks")).toBe(true);
		expect(isFaceStatus("bogus")).toBe(false);
	});
});
