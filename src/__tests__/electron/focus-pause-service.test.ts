import { describe, expect, it, vi } from "vitest";
import { FocusPauseService } from "../../../electron/application/focus-pause-service";
import { DEFAULT_PREFERENCES } from "../../../shared/preferences";
import type { FocusPauseStatePayload } from "../../../shared/session-pause-status";

function hoursWindowContainingNow(): { start: string; end: string } {
	const now = new Date();
	const start = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
	const endHour = (now.getHours() + 1) % 24;
	const end = `${String(endHour).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
	return { start, end };
}

function makeService(
	prefs: Partial<typeof DEFAULT_PREFERENCES> = {},
	supported = true,
) {
	const sendToMain = vi.fn();
	const closeReminder = vi.fn();
	const closeExercise = vi.fn();
	const closeLookAway = vi.fn();
	const hideNoFace = vi.fn();
	const hideAmbient = vi.fn();
	const hideCalibrationNudge = vi.fn();
	const pauseCameraForFocus = vi.fn();
	const resumeCameraIfNeeded = vi.fn();
	const dismissAll = vi.fn();
	const freeze = vi.fn();
	const resume = vi.fn();
	const preferences = {
		...DEFAULT_PREFERENCES,
		quietHoursEnabled: false,
		cameraEnabled: true,
		isTracking: true,
		...prefs,
	};
	const service = new FocusPauseService(
		preferences,
		{
			closeReminder,
			closeExercise,
			closeLookAway,
			hideNoFace,
			hideAmbient,
			hideCalibrationNudge,
			sendToMain,
		},
		{ pauseCameraForFocus, resumeCameraIfNeeded } as never,
		"focus-pause-state",
		supported,
		{
			isSupported: () => false,
			show: () => ({ shown: false }),
			dismiss: () => {},
			dismissAll,
			setActivationHandlers: () => {},
		},
		{ freeze, resume },
	);
	return {
		service,
		preferences,
		sendToMain,
		closeReminder,
		closeExercise,
		hideAmbient,
		pauseCameraForFocus,
		resumeCameraIfNeeded,
		dismissAll,
		freeze,
		resume,
	};
}

function pausePayload(
	overrides: Partial<FocusPauseStatePayload> = {},
): FocusPauseStatePayload {
	return {
		reason: null,
		fullscreenDetectionSupported: true,
		sessionPauseMode: "active",
		sessionIdleCause: null,
		...overrides,
	};
}

describe("FocusPauseService pushState", () => {
	it("includes fullscreenDetectionSupported in the payload", () => {
		const { service, sendToMain } = makeService({}, false);

		service.pushState();

		expect(sendToMain).toHaveBeenCalledWith(
			"focus-pause-state",
			pausePayload({ fullscreenDetectionSupported: false }),
		);
	});
});

describe("FocusPauseService app-rule / fullscreen / quiet hours", () => {
	it("pauses popups and camera on an app-rule match without freezing the clock", () => {
		const {
			service,
			closeReminder,
			hideAmbient,
			pauseCameraForFocus,
			freeze,
			sendToMain,
		} = makeService({
			pauseAppRules: [{ processName: "Zoom.exe", windowTitle: "" }],
		});

		service.setForeground({
			isFullscreen: false,
			processName: "Zoom.exe",
			windowTitle: "Zoom Meeting",
		});

		expect(service.pauseReason()).toBe("app-rule");
		expect(service.notificationsAllowed()).toBe(false);
		expect(closeReminder).toHaveBeenCalled();
		expect(hideAmbient).toHaveBeenCalled();
		expect(pauseCameraForFocus).toHaveBeenCalled();
		expect(freeze).not.toHaveBeenCalled();
		expect(sendToMain).toHaveBeenCalledWith(
			"focus-pause-state",
			pausePayload({ reason: "app-rule" }),
		);
	});

	it("does not pause when the foreground misses the blocklist", () => {
		const { service, closeReminder, pauseCameraForFocus, freeze } = makeService({
			pauseAppRules: [{ processName: "Zoom.exe", windowTitle: "" }],
		});

		service.setForeground({
			isFullscreen: false,
			processName: "chrome.exe",
			windowTitle: "Docs",
		});

		expect(service.pauseReason()).toBeNull();
		expect(service.notificationsAllowed()).toBe(true);
		expect(closeReminder).not.toHaveBeenCalled();
		expect(pauseCameraForFocus).not.toHaveBeenCalled();
		expect(freeze).not.toHaveBeenCalled();
	});

	it("resumes the camera when leaving an app-rule match", () => {
		const { service, pauseCameraForFocus, resumeCameraIfNeeded, freeze } =
			makeService({
				pauseAppRules: [{ processName: "zoom", windowTitle: "" }],
			});

		service.setForeground({
			isFullscreen: false,
			processName: "Zoom.exe",
			windowTitle: "",
		});
		expect(pauseCameraForFocus).toHaveBeenCalled();
		expect(freeze).not.toHaveBeenCalled();

		service.setForeground({
			isFullscreen: false,
			processName: "Code.exe",
			windowTitle: "BlinkGuard",
		});
		expect(resumeCameraIfNeeded).toHaveBeenCalledTimes(1);
		expect(service.pauseReason()).toBeNull();
	});

	it("pauses camera and freezes tracking during quiet hours without Stop", () => {
		const { start, end } = hoursWindowContainingNow();
		const {
			service,
			preferences,
			pauseCameraForFocus,
			closeReminder,
			dismissAll,
			freeze,
			resume,
		} = makeService({
			quietHoursEnabled: true,
			quietHoursStart: start,
			quietHoursEnd: end,
		});

		service.recompute();

		expect(service.pauseReason()).toBe("quiet-hours");
		expect(closeReminder).toHaveBeenCalled();
		expect(dismissAll).toHaveBeenCalled();
		expect(pauseCameraForFocus).toHaveBeenCalled();
		expect(freeze).toHaveBeenCalled();
		expect(resume).not.toHaveBeenCalled();
		expect(preferences.isTracking).toBe(true);
	});

	it("resumes camera and tracking clock when leaving quiet hours", () => {
		const prefs = {
			...DEFAULT_PREFERENCES,
			quietHoursEnabled: true,
			quietHoursStart: "22:00",
			quietHoursEnd: "08:00",
			quietHoursByWeekday: {},
			cameraEnabled: true,
			isTracking: true,
		};
		const pauseCameraForFocus = vi.fn();
		const resumeCameraIfNeeded = vi.fn();
		const freeze = vi.fn();
		const resume = vi.fn();
		const service = new FocusPauseService(
			prefs,
			{
				closeReminder: vi.fn(),
				closeExercise: vi.fn(),
				closeLookAway: vi.fn(),
				hideNoFace: vi.fn(),
				hideAmbient: vi.fn(),
				hideCalibrationNudge: vi.fn(),
				sendToMain: vi.fn(),
			},
			{ pauseCameraForFocus, resumeCameraIfNeeded } as never,
			"focus-pause-state",
			true,
			{
				isSupported: () => false,
				show: () => ({ shown: false }),
				dismiss: () => {},
				dismissAll: vi.fn(),
				setActivationHandlers: () => {},
			},
			{ freeze, resume },
		);

		const dayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
		const todayIndex = new Date().getDay();
		const today = dayKeys[todayIndex] ?? "mon";
		const yesterday = dayKeys[(todayIndex + 6) % 7] ?? "sun";
		const { start, end } = hoursWindowContainingNow();

		prefs.quietHoursByWeekday = {
			[today]: { mode: "custom", start, end },
		};
		service.recompute();
		expect(service.pauseReason()).toBe("quiet-hours");
		expect(pauseCameraForFocus).toHaveBeenCalled();
		expect(freeze).toHaveBeenCalled();

		pauseCameraForFocus.mockClear();
		freeze.mockClear();
		prefs.quietHoursByWeekday = {
			[today]: { mode: "off" },
			[yesterday]: { mode: "off" },
		};
		service.recompute();

		expect(service.pauseReason()).toBeNull();
		expect(resumeCameraIfNeeded).toHaveBeenCalledTimes(1);
		expect(resume).toHaveBeenCalledTimes(1);
		expect(prefs.isTracking).toBe(true);
		expect(pauseCameraForFocus).not.toHaveBeenCalled();
		expect(freeze).not.toHaveBeenCalled();
	});

	it("does not freeze when weekday override is off", () => {
		const dayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
		const todayIndex = new Date().getDay();
		const today = dayKeys[todayIndex] ?? "mon";
		const yesterday = dayKeys[(todayIndex + 6) % 7] ?? "sun";
		const { service, pauseCameraForFocus, freeze } = makeService({
			quietHoursEnabled: true,
			quietHoursStart: "00:00",
			quietHoursEnd: "23:59",
			quietHoursByWeekday: {
				[today]: { mode: "off" },
				[yesterday]: { mode: "off" },
			},
		});

		service.recompute();

		expect(service.pauseReason()).toBeNull();
		expect(pauseCameraForFocus).not.toHaveBeenCalled();
		expect(freeze).not.toHaveBeenCalled();
	});

	it("re-applies camera pause and freeze when tracking starts during quiet hours", () => {
		const { start, end } = hoursWindowContainingNow();
		const { service, preferences, pauseCameraForFocus, freeze } = makeService({
			quietHoursEnabled: true,
			quietHoursStart: start,
			quietHoursEnd: end,
			isTracking: false,
		});

		service.recompute();
		expect(pauseCameraForFocus).not.toHaveBeenCalled();
		expect(freeze).not.toHaveBeenCalled();

		preferences.isTracking = true;
		service.recompute();

		expect(service.pauseReason()).toBe("quiet-hours");
		expect(pauseCameraForFocus).toHaveBeenCalled();
		expect(freeze).toHaveBeenCalled();
	});

	it("re-freezes after Stop then Start during quiet hours", () => {
		const { start, end } = hoursWindowContainingNow();
		const { service, preferences, freeze } = makeService({
			quietHoursEnabled: true,
			quietHoursStart: start,
			quietHoursEnd: end,
			isTracking: true,
		});

		service.recompute();
		expect(freeze).toHaveBeenCalledTimes(1);

		preferences.isTracking = false;
		service.recompute();
		freeze.mockClear();

		preferences.isTracking = true;
		service.recompute();
		expect(freeze).toHaveBeenCalledTimes(1);
	});

	it("runs prompt dismissers so native-only showing flags can clear", () => {
		const { start, end } = hoursWindowContainingNow();
		const { service, dismissAll } = makeService({
			quietHoursEnabled: true,
			quietHoursStart: start,
			quietHoursEnd: end,
		});
		const blink = vi.fn();
		const exercise = vi.fn();
		const lookAway = vi.fn();
		service.bindPromptDismissers({ blink, exercise, lookAway });

		service.recompute();

		expect(blink).toHaveBeenCalledOnce();
		expect(exercise).toHaveBeenCalledOnce();
		expect(lookAway).toHaveBeenCalledOnce();
		expect(dismissAll).toHaveBeenCalled();
	});

	it("soft-pauses the camera on fullscreen without freezing the clock", () => {
		const { service, pauseCameraForFocus, freeze } = makeService();

		service.setFullscreen(true);

		expect(service.pauseReason()).toBe("fullscreen");
		expect(pauseCameraForFocus).toHaveBeenCalled();
		expect(freeze).not.toHaveBeenCalled();
	});

	it("overlays session-idle on top of other pause reasons", () => {
		const { start, end } = hoursWindowContainingNow();
		const { service, sendToMain, closeReminder, resume } = makeService({
			quietHoursEnabled: true,
			quietHoursStart: start,
			quietHoursEnd: end,
		});
		service.recompute();
		expect(service.pauseReason()).toBe("quiet-hours");

		service.setSessionOverlay({ mode: "inactive", cause: "lock" });

		expect(service.pauseReason()).toBe("session-idle");
		expect(service.notificationsAllowed()).toBe(false);
		expect(closeReminder).toHaveBeenCalled();
		expect(sendToMain).toHaveBeenCalledWith(
			"focus-pause-state",
			pausePayload({
				reason: "session-idle",
				sessionPauseMode: "inactive",
				sessionIdleCause: "lock",
			}),
		);

		service.setSessionOverlay({ mode: "active", cause: null });
		expect(service.pauseReason()).toBe("quiet-hours");
		expect(service.notificationsAllowed()).toBe(false);

		// Quiet hours still active while session wakes — do not resume clock
		// from the overlay flip alone (recompute owns freeze/resume).
		resume.mockClear();
		service.recompute();
		expect(resume).not.toHaveBeenCalled();
	});

	it("skips clock resume when quiet hours end while session is inactive", () => {
		const prefs = {
			...DEFAULT_PREFERENCES,
			quietHoursEnabled: true,
			quietHoursStart: "22:00",
			quietHoursEnd: "08:00",
			quietHoursByWeekday: {} as typeof DEFAULT_PREFERENCES.quietHoursByWeekday,
			cameraEnabled: true,
			isTracking: true,
		};
		const freeze = vi.fn();
		const resume = vi.fn();
		const service = new FocusPauseService(
			prefs,
			{
				closeReminder: vi.fn(),
				closeExercise: vi.fn(),
				closeLookAway: vi.fn(),
				hideNoFace: vi.fn(),
				hideAmbient: vi.fn(),
				hideCalibrationNudge: vi.fn(),
				sendToMain: vi.fn(),
			},
			{
				pauseCameraForFocus: vi.fn(),
				resumeCameraIfNeeded: vi.fn(),
			} as never,
			"focus-pause-state",
			true,
			undefined,
			{ freeze, resume },
		);

		const dayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
		const todayIndex = new Date().getDay();
		const today = dayKeys[todayIndex] ?? "mon";
		const yesterday = dayKeys[(todayIndex + 6) % 7] ?? "sun";
		const { start, end } = hoursWindowContainingNow();

		prefs.quietHoursByWeekday = {
			[today]: { mode: "custom", start, end },
		};
		service.recompute();
		expect(freeze).toHaveBeenCalled();

		service.setSessionOverlay({ mode: "inactive", cause: "lock" });
		service.recompute();

		prefs.quietHoursByWeekday = {
			[today]: { mode: "off" },
			[yesterday]: { mode: "off" },
		};
		resume.mockClear();
		service.recompute();

		expect(service.pauseReason()).toBe("session-idle");
		expect(resume).not.toHaveBeenCalled();
	});

	it("surfaces camera-only lid without blocking notifications", () => {
		const { service, sendToMain, closeReminder, dismissAll } = makeService();
		const exercise = vi.fn();
		service.bindPromptDismissers({
			blink: vi.fn(),
			exercise,
			lookAway: vi.fn(),
		});

		service.setSessionOverlay({ mode: "camera-only", cause: "lid" });

		expect(service.pauseReason()).toBeNull();
		expect(service.notificationsAllowed()).toBe(true);
		expect(closeReminder).not.toHaveBeenCalled();
		expect(dismissAll).not.toHaveBeenCalled();
		expect(exercise).not.toHaveBeenCalled();
		expect(sendToMain).toHaveBeenCalledWith(
			"focus-pause-state",
			pausePayload({
				sessionPauseMode: "camera-only",
				sessionIdleCause: "lid",
			}),
		);
	});

	it("picks up quietHoursByWeekday changes on recompute", () => {
		const prefs = {
			...DEFAULT_PREFERENCES,
			quietHoursEnabled: true,
			quietHoursStart: "22:00",
			quietHoursEnd: "08:00",
			quietHoursByWeekday: {},
			cameraEnabled: true,
			isTracking: true,
		};
		const sendToMain = vi.fn();
		const service = new FocusPauseService(
			prefs,
			{
				closeReminder: vi.fn(),
				closeExercise: vi.fn(),
				closeLookAway: vi.fn(),
				hideNoFace: vi.fn(),
				hideAmbient: vi.fn(),
				hideCalibrationNudge: vi.fn(),
				sendToMain,
			},
			{
				pauseCameraForFocus: vi.fn(),
				resumeCameraIfNeeded: vi.fn(),
			} as never,
			"focus-pause-state",
			true,
		);

		const dayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
		const todayIndex = new Date().getDay();
		const today = dayKeys[todayIndex] ?? "mon";
		const yesterday = dayKeys[(todayIndex + 6) % 7] ?? "sun";
		const { start, end } = hoursWindowContainingNow();

		prefs.quietHoursByWeekday = {
			[today]: { mode: "custom", start, end },
		};
		service.recompute();
		expect(service.pauseReason()).toBe("quiet-hours");

		prefs.quietHoursByWeekday = {
			[today]: { mode: "off" },
			[yesterday]: { mode: "off" },
		};
		service.recompute();
		expect(service.pauseReason()).toBeNull();
	});

	it("keeps the 30s quiet-hours watch interval", () => {
		vi.useFakeTimers();
		try {
			const { service } = makeService({ quietHoursEnabled: false });
			const spy = vi.spyOn(service, "recompute");
			service.startQuietHoursWatch(30_000);
			expect(spy).toHaveBeenCalled();
			spy.mockClear();
			vi.advanceTimersByTime(30_000);
			expect(spy).toHaveBeenCalledTimes(1);
			service.stopQuietHoursWatch();
			spy.mockClear();
			vi.advanceTimersByTime(30_000);
			expect(spy).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it("keeps quiet hours after midnight when Saturday is off and Friday wrapped", () => {
		vi.useFakeTimers();
		try {
			// 2026-08-21 is Friday; overnight default 22:00–08:00.
			vi.setSystemTime(new Date(2026, 7, 21, 23, 0, 0));
			const { service } = makeService({
				quietHoursEnabled: true,
				quietHoursStart: "22:00",
				quietHoursEnd: "08:00",
				quietHoursByWeekday: { sat: { mode: "off" } },
			});
			service.startQuietHoursWatch(30_000);
			expect(service.pauseReason()).toBe("quiet-hours");

			vi.setSystemTime(new Date(2026, 7, 22, 1, 0, 0));
			vi.advanceTimersByTime(30_000);
			expect(service.pauseReason()).toBe("quiet-hours");
			service.stopQuietHoursWatch();
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("FocusPauseService recompute after rule assignment", () => {
	it("pauses when a process-only rule is assigned while foreground still matches", () => {
		const sendToMain = vi.fn();
		const closeReminder = vi.fn();
		const pauseCameraForFocus = vi.fn();
		const freeze = vi.fn();
		const preferences = {
			...DEFAULT_PREFERENCES,
			quietHoursEnabled: false,
			cameraEnabled: true,
			isTracking: true,
			pauseAppRules: [] as typeof DEFAULT_PREFERENCES.pauseAppRules,
		};
		const service = new FocusPauseService(
			preferences,
			{
				closeReminder,
				closeExercise: vi.fn(),
				closeLookAway: vi.fn(),
				hideNoFace: vi.fn(),
				hideAmbient: vi.fn(),
				hideCalibrationNudge: vi.fn(),
				sendToMain,
			},
			{ pauseCameraForFocus, resumeCameraIfNeeded: vi.fn() } as never,
			"focus-pause-state",
			true,
			undefined,
			{ freeze, resume: vi.fn() },
		);

		service.setForeground({
			isFullscreen: false,
			processName: "Zoom.exe",
			windowTitle: "Zoom Meeting",
		});
		expect(service.pauseReason()).toBeNull();

		preferences.pauseAppRules = [{ processName: "Zoom.exe", windowTitle: "" }];
		service.recompute();

		expect(service.pauseReason()).toBe("app-rule");
		expect(closeReminder).toHaveBeenCalled();
		expect(pauseCameraForFocus).toHaveBeenCalled();
		expect(freeze).not.toHaveBeenCalled();
	});
});

describe("FocusPauseService lastExternalForeground", () => {
	it("keeps the last process-only identity when BlinkGuard-focused probes are empty", () => {
		const { service } = makeService();

		service.setForeground({
			isFullscreen: false,
			processName: "Zoom.exe",
			windowTitle: "Zoom Meeting",
		});
		expect(service.lastExternalForeground()).toEqual({
			processName: "Zoom.exe",
			windowTitle: "",
		});

		service.setForeground({
			isFullscreen: false,
			processName: null,
			windowTitle: null,
		});
		expect(service.lastExternalForeground()).toEqual({
			processName: "Zoom.exe",
			windowTitle: "",
		});
	});
});
