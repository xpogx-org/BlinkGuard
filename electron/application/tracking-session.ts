import type { AppPreferences } from "../../shared/preferences";
import type { ExerciseService } from "./exercise-service";
import type { LookAwayService } from "./look-away-service";
import type { ReminderService } from "./reminder-service";

/** Collaborators for a blink-tracking session that may also own eye-care timers. */
export type TrackingSessionDeps = {
	reminders: Pick<ReminderService, "start" | "stop" | "ensureStopped">;
	exercises: Pick<ExerciseService, "start" | "stop" | "resetTimer">;
	lookAway: Pick<LookAwayService, "start" | "stop" | "resetTimer">;
	preferences: Pick<
		AppPreferences,
		| "eyeExercisesEnabled"
		| "lookAwayEnabled"
		| "reminderInterval"
		| "eyeCareIndependentOfTracking"
	>;
};

/**
 * Stop blink tracking. When eye-care is coupled to reminders
 * (`eyeCareIndependentOfTracking === false`), also pause exercise / look-away
 * (prefs unchanged). Use `showStatus: false` for silent teardown.
 */
export function stopTrackingSession(
	deps: TrackingSessionDeps,
	showStatus = true,
): void {
	if (showStatus) {
		deps.reminders.stop(true);
	} else {
		deps.reminders.ensureStopped();
	}
	if (!deps.preferences.eyeCareIndependentOfTracking) {
		deps.exercises.stop();
		deps.lookAway.stop();
	}
}

/**
 * Start blink tracking. When eye-care is coupled, resume enabled timers and
 * reset due clocks so Stop→Start does not fire an immediate popup.
 * Independent mode leaves eye-care timers alone (owned by their own prefs).
 */
export function startTrackingSession(
	deps: TrackingSessionDeps,
	interval?: number,
): void {
	deps.reminders.start(interval ?? deps.preferences.reminderInterval);
	if (deps.preferences.eyeCareIndependentOfTracking) return;
	if (deps.preferences.eyeExercisesEnabled) {
		deps.exercises.resetTimer();
		deps.exercises.start();
	}
	if (deps.preferences.lookAwayEnabled) {
		deps.lookAway.resetTimer();
		deps.lookAway.start();
	}
}

/** Start or stop from the current armed `isTracking` flag (tray / shortcut). */
export function toggleTrackingSession(
	deps: TrackingSessionDeps,
	isTracking: boolean,
): void {
	if (isTracking) {
		stopTrackingSession(deps, true);
	} else {
		startTrackingSession(deps);
	}
}
