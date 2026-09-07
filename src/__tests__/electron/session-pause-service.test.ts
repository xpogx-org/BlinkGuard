import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRuntimeState } from "../../../electron/application/app-runtime-state";
import { SessionPauseService } from "../../../electron/application/session-pause-service";
import { SESSION_RESUME_DELAY_MS } from "../../../electron/domain/session-activity-policy";
import { DEFAULT_PREFERENCES } from "../../../shared/preferences";

function makeService(prefs: Partial<typeof DEFAULT_PREFERENCES> = {}) {
	const preferences = {
		...DEFAULT_PREFERENCES,
		isTracking: true,
		cameraEnabled: true,
		eyeExercisesEnabled: true,
		lookAwayEnabled: true,
		...prefs,
	};
	const state = new AppRuntimeState();
	const pauseForSession = vi.fn();
	const pauseCameraForClamshell = vi.fn();
	const pauseCameraForFocus = vi.fn();
	const resumeAfterSleep = vi.fn();
	const resumeCameraIfNeeded = vi.fn();
	const exercises = {
		start: vi.fn(),
		stop: vi.fn(),
		resetTimer: vi.fn(),
	};
	const lookAway = {
		start: vi.fn(),
		stop: vi.fn(),
		resetTimer: vi.fn(),
	};
	const focusPause = {
		setSessionOverlay: vi.fn(),
		recompute: vi.fn(),
		pauseReason: vi.fn(
			(): null | "quiet-hours" | "fullscreen" | "app-rule" | "session-idle" | "manual-hush" =>
				null,
		),
	};
	const service = new SessionPauseService(
		preferences,
		state,
		{
			pauseForSession,
			pauseCameraForClamshell,
			pauseCameraForFocus,
			resumeAfterSleep,
			resumeCameraIfNeeded,
		},
		exercises,
		lookAway,
		focusPause,
	);
	return {
		service,
		preferences,
		state,
		pauseForSession,
		pauseCameraForClamshell,
		pauseCameraForFocus,
		resumeAfterSleep,
		resumeCameraIfNeeded,
		exercises,
		lookAway,
		focusPause,
	};
}

describe("SessionPauseService", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("pauses tracking and eye-care immediately on lock without clearing isTracking", () => {
		const ctx = makeService();
		ctx.state.exerciseInterval = setInterval(() => {}, 60_000);
		ctx.state.lookAwayInterval = setInterval(() => {}, 60_000);

		ctx.service.setPowerFlags({ locked: true });

		expect(ctx.pauseForSession).toHaveBeenCalledTimes(1);
		expect(ctx.exercises.stop).toHaveBeenCalled();
		expect(ctx.lookAway.stop).toHaveBeenCalled();
		expect(ctx.focusPause.setSessionOverlay).toHaveBeenCalledWith({
			mode: "inactive",
			cause: "lock",
		});
		expect(ctx.preferences.isTracking).toBe(true);
		clearInterval(ctx.state.exerciseInterval);
		clearInterval(ctx.state.lookAwayInterval);
	});

	it("delays resume until after the wake debounce", () => {
		const ctx = makeService();
		ctx.state.exerciseInterval = setInterval(() => {}, 60_000);
		ctx.service.setPowerFlags({ locked: true });
		ctx.exercises.stop.mockClear();
		clearInterval(ctx.state.exerciseInterval);
		ctx.state.exerciseInterval = null;

		ctx.service.setPowerFlags({ locked: false });
		expect(ctx.resumeAfterSleep).not.toHaveBeenCalled();
		expect(ctx.focusPause.setSessionOverlay).toHaveBeenLastCalledWith({
			mode: "inactive",
			cause: "lock",
		});

		vi.advanceTimersByTime(SESSION_RESUME_DELAY_MS - 1);
		expect(ctx.resumeAfterSleep).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1);
		expect(ctx.focusPause.setSessionOverlay).toHaveBeenLastCalledWith({
			mode: "active",
			cause: null,
		});
		expect(ctx.focusPause.recompute).toHaveBeenCalled();
		expect(ctx.exercises.resetTimer).toHaveBeenCalled();
		expect(ctx.exercises.start).toHaveBeenCalled();
		expect(ctx.resumeAfterSleep).toHaveBeenCalledWith({
			releaseCamera: true,
			restoreStats: true,
		});
	});

	it("cancels a pending resume when the session goes inactive again", () => {
		const ctx = makeService();
		ctx.service.setPowerFlags({ locked: true });
		ctx.service.setPowerFlags({ locked: false });
		ctx.service.setPowerFlags({ locked: true });
		vi.advanceTimersByTime(SESSION_RESUME_DELAY_MS);
		expect(ctx.resumeAfterSleep).not.toHaveBeenCalled();
		expect(ctx.pauseForSession).toHaveBeenCalledTimes(1);
	});

	it("soft-pauses only the camera for clamshell lid-close", () => {
		const ctx = makeService();
		ctx.service.setEnvironment({ displaysAsleep: false, lidClosed: true });
		expect(ctx.pauseCameraForClamshell).toHaveBeenCalledTimes(1);
		expect(ctx.pauseForSession).not.toHaveBeenCalled();
		expect(ctx.exercises.stop).not.toHaveBeenCalled();
		expect(ctx.focusPause.setSessionOverlay).toHaveBeenCalledWith({
			mode: "camera-only",
			cause: "lid",
		});
		expect(
			ctx.focusPause.setSessionOverlay.mock.calls.every(
				([overlay]) => overlay.mode !== "inactive",
			),
		).toBe(true);
	});

	it("does not resume tracking if the user stopped during the pause", () => {
		const ctx = makeService();
		ctx.service.setPowerFlags({ suspended: true });
		ctx.preferences.isTracking = false;
		ctx.service.setPowerFlags({ suspended: false });
		vi.advanceTimersByTime(SESSION_RESUME_DELAY_MS);
		expect(ctx.resumeAfterSleep).not.toHaveBeenCalled();
		expect(ctx.resumeCameraIfNeeded).toHaveBeenCalledWith("session");
	});

	it("ignores duplicate power flags and environment snapshots", () => {
		const locked = makeService();
		locked.service.setPowerFlags({ locked: true });
		locked.service.setPowerFlags({ locked: true });
		expect(locked.pauseForSession).toHaveBeenCalledTimes(1);

		const clamshell = makeService();
		clamshell.service.setEnvironment({
			displaysAsleep: false,
			lidClosed: true,
		});
		clamshell.service.setEnvironment({
			displaysAsleep: false,
			lidClosed: true,
		});
		expect(clamshell.pauseCameraForClamshell).toHaveBeenCalledTimes(1);
	});

	it("updates the overlay cause when lock follows display-off without a second pause", () => {
		const ctx = makeService();
		ctx.service.setEnvironment({ displaysAsleep: true, lidClosed: false });
		expect(ctx.pauseForSession).toHaveBeenCalledTimes(1);
		expect(ctx.focusPause.setSessionOverlay).toHaveBeenCalledWith({
			mode: "inactive",
			cause: "display-off",
		});

		ctx.service.setPowerFlags({ locked: true });
		expect(ctx.pauseForSession).toHaveBeenCalledTimes(1);
		expect(ctx.focusPause.setSessionOverlay).toHaveBeenLastCalledWith({
			mode: "inactive",
			cause: "lock",
		});
	});

	it("overlays suspend as the primary cause", () => {
		const ctx = makeService();
		ctx.service.setPowerFlags({ suspended: true });
		expect(ctx.focusPause.setSessionOverlay).toHaveBeenCalledWith({
			mode: "inactive",
			cause: "suspend",
		});
	});

	it("does not restore tracking stats on unlock during quiet hours", () => {
		const ctx = makeService();
		ctx.focusPause.pauseReason.mockReturnValue("quiet-hours");
		ctx.service.setPowerFlags({ locked: true });
		ctx.service.setPowerFlags({ locked: false });
		vi.advanceTimersByTime(SESSION_RESUME_DELAY_MS);

		expect(ctx.resumeAfterSleep).toHaveBeenCalledWith({
			releaseCamera: true,
			restoreStats: false,
		});
		expect(ctx.focusPause.recompute.mock.calls.length).toBeGreaterThanOrEqual(2);
	});

	it("restores tracking stats on unlock when not in quiet hours", () => {
		const ctx = makeService();
		ctx.focusPause.pauseReason.mockReturnValue(null);
		ctx.service.setPowerFlags({ locked: true });
		ctx.service.setPowerFlags({ locked: false });
		vi.advanceTimersByTime(SESSION_RESUME_DELAY_MS);

		expect(ctx.resumeAfterSleep).toHaveBeenCalledWith({
			releaseCamera: true,
			restoreStats: true,
		});
	});
});
