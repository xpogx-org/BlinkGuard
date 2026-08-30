import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRuntimeState } from "../../../electron/application/app-runtime-state";
import { LookAwayService } from "../../../electron/application/look-away-service";
import type { PreferenceStore } from "../../../electron/application/ports/preference-store";
import type {
	LookAwayWindowPort,
	NotificationSoundPort,
} from "../../../electron/application/ports/runtime-ports";
import { snoozeAllPrompts } from "../../../electron/application/snooze-all";
import type { EyeCareStatsRecorder } from "../../../shared/blink-stats";
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
		lookAwayEnabled: true,
		lookAwayInterval: 20,
		lookAwayDuration: 20,
		...overrides,
	};
}

function createWindows(): LookAwayWindowPort & {
	open: boolean;
	lastPopup: unknown;
} {
	const api = {
		open: false,
		lastPopup: null as unknown,
		showLookAway: vi.fn((_onClosed: () => void) => {
			api.open = true;
			api.lastPopup = { id: Math.random() };
			return api.lastPopup;
		}),
		closeLookAway: vi.fn(() => {
			api.open = false;
		}),
		closeLookAwayIfCurrent: vi.fn((token: unknown) => {
			if (token === api.lastPopup) {
				api.open = false;
				return true;
			}
			return false;
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

describe("LookAwayService", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("shows a look-away popup when the interval elapses", () => {
		const preferences = createPreferences({ lookAwayInterval: 1 });
		const state = new AppRuntimeState();
		const store = createStore();
		store.set("lastLookAwayTime", Date.now() - 61_000);
		const windows = createWindows();
		const sound = createSound();
		const service = new LookAwayService(
			preferences,
			state,
			store,
			windows,
			sound,
		);

		service.start();
		vi.advanceTimersByTime(60_000);

		expect(sound.play).toHaveBeenCalledWith("lookAway");
		expect(windows.showLookAway).toHaveBeenCalledTimes(1);
		expect(state.isLookAwayShowing).toBe(true);
	});

	it("does not show when look-away is disabled", () => {
		const preferences = createPreferences({
			lookAwayEnabled: false,
			lookAwayInterval: 1,
		});
		const state = new AppRuntimeState();
		const store = createStore();
		store.set("lastLookAwayTime", Date.now() - 61_000);
		const windows = createWindows();
		const service = new LookAwayService(
			preferences,
			state,
			store,
			windows,
			createSound(),
		);

		service.start();
		vi.advanceTimersByTime(60_000);

		expect(windows.showLookAway).not.toHaveBeenCalled();
	});

	it("auto-closes after lookAwayDuration seconds", () => {
		const preferences = createPreferences({
			lookAwayInterval: 1,
			lookAwayDuration: 5,
		});
		const state = new AppRuntimeState();
		const store = createStore();
		store.set("lastLookAwayTime", Date.now() - 61_000);
		const windows = createWindows();
		const service = new LookAwayService(
			preferences,
			state,
			store,
			windows,
			createSound(),
		);

		service.start();
		vi.advanceTimersByTime(60_000);
		expect(state.isLookAwayShowing).toBe(true);

		vi.advanceTimersByTime(5_000);
		expect(windows.closeLookAwayIfCurrent).toHaveBeenCalled();
		expect(state.isLookAwayShowing).toBe(false);
	});

	it("skip closes the popup and resets the timer", () => {
		const preferences = createPreferences({ lookAwayInterval: 1 });
		const state = new AppRuntimeState();
		const store = createStore();
		store.set("lastLookAwayTime", Date.now() - 61_000);
		const windows = createWindows();
		const service = new LookAwayService(
			preferences,
			state,
			store,
			windows,
			createSound(),
		);

		service.start();
		vi.advanceTimersByTime(60_000);
		const beforeSkip = store.get("lastLookAwayTime", 0);

		vi.setSystemTime(Date.now() + 1_000);
		service.skip();

		expect(windows.closeLookAway).toHaveBeenCalled();
		expect(state.isLookAwayShowing).toBe(false);
		expect(store.get("lastLookAwayTime", 0)).toBeGreaterThanOrEqual(beforeSkip);
	});

	it("snooze closes and re-shows after snoozeMinutes", () => {
		const preferences = createPreferences({
			lookAwayInterval: 20,
			snoozeMinutes: 10,
		});
		const state = new AppRuntimeState();
		const store = createStore();
		store.set("lastLookAwayTime", Date.now() - 21 * 60 * 1000);
		const windows = createWindows();
		const service = new LookAwayService(
			preferences,
			state,
			store,
			windows,
			createSound(),
		);

		service.start();
		vi.advanceTimersByTime(60_000);
		expect(windows.showLookAway).toHaveBeenCalledTimes(1);

		service.snooze();
		expect(windows.closeLookAway).toHaveBeenCalled();
		expect(state.isLookAwayShowing).toBe(false);

		vi.advanceTimersByTime(10 * 60 * 1000 - 1);
		expect(windows.showLookAway).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(1);
		expect(windows.showLookAway).toHaveBeenCalledTimes(2);
	});

	it("suppressPrompts dismisses without scheduling a deferred show", () => {
		const preferences = createPreferences({ lookAwayInterval: 20 });
		const state = new AppRuntimeState();
		const store = createStore();
		store.set("lastLookAwayTime", Date.now() - 21 * 60 * 1000);
		const windows = createWindows();
		const service = new LookAwayService(
			preferences,
			state,
			store,
			windows,
			createSound(),
		);

		service.start();
		vi.advanceTimersByTime(60_000);
		expect(windows.showLookAway).toHaveBeenCalledTimes(1);

		service.suppressPrompts();
		expect(windows.closeLookAway).toHaveBeenCalled();
		expect(state.isLookAwayShowing).toBe(false);

		vi.advanceTimersByTime(10 * 60 * 1000 - 1);
		expect(windows.showLookAway).toHaveBeenCalledTimes(1);
	});

	it("does not show while an exercise popup is open", () => {
		const preferences = createPreferences({ lookAwayInterval: 1 });
		const state = new AppRuntimeState();
		state.isExerciseShowing = true;
		const store = createStore();
		store.set("lastLookAwayTime", Date.now() - 61_000);
		const windows = createWindows();
		const sound = createSound();
		const service = new LookAwayService(
			preferences,
			state,
			store,
			windows,
			sound,
		);

		service.start();
		vi.advanceTimersByTime(60_000);

		expect(windows.showLookAway).not.toHaveBeenCalled();
		expect(sound.play).not.toHaveBeenCalled();
	});

	it("does not show when the notification gate is closed", () => {
		const preferences = createPreferences({ lookAwayInterval: 1 });
		const state = new AppRuntimeState();
		const store = createStore();
		store.set("lastLookAwayTime", Date.now() - 61_000);
		const windows = createWindows();
		const sound = createSound();
		const service = new LookAwayService(
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

		expect(windows.showLookAway).not.toHaveBeenCalled();
		expect(sound.play).not.toHaveBeenCalled();
		expect(state.isLookAwayShowing).toBe(false);
	});

	it("clears showing state when showLookAway returns nothing", () => {
		const preferences = createPreferences({ lookAwayInterval: 1 });
		const state = new AppRuntimeState();
		const store = createStore();
		store.set("lastLookAwayTime", Date.now() - 61_000);
		const windows = createWindows();
		windows.showLookAway = vi.fn(() => null);
		const sound = createSound();
		const service = new LookAwayService(
			preferences,
			state,
			store,
			windows,
			sound,
		);

		service.start();
		vi.advanceTimersByTime(60_000);

		expect(sound.play).toHaveBeenCalledWith("lookAway");
		expect(windows.showLookAway).toHaveBeenCalledOnce();
		expect(state.isLookAwayShowing).toBe(false);
	});

	it("resetTimer bumps lastLookAwayTime without opening a popup", () => {
		const preferences = createPreferences({ lookAwayInterval: 1 });
		const state = new AppRuntimeState();
		const store = createStore();
		const dueAt = Date.now() - 61_000;
		store.set("lastLookAwayTime", dueAt);
		const windows = createWindows();
		const service = new LookAwayService(
			preferences,
			state,
			store,
			windows,
			createSound(),
		);

		vi.setSystemTime(Date.now() + 1_000);
		service.resetTimer();

		expect(store.get("lastLookAwayTime", 0)).toBeGreaterThan(dueAt);
		expect(windows.showLookAway).not.toHaveBeenCalled();
	});

	it("shows a native toast instead of an overlay when style is native", () => {
		const preferences = createPreferences({
			lookAwayInterval: 1,
			notificationStyle: "native",
		});
		const state = new AppRuntimeState();
		const store = createStore();
		store.set("lastLookAwayTime", Date.now() - 61_000);
		const windows = createWindows();
		const os = createOs();
		const service = new LookAwayService(
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

		expect(os.show).toHaveBeenCalledOnce();
		expect(windows.showLookAway).not.toHaveBeenCalled();
		expect(state.isLookAwayShowing).toBe(true);
	});

	it("dismissVisible clears native-only showing state", () => {
		const preferences = createPreferences({
			lookAwayInterval: 1,
			notificationStyle: "native",
		});
		const state = new AppRuntimeState();
		const store = createStore();
		store.set("lastLookAwayTime", Date.now() - 61_000);
		const windows = createWindows();
		const os = createOs();
		const service = new LookAwayService(
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
		expect(state.isLookAwayShowing).toBe(true);

		service.dismissVisible();

		expect(state.isLookAwayShowing).toBe(false);
		expect(os.dismiss).toHaveBeenCalledWith("lookAway");
	});

	it("shows overlay and native toast when style is both", () => {
		const preferences = createPreferences({
			lookAwayInterval: 1,
			notificationStyle: "both",
		});
		const state = new AppRuntimeState();
		const store = createStore();
		store.set("lastLookAwayTime", Date.now() - 61_000);
		const windows = createWindows();
		const sound = createSound();
		const os = createOs();
		const service = new LookAwayService(
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
		expect(windows.showLookAway).toHaveBeenCalledOnce();
		expect(os.show).toHaveBeenCalledOnce();
		expect(state.isLookAwayShowing).toBe(true);
	});

	it("does not call os.show when the gate is closed", () => {
		const preferences = createPreferences({
			lookAwayInterval: 1,
			notificationStyle: "both",
		});
		const state = new AppRuntimeState();
		const store = createStore();
		store.set("lastLookAwayTime", Date.now() - 61_000);
		const windows = createWindows();
		const sound = createSound();
		const os = createOs();
		const service = new LookAwayService(
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
		expect(windows.showLookAway).not.toHaveBeenCalled();
		expect(sound.play).not.toHaveBeenCalled();
	});

	it("snoozeAll still snoozes a native-only look-away", () => {
		const preferences = createPreferences({
			lookAwayInterval: 1,
			notificationStyle: "native",
		});
		const state = new AppRuntimeState();
		const store = createStore();
		store.set("lastLookAwayTime", Date.now() - 61_000);
		const windows = createWindows();
		const os = createOs();
		const service = new LookAwayService(
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
		expect(state.isLookAwayShowing).toBe(true);

		snoozeAllPrompts({
			reminders: { snooze: vi.fn() },
			exercises: { suppressPrompts: vi.fn() },
			lookAway: service,
			state,
			preferences: { snoozeMinutes: 5 },
			focusPause: {
				closeInterruptiveUi: vi.fn(),
				pushState: vi.fn(),
			},
		});

		expect(os.dismiss).toHaveBeenCalledWith("lookAway");
		expect(state.isLookAwayShowing).toBe(false);
		expect(windows.showLookAway).not.toHaveBeenCalled();
	});

	it("records completed when the countdown finishes", () => {
		const stats = { recordEyeCare: vi.fn() } satisfies EyeCareStatsRecorder;
		const preferences = createPreferences({
			lookAwayInterval: 1,
			lookAwayDuration: 5,
		});
		const state = new AppRuntimeState();
		const store = createStore();
		store.set("lastLookAwayTime", Date.now() - 61_000);
		const service = new LookAwayService(
			preferences,
			state,
			store,
			createWindows(),
			createSound(),
			undefined,
			undefined,
			stats,
		);

		service.start();
		vi.advanceTimersByTime(60_000);
		expect(stats.recordEyeCare).not.toHaveBeenCalled();
		vi.advanceTimersByTime(5_000);
		expect(stats.recordEyeCare).toHaveBeenCalledWith("lookAway", "completed");
	});

	it("records skipped on skip while showing, not when idle", () => {
		const stats = { recordEyeCare: vi.fn() } satisfies EyeCareStatsRecorder;
		const preferences = createPreferences({ lookAwayInterval: 1 });
		const state = new AppRuntimeState();
		const store = createStore();
		store.set("lastLookAwayTime", Date.now() - 61_000);
		const service = new LookAwayService(
			preferences,
			state,
			store,
			createWindows(),
			createSound(),
			undefined,
			undefined,
			stats,
		);

		service.skip();
		expect(stats.recordEyeCare).not.toHaveBeenCalled();

		service.start();
		vi.advanceTimersByTime(60_000);
		service.skip();
		expect(stats.recordEyeCare).toHaveBeenCalledWith("lookAway", "skipped");
		expect(stats.recordEyeCare).not.toHaveBeenCalledWith(
			"lookAway",
			"completed",
		);
	});

	it("records snoozed and not completed", () => {
		const stats = { recordEyeCare: vi.fn() } satisfies EyeCareStatsRecorder;
		const preferences = createPreferences({ lookAwayInterval: 1 });
		const state = new AppRuntimeState();
		const store = createStore();
		store.set("lastLookAwayTime", Date.now() - 61_000);
		const service = new LookAwayService(
			preferences,
			state,
			store,
			createWindows(),
			createSound(),
			undefined,
			undefined,
			stats,
		);

		service.start();
		vi.advanceTimersByTime(60_000);
		service.snooze();
		expect(stats.recordEyeCare).toHaveBeenCalledWith("lookAway", "snoozed");
		vi.advanceTimersByTime(20_000);
		expect(stats.recordEyeCare).not.toHaveBeenCalledWith(
			"lookAway",
			"completed",
		);
	});
});
