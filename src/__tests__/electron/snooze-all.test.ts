import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	endPromptHush,
	snoozeAllPrompts,
	type PromptHushDeps,
} from "../../../electron/application/snooze-all";

function createState() {
	return {
		promptSuppressUntil: 0,
		promptSuppressTimeout: null as ReturnType<typeof setTimeout> | null,
		blinkSnoozeUntil: 0,
		blinkSnoozeTimeout: null as ReturnType<typeof setTimeout> | null,
		exerciseSnoozeTimeout: null as ReturnType<typeof setTimeout> | null,
		lookAwaySnoozeTimeout: null as ReturnType<typeof setTimeout> | null,
	};
}

function createDeps(
	overrides: Partial<PromptHushDeps> = {},
): PromptHushDeps {
	const state = createState();
	return {
		reminders: { snooze: vi.fn() },
		exercises: { suppressPrompts: vi.fn() },
		lookAway: { suppressPrompts: vi.fn() },
		state,
		preferences: { snoozeMinutes: 5 },
		focusPause: {
			closeInterruptiveUi: vi.fn(),
			pushState: vi.fn(),
		},
		onHushStateChange: vi.fn(),
		...overrides,
	};
}

describe("snoozeAllPrompts", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("hushes all prompt kinds and dismisses visible UI", () => {
		const deps = createDeps();
		const now = Date.now();

		snoozeAllPrompts(deps);

		expect(deps.focusPause.closeInterruptiveUi).toHaveBeenCalledOnce();
		expect(deps.reminders.snooze).toHaveBeenCalledOnce();
		expect(deps.exercises.suppressPrompts).toHaveBeenCalledOnce();
		expect(deps.lookAway.suppressPrompts).toHaveBeenCalledOnce();
		expect(deps.state.promptSuppressUntil).toBe(now + 5 * 60 * 1000);
		expect(deps.focusPause.pushState).toHaveBeenCalledOnce();
		expect(deps.onHushStateChange).toHaveBeenCalledOnce();
	});

	it("clears hush after snoozeMinutes and pushes state", () => {
		const deps = createDeps();

		snoozeAllPrompts(deps);
		expect(deps.state.promptSuppressUntil).toBeGreaterThan(Date.now());

		vi.advanceTimersByTime(5 * 60 * 1000);

		expect(deps.state.promptSuppressUntil).toBe(0);
		expect(deps.focusPause.pushState).toHaveBeenCalledTimes(2);
		expect(deps.onHushStateChange).toHaveBeenCalledTimes(2);
	});

	it("clears blink snooze when hush expires", () => {
		const deps = createDeps();
		deps.reminders.snooze = vi.fn(() => {
			deps.state.blinkSnoozeUntil = Date.now() + 5 * 60 * 1000;
			deps.state.blinkSnoozeTimeout = setTimeout(() => {}, 5 * 60 * 1000);
		});

		snoozeAllPrompts(deps);
		expect(deps.state.blinkSnoozeUntil).toBeGreaterThan(Date.now());

		vi.advanceTimersByTime(5 * 60 * 1000);

		expect(deps.state.blinkSnoozeUntil).toBe(0);
		expect(deps.state.blinkSnoozeTimeout).toBeNull();
	});
});

describe("endPromptHush", () => {
	it("clears suppress timers and pushes state when hushed", () => {
		const deps = createDeps();
		deps.state.promptSuppressUntil = Date.now() + 60_000;
		deps.state.blinkSnoozeUntil = Date.now() + 60_000;
		deps.state.blinkSnoozeTimeout = setTimeout(() => {}, 60_000);
		deps.state.exerciseSnoozeTimeout = setTimeout(() => {}, 60_000);
		deps.state.lookAwaySnoozeTimeout = setTimeout(() => {}, 60_000);

		endPromptHush(deps);

		expect(deps.state.promptSuppressUntil).toBe(0);
		expect(deps.state.blinkSnoozeUntil).toBe(0);
		expect(deps.state.blinkSnoozeTimeout).toBeNull();
		expect(deps.state.exerciseSnoozeTimeout).toBeNull();
		expect(deps.state.lookAwaySnoozeTimeout).toBeNull();
		expect(deps.focusPause.pushState).toHaveBeenCalledOnce();
		expect(deps.onHushStateChange).toHaveBeenCalledOnce();
	});

	it("no-ops when not hushed", () => {
		const deps = createDeps();

		endPromptHush(deps);

		expect(deps.focusPause.pushState).not.toHaveBeenCalled();
		expect(deps.onHushStateChange).not.toHaveBeenCalled();
	});
});
