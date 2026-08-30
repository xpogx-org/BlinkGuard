import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRuntimeState } from "../../../electron/application/app-runtime-state";

describe("AppRuntimeState", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("tracks blink credit and reminder timestamps separately", () => {
		const state = new AppRuntimeState();
		expect(state.lastBlinkTime).toEqual(expect.any(Number));
		expect(state.lastReminderShownAt).toEqual(expect.any(Number));
		state.lastBlinkTime = 1;
		state.lastReminderShownAt = 2;
		expect(state.lastBlinkTime).toBe(1);
		expect(state.lastReminderShownAt).toBe(2);
	});

	it("clearReminderTimers clears intervals/timeouts and reminder flags", () => {
		vi.useFakeTimers();
		const state = new AppRuntimeState();
		state.blinkReminderActive = true;
		state.mgdReminderLoopActive = true;
		state.blinkSnoozeUntil = Date.now() + 60_000;
		state.promptSuppressUntil = Date.now() + 60_000;
		state.promptSuppressTimeout = setTimeout(() => {}, 5_000);
		state.blinkInterval = setInterval(() => {}, 1000);
		state.cameraMonitoringInterval = setInterval(() => {}, 100);
		state.cameraThresholdUpdateTimeout = setTimeout(() => {}, 500);
		state.blinkSnoozeTimeout = setTimeout(() => {}, 5_000);

		state.clearReminderTimers();

		expect(state.blinkInterval).toBeNull();
		expect(state.cameraMonitoringInterval).toBeNull();
		expect(state.cameraThresholdUpdateTimeout).toBeNull();
		expect(state.blinkSnoozeTimeout).toBeNull();
		expect(state.blinkSnoozeUntil).toBe(0);
		expect(state.promptSuppressUntil).toBe(0);
		expect(state.promptSuppressTimeout).toBeNull();
		expect(state.blinkReminderActive).toBe(false);
		expect(state.mgdReminderLoopActive).toBe(false);
	});

	it("clearExerciseTimers clears exercise timers and showing flag", () => {
		vi.useFakeTimers();
		const state = new AppRuntimeState();
		state.isExerciseShowing = true;
		state.exerciseInterval = setInterval(() => {}, 60_000);
		state.exerciseSnoozeTimeout = setTimeout(() => {}, 5_000);

		state.clearExerciseTimers();

		expect(state.exerciseInterval).toBeNull();
		expect(state.exerciseSnoozeTimeout).toBeNull();
		expect(state.isExerciseShowing).toBe(false);
	});

	it("clearLookAwayTimers clears look-away timers and showing flag", () => {
		vi.useFakeTimers();
		const state = new AppRuntimeState();
		state.isLookAwayShowing = true;
		state.lookAwayInterval = setInterval(() => {}, 60_000);
		state.lookAwaySnoozeTimeout = setTimeout(() => {}, 5_000);

		state.clearLookAwayTimers();

		expect(state.lookAwayInterval).toBeNull();
		expect(state.lookAwaySnoozeTimeout).toBeNull();
		expect(state.isLookAwayShowing).toBe(false);
	});
});
