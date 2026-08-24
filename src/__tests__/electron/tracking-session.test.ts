import { describe, expect, it, vi } from "vitest";
import {
	startTrackingSession,
	stopTrackingSession,
	type TrackingSessionDeps,
	toggleTrackingSession,
} from "../../../electron/application/tracking-session";

function createDeps(
	overrides: Partial<{
		eyeExercisesEnabled: boolean;
		lookAwayEnabled: boolean;
		reminderInterval: number;
		eyeCareIndependentOfTracking: boolean;
	}> = {},
) {
	const reminders = {
		start: vi.fn(),
		stop: vi.fn(),
		ensureStopped: vi.fn(),
	};
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
	const deps = {
		reminders,
		exercises,
		lookAway,
		preferences: {
			eyeExercisesEnabled: overrides.eyeExercisesEnabled ?? true,
			lookAwayEnabled: overrides.lookAwayEnabled ?? true,
			reminderInterval: overrides.reminderInterval ?? 5000,
			eyeCareIndependentOfTracking:
				overrides.eyeCareIndependentOfTracking ?? true,
		},
	};
	return deps as TrackingSessionDeps & typeof deps;
}

describe("tracking-session", () => {
	it("stopTrackingSession stops only blink when eye-care is independent", () => {
		const deps = createDeps({ eyeCareIndependentOfTracking: true });
		stopTrackingSession(deps, true);
		expect(deps.reminders.stop).toHaveBeenCalledWith(true);
		expect(deps.exercises.stop).not.toHaveBeenCalled();
		expect(deps.lookAway.stop).not.toHaveBeenCalled();
	});

	it("stopTrackingSession stops blink and eye-care when coupled", () => {
		const deps = createDeps({ eyeCareIndependentOfTracking: false });
		stopTrackingSession(deps, true);
		expect(deps.reminders.stop).toHaveBeenCalledWith(true);
		expect(deps.reminders.ensureStopped).not.toHaveBeenCalled();
		expect(deps.exercises.stop).toHaveBeenCalledOnce();
		expect(deps.lookAway.stop).toHaveBeenCalledOnce();
	});

	it("stopTrackingSession can tear down silently when coupled", () => {
		const deps = createDeps({ eyeCareIndependentOfTracking: false });
		stopTrackingSession(deps, false);
		expect(deps.reminders.ensureStopped).toHaveBeenCalledOnce();
		expect(deps.reminders.stop).not.toHaveBeenCalled();
		expect(deps.exercises.stop).toHaveBeenCalledOnce();
		expect(deps.lookAway.stop).toHaveBeenCalledOnce();
	});

	it("startTrackingSession starts only blink when eye-care is independent", () => {
		const deps = createDeps({
			eyeCareIndependentOfTracking: true,
			eyeExercisesEnabled: true,
			lookAwayEnabled: true,
			reminderInterval: 4000,
		});
		startTrackingSession(deps);
		expect(deps.reminders.start).toHaveBeenCalledWith(4000);
		expect(deps.exercises.start).not.toHaveBeenCalled();
		expect(deps.lookAway.start).not.toHaveBeenCalled();
	});

	it("startTrackingSession starts blink and resumes enabled eye-care when coupled", () => {
		const deps = createDeps({
			eyeCareIndependentOfTracking: false,
			eyeExercisesEnabled: true,
			lookAwayEnabled: true,
			reminderInterval: 4000,
		});
		startTrackingSession(deps);
		expect(deps.reminders.start).toHaveBeenCalledWith(4000);
		expect(deps.exercises.resetTimer).toHaveBeenCalledOnce();
		expect(deps.exercises.start).toHaveBeenCalledOnce();
		expect(deps.lookAway.resetTimer).toHaveBeenCalledOnce();
		expect(deps.lookAway.start).toHaveBeenCalledOnce();
	});

	it("startTrackingSession skips disabled eye-care prefs when coupled", () => {
		const deps = createDeps({
			eyeCareIndependentOfTracking: false,
			eyeExercisesEnabled: false,
			lookAwayEnabled: false,
		});
		startTrackingSession(deps, 3000);
		expect(deps.reminders.start).toHaveBeenCalledWith(3000);
		expect(deps.exercises.start).not.toHaveBeenCalled();
		expect(deps.lookAway.start).not.toHaveBeenCalled();
	});

	it("toggleTrackingSession starts only blink when independent", () => {
		const deps = createDeps({ eyeCareIndependentOfTracking: true });
		toggleTrackingSession(deps, false);
		expect(deps.reminders.start).toHaveBeenCalledWith(5000);
		expect(deps.exercises.start).not.toHaveBeenCalled();
		expect(deps.lookAway.start).not.toHaveBeenCalled();
	});

	it("toggleTrackingSession stops only blink when independent", () => {
		const deps = createDeps({ eyeCareIndependentOfTracking: true });
		toggleTrackingSession(deps, true);
		expect(deps.reminders.stop).toHaveBeenCalledWith(true);
		expect(deps.exercises.stop).not.toHaveBeenCalled();
		expect(deps.lookAway.stop).not.toHaveBeenCalled();
	});

	it("toggleTrackingSession starts blink and eye-care when coupled", () => {
		const deps = createDeps({ eyeCareIndependentOfTracking: false });
		toggleTrackingSession(deps, false);
		expect(deps.reminders.start).toHaveBeenCalledWith(5000);
		expect(deps.exercises.start).toHaveBeenCalledOnce();
		expect(deps.lookAway.start).toHaveBeenCalledOnce();
	});

	it("toggleTrackingSession stops blink and eye-care when coupled", () => {
		const deps = createDeps({ eyeCareIndependentOfTracking: false });
		toggleTrackingSession(deps, true);
		expect(deps.reminders.stop).toHaveBeenCalledWith(true);
		expect(deps.exercises.stop).toHaveBeenCalledOnce();
		expect(deps.lookAway.stop).toHaveBeenCalledOnce();
	});
});
