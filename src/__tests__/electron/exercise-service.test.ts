import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRuntimeState } from "../../../electron/application/app-runtime-state";
import { ExerciseService } from "../../../electron/application/exercise-service";
import type { PreferenceStore } from "../../../electron/application/ports/preference-store";
import type {
	ExerciseWindowPort,
	NotificationSoundPort,
} from "../../../electron/application/ports/runtime-ports";
import { snoozeAllPrompts } from "../../../electron/application/snooze-all";
import {
	type AppPreferences,
	DEFAULT_PREFERENCES,
} from "../../../shared/preferences";

function createStore(): PreferenceStore {
	const data = new Map<string, unknown>();
	return {
		get<T>(key: string, defaultValue?: T): T {
			if (data.has(key)) return data.get(key) as T;
			return defaultValue as T;
		},
		set<T>(key: string, value: T): void {
			data.set(key, value);
		},
		has(key: string): boolean {
			return data.has(key);
		},
		clear(): void {
			data.clear();
		},
	};
}

function createPreferences(
	overrides: Partial<AppPreferences> = {},
): AppPreferences {
	return {
		...DEFAULT_PREFERENCES,
		eyeExercisesEnabled: true,
		exerciseInterval: 1,
		lookAwayEnabled: true,
		lookAwayInterval: 1,
		...overrides,
	};
}

function createWindows(): ExerciseWindowPort & {
	lastPopup: unknown;
} {
	const api = {
		lastPopup: null as unknown,
		showExercise: vi.fn((_prompt: string, _onClosed: () => void) => {
			api.lastPopup = { id: Math.random() };
			return api.lastPopup;
		}),
		closeExercise: vi.fn(),
		closeExerciseIfCurrent: vi.fn((token: unknown) => {
			return token === api.lastPopup;
		}),
	};
	return api;
}

function createSound(): NotificationSoundPort {
	return { play: vi.fn(), stop: vi.fn() };
}

function createOs(shown = true) {
	return {
		isSupported: vi.fn(() => true),
		show: vi.fn(() => ({ shown })),
		dismiss: vi.fn(),
		dismissAll: vi.fn(),
		setActivationHandlers: vi.fn(),
	};
}

describe("ExerciseService", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("shows an exercise popup when the interval elapses", () => {
		const preferences = createPreferences({ lookAwayEnabled: false });
		const state = new AppRuntimeState();
		const store = createStore();
		store.set("lastExerciseTime", Date.now() - 61_000);
		const windows = createWindows();
		const sound = createSound();
		const service = new ExerciseService(
			preferences,
			state,
			store,
			windows,
			sound,
		);

		service.start();
		vi.advanceTimersByTime(60_000);

		expect(sound.play).toHaveBeenCalledWith("exercise");
		expect(windows.showExercise).toHaveBeenCalledTimes(1);
		expect(state.isExerciseShowing).toBe(true);
	});

	it("does not show while look-away is showing", () => {
		const preferences = createPreferences({ lookAwayEnabled: false });
		const state = new AppRuntimeState();
		state.isLookAwayShowing = true;
		const store = createStore();
		const dueAt = Date.now() - 61_000;
		store.set("lastExerciseTime", dueAt);
		const windows = createWindows();
		const sound = createSound();
		const service = new ExerciseService(
			preferences,
			state,
			store,
			windows,
			sound,
		);

		service.start();
		vi.advanceTimersByTime(60_000);

		expect(windows.showExercise).not.toHaveBeenCalled();
		expect(sound.play).not.toHaveBeenCalled();
		expect(store.get("lastExerciseTime", 0)).toBe(dueAt);
	});

	it("defers when look-away is also due (prefer look-away)", () => {
		const preferences = createPreferences();
		const state = new AppRuntimeState();
		const store = createStore();
		const dueAt = Date.now() - 61_000;
		store.set("lastExerciseTime", dueAt);
		store.set("lastLookAwayTime", dueAt);
		const windows = createWindows();
		const sound = createSound();
		const service = new ExerciseService(
			preferences,
			state,
			store,
			windows,
			sound,
		);

		service.start();
		vi.advanceTimersByTime(60_000);

		expect(windows.showExercise).not.toHaveBeenCalled();
		expect(sound.play).not.toHaveBeenCalled();
		expect(store.get("lastExerciseTime", 0)).toBe(dueAt);
	});

	it("skip closes the popup and resets the timer", () => {
		const preferences = createPreferences({ lookAwayEnabled: false });
		const state = new AppRuntimeState();
		const store = createStore();
		store.set("lastExerciseTime", Date.now() - 61_000);
		const windows = createWindows();
		const service = new ExerciseService(
			preferences,
			state,
			store,
			windows,
			createSound(),
		);

		service.start();
		vi.advanceTimersByTime(60_000);
		const beforeSkip = store.get("lastExerciseTime", 0);

		vi.setSystemTime(Date.now() + 1_000);
		service.skip();

		expect(windows.closeExercise).toHaveBeenCalled();
		expect(state.isExerciseShowing).toBe(false);
		expect(store.get("lastExerciseTime", 0)).toBeGreaterThanOrEqual(beforeSkip);
	});

	it("snooze closes and re-shows after snoozeMinutes", () => {
		const preferences = createPreferences({
			lookAwayEnabled: false,
			exerciseInterval: 20,
			snoozeMinutes: 10,
		});
		const state = new AppRuntimeState();
		const store = createStore();
		store.set("lastExerciseTime", Date.now() - 21 * 60 * 1000);
		const windows = createWindows();
		const service = new ExerciseService(
			preferences,
			state,
			store,
			windows,
			createSound(),
		);

		service.start();
		vi.advanceTimersByTime(60_000);
		expect(windows.showExercise).toHaveBeenCalledTimes(1);

		service.snooze();
		expect(windows.closeExercise).toHaveBeenCalled();
		expect(state.isExerciseShowing).toBe(false);

		vi.advanceTimersByTime(10 * 60 * 1000 - 1);
		expect(windows.showExercise).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(1);
		expect(windows.showExercise).toHaveBeenCalledTimes(2);
	});

	it("stop closes the popup and clears timers", () => {
		const preferences = createPreferences({ lookAwayEnabled: false });
		const state = new AppRuntimeState();
		const store = createStore();
		store.set("lastExerciseTime", Date.now() - 61_000);
		const windows = createWindows();
		const service = new ExerciseService(
			preferences,
			state,
			store,
			windows,
			createSound(),
		);

		service.start();
		vi.advanceTimersByTime(60_000);
		expect(state.isExerciseShowing).toBe(true);

		service.stop();

		expect(windows.closeExercise).toHaveBeenCalled();
		expect(state.exerciseInterval).toBeNull();
		expect(state.isExerciseShowing).toBe(false);
	});

	it("does not show when the notification gate is closed", () => {
		const preferences = createPreferences({ lookAwayEnabled: false });
		const state = new AppRuntimeState();
		const store = createStore();
		store.set("lastExerciseTime", Date.now() - 61_000);
		const windows = createWindows();
		const sound = createSound();
		const service = new ExerciseService(
			preferences,
			state,
			store,
			windows,
			sound,
			{
				notificationsAllowed: () => false,
				pauseReason: () => "quiet-hours",
			},
		);

		service.start();
		vi.advanceTimersByTime(60_000);

		expect(windows.showExercise).not.toHaveBeenCalled();
		expect(sound.play).not.toHaveBeenCalled();
		expect(state.isExerciseShowing).toBe(false);
	});

	it("clears showing state when showExercise returns nothing", () => {
		const preferences = createPreferences({ lookAwayEnabled: false });
		const state = new AppRuntimeState();
		const store = createStore();
		store.set("lastExerciseTime", Date.now() - 61_000);
		const windows = createWindows();
		windows.showExercise = vi.fn(() => null);
		const sound = createSound();
		const service = new ExerciseService(
			preferences,
			state,
			store,
			windows,
			sound,
		);

		service.start();
		vi.advanceTimersByTime(60_000);

		expect(sound.play).toHaveBeenCalledWith("exercise");
		expect(windows.showExercise).toHaveBeenCalledOnce();
		expect(state.isExerciseShowing).toBe(false);
	});

	it("shows a native toast instead of an overlay when style is native", () => {
		const preferences = createPreferences({
			lookAwayEnabled: false,
			notificationStyle: "native",
		});
		const state = new AppRuntimeState();
		const store = createStore();
		store.set("lastExerciseTime", Date.now() - 61_000);
		const windows = createWindows();
		const sound = createSound();
		const os = createOs();
		const service = new ExerciseService(
			preferences,
			state,
			store,
			windows,
			sound,
			undefined,
			os,
		);

		service.start();
		vi.advanceTimersByTime(60_000);

		expect(sound.play).toHaveBeenCalledWith("exercise");
		expect(os.show).toHaveBeenCalledOnce();
		expect(windows.showExercise).not.toHaveBeenCalled();
		expect(state.isExerciseShowing).toBe(true);
	});

	it("dismissVisible clears native-only showing state", () => {
		const preferences = createPreferences({
			lookAwayEnabled: false,
			notificationStyle: "native",
		});
		const state = new AppRuntimeState();
		const store = createStore();
		store.set("lastExerciseTime", Date.now() - 61_000);
		const windows = createWindows();
		const os = createOs();
		const service = new ExerciseService(
			preferences,
			state,
			store,
			windows,
			createSound(),
			undefined,
			os,
		);

		service.start();
		vi.advanceTimersByTime(60_000);
		expect(state.isExerciseShowing).toBe(true);

		service.dismissVisible();

		expect(state.isExerciseShowing).toBe(false);
		expect(os.dismiss).toHaveBeenCalledWith("exercise");
	});

	it("shows overlay and native toast when style is both", () => {
		const preferences = createPreferences({
			lookAwayEnabled: false,
			notificationStyle: "both",
		});
		const state = new AppRuntimeState();
		const store = createStore();
		store.set("lastExerciseTime", Date.now() - 61_000);
		const windows = createWindows();
		const sound = createSound();
		const os = createOs();
		const service = new ExerciseService(
			preferences,
			state,
			store,
			windows,
			sound,
			undefined,
			os,
		);

		service.start();
		vi.advanceTimersByTime(60_000);

		expect(sound.play).toHaveBeenCalledOnce();
		expect(windows.showExercise).toHaveBeenCalledOnce();
		expect(os.show).toHaveBeenCalledOnce();
	});

	it("falls back to overlay when native show fails", () => {
		const preferences = createPreferences({
			lookAwayEnabled: false,
			notificationStyle: "native",
		});
		const state = new AppRuntimeState();
		const store = createStore();
		store.set("lastExerciseTime", Date.now() - 61_000);
		const windows = createWindows();
		const os = createOs(false);
		const service = new ExerciseService(
			preferences,
			state,
			store,
			windows,
			createSound(),
			undefined,
			os,
		);

		service.start();
		vi.advanceTimersByTime(60_000);

		expect(windows.showExercise).toHaveBeenCalledOnce();
		expect(state.isExerciseShowing).toBe(true);
	});

	it("does not call os.show when the gate is closed", () => {
		const preferences = createPreferences({
			lookAwayEnabled: false,
			notificationStyle: "both",
		});
		const state = new AppRuntimeState();
		const store = createStore();
		store.set("lastExerciseTime", Date.now() - 61_000);
		const windows = createWindows();
		const sound = createSound();
		const os = createOs();
		const service = new ExerciseService(
			preferences,
			state,
			store,
			windows,
			sound,
			{
				notificationsAllowed: () => false,
				pauseReason: () => "quiet-hours",
			},
			os,
		);

		service.start();
		vi.advanceTimersByTime(60_000);

		expect(os.show).not.toHaveBeenCalled();
		expect(windows.showExercise).not.toHaveBeenCalled();
		expect(sound.play).not.toHaveBeenCalled();
	});

	it("does not show a native toast while look-away is due", () => {
		const preferences = createPreferences({ notificationStyle: "native" });
		const state = new AppRuntimeState();
		const store = createStore();
		const dueAt = Date.now() - 61_000;
		store.set("lastExerciseTime", dueAt);
		store.set("lastLookAwayTime", dueAt);
		const windows = createWindows();
		const os = createOs();
		const service = new ExerciseService(
			preferences,
			state,
			store,
			windows,
			createSound(),
			undefined,
			os,
		);

		service.start();
		vi.advanceTimersByTime(60_000);

		expect(os.show).not.toHaveBeenCalled();
		expect(windows.showExercise).not.toHaveBeenCalled();
		expect(state.isExerciseShowing).toBe(false);
	});

	it("snoozeAll still snoozes a native-only exercise", () => {
		const preferences = createPreferences({
			lookAwayEnabled: false,
			notificationStyle: "native",
		});
		const state = new AppRuntimeState();
		const store = createStore();
		store.set("lastExerciseTime", Date.now() - 61_000);
		const windows = createWindows();
		const os = createOs();
		const service = new ExerciseService(
			preferences,
			state,
			store,
			windows,
			createSound(),
			undefined,
			os,
		);

		service.start();
		vi.advanceTimersByTime(60_000);
		expect(state.isExerciseShowing).toBe(true);

		snoozeAllPrompts({
			reminders: { snooze: vi.fn() },
			exercises: service,
			lookAway: { snooze: vi.fn() },
			state,
		});

		expect(os.dismiss).toHaveBeenCalledWith("exercise");
		expect(state.isExerciseShowing).toBe(false);
		expect(windows.showExercise).not.toHaveBeenCalled();
	});
});
