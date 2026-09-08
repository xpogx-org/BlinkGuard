import { describe, expect, it } from "vitest";
import {
	BLINK_RATE_MIN_FACE_COVERAGE,
	BLINK_RATE_WINDOW_MS,
	blinkRateCoverageReadyMs,
	classifyBlinkRate,
	computeBlinksPerMinute,
	computeFaceVisibleMsInWindow,
	formatBlinksPerMinute,
	isBlinkRateCoverageReady,
	pruneBlinkTimestamps,
	pruneFaceVisibleSegments,
} from "../../../shared/blink-rate";

describe("blink-rate helpers", () => {
	const now = 1_000_000;

	it("returns 0 for an empty window", () => {
		expect(computeBlinksPerMinute([], now)).toBe(0);
		expect(computeBlinksPerMinute([now - BLINK_RATE_WINDOW_MS - 1], now)).toBe(
			0,
		);
	});

	it("scales blinks in the window to per-minute", () => {
		const timestamps = [now - 10_000, now - 5_000, now];
		expect(computeBlinksPerMinute(timestamps, now)).toBe(3);
	});

	it("scales blinks by face-visible ms when provided", () => {
		const timestamps = [
			now - 25_000,
			now - 20_000,
			now - 15_000,
			now - 10_000,
			now - 5_000,
		];
		// 5 blinks over 30s of face → 10 /min (not 5).
		expect(
			computeBlinksPerMinute(timestamps, now, { faceVisibleMs: 30_000 }),
		).toBe(10);
	});

	it("prunes timestamps outside the rolling window", () => {
		const timestamps = [
			now - BLINK_RATE_WINDOW_MS - 1,
			now - 30_000,
			now,
			now + 1,
		];
		expect(pruneBlinkTimestamps(timestamps, now)).toEqual([now - 30_000, now]);
	});

	it("sums face-visible overlap in the rolling window", () => {
		const segments = [
			{ startMs: now - 90_000, endMs: now - 70_000 }, // outside
			{ startMs: now - 50_000, endMs: now - 20_000 }, // 30s
		];
		expect(computeFaceVisibleMsInWindow(segments, now)).toBe(30_000);
		expect(
			computeFaceVisibleMsInWindow(
				segments,
				now,
				BLINK_RATE_WINDOW_MS,
				now - 10_000,
			),
		).toBe(40_000);
	});

	it("prunes stale face segments", () => {
		const segments = [
			{ startMs: now - 90_000, endMs: now - 80_000 },
			{ startMs: now - 20_000, endMs: now - 10_000 },
		];
		expect(pruneFaceVisibleSegments(segments, now)).toEqual([
			{ startMs: now - 20_000, endMs: now - 10_000 },
		]);
	});

	it("gates coverage ready at 40% of the window", () => {
		expect(BLINK_RATE_MIN_FACE_COVERAGE).toBe(0.4);
		expect(blinkRateCoverageReadyMs()).toBe(24_000);
		expect(isBlinkRateCoverageReady(23_999)).toBe(false);
		expect(isBlinkRateCoverageReady(24_000)).toBe(true);
		expect(isBlinkRateCoverageReady(18_000)).toBe(false); // 0.3 coverage
	});

	it("classifies low / ok / good from guidance bands", () => {
		expect(classifyBlinkRate(0).quality).toBe("low");
		expect(classifyBlinkRate(3.9).quality).toBe("low");
		expect(classifyBlinkRate(4).quality).toBe("ok");
		expect(classifyBlinkRate(14).quality).toBe("ok");
		expect(classifyBlinkRate(15).quality).toBe("good");
		expect(classifyBlinkRate(25).quality).toBe("good");
		expect(classifyBlinkRate(15).label).toBe("Good");
		expect(classifyBlinkRate(15).description).toContain("15–20");
	});

	it("formats display values", () => {
		expect(formatBlinksPerMinute(0)).toBe("0");
		expect(formatBlinksPerMinute(3)).toBe("3");
		expect(formatBlinksPerMinute(3.14)).toBe("3.1");
	});
});
